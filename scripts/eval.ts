// Simulates phone-camera captures of every card in a set (tilt, offset, zoom,
// lighting, colour cast, blur, glare, JPEG) and reports how often the matcher
// picks the right card. Requires `npm run build:db` to have filled .cache/.
//
//   node scripts/eval.ts [SET...] [--slots FILE]     (default: OGN)
//
// With --slots, also reports how often each card lands in the right break slot.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Matcher, baseName } from '../src/matcher.ts';
import { parseSlots, slotsFor, type Slot } from '../src/slots.ts';
import { REF_W, REF_H } from '../src/fingerprint.ts';
import type { SetFile } from '../src/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAD = 0.12;
const QW = Math.round(REF_W * (1 + 2 * PAD));
const QH = Math.round(REF_H * (1 + 2 * PAD));

let seed = 12345;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const between = (a: number, b: number) => a + (b - a) * rand();

async function simulateCapture(img: Buffer, landscape: boolean): Promise<Uint8Array> {
  const scale = between(0.93, 1.07);
  const cw = Math.round(REF_W * 2 * scale);
  const chh = Math.round(REF_H * 2 * scale);
  const angle = between(-4, 4) + (landscape ? (rand() < 0.5 ? 90 : 270) : 0);
  const bright = between(0.65, 1.3);
  const tint = { r: between(-25, 25), g: between(-15, 15), b: between(-30, 30) };
  const cardBuf = await sharp(img)
    .resize(landscape ? chh : cw, landscape ? cw : chh, { fit: 'fill' })
    .rotate(angle, { background: { r: 40, g: 40, b: 45, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(cardBuf).metadata();
  const W = QW * 2;
  const H = QH * 2;
  const left = Math.round((W - meta.width!) / 2 + between(-0.03, 0.03) * REF_W * 2);
  const top = Math.round((H - meta.height!) / 2 + between(-0.03, 0.03) * REF_H * 2);
  const bg = { r: Math.round(between(20, 200)), g: Math.round(between(20, 180)), b: Math.round(between(20, 160)) };
  const glareSize = Math.round(between(40, 140));
  const glare = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><radialGradient id="g"><stop offset="0" stop-color="white" stop-opacity="${between(0.2, 0.7).toFixed(2)}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="${between(0.2, 0.8) * W}" cy="${between(0.2, 0.8) * H}" r="${glareSize}" fill="url(#g)"/></svg>`,
  );
  const composed = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([
      { input: cardBuf, left: Math.max(-meta.width!, left), top: Math.max(-meta.height!, top) },
      { input: glare, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  const jpeg = await sharp(composed)
    .linear([bright, bright, bright], [tint.r, tint.g, tint.b])
    .blur(between(0.4, 2.0))
    .jpeg({ quality: Math.round(between(40, 85)) })
    .toBuffer();
  const { data } = await sharp(jpeg).resize(QW, QH, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

async function main() {
  const args = process.argv.slice(2);
  const slotsArg = args.indexOf('--slots');
  let slots: Slot[] | null = null;
  if (slotsArg >= 0) {
    slots = parseSlots(await readFile(args[slotsArg + 1], 'utf8'));
    args.splice(slotsArg, 2);
  }
  const sets = args;
  if (sets.length === 0) sets.push('OGN');
  const slotOf = (c: (typeof matcher.cards)[number]) => {
    const i = slotsFor(c, slots ?? [], true)[0];
    return i === undefined ? 'No slot' : slots![i].name;
  };
  let rightSlot = 0;
  const slotFailures: string[] = [];
  const files: SetFile[] = [];
  for (const s of sets) files.push(JSON.parse(await readFile(path.join(ROOT, 'public', 'data', `cards-${s}.json`), 'utf8')));
  const matcher = new Matcher(files);
  const landscape = new Set<string>();
  for (const f of files) {
    const count = new Map<number, number>();
    for (const r of f.rows) count.set(r, (count.get(r) ?? 0) + 1);
    for (const [i, n] of count) if (n > 1) landscape.add(f.cards[i].id);
  }

  let exact = 0, sameName = 0, sameTags = 0, total = 0, ms = 0;
  const goodScores: number[] = [];
  const badScores: number[] = [];
  const failures: string[] = [];
  for (const card of matcher.cards) {
    const img = await readFile(path.join(ROOT, '.cache', 'images', `${card.id}.jpg`));
    const px = await simulateCapture(img, landscape.has(card.id));
    const t0 = performance.now();
    const res = matcher.match(px, QW, QH, PAD);
    ms += performance.now() - t0;
    total++;
    const got = res.best!.card;
    if (got.id === card.id) exact++;
    if (baseName(got.name) === baseName(card.name)) {
      sameName++;
      goodScores.push(res.best!.score);
    } else {
      badScores.push(res.best!.score);
      failures.push(`${card.name}  ->  ${got.name}  (${res.best!.score.toFixed(3)}, margin ${res.margin.toFixed(3)})`);
    }
    if (got.tags.join('|') === card.tags.join('|')) sameTags++;
    if (slots) {
      if (slotOf(got) === slotOf(card)) rightSlot++;
      else slotFailures.push(`${card.name} [${slotOf(card)}]  ->  ${got.name} [${slotOf(got)}]  (${res.best!.score.toFixed(3)})`);
    }
  }

  // Captures with no card in the frame, for picking a rejection threshold.
  const emptyScores: number[] = [];
  for (let i = 0; i < 40; i++) {
    const bg = { r: Math.round(between(0, 255)), g: Math.round(between(0, 255)), b: Math.round(between(0, 255)) };
    const noise = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .png()
      .toBuffer();
    const img = await sharp({ create: { width: QW, height: QH, channels: 3, background: bg } })
      .composite([{ input: await sharp(noise).resize(QW, QH).blur(3).toBuffer(), blend: 'soft-light' }])
      .ensureAlpha()
      .raw()
      .toBuffer();
    emptyScores.push(matcher.match(new Uint8Array(img), QW, QH, PAD).best!.score);
  }

  const pct = (n: number) => `${((100 * n) / total).toFixed(1)}%`;
  const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))].toFixed(3) : '-');
  console.log(`sets ${sets.join(',')}  cards ${total}  avg match ${(ms / total).toFixed(1)} ms`);
  console.log(`exact card ${pct(exact)}   same name ${pct(sameName)}   same tags ${pct(sameTags)}`);
  console.log(`correct score p5/p50: ${q(goodScores, 0.05)} / ${q(goodScores, 0.5)}`);
  console.log(`wrong score p50/p95: ${q(badScores, 0.5)} / ${q(badScores, 0.95)}`);
  console.log(`empty-frame score p50/max: ${q(emptyScores, 0.5)} / ${q(emptyScores, 1)}`);
  if (slots) {
    console.log(`right slot ${pct(rightSlot)} (${rightSlot}/${total})`);
    if (slotFailures.length) console.log('wrong slot:\n  ' + slotFailures.join('\n  '));
  } else if (failures.length) console.log('failures:\n  ' + failures.slice(0, 25).join('\n  '));
}

await main();
