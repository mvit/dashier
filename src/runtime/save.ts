import { DashDocument, createDefaultDocument } from '../types/model';
import { expandPayloads } from './payloads';

let pristineHtml = '';
let activeFileHandle: FileSystemFileHandle | null = null;

const DOC_SCRIPT = /(<script\s+[^>]*id=["']dashier-doc["'][^>]*>)[\s\S]*?(<\/script>)/i;

const pageHtml = () => '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

/** Captures the page HTML before the app mutates the DOM; saving writes this back with the new document. */
export function capturePristine() {
  pristineHtml = pageHtml();
}

/** Reads and parses the embedded document from <script type="application/dashier+json" id="dashier-doc"> */
export function readEmbeddedDoc(): DashDocument {
  const el = document.getElementById('dashier-doc');
  const raw = el?.textContent;
  // the document can be hundreds of MB: once read, the page keeps no copy (saving writes the current one back)
  if (el) el.textContent = '';
  try {
    const parsed = raw?.trim() && JSON.parse(raw);
    if (Array.isArray(parsed?.pages) && parsed.pages.length) {
      parsed.sources ||= {};
      return parsed;
    }
  } catch (err) {
    console.warn('[dashier] Failed to parse #dashier-doc JSON, falling back to an empty dashboard:', err);
  }
  return createDefaultDocument();
}

/**
 * Injects the document (and the title) into the pristine HTML. Every '<' is escaped so no string can end the
 * script block. Payloads are still in-memory references here (see payloads.ts): expandPayloads writes them out.
 */
function generateSelfContainedHtml(doc: DashDocument): string {
  const serialized = JSON.stringify(doc, null, 2).replace(/</g, '\\u003c');
  const title = doc.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = (pristineHtml || pageHtml()).replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`);
  return DOC_SCRIPT.test(html)
    ? html.replace(DOC_SCRIPT, (_m, start, end) => `${start}\n${serialized}\n  ${end}`)
    : html.replace('</head>', () => `  <script type="application/dashier+json" id="dashier-doc">\n${serialized}\n  <` + `/script>\n</head>`);
}

const fileName = (doc: DashDocument, ext: string) =>
  (doc.title.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '_') || 'dashboard') + ext;

function download(content: Blob, name: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(content), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function writeTo(handle: any, content: Blob) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Self-save: writes in place through the File System Access API when a handle exists,
 * otherwise asks where to save, otherwise downloads.
 */
export async function saveDocument(
  doc: DashDocument,
  options?: { forceSaveAs?: boolean }
): Promise<{ success: boolean; mode: 'file-handle' | 'download'; fileName: string }> {
  // built from parts: a 200 MB payload is never one string
  const html = new Blob(await expandPayloads(generateSelfContainedHtml(doc)), { type: 'text/html;charset=utf-8' });
  const name = fileName(doc, '.dashier.html');

  if (!options?.forceSaveAs && activeFileHandle) {
    try {
      await writeTo(activeFileHandle, html);
      return { success: true, mode: 'file-handle', fileName: activeFileHandle.name };
    } catch (err) {
      console.warn('[dashier] Failed to write to the existing file handle, asking again:', err);
      activeFileHandle = null;
    }
  }

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Dashier dashboard', accept: { 'text/html': ['.html'] } }]
      });
      await writeTo(handle, html);
      activeFileHandle = handle;
      return { success: true, mode: 'file-handle', fileName: handle.name };
    } catch (err: any) {
      if (err.name === 'AbortError') return { success: false, mode: 'file-handle', fileName: name };
      console.warn('[dashier] showSaveFilePicker failed, downloading instead:', err);
    }
  }

  download(html, name);
  return { success: true, mode: 'download', fileName: name };
}

export async function exportDocumentJSON(doc: DashDocument) {
  download(new Blob(await expandPayloads(JSON.stringify(doc, null, 2)), { type: 'application/json;charset=utf-8' }), fileName(doc, '.dashier.json'));
}
