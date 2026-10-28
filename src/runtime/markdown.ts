export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (t: string) =>
  esc(t)
    .replace(/"/g, '&quot;')
    // a backslash keeps the next mark as text
    .replace(/\\(&gt;|[\\`*_[\]|#+.-])/g, (_, c) => (c[1] ? c : `&#${c.charCodeAt(0)};`))
    // a link's address is as written: its * and _ aren't emphasis
    .replace(/\]\((?:https?:|mailto:|#)[^)]*\)/g, m => m.replace(/[*_]/g, c => `&#${c.charCodeAt(0)};`))
    // code is as written: its marks become entities the styling below doesn't see
    .replace(/`([^`]+)`/g, (_, c) => `<code class="md-inline-code">${c.replace(/[*_[\]]/g, (m: string) => `&#${m.charCodeAt(0)};`)}</code>`)
    // underscores inside a word (snake_case, URLs) are just underscores
    .replace(/\*\*([^*]+)\*\*|\b__([^_]+)__\b/g, '<strong>$1$2</strong>')
    .replace(/\*([^*]+)\*|\b_([^_]+)_\b/g, '<em>$1$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:|mailto:|#)[^)]*)\)/g, (_, t, h) => `<a href="${h.replace(/&#(42|95);/g, (_: string, c: string) => String.fromCharCode(+c))}" target="_blank" rel="noopener noreferrer" class="md-link">${t}</a>`);

/** A small Markdown-to-HTML converter: headings, lists, quotes, rules, code blocks, tables and inline styles. Input is escaped. */
export function parseMarkdown(md: string): string {
  const out: string[] = [];
  let open = ''; // the closing tag of the list/table being built
  let code: string[] | null = null;
  let m: RegExpExecArray | null;
  const close = () => (open && out.push(open), (open = ''));
  const block = (start: string, end: string) => {
    if (open !== end) (close(), out.push(start), (open = end));
  };
  const pre = () => out.push(`<pre class="md-code-block"><code>${code!.join('\n')}</code></pre>`);

  for (const line of (md || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('```')) {
      if (code) (pre(), (code = null));
      else (close(), (code = []));
    } else if (code) code.push(esc(line));
    else if (t.startsWith('|') && t.endsWith('|')) {
      const cells = t.slice(1, -1).split(/(?<!\\)\|/).map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      const head = open !== '</tbody></table></div>';
      block('<div class="md-table-wrap"><table class="md-table">', '</tbody></table></div>');
      const tag = head ? 'th' : 'td';
      out.push(`${head ? '<thead>' : ''}<tr>${cells.map(c => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>${head ? '</thead><tbody>' : ''}`);
    } else if ((m = /^(?:([*+-])|\d+\.)\s+([^]*)/.exec(t))) {
      m[1] ? block('<ul class="md-list">', '</ul>') : block('<ol class="md-ordered-list">', '</ol>');
      out.push(`<li>${inline(m[2])}</li>`);
    } else {
      close();
      if ((m = /^(#{1,4}) (.*)/.exec(line))) out.push(`<h${m[1].length} class="md-h${m[1].length}">${inline(m[2])}</h${m[1].length}>`);
      else if (/^(\*{3,}|-{3,}|_{3,})$/.test(t)) out.push('<hr class="md-hr" />');
      else if (line.startsWith('> ')) out.push(`<blockquote class="md-quote">${inline(line.slice(2))}</blockquote>`);
      else if (t) out.push(`<p class="md-p">${inline(line)}</p>`);
    }
  }
  if (code) pre();
  close();
  return out.join('\n');
}
