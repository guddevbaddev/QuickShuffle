import './style.css';
import { Matcher, type Match, type MatchResult } from './matcher.ts';
import { Scanner } from './scanner.ts';
import { championNames, holoMatters, parseSlots, slotsFor, type Slot } from './slots.ts';
import type { Card, GameIndex, SetFile } from './types.ts';

interface LogEntry {
  t: number;
  id: string;
  name: string;
  set: string;
  num: number | null;
  img: string;
  slot: string;
  holo?: boolean;
}

interface Settings {
  sets: string[];
  slotsText: string;
  fallback: string;
  threshold: number;
  sound: boolean;
  vibrate: boolean;
  speak: boolean;
  // Rarities that only exist as holo, so the scanner doesn't ask about them.
  alwaysHolo: string;
}

const STORE_KEY = 'quickshuffle:v1';
const LOG_KEY = 'quickshuffle:log:v1';
// Candidates scoring within this of the best are treated as "could be either".
const AMBIGUOUS_GAP = 0.02;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

const settings: Settings = load<Settings>(STORE_KEY, {
  sets: [],
  slotsText: '',
  fallback: 'No slot',
  threshold: 0.6,
  sound: true,
  vibrate: true,
  speak: false,
  alwaysHolo: 'Rare, Epic, Showcase',
});
let log: LogEntry[] = load<{ entries: LogEntry[] }>(LOG_KEY, { entries: [] }).entries;
let slots: Slot[] = parseSlots(settings.slotsText);
let index: GameIndex | null = null;
const setFiles = new Map<string, SetFile>();
const matcher = new Matcher();

const saveSettings = () => save(STORE_KEY, settings);
const saveLog = () => save(LOG_KEY, { entries: log });

// ---------- data ----------

async function loadIndex(): Promise<void> {
  const res = await fetch('data/index.json');
  index = (await res.json()) as GameIndex;
  const known = new Set(index.sets.map((s) => s.id));
  settings.sets = settings.sets.filter((s) => known.has(s));
  if (settings.sets.length === 0) {
    // Default to the newest main set (promo sets are tiny).
    const main = index.sets.filter((s) => s.count > 50);
    settings.sets = [(main[main.length - 1] ?? index.sets[0]).id];
  }
}

async function loadSets(): Promise<void> {
  $('setsButton').textContent = 'Loading…';
  await Promise.all(
    settings.sets
      .filter((id) => !setFiles.has(id))
      .map(async (id) => {
        const res = await fetch(`data/cards-${id}.json`);
        setFiles.set(id, (await res.json()) as SetFile);
      }),
  );
  matcher.setFiles(settings.sets.map((id) => setFiles.get(id)!).filter(Boolean));
  $('setsButton').textContent = settings.sets.join(' + ') + ' ▾';
  $('dataInfo').textContent = `${matcher.cards.length} cards loaded. Card data from riftcodex.com, updated ${index?.generated.slice(0, 10) ?? '?'}.`;
  renderSlotPreview();
}

// ---------- slots ----------

// true/false when the rarity settles it, undefined when the scanner has to ask.
function knownHolo(card: Card): boolean | undefined {
  const always = settings.alwaysHolo.split(',').map((r) => r.trim().toLowerCase());
  return always.includes(card.rarity.toLowerCase()) ? true : undefined;
}

function slotNameFor(card: Card, holo = knownHolo(card) ?? false): { name: string; index: number; also: string[] } {
  const hits = slotsFor(card, slots, holo);
  if (hits.length === 0) return { name: settings.fallback || 'No slot', index: -1, also: [] };
  return { name: slots[hits[0]].name, index: hits[0], also: hits.slice(1).map((i) => slots[i].name) };
}

function slotColor(index: number): string {
  return index < 0 ? 'hsl(220 8% 35%)' : `hsl(${(index * 137.508) % 360} 65% 33%)`;
}

