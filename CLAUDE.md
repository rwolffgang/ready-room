# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ready Room is an unofficial browser implementation of the board game _Star Trek: Captain's Chair_:
a pure TypeScript rules engine, a React UI (desktop + phone layouts), and a small Node server for
asynchronous online play.

## Commands

```bash
npm run fetch-cards               # download the STCC card database into vendor/stcc/ + public/stcc/ (gitignored)
npm run dev                       # Vite app on :5173
npm run server                    # game/session server on :8787 (tsx server/main.ts)
npm run game                      # replay + summarise the newest game being tested (see below)
npm test                          # vitest run (two projects: engine-node and dom)
npx vitest run src/engine/scoring.test.ts      # a single test file
npx vitest run -t "some test name"             # tests matching a name
npx vitest run --project engine-node           # only the node (DOM-free) project
npm run lint                      # eslint src tools server
npm run build                     # validate:cards + audit:publish + tsc -b + vite build
npm run validate:cards            # Zod-parse every card JSON, ID uniqueness, group counts
npm run audit:publish             # copyright gate (see below)
npx tsx tools/crosscheck-stcc.ts  # diff our card defs against the STCC database
npx tsx tools/arena.ts --a normal --b easy --games 100   # House AI self-play arena (docs/bot.md)
npm run bot:check                 # quick arena regression after card/rule changes
npm run bot:retrain               # self-play → train value → arena gate → src/bot/weights/
npm run desktop:dev               # Tauri desktop app around Vite on :1420 (needs Rust)
npm run desktop:build             # desktop installers (runs build:desktop = vite build --mode desktop)
```

`.claude/launch.json` defines preview servers: `ready-room` (dev on :5180), `ready-room-5181` (a
second dev server, for a parallel session), `game-server` (:8787) and `hosted` (the
production-style server on :8080 serving `dist`).

**Looking into the user's games:** while `npm run dev` runs, every autosave of a local game is also
written to `.debug/games/<id>.json` (gitignored; the `debugGames` plugin in `vite.config.ts`). Don't
ask for pasted session JSON: run `npm run game` (newest game: turn, phase, zones with card names,
pending choice, log tail), `-- --list`, `-- <id>`, `-- --at N` (replay the first N intents),
`-- --intents` or `-- --state` (full GameState JSON). Online games live on the game server instead
(`server/data/`).

A husky pre-commit hook runs lint-staged (Prettier on staged files). Prettier style: tabs, no
semicolons, single quotes.

Desktop builds for macOS and Windows come from `.github/workflows/desktop.yml` (Tauri, unsigned;
publishing a GitHub Release builds the installers and attaches them to it); see `docs/desktop.md`.

Deployment is a single Fly.io machine (`fly deploy --ha=false --remote-only`, see `docs/deploy.md`);
it must never be scaled past one machine because game state and deadline timers live on its volume.
`fly.toml` is local/gitignored; `fly.example.toml` is the template.

## Hard rules

- **No WizKids/CBS material in git.** No card images, PDFs, printed card text or card _names_ in
  code, tests or card data. Refer to cards by id (e.g. `1PIC08/24`); names and printed wording are
  joined in at runtime from the fetched STCC data (`src/data/stcc.ts`, `src/data/cardNames.ts`).
  `tools/audit-publish.ts` enforces this and is part of `npm run build` — keep it green.
- **The STCC database is the source of truth for card data** (including errata). `crosscheck-stcc`
  reports divergence. Assume the fetched STCC files are present when working locally, and use the
  original game icons from them.
- **Engine determinism** (ESLint-enforced in `src/engine/**` and `src/data/**`, tests excepted): no
  `Math.random`, `Date.now` or `new Date` — randomness comes from `state.rng` (`src/engine/rng.ts`).
- **The engine is DOM-free**: no imports from `@ui` / `ui/`. Engine, data, session and server tests
  run in Node; only UI tests get jsdom.
- **`GameState` is plain JSON**: no class instances, `Map`/`Set`, functions or object-identity
  references. Cards are referenced by instance id.
- Unused parameters are prefixed with `_` (primitive handlers share a full `(state, node, ctx, frame)`
  signature).

## Architecture

Read `docs/architecture.md` first; `docs/state-machine.md` and `docs/effect-dsl.md` specify the core.

**Card effects are data, not code.** Each card is a JSON definition in `src/data/cards/`
(`common/`, `crew/`, `boards/`, `solo/`) carrying mechanics only (suit, traits, skills, VP,
operations). Operations are trees in a typed effect DSL, schema-validated by Zod
(`src/data/schema.ts`). Adding or fixing a card means editing JSON, never adding a `switch (cardId)`.

