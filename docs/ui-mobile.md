# Pocket Bridge — the phone shell and async play

The phone and tablet layer of the UI, and the async model it plays over. The desktop console
has its own layout (`ui-lcars.md` §4); `ui-spec.md` still decides _what_ must be reachable. This file
records the design and the decisions taken on 2026-09-28 (design proposal: "Pocket Bridge"
artifact). Build order in §9.

## 1. Goals

1. Every card readable at a glance on a 390px screen — via Shorthand (`shorthand.md`), not the
   printed face.
2. A whole turn playable with one thumb in a spare minute.
3. Async two-player over a shared server: no hot-seat, each device is one seat, turns and
   interrupts travel as messages; live play falls out when both players are online.

## 2. Shells — viewport media queries pick the shell

| Viewport                     | Shell          | Layout                                                                 |
| ---------------------------- | -------------- | ---------------------------------------------------------------------- |
| width < 768px                | **phone**      | pinned header · station tabs · one station · hand dock · bottom sheets |
| landscape and height < 500px | **phone-wide** | header as a left rail · station · hand as a right column · side sheets |
| 768px ≤ width < 1080px       | **tablet**     | header · Sector and Ship side by side · Crew in a drawer · hand dock   |
| width ≥ 1080px               | **console**    | the LCARS desktop, laid out across the table (`ui-lcars.md` §4)        |

A player may force a shell from the menu (stored per device). Shells share every component below
the station level; only the frame differs.

## 3. Card densities — container queries pick the card

One `<CardTile>` renders four densities from the width of its **slot** (`container-type:
inline-size`), never the viewport:

| Slot width | Density  | Shows                                                | Used in                           |
| ---------- | -------- | ---------------------------------------------------- | --------------------------------- |
| ≤ 66px     | **pip**  | suit glyph, VP                                       | stacks, counts, beamed cards      |
| ≤ 112px    | **chip** | suit, name (2 lines), first line clipped             | hand dock, compact lists          |
| ≤ 180px    | **tile** | suit, name, VP, tokens, every line (small)           | Market grid, candidate trays      |
| > 180px    | **wide** | + traits, skill/focus icons, state chips, full lines | Fleet, hand sheet, Orders, detail |

Long-press (or click on desktop) opens the full card: the **Rosetta view** — each Shorthand line
over its English sentence, legality per line ("Why not: …"), keyword links, and the printed scan
behind a toggle when STCC data is on the device. As on desktop (`ui-spec` §3), the lines usable
from the card's zone come first and the rest fold under **Not usable from here (n)**, and a
Play / Activate that costs an action leads with the action token.

State is drawn on the tile, never baked into the face: Glory tokens, action tokens, exhausted
(dims only the operations it disables), beamed cards (chips), ship location, candidate ring.
Every Location in play carries a row of named standees for the ships at it, wherever the tile
is drawn (stations, choice sheets).

**Lines shown depend on where the card is.** In play: hide PLAY, CONTROL and Development lines
(they cannot fire again). In hand: table lines fade ("works once in play"). In the Market and
detail: everything.

## 4. The phone screen

- **Header (pinned on every station):** turn and phase rail (Resupply · Control · Action ·
  Clean-up), actions left as chips, your pool (DIL/LAT/GLO), ~VP, an opponent pill (seat colour,
  ~VP; opens the opponent view), Stardate meter (sequence, Glory left, cards left) and the **Burn
  meter** (Incident deck left, and who would win the Burn now).
- **Stations (tabs):**
  - **Sector** — Market 2×2 (Glory tokens, deck counts, Junk/Encounter counts), then the Neutral
    Zone: one row per Location with a tug-of-war bar (your tokens vs theirs) and the secure rule
    worked out ("Secured by you · 3 vs 1", "You need 3 more tokens here").
  - **Ship** — Captain (Away Team pool), Duty Officer(s), Fleet (ship location, beamed cards),
    Location Area, Staging (this turn), all as wide tiles.
  - **Crew** — specialty tracks with the current multiplier and steps to the next, mission goals
    as a checklist compiled from the goal predicates, piles (Draw, Discard, Reserve, Development,
    Log), and **"if the game ended now"** from the scoring function (incl. the Focus = 0 until a
    mission is complete warning).
- **Hand dock:** chip-density hand, `Hand n` / `Orders n` / primary `End step ›` buttons. Swipe up
  (or tap) for the hand sheet with wide tiles.