function renderSlotPreview(): void {
  const counts = new Map<number, number>();
  for (const c of matcher.cards) {
    const i = slotNameFor(c).index;
    counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const el = $('slotPreview');
  el.innerHTML = '';
  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = `${slots.length} slots. Cards per slot in the selected sets:`;
  el.append(head);
  slots.forEach((s, i) => el.append(pill(s.name, counts.get(i) ?? 0, i)));
  el.append(pill(settings.fallback || 'No slot', counts.get(-1) ?? 0, -1));
}

function pill(name: string, count: number, index: number): HTMLElement {
  const p = document.createElement('span');
  p.className = 'pill';
  p.style.background = slotColor(index);
  p.textContent = `${name} · ${count}`;
  return p;
}

// ---------- scanning ----------

let audio: AudioContext | null = null;
function beep(found: boolean): void {
  if (!settings.sound) return;
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = found ? 1046 : 392;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.16);
  } catch {
    /* audio unavailable */
  }
}

function announce(slotIndex: number, slotName: string): void {
  beep(slotIndex >= 0);
  if (settings.vibrate) navigator.vibrate?.(slotIndex >= 0 ? 40 : [30, 60, 30]);
  if (settings.speak && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(slotName);
    u.rate = 1.3;
    speechSynthesis.speak(u);
  }
}

function addEntry(card: Card, holo?: boolean): LogEntry {
  const entry: LogEntry = {
    t: Date.now(),
    id: card.id,
    name: card.name,
    set: card.set,
    num: card.num,
    img: card.img,
    slot: slotNameFor(card, holo).name,
    holo,
  };
  log.push(entry);
  saveLog();
  renderLog();
  return entry;
}

function onDetect(res: MatchResult): void {
  const best = res.best!;
  const slot = slotNameFor(best.card);
  // Close calls that would land in a different slot need a human look.
  const close = res.others.filter((o) => best.score - o.score <= AMBIGUOUS_GAP && slotNameFor(o.card).name !== slot.name);
  place(best, close.length ? [best, ...close] : [], res.others);
}

// Logs the card and shows its slot, first asking "holo?" when that decides the slot.
function place(match: Match, choices: Match[], others: Match[]): void {
  const holo = knownHolo(match.card);
  if (holo === undefined && holoMatters(match.card, slots)) {
    askHolo(match, choices, others);
    return;
  }
  finishPlace(match, choices, others, holo);
}

function finishPlace(match: Match, choices: Match[], others: Match[], holo: boolean | undefined): void {
  addEntry(match.card, holo);
  const slot = slotNameFor(match.card, holo);
  announce(slot.index, slot.name);
  renderResult(match, choices, others, holo);
}

let askingHolo = false;

function askHolo(match: Match, choices: Match[], others: Match[]): void {
  askingHolo = true;
  updatePause();
  beep(true);
  if (settings.vibrate) navigator.vibrate?.([20, 40, 20]);
  const el = $('result');
  el.innerHTML = '';
  el.classList.remove('warn');
  el.style.setProperty('--slot', 'var(--warn)');
  const banner = document.createElement('div');
  banner.className = 'banner ask';
  banner.innerHTML = '<div class="slot-name">Holo?</div>';
  const info = cardInfo(match);
  const answer = (holo: boolean) => {
    askingHolo = false;
    updatePause();
    finishPlace(match, choices, others, holo);
  };
  const yes = slotNameFor(match.card, true);
  const no = slotNameFor(match.card, false);
  const row = document.createElement('div');
  row.className = 'row answer';
  const yesBtn = button('', () => answer(true), 'primary');
  yesBtn.innerHTML = '<b>Holo</b><small></small>';
  yesBtn.querySelector('small')!.textContent = `→ ${yes.name}`;
  const noBtn = button('', () => answer(false));
  noBtn.innerHTML = '<b>Not holo</b><small></small>';
  noBtn.querySelector('small')!.textContent = `→ ${no.name}`;
  row.append(yesBtn, noBtn);
  el.append(banner, info, row);
}

