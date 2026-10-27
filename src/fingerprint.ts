// Image fingerprinting shared by the browser scanner and the Node build script.
// A card is reduced to a small colour grid; two cards match when the cosine
// similarity of their grids is high. Brightness/contrast and white-balance
// shifts are mostly cancelled by per-channel mean removal and normalisation.

export const GRID_W = 16;
export const GRID_H = 22;
export const FEATURE_LEN = GRID_W * GRID_H * 3;

// Reference card images are rasterised at this size before fingerprinting.
export const REF_W = 120;
export const REF_H = 168;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLOR_WEIGHT = 0.6;

// Computes the fingerprint of `rect` within an RGBA buffer of size w*h.
export function fingerprint(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, rect: Rect): Float32Array {
  const out = new Float32Array(FEATURE_LEN);
  const cells = GRID_W * GRID_H;
  const cw = rect.w / GRID_W;
  const ch = rect.h / GRID_H;
  for (let gy = 0; gy < GRID_H; gy++) {
    const y0 = Math.max(0, Math.floor(rect.y + gy * ch));
    const y1 = Math.min(h, Math.max(y0 + 1, Math.floor(rect.y + (gy + 1) * ch)));
    for (let gx = 0; gx < GRID_W; gx++) {
      const x0 = Math.max(0, Math.floor(rect.x + gx * cw));
      const x1 = Math.min(w, Math.max(x0 + 1, Math.floor(rect.x + (gx + 1) * cw)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          n++;
        }
      }
      if (n === 0) n = 1;
      r /= n; g /= n; b /= n;
      const c = gy * GRID_W + gx;
      out[c] = (r + g + b) / 3;
      out[cells + c] = (r - g) * COLOR_WEIGHT;
      out[2 * cells + c] = ((r + g) / 2 - b) * COLOR_WEIGHT;
    }
  }
  for (let k = 0; k < 3; k++) {
    let mean = 0;
    for (let c = 0; c < cells; c++) mean += out[k * cells + c];
    mean /= cells;
    for (let c = 0; c < cells; c++) out[k * cells + c] -= mean;
  }
  normalize(out);
  return out;
}

export function normalize(v: Float32Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
}

// Candidate crops around the guide box, used to tolerate a card that is held
// slightly off-centre or at a slightly different distance. The query buffer
// covers the guide box plus `pad` (fraction of guide size) on every side.
export function candidateRects(bufW: number, bufH: number, pad: number): Rect[] {
  const gw = bufW / (1 + 2 * pad);
  const gh = bufH / (1 + 2 * pad);
  const cx = bufW / 2;
  const cy = bufH / 2;
  const rects: Rect[] = [];
  for (const s of [0.9, 1.0, 1.1]) {
    const w = gw * s;
    const h = gh * s;
    for (const dy of [-0.04, 0, 0.04]) {
      for (const dx of [-0.04, 0, 0.04]) {
        rects.push({ x: cx - w / 2 + dx * gw, y: cy - h / 2 + dy * gh, w, h });
      }
    }
  }
  return rects;
}

// int8 quantisation for compact storage of reference fingerprints.
export function quantize(v: Float32Array): Int8Array {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const q = new Int8Array(v.length);
  const k = max > 0 ? 127 / max : 0;
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] * k);
  return q;
}

export function dequantize(q: Int8Array): Float32Array {
  const v = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) v[i] = q[i];
  normalize(v);
  return v;
}