- **The line is the button.** A legal operation is a lit line on its tile; tapping it plays or
  activates it (or opens its choice). No double-click, no hover. A card with a single legal
  action also carries the console's Play button beside its header (`src/ui/quickPlay.tsx`).
- **Orders sheet:** every legal move right now, grouped by where the card is, built from
  `legalIntents`; also the screen-reader path through a turn.
- **Choice sheets:** one renderer per `PendingChoice` kind (14 kinds). A choice switches to the
  station holding its candidates and rings them in place; the sheet repeats candidates as tiles
  only when some cannot be ringed on screen (blind deck tops, hand + discard mixes). Source card,
  prompt, min/max and Decline are always shown (ui-spec §4). An operation choice (which PLAY a
  free play resolves, which operation to duplicate) shows the card with each printed operation
  as a tappable block. Destination choices remember their default for the game. The choice sheet takes the dock's place in the column rather than rising
  over a scrim, so the ringed board above stays visible and tappable; it folds to its header.
  Confirm is enabled only when the engine's `checkSelection` accepts the selection.
- **Read at the top, act at the bottom:** everything pressed to act lives in the bottom 40%.

## 5. Async screens

- **Hails (inbox):** games waiting on you first (score, Stardate, the opponent's last turn in
  Shorthand), then games needing an answer on the opponent's turn (with the deadline), then games
  on their move (with presence: "on the bridge").
- **Previously on…:** the opponent's last turn replayed from the intent log as rows — card,
  resolved Shorthand with real numbers, one-line note — with four deltas on top (VP, Stardate Glory,
  Incident deck, their Incidents). Anything that hit you is outlined in your colour, including
  answers your standing orders gave. "Replay on board" steps the log on the stations.
- **Reaction / forced choice on their turn:** opens straight into the decision, with the
  opponent's attacking card, your reacting card, and the standing-order control.
- **Opponent view:** their tiles in salmon, read-only; hidden information as locked counts (hand 5,
  Log 1), never as a gap.

## 6. What stays LCARS

Keep: seat colours (ice = you, salmon = opponent), one hue per system, Antonio for chrome and
numbers / Barlow for sentences, red = alert only, state drawn over cards. Drop on phones: capped
bars and the console strip, printed faces as the default view, Option-hold zoom and double-click
(long-press and tap-the-line replace them). Relaxed: "no modal shows a copy of a card" — candidate
tiles appear in a sheet only when they cannot be ringed in place.

## 7. Async model

A session is seed + setup + intent log; the engine replays it byte-for-byte. The server becomes
**authoritative**:

- **The seed never reaches a phone.** Today a session file carries the seed and full log, so
  anyone holding it can replay the hidden decks. Online, the server holds seed and raw state;
  clients send intents and receive `project(state, seat)` plus their legal intents — as a
  seat view (`src/engine/seatView.ts`): instance ids are minted in catalog order, so hidden
  cards also travel under positional aliases (`hidden:HAND:1:3`), never their real ids.
- **Server runs the engine** (pure TS, no DOM): validates each intent against `legalIntents`,
  applies `reduce`, bumps a game `version` (optimistic concurrency: a stale version is rejected).
- **Seats by capability link.** Creating a game returns one secret token per seat; the invite link
  carries the other seat's token. No accounts. The token authorises intents for its seat only.
