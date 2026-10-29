/**
 * Optional password encryption of a file's data, with the Web Crypto API only. Every table's payload goes into one
 * AES-256-GCM ciphertext, under a key derived from the password (PBKDF2-SHA256, 600,000 iterations, a random 16-byte
 * salt); each save draws a fresh 12-byte IV. The file holds `Sealed` and never the password or the key. The
 * plaintext is a JSON line of [table, byte length] pairs, then those tables' gzip bytes back to back.
 */

export interface Sealed {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64 (in memory: a payload reference, see payloads.ts)
}

/** A derived key and what derived it: entered once per file, then every save encrypts with it. */
export type Lock = { key: CryptoKey; salt: Uint8Array<ArrayBuffer>; iterations: number };

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** The key for a password: a new random salt, or the one an encrypted file was saved with. */
export async function deriveLock(password: string, from?: Pick<Sealed, 'salt' | 'iterations'>): Promise<Lock> {
  const salt = from ? unb64(from.salt) : crypto.getRandomValues(new Uint8Array(16));
  const iterations = from?.iterations ?? 600_000;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, salt, iterations };
}

/** Encrypts the tables' bytes into one ciphertext, under a fresh IV. */
export async function seal(lock: Lock, tables: [string, Blob][]): Promise<[Omit<Sealed, 'ciphertext'>, Blob]> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Blob([JSON.stringify(tables.map(([id, b]) => [id, b.size])) + '\n', ...tables.map(t => t[1])]);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, lock.key, await plain.arrayBuffer());
  return [{ version: 1, kdf: 'PBKDF2-SHA256', iterations: lock.iterations, salt: b64(lock.salt), iv: b64(iv) }, new Blob([cipher])];
}

/** The tables' bytes back from a ciphertext. Throws on a wrong password or any change to the ciphertext (GCM). */
export async function unseal(lock: Lock, sealed: Pick<Sealed, 'version' | 'kdf' | 'iv'>, cipher: Blob): Promise<[string, Blob][]> {
  if (sealed.version !== 1 || sealed.kdf !== 'PBKDF2-SHA256') throw new Error('unknown encryption');
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, lock.key, await cipher.arrayBuffer()));
  const nl = plain.indexOf(10);
  let at = nl + 1;
  return (JSON.parse(new TextDecoder().decode(plain.subarray(0, nl))) as [string, number][]).map(([id, n]) => [id, new Blob([plain.subarray(at, (at += n))])]);
}
