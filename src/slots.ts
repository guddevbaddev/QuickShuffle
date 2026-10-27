import type { Card } from './types.ts';

export interface Slot {
  name: string;
  // Each rule is a list of conditions that must all hold; the slot matches if any rule does.
  rules: Condition[][];
}

interface Condition {
  field: 'any' | 'name' | 'tag' | 'domain' | 'type' | 'rarity' | 'set' | 'number';
  value: string;
  negate: boolean;
}

const FIELDS = new Set(['name', 'tag', 'domain', 'type', 'rarity', 'set', 'number']);

// Parses the slot editor text. One slot per line:
//
//   Jinx                       -> cards tagged Jinx or with "Jinx" in the name
//   Team Zaun = zaun, ekko     -> any of the comma-separated terms
//   Epics = rarity:epic        -> field filters: name tag domain type rarity set number
//   Jinx foils = jinx & rarity:showcase   -> "&" joins conditions that must all hold
//   Jinx no legend = jinx & !type:legend   -> "!" negates a condition
//
// Blank lines and lines starting with # are ignored.
export function parseSlots(text: string): Slot[] {
  const slots: Slot[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const name = (eq >= 0 ? line.slice(0, eq) : line).trim();
    const terms = eq >= 0 ? line.slice(eq + 1) : line;
    const rules = terms
      .split(',')
      .map((t) => t.split('&').map(parseCondition).filter((c): c is Condition => c !== null))
      .filter((r) => r.length > 0);
    if (name && rules.length) slots.push({ name, rules });
  }
  return slots;
}

function parseCondition(term: string): Condition | null {
  let t = term.trim().toLowerCase();
  let negate = false;
  if (t.startsWith('!')) {
    negate = true;
    t = t.slice(1).trim();
  }
  if (!t) return null;
  const colon = t.indexOf(':');
  if (colon > 0 && FIELDS.has(t.slice(0, colon).trim())) {
    return { field: t.slice(0, colon).trim() as Condition['field'], value: t.slice(colon + 1).trim(), negate };
  }
  return { field: 'any', value: t, negate };
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

function test(card: Card, c: Condition): boolean {
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
    default: hit = card.tags.some(eq) || containsWord(card.name, v);
  }
  return hit !== c.negate;
}

export function slotMatches(card: Card, slot: Slot): boolean {
  return slot.rules.some((rule) => rule.every((c) => test(card, c)));
}

// Indexes of every slot the card belongs to, in priority (line) order.
export function slotsFor(card: Card, slots: Slot[]): number[] {
  const out: number[] = [];
  slots.forEach((s, i) => {
    if (slotMatches(card, s)) out.push(i);
  });
  return out;
}

// Champion names appearing in the given cards, for one-tap slot setup: tags of
// champion units and legends whose name starts with that tag ("Jinx - Loose Cannon").
export function championNames(cards: Card[]): string[] {
  const names = new Set<string>();
  for (const c of cards) {
    if (c.type !== 'Legend' && c.supertype !== 'Champion') continue;
    for (const t of c.tags) if (c.name.toLowerCase().startsWith(t.toLowerCase())) names.add(t);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
