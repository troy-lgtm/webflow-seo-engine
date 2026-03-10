// Stable string hash — same input always produces the same integer.
// Uses djb2 variant for good distribution across lane keys.
export function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Seeded PRNG (linear congruential) — deterministic sequence from a seed integer.
// Usage: const rng = seededRng(stableHash("key")); rng(); rng(); ...
export function seededRng(seed) {
  let s = (seed | 0) || 1;
  return function next() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Convenience: hash a string and return an RNG seeded from it.
export function rngFromKey(str) {
  return seededRng(stableHash(str));
}
