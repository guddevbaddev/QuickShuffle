import { describe, expect, it } from 'vitest';
import { championNames, parseSlots, slotsFor } from '../src/slots.ts';
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
    expect(championNames([jinx, vi, viktor, spell])).toEqual(['Jinx', 'Vi', 'Viktor']);
  });
});
