# LCARS visual design — Ready Room

Visual layer for [`docs/ui-spec.md`](ui-spec.md), implemented by
[`todo/14-ui-shell.md`](../todo/14-ui-shell.md). The spec decides _what_ is on screen and why;
this file decides what it looks like. **Where the two disagree, `ui-spec.md` wins** — every rule
below exists to serve "legality and legibility, not animation" (§1).

Implemented in `src/ui/ui.css` (component dress) over `src/ui/lcars.css` (tokens + bar geometry).
The class names are the ones the components already used, so the restyle changed no component
tree and no test.

---

## 1. The thesis

LCARS is not a skin of coloured rectangles. Its actual grammar is **a frame that reports system
state around content that stays still.** That maps onto this game better than any table-felt
theme would:

> **The frame carries state. The table never moves.**

- Everything coloured is **chrome**: the rail, the elbows, the top/bottom bars, section headers,
  the choice dialog's stripe. Chrome may recolour, pulse, or switch label at any time.
- Everything playable sits on the **black ground** and never moves for a cosmetic reason. A card
  moves only when the rules move it. This is what makes a 5–7/10 complexity board readable after
  looking away mid-turn.

Two consequences worth stating, because they're the ones that get eroded later:

1. **Selection happens in situ** (`ui-spec` §4): the candidates ring where they live. The
   choice dialog repeats them so the decision stays readable while it covers the board, laid
   out the way the board is (grouped by zone, Locations by area, with their tokens), never as a
   loose pile of copies.
2. **No animation moves a card between zones in v1.** The log is the record of movement.

**The one deliberate exception: tokens fly.** Resources and action tokens travel from where
they came from to where they went — out of the passive that produced them, into the card
they paid for, from the opponent's pool into yours — and every counter they leave or reach
floats its `+n` / `−n` (`src/ui/flow.ts`, `flight.tsx`, `delta.tsx`). Cards still never move.
Undo, passing the device and loading a save never animate; `prefers-reduced-motion` keeps
the delta badges and drops the flights.

## 2. Colour — one hue per system, not per mood

| Token                    | Hue          | Owns                                                          |
| ------------------------ | ------------ | ------------------------------------------------------------- |
| `--orange` `#ff9c00`     | LCARS orange | the frame itself, turn control, the active choice ring        |
| `--sunflower` `#ffcc66`  | amber        | Market and everything commercial                              |
| `--periwinkle` `#9c9cff` | blue-violet  | Neutral Zone, contested space, reactions                      |
| `--lilac` `#cc99cc`      | lilac        | Stardate track, Glory, VP — the time/score axis               |
| `--ice` `#99ccff`        | ice blue     | **you**, seat 0                                               |
| `--salmon` `#cc6666`     | salmon       | **opponent**, seat 1                                          |
| `--mars` `#ff4141`       | red          | alert only: the Burn, ATTACK, illegal, what the AI did to you |

The ground is `#05050a` — near-black pulled slightly blue, so the chrome's warm hues read as lit
rather than pasted on. Neutrals are `#0e0e16` / `#171722` / `#2a2a3a`.

The seat colours are the load-bearing pair: once _ice = you, salmon = Shran_ holds everywhere —
token pips at a Location, log entries, the crew board, the secured badge — the player stops
reading labels to work out whose tokens those are. The ship standees on a Location and the
winner's banner on the end screen take the same pair. Never spend ice or salmon on anything else.

Specialties keep the printed red/blue/yellow (`--research` / `--influence` / `--military`) and,
per `ui-spec` §8, **always** appear as hue + `.glyph` letter + text label. Colour never carries
a specialty on its own.

### 2.1 Palette themes

The token names above are **roles** (`--orange` is "the frame", `--ice` is "you"); a theme moves
only the hues. Themes are `:root[data-theme='…']` blocks at the end of `src/ui/lcars.css`, chosen
per device from the console's Settings, the start screen or the phone menu (`src/ui/theme.ts`), and
applied before first paint by an inline script in `index.html`.

| Theme        | Frame            | Market | Neutral Zone | You  | Opponent |
| ------------ | ---------------- | ------ | ------------ | ---- | -------- |
| TNG classic  | orange (default) | amber  | blue-violet  | ice  | salmon   |
| LCARS blue   | cornflower       | silver | violet       | aqua | salmon   |
| Voyager      | lavender-blue    | peach  | blue         | sky  | salmon   |
| Enterprise-E | steel blue       | ochre  | blue         | ice  | salmon   |

