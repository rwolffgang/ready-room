# Adding a custom crew deck

The playbook behind the Firefly deck (MAL), from research to painted card
art, written so the next crew follows the same path. `docs/custom-decks.md`
describes what exists; this file is how to make another one.

The flow, in order:

1. Research the source.
2. Design the deck within the existing rules.
3. Write the cards and the crew board.
4. Wire the deck into the game.
5. Test it (validate, crosscheck, describe, fuzz, unit tests).
6. Collect art sources and render the faces.
7. Paint the art with Codex (or ChatGPT), review, iterate.
8. Commit (the art stays local).

Throughout, `<CODE>` is the three-letter deck code and `<pack>` the pack name
(`MAL` / `firefly`).

## 0. Ground rules

- **No new rules.** Only existing suits, traits (`src/data/ids.ts`), DSL
  nodes (`docs/effect-dsl.md`), triggers (`src/data/schema.ts`) and passive
  modifiers (`src/engine/modifiers.ts`). Prefer card patterns that already
  exist. If a card needs new engine code, redesign the card.
- **What goes in git:** card mechanics (ids only), the crew board, the pack
  (names, our own card text and flavor), the art manifest (URLs and art
  direction only), tools and docs.
- **What never goes in git:** downloaded stills, generated art and rendered
  faces. They live in `vendor/custom/` and `public/custom/` (gitignored, and
  listed as local-only in the publish audit).
- **Words:** write flavor text yourself. At most a short catchphrase from the
  source, never song lyrics, and never another game's tagline. Firefly's "find
  a crew, find a job, keep flying" belongs to _Firefly: The Game_, so those
  cards became _Signing On_, _Take the Job_ and _Into the Black_.
- **Character art comes from the source:** stills from the series or film,
  not convention or actor photos. Free Commons photos are fine for props,
  places and flags.
- **Never get past a bot check.** If a site shows a "verify you're human" or
  Cloudflare page, stop and use another route (§6).
- Work in a sibling worktree (`../ready-room-<topic>`), not the shared
  checkout. Copy `vendor/stcc` and `public/stcc` into it and run `npm ci`.

## 1. Research

Have an agent write a brief to a scratch file covering:

- **The crew:** role, defining skills, 2–3 signature episode moments per
  character (these become abilities), species (mostly HUMAN), and which
  existing traits fit.
- **Ships**, **allies/antagonists**, **locations**, **items/jobs**, and
  **recurring themes**. The themes drive the deck's engine.
- **Pitfalls:** misremembered facts (the train-job cargo was Pescaline D, not
  "Pax"), taglines owned by other products, copyrighted lyrics.
- **Image leads** per subject, which you verify later in §6.

Firefly's trait mapping, as an example of reusing traits: Mal HUMAN SHADY,
River TELEPATH AUGMENT, Simon DOCTOR, Wash PILOT, Kaylee ENGINEER, Jayne and
Zoe SECURITY, Book SPY, Inara AMBASSADOR COMMUNICATION, Badger BUSINESS
SHADY, Vera WEAPON.

## 2. Design

Pick a published deck as the template. Dump it with names and printed text
(a throwaway tsx script: `loadStccNode()` + `loadCatalog()`, then `describe()`
each operation) and copy its structure:

| Slot          | Count | Notes                                                                                                                                 |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CAPTAIN       | 1     | `startPosition: null`, `awayTeams` 4–6, one table op + often an ENDGAME                                                               |
| DEPLOYED SHIP | 1     | the flagship: Play (deploy + warp OR beam), warp / beam / promote activations                                                         |
| DEVELOPMENT   | 8     | the deck's power cards, each with a `developmentCost` (2–5 {DIL}, often + {LAT}, an INCIDENT, a log)                                  |
| RESERVE       | 4–5   | mid-game cards, including the crew's INCIDENT                                                                                         |
| AVAILABLE     | 10    | the starting deck: its own Utilize / Recruit / Analyze-style directives, a Red Alert-style INCIDENT, a starting LOCATION, 3–4 PERSONs |

Box-1 decks have 24–26 cards; MAL has 25.

Design notes from MAL:

- **Give the deck one engine and one risk.** MAL pays for jobs with INCIDENTs,
  and its crew turns them into tempo: Reynolds gains {DIL}, Book gains {GLO}
  on returns, Miranda scores them. The Burn is the risk.
