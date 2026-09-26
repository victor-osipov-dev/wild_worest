// Детерминированный value-noise + FBM, приближение Simplex из terrain.gd.
// Формула оригинала: h = FBM(0.007, 5 oct)*8 + FBM(0.045, 3 oct)*0.6,
// flatten к 0 в радиусе 30..45м от нуля, яма -14м в (8,0) r3.2/edge1.0.

export const HOUSE_POS = { x: -8, z: -5 };
export const PIT_CENTER = { x: 8, z: 0 };
export const PIT_R = 3.2, PIT_EDGE = 1.0, PIT_DEPTH = 14.0;

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v; // 0..1
}

function fbm(x, y, oct, lac = 2, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm; // 0..1
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function baseHeight(x, z) {
  // Как в terrain.gd: Simplex seed 1337, FBM 5 октав, ±8м + detail (seed+7) 3 октавы ±0.6м.
  // Наш fbm() возвращает 0..1, поэтому приводим к [-1,1] — та же амплитуда, тот же сид каждый запуск.
  const n1 = fbm(x * 0.007 + 13.7, z * 0.007 + 7.1, 5, 2, 0.5);
  const n2 = fbm(x * 0.045 + 3.3, z * 0.045 + 9.9, 3, 2, 0.5);
  return (n1 * 2 - 1) * 8.0 + (n2 * 2 - 1) * 0.6;
}

export function getHeight(x, z) {
  let h = baseHeight(x, z);
  const d0 = Math.hypot(x, z);
  const flat = smoothstep(30, 45, d0);
  h = h * flat;
  const dp = Math.hypot(x - PIT_CENTER.x, z - PIT_CENTER.z);
  const pitT = 1 - smoothstep(PIT_R, PIT_R + PIT_EDGE, dp);
  h -= PIT_DEPTH * pitT;
  return h;
}

// Детерминированный хэш клетки для растительности (как в terrain.gd).
export function cellHash(cx, cz) {
  return hash2(cx, cz);
}

export function rand01(seedObj) {
  // mulberry32
  seedObj.s = (seedObj.s + 0x6D2B79F5) | 0;
  let t = Math.imul(seedObj.s ^ (seedObj.s >>> 15), 1 | seedObj.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
