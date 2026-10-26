/** mulberry32: small deterministic PRNG. Same seed -> same sequence, always. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function hexFromRng(rng: () => number, chars: number): string {
  const hex = "0123456789abcdef"; let out = "";
  for (let i = 0; i < chars; i++) out += hex[Math.floor(rng() * 16)];
  return out === "0".repeat(chars) ? "1" + out.slice(1) : out;
}
export function pick<T>(rng: () => number, arr: readonly T[]): T { return arr[Math.floor(rng() * arr.length)]; }
