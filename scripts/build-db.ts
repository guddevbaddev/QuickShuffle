// Downloads the Riftbound card list from riftcodex.com, fetches a small image
// of every card and writes per-set fingerprint databases to public/data/.
//
//   npm run build:db
//
// Images are cached in .cache/images so re-runs only fetch new cards.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fingerprint, quantize, REF_W, REF_H, FEATURE_LEN } from '../src/fingerprint.ts';
import type { Card, SetInfo, SetFile, GameIndex } from '../src/types.ts';

const API = 'https://api.riftcodex.com';
const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'images');
const OUT = path.join(ROOT, 'public', 'data');

interface ApiCard {
  id: string;
  name: string;
  collector_number: number | null;
  classification: { type: string; supertype: string | null; rarity: string; domain: string[] | null };
  set: { set_id: string; label: string };
  media: { image_url: string };
  tags: string[] | null;
  orientation: string;
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function thumbUrl(imageUrl: string, width: number): string {
  const u = new URL(imageUrl);
  u.searchParams.set('w', String(width));
  u.searchParams.set('fm', 'jpg');
  return u.toString();
}

async function cachedImage(card: ApiCard): Promise<Buffer> {
  const file = path.join(CACHE, `${card.id}.jpg`);
  if (await exists(file)) return readFile(file);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(thumbUrl(card.media.image_url, 360));
      if (!res.ok) throw new Error(`${res.status} image ${card.name}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

// Raw RGBA of an image resized to the reference size, optionally rotated.
export async function refPixels(img: Buffer, rotate: number): Promise<Uint8Array> {
  const { data } = await sharp(img)
    .rotate(rotate)
    .resize(REF_W, REF_H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const sets = (await getJson<{ items: { set_id: string; name: string; card_count: number; published_on: string }[] }>(`${API}/sets`)).items;
  const all: ApiCard[] = [];
  for (let page = 1; ; page++) {
    const res = await getJson<{ items: ApiCard[]; pages: number }>(`${API}/cards?size=100&page=${page}`);
    all.push(...res.items);
    if (page >= res.pages) break;
  }
  console.log(`${all.length} cards in ${sets.length} sets`);

  const index: GameIndex = { game: 'riftbound', generated: new Date().toISOString(), sets: [] };
  const sorted = [...sets].sort((a, b) => a.published_on.localeCompare(b.published_on));
  for (const s of sorted) {
    const apiCards = all
      .filter((c) => c.set.set_id === s.set_id && c.media?.image_url)
      .sort((a, b) => (a.collector_number ?? 0) - (b.collector_number ?? 0) || a.name.localeCompare(b.name));
    if (apiCards.length === 0) continue;
    const info: SetInfo = { id: s.set_id, name: s.name, count: apiCards.length, released: s.published_on.slice(0, 10) };
    const cards: Card[] = [];
    const rows: number[] = [];
    const feats: Int8Array[] = [];
    let done = 0;
    const work = apiCards.map((c) => async () => {
      const img = await cachedImage(c);
      const rotations = c.orientation === 'landscape' ? [90, 270] : [0];
      const out: Int8Array[] = [];
      for (const r of rotations) {
        const px = await refPixels(img, r);
        out.push(quantize(fingerprint(px, REF_W, REF_H, { x: 0, y: 0, w: REF_W, h: REF_H })));
      }
      done++;
      if (done % 50 === 0) console.log(`  ${s.set_id}: ${done}/${apiCards.length}`);
      return out;
    });
    const results = await runPool(work, 8);
    apiCards.forEach((c, i) => {
      cards.push({
        id: c.id,
        name: c.name,
        set: c.set.set_id,
        num: c.collector_number,
        type: c.classification.type,
        supertype: c.classification.supertype,
        rarity: c.classification.rarity,
        domains: c.classification.domain ?? [],
        tags: c.tags ?? [],
        img: thumbUrl(c.media.image_url, 240),
      });
      for (const f of results[i]) {
        rows.push(i);
        feats.push(f);
      }
    });
    const blob = new Int8Array(feats.length * FEATURE_LEN);
    feats.forEach((f, i) => blob.set(f, i * FEATURE_LEN));
    const file: SetFile = {
      set: info,
      cards,
      rows,
      features: Buffer.from(blob.buffer).toString('base64'),
    };
    await writeFile(path.join(OUT, `cards-${s.set_id}.json`), JSON.stringify(file));
    index.sets.push(info);
    console.log(`${s.set_id} ${s.name}: ${cards.length} cards`);
  }
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
}

async function runPool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  await main();
}
