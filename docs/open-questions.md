# Open Questions & Blockers

Ordered by how much they block work.

## B1 — ~~The spritesheets are not in the repo~~ RESOLVED

The card source turned out to be `tts/` — a Tabletop Simulator mod dump carrying its own grid
geometry, so no grid detection was needed. **301 card faces are extracted** to `cards/raw/`.
See [`docs/tts-assets.md`](tts-assets.md) and [`todo/02`](../todo/02-card-extraction.md).

Two residual issues from that source:

- **The dump includes expansion/promo content**, not just the Core Set. Filter by the printed
  card ID (`todo/02c` §3).
- **Deck-sheet cards are only ~307 × 432 px.** This is workable — macOS Vision OCR handles it
  well at 3× upscale — but it is why icon recovery (`todo/02b`) needs a classifier rather than
  simple template matching at full resolution.

## B2 — The solo Bot rules are not in this PDF _(resolved)_

**Resolved (2026-10-31):** the solo rulebook is now restated in `rules/13-solo-mode.md` and
`rules/14-five-year-mission.md`, and STCC publishes the Automated Command card text
(`data/bots.json`, fetched with the card data). Implementation: `todo/15` §3. The original note
follows.


The box contains **12 Automated Command cards** and **2 Solo cards**, but this rulebook does not
specify how they work — the solo rules are a separate document
(`Star Trek Captain's Chair Core Rulebook Solitaire`, on BGG). The `SURPRISE` trait and the Bot
action count on Stardate cards are solo-only. (The 25 solo Stardate cards SD08–SD32 are
transcribed — Glory, text and Bot action count — in `src/data/stardate.ts`, boxed in every mode.)

**Mitigation:** _Cadet Training mode_ (`rules/10`) is fully specified here and needs **no Bot at
all**. Build that first; it gives a complete single-player experience. Add the Bot only after
obtaining the solo rulebook.

## B3 — Card text is not in the rulebook _(mitigated)_

The rulebook names many cards in examples (Set a Course, Will Riker, Confiscate, Tribbles,
Iconian Gateway, Amargosa Observatory, Orb of Time, Odo, Cloaking Device, Denobulans, Bynars,
Halkan Council, Tamarians, Kelpiens, Zephram Cochrane, Unstable Wormhole, Pakled Freighter,
Tholians, Ambassador Kamarag, Captain Dorg, Daystrom Institute, Farpoint Station, Andoria,
Weytahn, Memory Alpha, Archer IV, Betazed, Corvan II, Tulgana IV, Risa, Solum, Ancient Relay
Station, Rura Penthe, Starbase 375, Theta Zeta, Phasing Cloak, …) but **prints no full card
text**. Every card's operations must be transcribed from your sprites. That's what
`todo/11-card-authoring-tool.md` exists for.

**Resolved by the OCR pipeline.** `todo/02a`–`02c` turn the card images into
`cards/records/ALL.md`, a complete text corpus with inline icon tokens. Card rules are then
implemented from text alone — no visual access required.

**The residual risk is icon classification accuracy** (`todo/02b`). OCR reads words well but
drops every icon, and icons carry real rules meaning (`gain 1 {GLO}` vs `gain 1 {DIL}`). Budget
a day for it and drive `{UNKNOWN}` to zero before implementing cards.

Two supplementary sources reduce the risk further:

- **`STCC-Traits_Cyclopedia_2.1.1.pdf`** — 45 pages of _real text_ giving common-card lists,
  per-deck card lists with **start positions**, and trait groupings.
- **`tts/inventory.json`** — authoritative ship-token names per deck.

## Q1 — Which crew decks in v1?

Recommendation: **Picard + Shran only.** The rulebook states they have no `INCIDENT DECK`,
`CONTROLLED LOCATION`, `DEPLOYED`, `DISCARD` or Status cards, so they skip the most special-cased
setup paths. Burnham should be **last** — her Inert Dilithium rules require the whole
rule-modifier system (`rules/11` §11.6.1).

## Q2 — Basic or Advanced crew-board sides in v1?

Recommendation: **Basic only** at first (1 mission, 2 Mission Completion tokens boxed). Advanced
adds 3 missions plus mission VP in final scoring — a small delta once missions work at all, so
add it in the same milestone as the second crew deck.

## Q3 — Hot-seat or single-player first?

Recommendation: **Cadet Training (single-player) first.** It needs no opponent model, no hidden
information handling, and no pass-the-device flow — but exercises ~90% of the engine. Hot-seat
2-player is then mostly UI work.

## Q4 — Mission goal witness sets

`rules/12` §12.26: completing a mission dismisses the **beamed** cards that contributed. When
several different sets of cards satisfy the goal, the rulebook does not explicitly say who
chooses. **Assumption taken in this plan: the player chooses** (it is their mission, and every
other ambiguous choice in the game belongs to the resolving player). Surface it as a
`CHOOSE_WITNESS` choice. Flag it in-app as a house ruling.

## Q5 — Is the whole rulebook covered?

Yes for the 36-page core rulebook. **Not** covered, and out of scope unless you buy them:

- _Star Trek: Captain's Chair – To Boldly Go_ (separate rulebook + solo rules)
- _Star Trek: Captain's Chair – Second Contact_ (separate rulebook)

The data model has a `deck:` discriminator and the DSL has an escape hatch, so expansions are
additive — no engine change should be needed.

## Q6 — Licensing / distribution — RESOLVED (2026-09-23)

The card art and text are © 2024 WizKids/NECA and CBS Studios. Resolution: the repo ships
**code only**. Card scans, printed text and icons come from the community
[STCC Card Database](https://periodic-agent.github.io/stcc-strategy/) through
`npm run fetch-cards` (`tools/fetch-stcc.ts`) into gitignored folders on each player's machine.
Card defs carry mechanics only, with no printed `text`. The OCR records, the rulebook PDF and the
Cyclopedia PDF are untracked, and `npm run audit:publish` (part of `build`) keeps it that way.
Still open: a _hosted_ build (`dist/` includes `public/stcc/`) would redistribute the scans, so
don't deploy a build that includes fetched data.
The desktop installers (docs/desktop.md) ship code only as well: `vite build --mode desktop`
leaves the STCC data out, and the app fetches each player's own copy on first launch.
Since 2026-10-18 the hosted build is code only too (no fetch in the Dockerfile,
`vite build --mode hosted`), which settles the hosted-build question above.
