import { describe, expect, it } from 'vitest';
import { championNames, holoMatters, parseSlots, slotsFor } from '../src/slots.ts';
import type { Card } from '../src/types.ts';

const card = (over: Partial<Card>): Card => ({
  id: 'x', name: 'Card', set: 'OGN', num: 1, type: 'Unit', supertype: null,
  rarity: 'Common', domains: [], tags: [], img: '', ...over,
});

const jinx = card({ name: 'Jinx - Loose Cannon', type: 'Legend', tags: ['Jinx'], domains: ['Fury'], rarity: 'Rare' });
const vi = card({ name: 'Vi - Peacekeeper', supertype: 'Champion', tags: ['Vi', 'Piltover'], domains: ['Order'] });
const viktor = card({ name: 'Viktor - Innovator', supertype: 'Champion', tags: ['Viktor', 'Zaun'], rarity: 'Epic' });
const spell = card({ name: 'Super Mega Death Rocket!', type: 'Spell', tags: ['Jinx'], rarity: 'Epic' });

describe('parseSlots / slotsFor', () => {
  it('plain names match tags and whole words in the name', () => {
    const slots = parseSlots('Jinx\nVi');
    expect(slotsFor(jinx, slots)).toEqual([0]);
    expect(slotsFor(spell, slots)).toEqual([0]);
    expect(slotsFor(vi, slots)).toEqual([1]);
    // "Vi" must not match "Viktor"
    expect(slotsFor(viktor, slots)).toEqual([]);
  });

  it('supports named slots with several terms, fields, & and !', () => {
    const slots = parseSlots(`
      # comment
      Zaun crew = viktor, tag:zaun
      Epic Jinx = jinx & rarity:epic
      Jinx not legend = jinx & !type:legend
      Fury = domain:fury
    `);
    expect(slots.map((s) => s.name)).toEqual(['Zaun crew', 'Epic Jinx', 'Jinx not legend', 'Fury']);
    expect(slotsFor(viktor, slots)).toEqual([0]);
    expect(slotsFor(spell, slots)).toEqual([1, 2]);
    expect(slotsFor(jinx, slots)).toEqual([3]);
  });

  it('lists champion names from champion units and legends', () => {
    const kennen = card({ name: 'Yordle, Kennen - Heart of the Tempest', type: 'Legend', tags: ['Yordle', 'Kennen'] });
    const kaisa = card({ name: "Kai'Sa, Survivor", supertype: 'Champion', tags: ["Kai'Sa"] });
    expect(championNames([jinx, vi, viktor, spell, kennen, kaisa])).toEqual(['Jinx', "Kai'Sa", 'Kennen', 'Vi', 'Viktor']);
  });

  it('sends signature gear to its champion and only holo gear to the gear slot', () => {
    const slots = parseSlots('Vi\nGear = type:gear & holo');
    const sigGear = card({ name: 'Hextech Gauntlets', type: 'Gear', supertype: 'Signature', tags: ['Vi', 'Equipment'] });
    const gear = card({ name: 'Sun Disc', type: 'Gear', rarity: 'Uncommon' });
    expect(slotsFor(sigGear, slots, false)).toEqual([0]);
    expect(holoMatters(sigGear, slots)).toBe(false);
    expect(slotsFor(gear, slots, true)).toEqual([1]);
    expect(slotsFor(gear, slots, false)).toEqual([]);
    expect(holoMatters(gear, slots)).toBe(true);
    expect(holoMatters(vi, slots)).toBe(false);
  });
});
