import type { Card } from './types.ts';

export interface Slot {
  name: string;
  // Each rule is a list of conditions that must all hold; the slot matches if any rule does.
  rules: Condition[][];
}

interface Condition {
  field: 'any' | 'name' | 'tag' | 'domain' | 'type' | 'rarity' | 'set' | 'number' | 'holo';
  value: string;
  negate: boolean;
}

const FIELDS = new Set(['name', 'tag', 'domain', 'type', 'rarity', 'set', 'number']);

// Parses the slot editor text. One slot per line. Plain lines are meant to be
// pasted straight from a listing:
//
//   🔥 Ahri + Fizz 🔥  $13.00    -> combo slot "Ahri + Fizz"; emojis, prices and "1." numbering
//                                  are dropped, and + / & , | "and" all join characters
//   Epic, Holo Gear, Alt Art Runes -> keyword slots: rarity, card type, domain, holo/foil,
//                                  alt art, overnumbered (plurals are fine); "top" means epic
//
// Lines with "=" give exact rules:
//
//   Team Zaun = zaun, ekko     -> any of the comma-separated terms
//   Epics = rarity:epic        -> field filters: name tag domain type rarity set number
//   Jinx foils = jinx & rarity:showcase   -> here "&" joins conditions that must all hold
//   Jinx no legend = jinx & !type:legend   -> "!" negates a condition
//   Gear = type:gear & holo    -> "holo" (or "foil") can't be seen by the camera, so the
//                                 scanner asks when the answer changes the slot
//
// Blank lines and lines starting with "#" (not "#3") are ignored. Passing the
// loaded cards lets a phrase that mixes a keyword into a real card name ("Rune
// Prison") stay a name.
export function parseSlots(text: string, cards: Card[] = []): Slot[] {
  const slots: Slot[] = [];
  for (const raw of text.split('\n')) {
    if (/^\s*#(?!\d)/.test(raw)) continue;
    const line = cleanLine(raw);
    if (!line || /^[\d\s.,]+$/.test(line)) continue;
    const eq = line.indexOf('=');
    let name: string;
    let rules: Condition[][];
    if (eq >= 0) {
      name = line.slice(0, eq).trim();
      rules = line
        .slice(eq + 1)
        .split(',')
        .map((t) => t.split('&').flatMap((c) => parseCondition(c, cards)));
    } else {
      name = line;
      rules = line.split(/\s*(?:[+\/&|,]|\band\b)\s*/i).map((t) => parseCondition(t, cards));
    }
    rules = rules.filter((r) => r.length > 0);
    if (name && rules.length) slots.push({ name, rules });
  }
  return slots;
}

// Strips what listings decorate slot names with: emojis, prices, list numbering.
export function cleanLine(raw: string): string {
  return raw
    .replace(/[’‘`´]/g, "'")
    .replace(/[•·]/g, '+')
    .replace(/[$€£]\s*\d[\d,]*(?:\.\d+)?/g, ' ')
    .replace(/[^\p{L}\p{N}\s'.\-+\/&,|:!=]/gu, ' ')
    .replace(/^\s*(?:slot\s*)?\d+\s*[.):\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-.,+\/&|]+|[\s\-.,+\/&|]+$/g, '');
}

const KEYWORDS: Record<string, Condition> = {};
const kw = (words: string[], field: Condition['field'], value: string) => {
  for (const w of words) KEYWORDS[w] = { field, value, negate: false };
};
for (const r of ['common', 'uncommon', 'rare', 'epic', 'showcase', 'promo']) kw([r, `${r}s`], 'rarity', r);
for (const t of ['unit', 'spell', 'gear', 'legend', 'rune', 'battlefield', 'champion', 'signature', 'token']) kw([t, `${t}s`], 'type', t);
for (const d of ['fury', 'calm', 'mind', 'body', 'chaos', 'order']) kw([d], 'domain', d);
kw(['holo', 'holos', 'foil', 'foils'], 'holo', '');
// Breaker shorthand: "Top Units" = epic units.
kw(['top'], 'rarity', 'epic');
kw(['alt art', 'alt arts', 'alternate art', 'alternate arts', 'alt-art', 'alt-arts'], 'name', 'alternate art');
kw(['overnumbered', 'overnumber', 'overnumbers'], 'name', 'overnumbered');
const FILLER = new Set(['all', 'any', 'the', 'card', 'cards', 'only', 'of']);

function parseCondition(term: string, cards: Card[]): Condition[] {
  let t = term.trim().toLowerCase();
  let negate = false;
  if (t.startsWith('!')) {
    negate = true;
    t = t.slice(1).trim();
  }
  if (!t) return [];
  const colon = t.indexOf(':');
  if (colon > 0 && FIELDS.has(t.slice(0, colon).trim())) {
    return [{ field: t.slice(0, colon).trim() as Condition['field'], value: t.slice(colon + 1).trim(), negate }];
  }
  const plain: Condition = { field: 'any', value: t, negate };
  const keywords = keywordConditions(t);
  if (!keywords) return [plain];
  // "Epic" or "Holo Gear" are pure keywords; a mixed phrase like "Rune Prison" stays
  // a name when some loaded card is called that.
  const mixed = keywords[0].field === 'any';
  if (mixed && cards.some((c) => test(c, { ...plain, negate: false }, false))) return [plain];
  if (negate && keywords.length === 1) keywords[0] = { ...keywords[0], negate };
  return negate && keywords.length > 1 ? [plain] : keywords;
}

// "holo gear" -> [type:gear, holo]; "jinx holo" -> [jinx, holo]; null when no keywords.
function keywordConditions(t: string): Condition[] | null {
  const words = t.split(/\s+/);
  const out: Condition[] = [];
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const two = `${words[i]} ${words[i + 1] ?? ''}`;
    if (KEYWORDS[two]) {
      out.push(KEYWORDS[two]);
      i++;
    } else if (KEYWORDS[words[i]]) out.push(KEYWORDS[words[i]]);
    else if (!FILLER.has(words[i])) rest.push(words[i]);
  }
  if (out.length === 0) return null;
  if (rest.length) out.unshift({ field: 'any', value: rest.join(' '), negate: false });
  return out;
}

// Plain-words summary of a slot, shown under it in the editor.
export function describeSlot(slot: Slot): string {
  const cond = (c: Condition) => {
    const v = c.field === 'holo' ? 'holo' : c.field === 'any' ? c.value : `${c.field} ${c.value}`;
    return c.negate ? `not ${v}` : v;
  };
  return slot.rules.map((r) => r.map(cond).join(' & ')).join('  or  ');
}

function containsWord(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  let i = h.indexOf(needle);
  while (i >= 0) {
    const before = i === 0 ? ' ' : h[i - 1];
    const after = i + needle.length >= h.length ? ' ' : h[i + needle.length];
    if (!/[\p{L}\p{N}']/u.test(before) && !/[\p{L}\p{N}']/u.test(after)) return true;
    i = h.indexOf(needle, i + 1);
  }
  return false;
}

function test(card: Card, c: Condition, holo: boolean): boolean {
  const v = c.value;
  const eq = (s: string | null | undefined) => (s ?? '').toLowerCase() === v;
  let hit: boolean;
  switch (c.field) {
    case 'name': hit = containsWord(card.name, v); break;
    case 'tag': hit = card.tags.some(eq); break;
    case 'domain': hit = card.domains.some(eq); break;
    case 'type': hit = eq(card.type) || eq(card.supertype); break;
    case 'rarity': hit = eq(card.rarity); break;
    case 'set': hit = eq(card.set); break;
    case 'number': hit = String(card.num ?? '') === v; break;
    case 'holo': hit = holo; break;
    default: {
      // Plurals from listings: "Poros", "Seals".
      const one = v.endsWith('s') && v.length > 3 ? v.slice(0, -1) : null;
      hit = card.tags.some(eq) || containsWord(card.name, v) ||
        (one !== null && (card.tags.some((t) => t.toLowerCase() === one) || containsWord(card.name, one)));
    }
  }
  return hit !== c.negate;
}

export function slotMatches(card: Card, slot: Slot, holo = false): boolean {
  return slot.rules.some((rule) => rule.every((c) => test(card, c, holo)));
}

// A rule naming particular cards (a champion, "Seals", "Mystic Poro") rather than
// only a category (Epic, Gear, Spells).
function isSpecific(rule: Condition[]): boolean {
  return rule.some((c) => !c.negate && (c.field === 'any' || c.field === 'tag' || c.field === 'number' || (c.field === 'name' && c.value !== 'alternate art' && c.value !== 'overnumbered')));
}

// Indexes of every slot the card belongs to, best first: slots that name the card
// specifically beat category slots, so "Seals" wins over an earlier "Gear" and a
// champion keeps their epics and signature spells; otherwise line order decides.
export function slotsFor(card: Card, slots: Slot[], holo = false): number[] {
  const specific: number[] = [];
  const general: number[] = [];
  slots.forEach((s, i) => {
    const hits = s.rules.filter((rule) => rule.every((c) => test(card, c, holo)));
    if (hits.length === 0) return;
    (hits.some(isSpecific) ? specific : general).push(i);
  });
  return [...specific, ...general];
}

// True when whether the card is holo decides which slot it goes to.
export function holoMatters(card: Card, slots: Slot[]): boolean {
  return (slotsFor(card, slots, true)[0] ?? -1) !== (slotsFor(card, slots, false)[0] ?? -1);
}

// Champion names appearing in the given cards, for one-tap slot setup. Champion
// units and legends are named "Jinx - Loose Cannon", "Kai'Sa, Survivor" or
// "Yordle, Kennen - Heart of the Tempest"; the champion is the tagged name in front.
export function championNames(cards: Card[]): string[] {
  const names = new Set<string>();
  for (const c of cards) {
    if (c.type !== 'Legend' && c.supertype !== 'Champion') continue;
    const dash = c.name.indexOf(' - ');
    const head = dash >= 0 ? c.name.slice(0, dash).split(', ').pop()! : c.name.split(', ')[0];
    const tag = c.tags.find((t) => t.toLowerCase() === head.trim().toLowerCase());
    if (tag) names.add(tag);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
