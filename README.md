# QuickShuffle

A phone web app for running Whatnot character breaks. Point the camera at a
Riftbound card and it tells you, in big text, which break slot the card goes to.

- **Fast scanning.** Hold a card in the on-screen box. It's recognised in a
  fraction of a second, with no button press. You get a beep/vibration, and the
  slot name shows in large text (it can also be read out loud).
- **Set selector.** Pick only the sets in the boxes you're opening. Fewer
  candidates means faster, more accurate scans.
- **Slots.** One slot per line. Tap "Fill with champions" to create a slot for
  every champion in the selected sets, then edit as needed.
- **Log.** Shows counts per slot and every scanned card. "Copy" gives a summary
  you can paste into chat. Undo, "+1 again" for duplicates, and "Fix" for a
  wrong match are on the scan screen.
- **Offline.** After the first load it works without a connection, and it
  installs to your home screen like an app.

## Slot syntax

```
Jinx                              # cards tagged Jinx, or "Jinx" as a word in the name
Zaun crew = ekko, viktor, tag:zaun   # any of the comma-separated terms
Epic Jinx = jinx & rarity:epic    # & = all conditions must hold
Jinx (no legend) = jinx & !type:legend   # ! = not
```

Filters: `tag:` `name:` `domain:` `type:` `rarity:` `set:` `number:`.
A card goes to the **first** slot it matches; anything else goes to the
fallback slot ("No slot" by default).

## How recognition works

`scripts/build-db.ts` downloads every card from the
[riftcodex](https://riftcodex.com) API and turns each card image into a small
colour "fingerprint" (a 16×22 colour grid with brightness and white balance
normalised out). The fingerprints ship with the app (about 2.6 MB for all
sets). On the phone, each camera frame inside the guide box is fingerprinted the
same way and compared against the selected sets. It tries a few
offsets and zooms, so the card doesn't need to be perfectly lined up. A card is
accepted once two frames in a row agree, and it won't count the same card again
until it has left the box.

Simulated phone shots (tilt, offset, blur, glare, colour cast, JPEG) give these
results (`npm run eval`):

| Sets loaded | Correct card name | Correct slot (tags) | Time per frame (laptop) |
|---|---|---|---|
| One set (Origins) | 99.7% | 99.7% | ~8 ms |
| All 8 sets | 95.8% | 99.5% | ~12 ms |

With every set loaded, most misses are the same artwork printed under a
slightly different name in another set. Those land in the same slot anyway.

## Development

```
npm install
npm run dev        # http://localhost:5173 (camera needs https or localhost)
npm test
npm run build      # static site in dist/
npm run build:db   # refresh card data when a new set releases
npm run eval       # accuracy check against simulated photos (needs build:db first)
```

## Putting it on your phone

The camera only works over **https**. The included GitHub Actions workflow
deploys to GitHub Pages on every push to `main`:

1. In the repo: **Settings → Pages → Source: GitHub Actions**. Pages on a
   private repo needs a paid GitHub plan; you can also make the repo public, or
   drag the `dist/` folder onto Netlify Drop or Cloudflare Pages.
2. Open the site on your phone and allow camera access.
3. Use **Share → Add to Home Screen** (iPhone) or **Install app** (Android).
