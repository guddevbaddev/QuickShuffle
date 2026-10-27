// Slot lists pasted straight from a Whatnot listing, emojis and all.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanLine, describeSlot, parseSlots, slotsFor } from '../src/slots.ts';
import type { SetFile } from '../src/types.ts';

const sfd: SetFile = JSON.parse(readFileSync(new URL('../public/data/cards-SFD.json', import.meta.url), 'utf8'));
const slots = parseSlots(readFileSync(new URL('./fixtures/spiritforged-paste.txt', import.meta.url), 'utf8'), sfd.cards);
const slotOf = (name: string) => {
  const card = sfd.cards.find((c) => c.name === name);
  if (!card) throw new Error(`no card ${name}`);
  const i = slotsFor(card, slots, true)[0];
  return i === undefined ? 'No slot' : slots[i].name;
};

describe('cleanLine', () => {
  it('drops emojis, prices and numbering but keeps names', () => {
    expect(cleanLine('🔥🔥 Irelia & Fizz 🌀🐟 🔥🔥')).toBe('Irelia & Fizz');
    expect(cleanLine('⚙️ Gear + Top Units ⚙️')).toBe('Gear + Top Units');
    expect(cleanLine('3. Rek’Sai $13.00')).toBe("Rek'Sai");
    expect(cleanLine('Dr. Mundo')).toBe('Dr. Mundo');
  });
});

describe('pasted Spiritforged list', () => {
  it('reads every line as a slot with combos split into characters', () => {
    expect(slots).toHaveLength(16);
    expect(slots[0].name).toBe('Irelia & Fizz');
    expect(describeSlot(slots[5])).toBe('ezreal  or  darius  or  jayce');
    expect(describeSlot(slots[13])).toBe('type spell');
  });

  it('sends champion cards, signature spells and gear to the combo slot', () => {
    expect(slotOf('Irelia - Blade Dancer')).toBe('Irelia & Fizz');
    expect(slotOf('Fizz - Trickster')).toBe('Irelia & Fizz');
    expect(slotOf('Xin Zhao - Vigilant')).toBe('Fiora, Bard & Xin Zhao');
    const sigs = sfd.cards.filter((c) => c.supertype === 'Signature' && c.type !== 'Legend');
    expect(sigs.length).toBeGreaterThan(0);
    for (const c of sigs) expect(slotOf(c.name)).not.toMatch(/Spells|Gear|No slot/);
  });

  it('uses categories for the rest, letting specific slots win over earlier broad ones', () => {
    expect(slotOf('Veteran Poro')).toBe('Poros');
    expect(slotOf('Blood Rush')).toBe('Spells');
    expect(slotOf("Doran's Blade")).toBe('Gear + Top Units');
    // A seal is gear, but "Seals" names it, so it beats the earlier Gear slot.
    expect(slotOf('Seal of Rage (Overnumbered)')).toBe('Runes, Seals & Battlefields');
    expect(slotOf('Sunken Temple')).toBe('Runes, Seals & Battlefields');
  });
});