- **Don't park the engine's safety valve in Development.** A Development card
  usually enters a game only after the Reserve has run out, around turn 15, if
  at all. MAL's first version kept its INCIDENT-return crew there and won 37 %
  in the arena; moving one of them to the Reserve brought it to 48 %
  (`docs/custom-decks.md`, Balance). Balance-check a new deck with Normal vs
  Normal over its pairings in both seat orders before calling it done.
- **Keep the starting deck self-sufficient.** Don't make AVAILABLE cards
  discard CARGO or WEAPONs the starting deck doesn't contain.
- **Watch loops.** ACTIVATIONs and REACTIONs exhaust the card, so a refund
  ("after your ship warps, gain 1 {DIL}") fires once per turn and can't loop.
- **Missions dismiss the beamed cards they need.** Pair them against an
  endgame that rewards keeping crew aboard: a deliberate tension.
- **Tracks:** pick each track's multipliers from the box-1 patterns (compare
  every board with a quick script). The Advanced side drops the 0-step ×1
  glyph and shifts the values.

## 3. Write the cards

Generate the JSON from a small script (kept out of the repo) using helper
builders: `op`, `seq`, `may`, `pay`, `gain`, `cost_res`, `adv`, `warp`,
`beam_here`, `send` and so on. Copy operation trees from existing cards; for
any new pattern, find a box-1 card that already does it.

**Card JSON:** `src/data/cards/crew/<code>.json`.

- `cardId` is `1<CODE>NN/TT` (e.g. `1MAL01/25`) and `id` is the same with `-`.
  The leading `1` is required: `deckLabel()` looks up `1<CODE>01/` to name the
  deck after its captain.
- No `name` field (the schema forbids it when there is a `cardId`). No printed
  text.

**Board:** `src/data/cards/boards/<code>.json`, with BASIC (1 mission, 0 VP)
and ADVANCED (3 missions) sides. Mission `cardId`s are `1<CODE>/M1`…`M3`.

**Pack:** `src/data/custom/<pack>.json` holds `{ pack, deck, title, cards }`,
with each card in the STCC record shape:

- `name`, `suit`, `card_number`, `position_indicator`
- `glory`: the printed VP
- `species_traits` / `regular_traits` / `other_traits`
- `icons`, `away_team`
- `text`: `hand` / `table` / `goal` / `reward` / `cost`, written with STCC
  `[[tokens]]`
- plus our own `flavor` and `art` (the art key)

Mission records go in the pack too, keyed `1<CODE>/M1`.

Pitfalls hit with MAL and SHP:

- `RETURN_INCIDENT` has no `bind`. For "if you do", guard with `IF
COUNT_AT_LEAST`.
- `ONGOING` cards need a PLAY op containing `DEPLOY`.
- Seat `0` in zone specs means _self_.
- A PASSIVE `MODIFIER_ATTACH { id }` works only if the card also lists the id
  under `passives` (see `1PIC07`). The validator doesn't catch a missing one.
- The publish audit matches STCC card names in flavor text too: "Earth" is one.

## 4. Wire it into the game