- **Invites (hails).** The host picks only their own captain; the game waits, unset-up, until the
  invite's holder picks theirs (never the host's crew). Then the seed is drawn and the guest opens
  the game — they are at the screen right then (an agreed `SetupConfig.startingSeat`; the random
  draw of §2.1 #17 is still made, so the seed stream is unchanged). Joining retires the invite
  token for a fresh one: the host has seen the link, so it must not stay a key to the guest's seat.
- **Undo (decided): until something new is revealed.** Within your own turn you may undo freely
  until an effect reveals hidden information — a draw, scan, look, take, find/shuffle, or anything
  that consumes `state.rng`. Once seen it cannot be unseen; the server enforces the boundary.
  (Hot-seat and Cadet keep their current policies.)
- **Interrupts.** REACTION windows (41 operations) and FORCE/OPPONENT choices (35 effects) put a
  decision on the seat that is not moving; its stack pauses.
  - **Standing orders**, per reaction card and seat: _Ask me_ (default), _Always use_ (the bot
    heuristic, `src/bot`, makes any sub-choice), _Never_.
  - **Deadline (decided): 12 hours by default**, per game setting. On expiry the server takes the
    safe default — decline an optional reaction/window, or `firstLegalSelection` for a forced
    choice — and the log records that it timed out.
  - The engine already skips windows that could change nothing; those never reach a phone.
- **Live when both are online.** Presence per seat over the realtime channel; the same flow
  resolves in seconds. There is no separate live mode.
- **Notifications.** In-app (Hails badges, SSE) first; Web Push for installed PWAs as a follow-up.

### Server storage (extends `server/`, decided over a hosted database)

```
games     id · seats(deck, side) · status · version · pending(seat, kind, deadline) · settings
intents   game_id · seq · seat · intent (json) · at             append-only; the source of truth
secrets   game_id · seed · seat tokens                           never served
orders    game_id · seat · card_def · policy                     ask | always | never
presence  game_id · seat · last_seen                             in memory; drives "on the bridge"
```

The file store keeps one JSON document per game as today (atomic temp+rename), split into a
public part and a secret part.

## 8. Accessibility

44px targets, focus rings, `prefers-reduced-motion`; each Shorthand line is `role="img"` labelled
with its English sentence; Orders is a complete list-based way to play; colour is never alone.

## 9. Build order

1. **Shorthand compiler and glyphs** — `src/engine/shorthand.ts`, `src/ui/shorthand.tsx`, tests,
   desktop detail and Details view. _(done)_
2. **`<CardTile>` densities** — container-query tile with state overlays and lit lines from
   `canPlay` / `canActivate`. It powers the phone and tablet shells; the desktop console keeps the
   printed scans (its Details toggle already shows Shorthand). _(done: `src/ui/tile/`)_
3. **Phone shell** — header, stations, dock, sheet host, choice sheets per kind, Orders, opponent
   view; shell switch by viewport (§2). _(done: `src/ui/mobile/`; local hot-seat/solo through the
   store — the async screens of §5 arrive with step 4)_
4. **Authoritative async server** — intents API, seat tokens, projections, version checks,
   undo-until-reveal, standing orders, deadlines, SSE, recap built from the log. _(done —
   `server/README.md`, `src/session/online.ts`; the phone and tablet shells play it through
   `src/ui/online/`: Hails, new game + invite, join by link, Previously on…, standing orders,
   the online status line)_
5. **Presence and live values** — "on the bridge" (_done_: presence per seat over SSE, shown in
   Hails and the status line) and live numbers on variable amounts (_done_: `withLiveValues`,
   `docs/shorthand.md` §5; phone tiles and the desktop detail, local play only). Trait resonance
   (lighting the in-play cards a line refers to) is not built yet.

## 10. Playing online

```bash
npm run server -- --host 0.0.0.0   # the game server on port 8787; games in server/data/games
npm run dev -- --host              # the app, reachable from phones on the same network
```

Open the app, then **Play online** (or go to `#hails`). Without `--host` both only listen on this
computer, which is enough to try it in two browser tabs.

- **Hail** a captain under Hails → New online game: pick your captain and send the invite link
  (the token rides in the URL fragment, never sent to a server). The game waits in Hails under
  _Waiting for an answer_ (tap it to share the link again); the invite screen switches to _Take
  the chair_ as soon as it is answered.
- **Answer** by opening the link: pick your captain, board side and name, and you take the first
  turn. _Not now_ keeps the hail in your Hails under _Hails to answer_. The link works once;
  opening it again afterwards opens the seat on the device that answered it.
- **The app finds the server** on port 8787 of the host that served it, so a phone on the same
  network works when both run on one computer. A production build expects the server at its own
  address instead — the hosted setup serves both from one place ([`deploy.md`](deploy.md)). Point
  it elsewhere from the Hails footer.
- **Seats live on the device** (localStorage): clearing site data forgets them, and an answered
  invite link cannot take the seat back (it was retired on joining). **Menu → Copy my seat link**
  gives a link with the seat's own token: open it on another device to play there, or keep it as
  a backup. Anyone holding it plays that seat.
- **Online always uses the phone or tablet shell.** The LCARS console reads the local engine
  state for its legality and detail views; on a wide screen an online game opens in the tablet
  shell, which reads only the seat view.

### Known limits

- The engine seed is 32 bits: a determined client could brute-force it from the visible opening
  and predict the decks. Widening it changes every replay of existing sessions.
- The old `/sessions` routes are an unauthenticated debug store; `--public` (the hosted mode)
  switches them off and adds per-client rate limits.
- Each view carries the full engine log, so payloads grow over a game; deltas could come later.
- Notifications are in-app only (Hails, the live stream); Web Push for installed web apps is a
  follow-up.