TNG leans orange/gold; Voyager and the later films lean blue and lavender. Two rules every theme
keeps: the seat pair stays distinct from the frame and from each other, and red stays reserved
for alerts — so there is no red-frame theme. Text and wells painted _on_ the chrome use `--ink` /
`--ink-soft` / `--ink-veil`, which each theme sets to match its frame.

`--mars` is reserved. If red appears anywhere that isn't an alert, the alert stops working.

## 3. Type

- **Antonio** — all chrome, labels, numerals, card names, buttons. Ultra-condensed grotesque; the
  closest free stand-in for the Swiss 911 the 1987 art department used. Uppercase, `.09em`
  tracking, `tabular-nums` wherever digits line up.
- **Barlow** — card rules text, log messages, reasons. LCARS never had to render four lines of
  conditional rules text; forcing condensed caps on it would be cosplay at the cost of the one
  thing the UI exists to do.

The split is itself informational: **condensed caps = system chrome, normal-width = game text.**

## 4. Layout

```
┌ cap ┬ HEAD BAR  phase · turn · actions · your pool · ~VP · alerts · AI · Undo · Orders · step · Log · ⛶ · Menu ┐
├─────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ OPPONENT BAND  [hand, face down] [Draw][Discard]  pool · ~VP · tracks · missions · AI ticker · On screen (V)    │
│                Captain · Fleet · Duty · Locations · Staging — every card they have in play, small             │
├────────────────────────────────────────┬──────────────────────────────┬──────────────────────────────────────┤
│ MARKET (M)  [deck] ×4                   │ NEUTRAL ZONE ×3 · Close up (N)│ PILES  [Stardates] [Incidents] [Junk]│
├────────────────────────────────────────┴──────────────────────────────┼──────────────────────────────────────┤
│ YOUR AREA  Captain · Fleet · Duty Officer · Location Area  Close up (B)│ CREW CONSOLE  tracks · piles ·       │
│            Staging Area                                                 │               missions               │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Draw][Discard] [Hand · H]  the hand, peeking up from the bottom edge                                  [Hold] │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The console is laid out like the table it stands for: the opponent across from you, the shared
cards in the middle, you at the bottom with your hand in front of you. A laptop (≈1470×840 of
usable browser) and an iPad on its side (1180×760–820) are the screens it is designed for; the
code is `src/ui/console/` (`ConsoleShell` composes it) and `console.css`.

What the layout follows:

- **One head bar.** Turn, phase, the action tray, your pool and Away Teams, your ~VP (public
  information only), Undo, Orders, the one primary step, and the doors to everything else: Log,
  Fullscreen and a Menu (Replay, Reference, Settings, New game). The four bars it replaced (title,
  session nav, counters, status) cost 210px of an 840px screen. The end conditions appear in it only
  when they are close — the Burn at ≤2 Incidents, Resolution once triggered — and the House AI's
  status sits in it as a short segment (the full sentence for screen readers).
- **The opponent is across the table.** A band along the top in their seat colour: their hand as
  face-down cards, one back per card (face up only with the spectator's Reveal hands), their Draw and
  Discard, their pool, ~VP, the read-outs of their tracks, missions and Incidents, the House AI's
  latest move, and every card they have in play at the small size, grouped by zone. Hold Option
  (or long-press) to read one. Against the official solo Bot the band shows its face-down row in
  place of a hand, its Bot deck, Discard and Supplement, and, beside its cards, the beat it is on:
  the card it resolves and the Automated Command row it matched, with a button for both whole
  cards (`src/ui/solo/AutomatedCommand.tsx`). It replaced a side column of counts — "hand 5, fleet 2" told you
  nothing about what they could do.
- **The decks are on the table.** Every deck and pile is drawn as a small stack of backs with its
  count on top: each Market suit's deck beside its banner, the Stardate pile, Incident deck and
  Junk in the centre column of the shared row, your Draw and Discard at the left end of the hand
  dock, theirs in the band. Public piles (Discards, Junk) open on a click.
- **Shared cards in one row.** Market ×4, Neutral Zone ×3 and the centre piles, one card high.
  Each panel's name runs up its left edge as a tab, so the row spends its height on cards.
- **Your area in two lines.** The printed board has three rows; a laptop has height for two, so
  the zones flow Captain · Fleet · Duty Officer · Location Area on the first line and the Staging
  Area on its own. A late game that runs out of width wraps. The line for Staging is reserved even
  when it is empty, so the board does not jump when you play a card.
- **The hand docks.** It rests along the bottom edge with only the top strip of each card showing —
  the name band, enough to see what you hold, with unplayable cards dimmed as always — and lifts
  to full size over your area when you point at it, focus it or tap it (the first tap on a lowered
  hand only lifts it). The end cap that closes the dock on the right (**Hold**) pins it up and
  lets it drop; the pin is kept per device. On a screen tall enough (`HAND_ROOM_QUERY`, 960px) a
  pinned hand docks at full size in a row of its own and the board's cards shrink to fit above it
  (123px instead of 132 at 1080p), so it covers nothing and Esc leaves it; on a shorter screen it
  lifts over your area and Esc drops it. It lifts straight up and never sideways, so a double
  click lands on the same card. It used to float over the bottom-right of the board at full size
  and covered most of your area.
- **Four layers open only on request.** The hand (above), the opponent **on screen** (**V**, or a
  click on the band: their full area and crew console at your card size, framed like the main
  viewscreen), a **close-up** of one part of the table (**N** the Neutral Zone, **M** the Market,
  **B** your area, **H** your hand) and the **log drawer** (**L** or the Log button; it never opens by itself, and
  the button counts what the other side did since you last looked). **Esc** closes the topmost
  one.
- **The close-ups** draw the same components as the table, only with `--card-w` set as high as
  the board leaves room for, in a frame that takes the viewscreen's place in the system's own
  colour; one shows at a time, and opening one puts the viewscreen away (`Closeup.tsx`). A click
  on a card does what it does on the table, so a choice that asks for one can be answered from
  the close-up. Their doors: the Close up button over the three Locations (N), the Market's own
  label (M, since its suits fill the row a button would take), the Close up button at the end
  of your area's first line (B) and the hand dock's own name (H).
  - **Neutral Zone** (periwinkle; about 280px wide on a 1180×760 iPad, 330px on a laptop,
    against 85–104px on the table): the three `<LocationCard>`s with their Away Teams, ships and
    beamed cards. Under each a readout works out the secure rule for both sides (rules/03
    §3.4.1, `secureStatus` / `secureCopy` in `mobile/facts.ts`, shared with the phone's Sector):
    who holds it, the token count, each side's Away Teams and ships, and how many more tokens you
    need.
  - **Market** (sunflower; about 250px on the iPad, 320px on a laptop): each suit over its faceup
    card and a readout of what comes with it — the cards left in its deck, the resource tokens
    on it (whoever gains it takes them, and while it carries any it can't be junked: rules/05
    §5.4.4, §5.6) and that suit's cards in the Junk.
  - **Your area** (ice; about 160px on the iPad, 190px on a laptop): your `<PlayerArea>`, sized
    so its two lines fit; a late game that runs out of width wraps and the frame scrolls.
  - **Your hand** (orange; five cards about 260px wide on a laptop, against 156px in the dock):
    every card in your hand at once, in as many rows as draw them largest, and the rows even —
    seven cards are four and three, not six and one (`HandCloseup.tsx` measures the backdrop for
    that; `handLayout`). A click on a card does what it does in the dock. While it is open the
    dock stays down, unless it is docked in a row of its own.
- **Cards fit the screen.** One number, `--card-w`, sizes every card on the table from the
  board's height: the shared row is one card high and your area two, and a card's face keeps the
  printed proportions (1170×1635, 1:1.397 — any other box crops the art's edges), so 4.19 card
  widths plus the dock and the measured fixed parts (281px) must fit. It runs from 84px (below that the table
  scrolls) to 132px — about 104px on a 1470×840 laptop and 85px on a 1180×760 iPad, where the old
  layout had 94px cards and still scrolled. The hand keeps its 156px.
- **Zoom is held, not hovered.** Hovering a card does nothing on its own; hold **Option** and the
  hovered card lifts to the middle of the screen at 360×504, over a dimmed board. On a touch
  screen, hold a finger on the card for half a second; the tap that ends the press is swallowed,
  so reading a card never also plays it. The overlay is `pointer-events: none` and sits above
  everything, the choice bar included, because reading a card is usually what you are doing while a
  choice is pending. Releasing the key, lifting the finger, leaving the window or hiding the tab
  drop it.
- **Fullscreen** (**F**, or the button) takes the whole document fullscreen, which wins back the
  browser's ~90px on a laptop. It is offered only where it works and helps: not on an iPhone, not
  in the desktop app, not when the app runs from the home screen (which has no browser chrome to
  begin with — the way to play on an iPad).

| Key        | Does                                 |
| ---------- | ------------------------------------ |
| O          | Orders: every legal move in one list |
| H          | your hand close up                   |
| V          | the opponent on screen               |
| N          | the Neutral Zone close up            |
| M          | the Market close up                  |
| B          | your area close up                   |
| L          | the log drawer                       |
| F          | fullscreen                           |
| Option     | hold over a card to zoom it          |
| Esc        | close the topmost layer              |
| long press | (touch) zoom a card until you let go |

Shortcuts are bare keys: none fires with Cmd, Ctrl or Option held, on auto-repeat, or while you
type in a field (`console/useShortcut.ts`).

Breakpoints: the console takes over at 1080px (`mobile/shell.ts`); below 900px — only reachable by
forcing the console from the menu — cards stop fitting and the page scrolls normally. Below 1080px
the phone and tablet shells take over ([`ui-mobile.md`](ui-mobile.md)).

### 4.1 The crew console

Your crew board is drawn as a console readout rather than a copy of the printed board: the
board's state is three numbers and a handful of counts, and the printed layout spends most of
its area on art.

- **Each specialty is one capped bar.** The cap carries the printed skill icon and the name
  (`RES` / `INF` / `MIL`, full name on the title and in the accessible label), then one segment per
  step 0–15, lit in the specialty hue up to the marker, with the marker segment full-strength
  (no seat-colour underline: on the yellow and red bars it read as a stray mark). The side's
  multiplier glyphs print in their own
  segments, so the Basic and Advanced sides look as different as they score. The end-cap reads
  out the **position** and the **multiplier Focus icons score at right now** (×0 below an
  Advanced side's first glyph) — the two numbers you actually check.
- **Counts are tiles, four to a row.** The piles — Reserve, Development, Log — and completed
  missions are dark tiles; a pile you may look through is a button that opens it.
- **Your resources live in the head bar, not on the console or in your area header.**
  Dilithium, Latinum, Glory and Away Teams (on your Captain / owned) sit next to the action
  tray, always in view. Every pool has exactly one counter on screen, so a token flight (§1)
  has one place to land; the opponent's pips are in their band.
- Missions stay a list under the tiles, since completing one is a button, not a count.

Printed icons on lit chrome sit in an `--ink` well, or a token would vanish into the tile of its
own hue. The opponent's band shows only the read-outs of their tracks; their full crew console is
on the viewscreen (V).

## 5. Cards

The face is the printed sprite from the atlas, with the text card (name, `SUIT · traits`,
operation blocks) behind the **Details** toggle. Sizes follow `ui-spec` §3 — `micro` / `board` /
`hand` — but only the hand runs at hand size: the shared board packs seven slots into one row at
104px and your in-play rows run 94px. Cards away from your hand are read at a glance and clicked
for detail; five zone rows at hand size would never fit a laptop.

**State is drawn over the face, never baked into it** — exhausted rotation, action-token chips,
resource pips, the candidate ring, the illegal hatch. That holds whether the face underneath is
the sprite or the text fallback.

Illegal cards get 34% opacity **plus** a red diagonal hatch **plus** the reason: on hover, and
spelled out per operation in the detail overlay ("Why not: Activations only run in the ACTION
phase"). Opacity alone reads as "loading".

## 6. Icons

The cards print resources and suits as marks, not words, and so does the board: a Glory count
beside a blue crystal is read at a glance where "GLO 4" is read letter by letter.

`tools/extract-icons.ts` lifts them off the card art. The icon-recovery pass (`todo/02b`) already
located every icon on every card, so the tool is not looking at pixels blind: for each label it
measures every occurrence, splits the crop into connected components, and picks the glyph by
**consensus** — the component closest to the most others, since an icon looks the same in all its
dozens of occurrences and the text scraps sharing its gaps do not. The winner is re-cropped from
one of the eight full-size card scans where one exists.

Shipped in `public/icons/`, rendered by `src/ui/icons.tsx`: `DIL` (pink crystal), `GLO` (blue
crystal — they differ in hue, not shape), `LAT`, `ACTION`, `AWAY_TEAM`, and the seven suit pills,
which print as icon-plus-word and are used whole, the way the cards use them.

Not extracted, deliberately: `VP` (11 occurrences, no stable cluster), the three `REQ_*` badges
(the printed gem is fused to its threshold digit, so the digit would bake into the asset — and a
photographic gem is mush at 16px), and `SUIT:CAPTAIN` (3 occurrences, all clipped). Specialties
stay hue + glyph + label, which `ui-spec` §8 requires anyway and which recolours cleanly.

Icons are decorative in the accessibility tree: the count or label beside them is the content, so
each is `alt=""` with its name on `title`.

## 7. The choice dialog

Centre stage, vertically centred over the board and as wide as its content, with a left stripe
in the colour of the system the choice concerns — so the eye is already pointed at the right
zone before the prompt is read. A pending choice is the one thing the player must attend to, so
it sits where the eye is. It always carries: the choice kind, the prompt, **the source card**,
min/max with a live count, and Decline when optional. One renderer per `PendingChoice` kind
(`docs/state-machine.md` §4):

| Kind                 | Treatment                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `CHOOSE_CARDS`       | rings in situ; disabled candidates greyed **with their reason**; live `n selected · min–max`              |
| Locations            | `CHOOSE_LOCATION`, or `CHOOSE_CARDS` over Locations: one picker by area, tokens and ships shown           |
| Operations           | which PLAY / which operation to duplicate: the card, each printed operation a block                       |
| `CHOOSE_DESTINATION` | the gained card beside **Top of deck** stacked over **Discard pile**; one _Remember decision_ checkbox    |
| `OPTIONAL_TRIGGERS`  | a row per reaction (card + printed text), Use toggles in pick order, highlighting the card in play        |
| `ORDER_OPERATIONS`   | drag list + **Auto** when the engine proved independence                                                  |
| Control Step         | the secured Location ringed, with the price (opponent's Glory, cleared tokens) stated _before_ the button |

With no choice pending the head bar is the turn control: phase, one obvious primary action, the
unused-action warning (`todo/14` §5), and **Orders** with the number of legal moves (`ui-spec`
§2).

## 8. Alert

The frame — the head bar and its cap — turns `--mars` in exactly two cases: the Burn is one
Incident away (`ConsoleShell` sets `.frame-alert` at one Incident left), and you are the target of an ATTACK.
It pulses at 1.6s unless `prefers-reduced-motion`. Nothing else in the UI is allowed to recolour the frame, which is what
makes it mean something.

The Incident deck also carries its own warning colour at ≤2 (`todo/14` §3) — a module-level
warning, distinct from the frame-level alarm.

## 9. Accessibility

- Candidates are real `<button>`s: Tab walks them, Enter selects, Esc declines — no roving
  tabindex needed.
- Minimum 44px on every control (`.btn`); `micro` cards are display-only and never clickable.
- Focus is a 2px orange ring at 2px offset, on the dark ground — visible on every surface here.
- `prefers-reduced-motion` kills every animation including the candidate ring, which then falls
  back to its static 2px ring and outer glow.
- Hidden information is drawn as an explicit lock chip ("Log 4 · contents hidden"), never as an
  absence. A player must be able to see that something is hidden, not just fail to find it.

## 10. Using it

- [`src/ui/lcars.css`](../src/ui/lcars.css) — tokens and the bar-cap geometry, imported by
  [`src/ui/ui.css`](../src/ui/ui.css), which dresses the components. No component hard-codes a hex
  value.
- Fonts load from Google Fonts in `index.html`: `Antonio` 400/600/700 + `Barlow` 400/500/600,
  each with a real fallback stack (`Arial Narrow` for Antonio).
- Themable palette, always dark. There is no light mode — LCARS is a dark console, and a light
  variant would need a second, unrelated design. Every colour is painted explicitly. See §2.1
  for the palette themes.

## 11. Explicitly not in v1

Card-movement animation (token flights are in — §1), sound, the LCARS boot sequence, 3D flips, and the
vertical rail (§4 — it lost to the board on width). `todo/14`
§9 already defers these; the design does not secretly depend on any of them.