**The engine is a halting stack machine** (`src/engine/resolver/`). `reduce(state, intent)`
(`src/engine/intents.ts`) validates an intent, pushes frames onto `state.stack`, and runs until the
stack is empty, a `pendingChoice` is published, or the game ends. Each DSL node kind has a primitive
in `resolver/primitives/` (one file per kind, registered in its `index.ts`). Because the stack lives
in state, mid-effect saves, undo, replay and bots all work by construction; a choice is answered with a
`RESOLVE_CHOICE` intent. REACTION/PASSIVE operations are collected after each primitive from events
(`resolver/triggers.ts`) and pushed above the interrupted frame; before that, `resolver/chronicle.ts`
logs a line for every card or Away Team an event took off the table. Other engine pieces: `phases.ts`
(RESUPPLY → CONTROL → ACTION → CLEANUP), `setup.ts`, `market.ts`, `scoring.ts`, `endgame.ts`,
`modifiers.ts`, `queries/` (in-play, traits, counting, legality), and `seatView.ts`/`projection.ts`
(hide the opponent's hidden info per seat).

**`describe()`** (`src/engine/describe.ts`) renders an effect tree back to card-record English. It is
the verification loop for transcribing cards (tree → describe → diff against the record) and is also
used for UI tooltips; `describe.test.ts` forces it to stay total over every node kind.
`src/engine/shorthand.ts` renders the compact glyph line used on phones (`docs/shorthand.md`).

**Session layer** (`src/session/`): the intent log is the real source of truth; state = replay(seed,
setup, log); undo = truncate + replay. Persistence is IndexedDB via a small `Storage` interface
(`get/set/del/keys`) that the server also implements over HTTP (`remote.ts`). `online.ts` /
`protocol.ts` talk to the authoritative online-game API.

**Server** (`server/`, dependency-free Node + tsx, see `server/README.md`): `/sessions` is a debug
store (one JSON file per game); `/games` is the authoritative async two-player service — it holds
seed and full state, runs the engine, and returns each seat only its own view. `--public --static
dist` is the hosted mode (serves the app, disables `/sessions`, rate-limits).

**Desktop** (`src-tauri/`, `src/desktop/`): a Tauri shell around the same web build. Installers
ship no STCC data; on first launch `src/desktop/DesktopRoot.tsx` fetches it with the shared
fetcher (`src/data/stccFetch.ts`, also behind `npm run fetch-cards`) into the app-data folder, and
`src-tauri/src/lib.rs` serves it over the `stcc` scheme. `VITE_PUBLIC_URL` points online play at
the hosted game.

**UI** (`src/ui/`): React 19 + Zustand. It renders state read-only and dispatches intents; each
`PendingChoice` kind has a renderer. Below 1080px it switches to `mobile/`. `online/` holds the online
play screens. Path aliases: `@engine`, `@data`, `@ui`, `@session`.

**Bot** (`src/bot/`): the Cadet Training virtual opponent (`rules/10`) and the **House AI**. The
House AI is our own opponent (Easy / Normal / Hard), _not_ the official solo Bot, which is still
blocked on the solo rulebook. `docs/bot.md` is its manual. Read it before you change anything in
`src/bot/`.

## House AI: how to keep it working

- **It is rule-agnostic.** A `Bot` (`src/bot/types.ts`) chooses among `legalIntents` and
  `candidates()` and simulates with `reduce`. New cards are JSON, and the AI plays them without bot
  code. Never add card-specific logic (`if (cardId …)`) to `src/bot/`.
- **No cheating.** `decide()` receives the full state but may read hidden information only through
  `determinize()` (`src/bot/determinize.ts`). The no-cheat invariance tests must stay green.
- **Deterministic.** `src/bot/` is under the same ESLint determinism rule as the engine. Wall-clock
  budgets come in as an injected `clock` (the worker passes `performance.now`, in
  `src/ui/workerBots.ts`).
- **A new `PendingChoice` kind** needs a case in `src/bot/candidates.ts` (and `firstLegalPolicy` in
  `src/bot/autoPlay.ts`). The exhaustive switches flag it.
- **A new resource, track, token or scoring rule** should become a feature in
  `src/bot/evaluate.ts` (`FEATURE_NAMES`, `EVAL_WEIGHTS`). Otherwise the AI plays it legally but
  doesn't value it.
- **After adding cards, an expansion or rules changes**, run the arena regression (`npm run
bot:check`, a quick seat-swapped self-play sweep across all deck pairings). It must report 0
  fallbacks and 0 CYCLE/CAP/STALL stops for the house bots. It's also a good engine fuzzer: it has
  found real engine bugs.
- **Whenever the features change** (and preferably after an expansion), retrain the learned value
  with `npm run bot:retrain`. It runs self-play, trains, gates the result in the arena and writes
  `src/bot/weights/`. The weights record the feature-list hash and the card-data hash. On a mismatch
  the bot falls back to the hand-tuned evaluation, so stale weights never ship silently. Only commit
  new weights when they pass the arena gate.
- **Strength claims need arena numbers**: `npx tsx tools/arena.ts --a <spec> --b <spec> --games N`
  (Wilson CI, seat swaps). Record gate results in `docs/bot.md`.

## Rules and rulings

- `rules/` is the rulebook restructured in our own words; precedence when interpreting a card is
  `rules/08-keywords-reference.md` > `rules/12-edge-cases-and-rulings.md` > sibling cards.
- `docs/card-rulings.md` is an append-only log of every interpretation made while implementing a
  card — add an entry when resolving an ambiguity; `docs/open-questions.md` tracks unresolved ones.
- `todo/` holds the original build plan; each file ends with a Definition of Done, and tests and lint
  comments cite them (`todo/NN §x`).