function cardInfo(match: Match, holo?: boolean): HTMLElement {
  const card = match.card;
  const info = document.createElement('div');
  info.className = 'card-info';
  const img = document.createElement('img');
  img.src = card.img;
  img.alt = '';
  img.loading = 'lazy';
  const text = document.createElement('div');
  text.innerHTML = `<b></b><small></small>`;
  text.querySelector('b')!.textContent = card.name;
  text.querySelector('small')!.textContent =
    `${card.set} #${card.num ?? '?'} · ${card.rarity}${holo ? ' · holo' : ''} · ${Math.round(match.score * 100)}% match`;
  info.append(img, text);
  return info;
}

function renderResult(best: Match, choices: Match[], others: Match[], holo?: boolean): void {
  const card = best.card;
  const slot = slotNameFor(card, holo);
  const el = $('result');
  el.innerHTML = '';
  el.style.setProperty('--slot', slotColor(slot.index));
  el.classList.toggle('warn', choices.length > 0);

  const banner = document.createElement('div');
  banner.className = 'banner';
  const big = document.createElement('div');
  big.className = 'slot-name';
  big.textContent = slot.name;
  const sub = document.createElement('div');
  sub.className = 'slot-sub';
  sub.textContent = slot.index >= 0 ? `Slot ${slot.index + 1} of ${slots.length}` : 'No matching slot';
  if (slot.also.length) sub.textContent += ` · also matches ${slot.also.join(', ')}`;
  banner.append(big, sub);

  const info = cardInfo(best, holo);

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.append(
    button('Undo', () => {
      log.pop();
      saveLog();
      renderLog();
      scanner.rearm();
      el.innerHTML = '<div class="result-empty">Removed. Scan the next card.</div>';
      el.classList.remove('warn');
      el.style.removeProperty('--slot');
    }),
    button('+1 again', () => place(best, [], others)),
    button('Fix', () => showChoices(el, [best, ...others], 'Pick the right card:')),
  );

  el.append(banner, info, actions);
  if (choices.length) showChoices(el, choices, 'Close call — check it is the right card:');
}

