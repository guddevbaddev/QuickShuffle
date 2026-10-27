import { FEATURE_LEN, candidateRects, dequantize, fingerprint } from './fingerprint.ts';
import type { Card, SetFile } from './types.ts';

export interface Match {
  card: Card;
  score: number;
}

export interface MatchResult {
  best: Match | null;
  // Best scores for other distinct cards, highest first.
  others: Match[];
  // best.score minus the best score of a card with a different name.
  margin: number;
}

function decodeBase64(b64: string): Int8Array {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Int8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) << 24) >> 24;
    return out;
  }
  const buf = Buffer.from(b64, 'base64');
  return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
}

// Strip the variant suffix so alternate arts of one card count as the same name.
export function baseName(name: string): string {
  return name.replace(/\s*\((alternate art|signature|overnumbered|showcase|foil|promo)[^)]*\)\s*$/i, '').trim();
}

const SHORTLIST = 40;

export class Matcher {
  cards: Card[] = [];
  private rows: number[] = [];
  private feats = new Float32Array(0);

  constructor(files: SetFile[] = []) {
    this.setFiles(files);
  }

  setFiles(files: SetFile[]): void {
    const cards: Card[] = [];
    const rows: number[] = [];
    const chunks: Float32Array[] = [];
    for (const f of files) {
      const base = cards.length;
      cards.push(...f.cards);
      const q = decodeBase64(f.features);
      f.rows.forEach((cardIdx, r) => {
        rows.push(base + cardIdx);
        chunks.push(dequantize(q.subarray(r * FEATURE_LEN, (r + 1) * FEATURE_LEN)));
      });
    }
    const feats = new Float32Array(chunks.length * FEATURE_LEN);
    chunks.forEach((c, i) => feats.set(c, i * FEATURE_LEN));
    this.cards = cards;
    this.rows = rows;
    this.feats = feats;
  }

  // `rgba` is the guide box plus `pad` on each side (see candidateRects).
  match(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, pad: number, topN = 4): MatchResult {
    const nCards = this.cards.length;
    const best = new Float32Array(nCards).fill(-2);
    const feats = this.feats;
    const rows = this.rows;
    const rowScore = new Float32Array(rows.length);
    const score = (q: Float32Array, r: number) => {
      let s = 0;
      const off = r * FEATURE_LEN;
      for (let i = 0; i < FEATURE_LEN; i++) s += q[i] * feats[off + i];
      return s;
    };
    // Score every card against the centred crop, then refine only a shortlist
    // against the shifted/scaled crops.
    const rects = candidateRects(w, h, pad);
    const centre = rects.splice(Math.floor(rects.length / 2), 1)[0];
    const q0 = fingerprint(rgba, w, h, centre);
    for (let r = 0; r < rows.length; r++) rowScore[r] = score(q0, r);
    const shortlist = Array.from({ length: rows.length }, (_, i) => i)
      .sort((a, b) => rowScore[b] - rowScore[a])
      .slice(0, SHORTLIST);
    for (const rect of rects) {
      const q = fingerprint(rgba, w, h, rect);
      for (const r of shortlist) rowScore[r] = Math.max(rowScore[r], score(q, r));
    }
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r];
      if (rowScore[r] > best[c]) best[c] = rowScore[r];
    }
    const order = Array.from({ length: nCards }, (_, i) => i).sort((a, b) => best[b] - best[a]);
    if (nCards === 0) return { best: null, others: [], margin: 0 };
    const top = { card: this.cards[order[0]], score: best[order[0]] };
    const topName = baseName(top.card.name);
    let margin = top.score + 1;
    for (const i of order.slice(1)) {
      if (baseName(this.cards[i].name) !== topName) {
        margin = top.score - best[i];
        break;
      }
    }
    const others = order.slice(1, topN).map((i) => ({ card: this.cards[i], score: best[i] }));
    return { best: top, others, margin };
  }
}
