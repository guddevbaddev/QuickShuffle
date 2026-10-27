// Checks the real Unleashed card list against a real break's slot list
// (tests/fixtures/unleashed-break.txt), so data or rule changes can't silently
// move cards between slots.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSlots, slotsFor } from '../src/slots.ts';
import type { SetFile } from '../src/types.ts';

const file: SetFile = JSON.parse(readFileSync(new URL('../public/data/cards-UNL.json', import.meta.url), 'utf8'));
const slots = parseSlots(readFileSync(new URL('./fixtures/unleashed-break.txt', import.meta.url), 'utf8'));
const slotOf = (name: string) => {
  const card = file.cards.find((c) => c.name === name);
  if (!card) throw new Error(`no card ${name}`);
  const i = slotsFor(card, slots, true)[0];
  return i === undefined ? 'No slot' : slots[i].name;
};
const counts = new Map<string, number>();
for (const c of file.cards) {
  const i = slotsFor(c, slots, true)[0];
  const n = i === undefined ? 'No slot' : slots[i].name;
  counts.set(n, (counts.get(n) ?? 0) + 1);
}

describe('Unleashed character break', () => {
  it('gives each champion all 8 of their cards, including signature spells, gear and units', () => {
    for (const champ of ['Rengar', 'Poppy', 'Pyke', 'Vex', 'Vi', 'LeBlanc', 'Jhin', 'Lillia', 'Ivern', 'Master Yi', "Kha'Zix", 'Diana']) {
      expect(counts.get(champ), champ).toBe(8);
    }
    expect(slotOf('Hextech Gauntlets')).toBe('Vi');
    expect(slotOf('Shadow')).toBe('Vex');
    expect(slotOf('Daisy!')).toBe('Ivern');
    expect(slotOf('Thrill of the Hunt')).toBe('Rengar');
    expect(slotOf('Vi - Piltover Enforcer (Signature)')).toBe('Vi');
  });

  it('keeps champion epics with the champion and sends other epics to Epic', () => {
    expect(slotOf('Pyke - Dockside Butcher')).toBe('Pyke');
    expect(slotOf('Baron Nashor (Ultimate)')).toBe('Baron Nashor');
    expect(counts.get('Baron Nashor')).toBe(3);
    expect(slotOf('Elder Dragon')).toBe('Epic');
    expect(slotOf('Gutter Palace')).toBe('Epic');
    expect(counts.get('Epic')).toBe(16);
  });

  it('puts each named poro in its own slot and leaves unsold poros out', () => {
    for (const p of ['Mystic', 'Veteran', 'Lonely', 'Pouty', 'Daring', 'Plundering']) {
      expect(slotOf(`${p} Poro (Overnumbered)`)).toBe(`${p} Poro`);
    }
    expect(slotOf('Loyal Poro')).toBe('No slot');
  });

  it('sends unsold champions to No slot', () => {
    expect(slotOf('Katarina - Reckless')).toBe('No slot');
  });
});