| File                      | Change                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/ids.ts`         | add `<CODE>` to `DECKS` (`boards.ts` uses `DECKS` for its enum)                                                                                |
| `tools/validate-cards.ts` | add a `GROUPS` entry and raise `OVERALL_EXPECTED` by the card count                                                                            |
| `src/ui/deckReview.tsx`   | add `<CODE>` to `DECK_ORDER`                                                                                                                   |
| `tools/fuzz.ts`           | add `<CODE>` to `CREW`                                                                                                                         |
| `src/bot/arena.ts`        | add `<CODE>` to `CREW_DECKS`; update the pairing counts in `arena.test.ts`, `tools/bot-check.ts` (games = 2 × pairings) and `tools/retrain.ts` |

Nothing else is needed. Both catalog loaders glob the card folders, the setup
screen lists every deck in the catalog, and the STCC loaders
(`src/ui/stcc.ts`, `tools/stcc-node.ts`) pick up every
`src/data/custom/*.json` pack.

## 5. Test

```bash
npm run validate:cards                 # schema + counts
npx tsx tools/crosscheck-stcc.ts       # pack vs defs: suit, traits, VP, position, icons, missions
npm run audit:publish                  # stage first (git add -A): it checks the git index
FUZZ_SEEDS=40 FUZZ_WORKERS=8 npx tsx tools/fuzz.ts   # every pairing, invariants on; expect 0 NEW
npx vitest run src/engine/shorthand.test.ts -u       # golden snapshot: the diff must be additions only
npm run test:all && npm run lint && npx tsc -b && npm run build
```

- **Read every card back with `describe()`** next to your printed text. It
  catches wrong zones, missing MAYs and mixed-up costs.
- **Write `src/engine/<code>-deck.test.ts`** for setup (zone counts) and for
  every trigger or pattern no box-1 card uses. MAL needed tests for
  `SHIP_WARPED`, `INCIDENT_RETURNED`, the either-resource warp and both
  endgame counts.
- **Test-harness traps:** an OPERATION frame that `costsAction` needs
  `setActions`. A one-card Incident deck triggers the Burn when it's taken.
  Low-level `run()` drains events, so reactions do fire.
- **Look at it in the app.** Add a preview config for the worktree; Deck
  review shows the rendered face, the printed text and the engine's reading
  side by side.

## 6. Art sources

**Manifest:** `tools/custom/<pack>-art.json`.

```json
{
	"universe": "the Firefly series",
	"palette": "Firefly's space-western mood — dusty amber, rust and teal …",
	"art": {
		"<key>": {
			"source": "tmdb:<id>.jpg | commons:File:… | enwiki:File:… | file:likeness/x.jpg",
			"crop": [0.3, 0.0, 0.85, 1.0],
			"position": "50% 25%",
			"size": "200% auto",
			"subject": "art direction for the prompt",
			"notes": "extra direction, e.g. lighting",
			"likeness": false
		}
	}
}
```

Field meanings:

- `crop` pre-crops the download (fractions), so the likeness file shows just
  the face.
- `position` and `size` place the photo in the art window of a photo-based
  face.
- `likeness: false` paints the card from its description alone. Use it when
  the only reference would mislead: MAL's shuttle and skyplex copied the NASA
  photos they were given.

Where images came from, and what worked:

| Source                             | Use                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TMDB** (`image.tmdb.org`)        | series and film stills, promo portraits | The CDN is open. The web pages listing images respond to `curl` with a browser UA, a few seconds apart; Python `urllib` got 403s and then a rate limit. Useful pages: `/tv/<id>/images/backdrops`, `/tv/<id>/season/1/episode/N/images/backdrops`, `/movie/<id>/images/backdrops`, `…/images/posters`. Make numbered contact sheets (`w300` thumbnails), pick, then fetch `original`.                                                                                                                                                |
| **Fandom wiki**                    | guest characters missing from TMDB      | `static.wikia.nocookie.net` blocks scripts with a Cloudflare check. Open the article in the user's Chrome (Claude in Chrome), list images or search files with the wiki's `/api.php` from the page, `fetch()` the image from within the article (CORS allows it), and save it with an `<a download>` click. Chrome allows one automatic download per page load, so reload between files. Opening the image URL directly brings up the Cloudflare check: back out, don't interact. Ask the user before downloading, naming the files. |
| **Wikipedia** (`enwiki:`)          | a few small in-character stills         | Usually too small for art; fine as a likeness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Wikimedia Commons** (`commons:`) | props, places, flags, space imagery     | Freely licensed; the credit is printed on the card. Never use it for crew portraits.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **IMDb**                           | —                                       | Bot challenge (202); don't.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Saved files go in `vendor/custom/<pack>/likeness/` and are referenced as
`file:likeness/<key>.jpg`.

**Character likenesses need a label.** TMDB stills carry no captions, so don't
pick a character out of one by their face. Use stills that name who they show:
the non-free image on the character's Wikipedia article (list a page's files
with `generator=images`; keep the `local` ones, the Commons ones are usually
convention photos), or a captioned group photo ("from left to right: …"). A
higher-resolution copy of the same photograph (same poses and composition) keeps
the caption's positions; SHP's Sheppard comes from the TMDB copy of the
captioned season 4 cast photo. With no labeled still, paint the character from a
description (`likeness: false`), as SHP did for Zelenka and Todd. Unlabeled TMDB
stills are fine for ships, places and props.

```bash
npx tsx tools/custom/render-cards.ts <pack>   # fetch art, render faces + template-blank.jpg
```

Check every face on a contact sheet (PIL, five per row). Fix crops and
positions in the manifest, then re-run. Faces go to `public/custom/<pack>/`,
and their map to `vendor/custom/<pack>.images.json`, which the loaders read.
The renderer needs Chrome or Chromium (`CHROME_PATH`) and the fetched STCC
icons.

## 7. Painted art with Codex

```bash
npx tsx tools/custom/build-prompt-kit.ts <pack>   # vendor/custom/<pack>/prompt-kit/
PACK=<pack> tools/custom/codex-art.sh 01 02 03    # paint, one card at a time
npx tsx tools/custom/render-cards.ts <pack>       # re-render with the art
```

- **The kit:** per card, prompt A (art only, recommended), prompt B (whole
  card), `card-text.txt`, `layout.jpg` and `likeness.*`, plus four printed
  cards as style references. It works by hand in ChatGPT too (see its
  README).
- **`codex-art.sh`** runs the Codex CLI bundled with the ChatGPT app (`codex
exec`, OpenAI's built-in image generation, signed in with the user's
  ChatGPT account; about 30k tokens per card). The prompt goes in on stdin,
  because `-i` takes several files and would swallow it. Codex copies the
  image from `~/.codex/generated_images/` to `override/<key>.png`. Logs go to
  `vendor/custom/<pack>/codex-logs/`.
- **If Codex points at another provider** (the user's `~/.codex/config.toml`
  pointed at a LoyJoy server), park it first. Copy the whole file to
  `~/.codex/parked/config.<name>-<date>.toml`, then set `model_provider =
"openai"` and remove the provider block, editing line by line and checking
  that the result still parses as TOML. Restore by copying the file back.
- **Order:** paint three cards, review, adjust, then run the rest.
- **Painted art fills the whole card** behind the text boxes, like the print.

Art direction learned the hard way:

- **Character cards:** chest-up portrait, face centred, eyes about 40 % down,
  the top 22 % background only. Keep the face out of the top-left (name
  plates), the top-right quarter (trait badges) and the bottom 40 % (rules
  text). The kit adds this for PERSON, CAPTAIN and ALLY cards. Subjects
  shouldn't say "standing" or "bare feet", which invites full-body shots.
- **Likeness stills:** solo shots only. A face that's small, turned away or
  looking down comes back the same way (Simon). Pick a front-facing still and
  add `notes` ("faces the viewer, face large and well lit").
- **Lighting:** hats and dark scenes cast shadow over the eyes. Use `notes`
  for an even key light (Badger).
- **Real-world stand-ins** (NASA craft for fictional ships) get copied
  literally. Use `likeness: false` with a detailed text description.
- **Before regenerating,** keep the old art as `<key>.v1.png`. Only the exact
  `<key>.png` is used, and a missing override makes the renderer fetch the
  photo source again.

To replace art by hand, drop `override/<key>.png`. A whole finished face goes
in `override/faces/1<CODE>NN-TT.jpg`.

## 8. Commit

`git add -A`, run the checks again (`npm run audit:publish` must be clean),
and confirm `git status --short --ignored` lists `vendor/custom/` and
`public/custom/` as ignored. Commit on the topic branch. Pushing to the public
repo publishes the pack's names and text, so that's the user's call.

## Checklist for a new crew

- [ ] Research brief, with the pitfalls (facts, taglines, lyrics)
- [ ] Deck design: slots, engine, risk, starting-deck sanity, loops
- [ ] `crew/<code>.json`, `boards/<code>.json`, `custom/<pack>.json`
- [ ] `DECKS`, `validate-cards` group + total, `DECK_ORDER`, fuzz `CREW`
- [ ] validate, crosscheck (0 mismatches), describe read-back, audit
- [ ] fuzz (0 NEW), `<code>-deck.test.ts`, shorthand snapshot (additions only)
- [ ] `<pack>-art.json`: `universe`, `palette`, a source + subject per card
- [ ] Faces rendered and reviewed; crops fixed
- [ ] Prompt kit; first three painted and reviewed; the rest painted
- [ ] Fixes: likeness, notes, `likeness: false`; v1 art kept
- [ ] Full test, lint, build; commit; art left untracked
