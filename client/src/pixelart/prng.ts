// Deterministic PRNG for procedural pixel-art. Seeded from (worldSeed, assetKey) so every
// asset is reproducible and independent of generation order — never Math.random / time.

export function hashKey(seed: number, key: string): number {
  let h = (seed ^ 0x811c9dc5) | 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 15;
  return h >>> 0;
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function prngFor(seed: number, key: string): () => number {
  return mulberry32(hashKey(seed, key));
}