function showChoices(el: HTMLElement, choices: Match[], title: string): void {
  el.querySelector('.choices')?.remove();
  const box = document.createElement('div');
  box.className = 'choices';
  const h = document.createElement('p');
  h.textContent = title;
  box.append(h);
  const list = document.createElement('ul');
  list.className = 'cardlist';
  for (const m of choices) {
    list.append(
      cardRow(m.card, `${slotNameFor(m.card).name} · ${Math.round(m.score * 100)}%`, () => {
        log.pop();
        saveLog();
        renderLog();
        place(m, [], []);
      }),
    );
  }
  box.append(list);
  el.append(box);
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function cardRow(card: Pick<Card, 'name' | 'img' | 'set' | 'num'>, detail: string, onClick?: () => void, color?: string): HTMLLIElement {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.src = card.img;
  img.alt = '';
  img.loading = 'lazy';
  const t = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = card.name;
  const s = document.createElement('small');
  s.textContent = `${card.set} #${card.num ?? '?'} · ${detail}`;
  if (color) s.style.color = color;
  t.append(b, s);
  li.append(img, t);
  if (onClick) {
    li.tabIndex = 0;
    li.classList.add('clickable');
    li.addEventListener('click', onClick);
  }
  return li;
}

const scanner = new Scanner({
  video: $<HTMLVideoElement>('video'),
  guide: $('guide'),
  matcher: () => matcher,
  threshold: () => settings.threshold,
  onDetect,
  onFrame: (res) => {
    const g = $('guide');
    const s = res?.best?.score ?? 0;
    g.classList.toggle('seen', s >= 0.45 && s < settings.threshold);
    g.classList.toggle('locked', s >= settings.threshold);
  },
});

async function startCamera(): Promise<void> {
  const msg = $('cameraMsg');
  try {
    await scanner.start();
    msg.hidden = true;
    $('torchButton').hidden = !scanner.hasTorch();
  } catch (e) {
    msg.hidden = false;
    msg.querySelector('p')!.textContent =
      window.isSecureContext === false
        ? 'The camera needs an https:// address.'
        : `Couldn't open the camera (${(e as Error).name}). Allow camera access and try again.`;
  }
}

// ---------- log ----------

function renderLog(): void {
  $('logCount').textContent = `(${log.length})`;
  const totals = new Map<string, number>();
  for (const e of log) totals.set(e.slot, (totals.get(e.slot) ?? 0) + 1);
  const slotIndex = new Map(slots.map((s, i) => [s.name, i]));
  const tot = $('slotTotals');
  tot.innerHTML = '';
  [...totals.entries()]
    .sort((a, b) => (slotIndex.get(a[0]) ?? 1e9) - (slotIndex.get(b[0]) ?? 1e9))
    .forEach(([name, n]) => tot.append(pill(name, n, slotIndex.get(name) ?? -1)));
  const list = $('logList');
  list.innerHTML = '';
  [...log].reverse().slice(0, 300).forEach((e) => {
    const li = cardRow(e, e.holo ? `${e.slot} · holo` : e.slot, undefined, slotColor(slotIndex.get(e.slot) ?? -1));
    const del = button('✕', () => {
      log = log.filter((x) => x !== e);
      saveLog();
      renderLog();
    }, 'icon');
    del.setAttribute('aria-label', `Remove ${e.name}`);
    li.append(del);
    list.append(li);
  });
}

function logAsText(): string {
  const bySlot = new Map<string, LogEntry[]>();
  for (const e of log) bySlot.set(e.slot, [...(bySlot.get(e.slot) ?? []), e]);
  const order = [...slots.map((s) => s.name), settings.fallback || 'No slot'];
  const names = [...bySlot.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  return names
    .map((n) => {
      const counts = new Map<string, number>();
      for (const e of bySlot.get(n)!) {
        const label = e.holo ? `${e.name} (holo)` : e.name;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const items = [...counts.entries()].map(([c, k]) => (k > 1 ? `${c} x${k}` : c));
      return `${n} (${bySlot.get(n)!.length}): ${items.join(', ')}`;
    })
    .join('\n');
}

// ---------- sets dialog ----------

function openSetsDialog(): void {
  if (!index) return;
  const list = $('setsList');
  list.innerHTML = '';
  for (const s of [...index.sets].reverse()) {
    const label = document.createElement('label');
    label.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s.id;
    cb.checked = settings.sets.includes(s.id);
    label.append(cb, ` ${s.name} `);
    const small = document.createElement('small');
    small.textContent = `${s.id} · ${s.count} cards`;
    label.append(small);
    list.append(label);
  }
  const dlg = $<HTMLDialogElement>('setsDialog');
  dlg.returnValue = '';
  dlg.showModal();
}

$<HTMLDialogElement>('setsDialog').addEventListener('close', async () => {
  const dlg = $<HTMLDialogElement>('setsDialog');
  if (dlg.returnValue !== 'ok') return;
  const picked = [...dlg.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
  if (picked.length === 0) return;
  settings.sets = picked;
  saveSettings();
  await loadSets();
});

// ---------- wiring ----------

function showTab(name: string): void {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  currentTab = name;
  updatePause();
}

let pausedByUser = false;
let currentTab = 'scan';

// Don't burn battery scanning while editing slots, and hold off while a holo question is open.
function updatePause(): void {
  scanner.setPaused(pausedByUser || currentTab !== 'scan' || askingHolo);
}

function wire(): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab!)));
  $('setsButton').addEventListener('click', openSetsDialog);
  $('startCamera').addEventListener('click', startCamera);
  $('pauseButton').addEventListener('click', () => {
    pausedByUser = !pausedByUser;
    updatePause();
    $('pauseButton').textContent = pausedByUser ? 'Resume' : 'Pause';
    $('camera').classList.toggle('paused', pausedByUser);
  });
  let torch = false;
  $('torchButton').addEventListener('click', async () => {
    torch = !torch;
    try {
      await scanner.setTorch(torch);
    } catch {
      torch = false;
    }
    $('torchButton').classList.toggle('on', torch);
  });

  const slotsText = $<HTMLTextAreaElement>('slotsText');
  slotsText.value = settings.slotsText;
  slotsText.addEventListener('input', () => {
    settings.slotsText = slotsText.value;
    slots = parseSlots(settings.slotsText);
    saveSettings();
    renderSlotPreview();
  });
  const setSlotsText = (text: string) => {
    if (settings.slotsText.trim() && !confirm('Replace your current slots?')) return;
    slotsText.value = text;
    slotsText.dispatchEvent(new Event('input'));
  };
  // Champions first so their signature spells and gear go to them; only other holo gear reaches the Gear slot.
  $('genChampions').addEventListener('click', () =>
    setSlotsText([...championNames(matcher.cards), 'Gear = type:gear & holo'].join('\n')),
  );
  $('genDomains').addEventListener('click', () => {
    const domains = [...new Set(matcher.cards.flatMap((c) => c.domains))].sort();
    setSlotsText(domains.map((d) => `${d} = domain:${d.toLowerCase()}`).join('\n'));
  });
  const fallback = $<HTMLInputElement>('fallbackName');
  fallback.value = settings.fallback;
  fallback.addEventListener('input', () => {
    settings.fallback = fallback.value;
    saveSettings();
    renderSlotPreview();
  });

  const threshold = $<HTMLInputElement>('threshold');
  const showThreshold = () => ($('thresholdValue').textContent = `${Math.round(settings.threshold * 100)}%`);
  threshold.value = String(settings.threshold);
  showThreshold();
  threshold.addEventListener('input', () => {
    settings.threshold = Number(threshold.value);
    showThreshold();
    saveSettings();
  });
  const alwaysHolo = $<HTMLInputElement>('alwaysHolo');
  alwaysHolo.value = settings.alwaysHolo;
  alwaysHolo.addEventListener('input', () => {
    settings.alwaysHolo = alwaysHolo.value;
    saveSettings();
    renderSlotPreview();
  });
  for (const key of ['sound', 'vibrate', 'speak'] as const) {
    const cb = $<HTMLInputElement>(`${key}On`);
    cb.checked = settings[key];
    cb.addEventListener('change', () => {
      settings[key] = cb.checked;
      saveSettings();
    });
  }

  const search = $<HTMLInputElement>('search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    const list = $('searchResults');
    list.innerHTML = '';
    if (q.length < 2) return;
    matcher.cards
      .filter((c) => c.name.toLowerCase().includes(q) || String(c.num) === q)
      .slice(0, 12)
      .forEach((c) =>
        list.append(
          cardRow(c, slotNameFor(c).name, () => {
            place({ card: c, score: 1 }, [], []);
            search.value = '';
            list.innerHTML = '';
          }),
        ),
      );
  });

  $('copyLog').addEventListener('click', async () => {
    const text = logAsText();
    try {
      await navigator.clipboard.writeText(text);
      $('copyLog').textContent = 'Copied!';
      setTimeout(() => ($('copyLog').textContent = 'Copy'), 1500);
    } catch {
      prompt('Copy this:', text);
    }
  });
  $('clearLog').addEventListener('click', () => {
    if (!log.length || !confirm(`Clear all ${log.length} scanned cards?`)) return;
    log = [];
    saveLog();
    renderLog();
  });
}

async function init(): Promise<void> {
  wire();
  renderLog();
  try {
    await loadIndex();
    saveSettings();
    await loadSets();
  } catch (e) {
    $('setsButton').textContent = 'Offline';
    $('dataInfo').textContent = `Couldn't load card data: ${(e as Error).message}`;
  }
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
