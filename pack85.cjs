// Base85 for the packed app code: 5 characters per 4 bytes (base64 takes 5⅓). The alphabet is printable ASCII
// without " & ' < > \ ` (so the text can sit in a <script> block and a JS string) and without { }.
// A last group of n bytes is written as n+1 characters and read back padded with the highest digit, as in Ascii85.
const ALPHABET = [...Array(94)].map((_, i) => String.fromCharCode(33 + i)).filter(c => !`"&'<>\\\`{}`.includes(c)).join('');

function encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const n = Math.min(4, bytes.length - i);
    let v = 0;
    for (let j = 0; j < 4; j++) v = v * 256 + (j < n ? bytes[i + j] : 0);
    let group = '';
    for (let j = 0; j < 5; j++) (group = ALPHABET[v % 85] + group), (v = Math.floor(v / 85));
    out += group.slice(0, n + 1);
  }
  return out;
}

/** The browser's decoder (inlined in the loader): text → bytes. */
const DECODE = `t=>{const m=[],n=t.length,b=new Uint8Array(n*4/5|0);for(let i=0;i<85;i++)m[${JSON.stringify(ALPHABET)}.charCodeAt(i)]=i;for(let i=0,p=0;i<n;i+=5){let v=0;for(let j=0;j<5;j++)v=v*85+(i+j<n?m[t.charCodeAt(i+j)]:84);for(let j=0;j<4&&p<b.length;j++)b[p++]=v>>>24-8*j}return b}`;

const decode = (text) => Buffer.from(eval(DECODE)(text.replace(/\s/g, '')));

module.exports = { ALPHABET, encode, decode, DECODE };
