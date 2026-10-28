/**
 * Table payloads. In the file a payload is base64(gzip(CSV|JSON)). In memory it is bytes in a Blob, which the
 * browser keeps outside the JavaScript heap (a 2M-row table's payload is ~200 MB), and the document holds a short
 * reference instead ("@gzip:3"), so undo snapshots never copy data either. Saving writes the base64 back in
 * pieces, never as one huge string.
 */

const REF = '@gzip:';
const held = new Map<string, Blob>();
let next = 0;

/** True for an in-memory reference (as opposed to base64 text, e.g. straight from a file). */
export const isHeld = (payload: string) => payload.startsWith(REF) && held.has(payload);

const hold = (blob: Blob) => {
  const ref = REF + ++next;
  held.set(ref, blob);
  return ref;
};

/** base64 characters decoded per step: a multiple of 4. */
const B64_CHUNK = 1 << 22;

/**
 * base64 → bytes, a few MB at a time. Decoding a 200 MB payload in one go (atob, then a byte per character)
 * needs gigabytes and crashes the tab; streamed, only one chunk is in memory at once.
 */
function base64Stream(b64: string): ReadableStream<BufferSource> {
  if (/\s/.test(b64)) b64 = b64.replace(/\s+/g, ''); // hand-edited payloads may be wrapped
  let pos = 0;
  return new ReadableStream({
    pull(out) {
      if (pos >= b64.length) return out.close();
      const bin = atob(b64.slice(pos, (pos += B64_CHUNK)));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      out.enqueue(bytes);
    }
  });
}

const gunzip = (bytes: ReadableStream<BufferSource>) => new Response(bytes.pipeThrough(new DecompressionStream('gzip'))).text();
const decode = (b64: string) => new Response(base64Stream(b64)).blob();

/** base64(gzip(text)) → text. */
export const decompressPayload = (payload: string) => gunzip(base64Stream(payload));

/** Keeps base64 text from a file as in-memory bytes; returns its reference. */
export const holdBase64 = async (b64: string) => hold(await decode(b64));


/** Compresses new data into memory; returns its reference. */
export const holdText = async (text: string) => hold(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob());

/** The CSV/JSON text of a payload (a reference or base64). */
export const payloadText = (payload: string) => gunzip(held.get(payload)?.stream() ?? base64Stream(payload));

/** The payload's size in the saved file (base64 characters). */
export function payloadSize(payload: string): number {
  const blob = held.get(payload);
  return blob ? Math.ceil(blob.size / 3) * 4 : payload.length;
}

/** A payload as base64, in pieces (for writing it into a file). */
async function base64Parts(payload: string): Promise<string[]> {
  const blob = held.get(payload);
  if (!blob) return [payload];
  const out: string[] = [];
  const step = 3 * (1 << 18); // ~768 KB of bytes at a time
  for (let i = 0; i < blob.size; i += step) {
    const bytes = new Uint8Array(await blob.slice(i, i + step).arrayBuffer());
    // in pieces of 3 × 8192 bytes: no single huge binary string
    for (let j = 0; j < bytes.length; j += 3 * 8192) out.push(btoa(String.fromCharCode(...bytes.subarray(j, j + 3 * 8192))));
  }
  return out;
}

/** Text with payload references swapped for their base64, as parts of a Blob (for saving and exporting). */
export async function expandPayloads(text: string): Promise<BlobPart[]> {
  const parts: BlobPart[] = [];
  let last = 0;
  // only a table's payload is a reference: the same text typed in a title stays as typed
  for (const m of text.matchAll(/"payload":\s*"(@gzip:\d+)"/g)) {
    const ref = m[1];
    if (!held.has(ref)) continue;
    const at = m.index! + m[0].length - ref.length - 1;
    parts.push(text.slice(last, at));
    parts.push(...(await base64Parts(ref)));
    last = at + ref.length;
  }
  parts.push(text.slice(last));
  return parts;
}
