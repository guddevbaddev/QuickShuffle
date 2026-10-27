export interface Card {
  id: string;
  name: string;
  set: string;
  num: number | null;
  type: string;
  supertype: string | null;
  rarity: string;
  domains: string[];
  tags: string[];
  img: string;
}

export interface SetInfo {
  id: string;
  name: string;
  count: number;
  released: string;
}

// Shape of public/data/cards-<SET>.json
export interface SetFile {
  set: SetInfo;
  cards: Card[];
  // Card index for each fingerprint row (landscape cards have two rows, one per rotation).
  rows: number[];
  // Base64 of the int8 fingerprints, rows.length * FEATURE_LEN bytes.
  features: string;
}

export interface GameIndex {
  game: string;
  generated: string;
  sets: SetInfo[];
}
