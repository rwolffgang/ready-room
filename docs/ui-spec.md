# UI Specification

## 1. Guiding constraint

> The visual layer that implements this spec is [`ui-lcars.md`](ui-lcars.md) (tokens in
> [`src/ui/lcars.css`](../src/ui/lcars.css)). This file stays the authority on _what_ is on
> screen and why.

At complexity 5–7/10 with ~300 unique cards, **the UI's job is legality and legibility, not
animation.** Every affordance should answer: _what can I do right now, and why not that?_

## 2. Screen layout (desktop, ≥1280px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: phase · turn · actions ●●○ · [End Step] · undo · menu         │
│ [CHOICE panel — fixed overlay at top while a decision is pending]      │
├──────────────┬─────────────────────────────────────────┬───────────────┤
│ OPPONENT     │  SHARED BOARD                           │  GAME LOG     │
│ - specialty  │  ┌─ Stardate: #3, ◆◆◆◆ (4 glory) ──┐    │  (scrolling,  │
│   tracks     │  │ Market:  [P] [C] [S] [A]        │    │   filterable) │
│ - resources  │  │ Junk ▸ 12   Incident ▸ 4  ⚠     │    │               │
│ - hand: 5 ▮▮ │  └─────────────────────────────────┘    │               │
│ - areas      │  Neutral Zone: [L1] [L2] [L3]           │               │
│   (compact)  │     tokens shown per Location            │               │
├──────────────┴─────────────────────────────────────────┴───────────────┤
│ YOUR AREA                                              │               │
│  [Duty Officer] [ Location Area ──────────────────► ]  │               │
│  [ Captain    ] [ Fleet Area ─────────────────────► ]  │               │
│  [ Draw 12    ] [ Staging Area ─────► ]    [Discard 8] │               │
│  Crew board: R ●──8  I ●─3  M ●──────12   Missions ○●○ │               │
├────────────────────────────────────────────────────────┴───────────────┤
│ HAND (fanned, large, always readable)                                  │
└────────────────────────────────────────────────────────────────────────┘
```

The head bar's **Orders** button (with the move count, or the `O` key) opens a drawer listing
every legal PLAY / ACTIVATE / COMPLETE_MISSION move, grouped by where the card is. Each row is the
card detail's operation block with its button, so a whole turn can be played from the list. It
is the desktop twin of the phone's Orders sheet (`ui-mobile.md` §4).

The diagram above was the first sketch. The console as built lays the board out across the
table instead — the opponent in a band along the top, the decks on the table, the log in a
drawer, the hand docked along the bottom edge — see [`ui-lcars.md`](ui-lcars.md) §4. Phones and
tablets get their own shells (the Pocket Bridge), specified in [`ui-mobile.md`](ui-mobile.md).

## 3. Card rendering

Cards come from the spritesheets (`todo/02-sprite-pipeline.md`).

```tsx
<CardSprite def={def} size="hand" />
```

- Implemented as a `<div>` with `background-image: url(atlas.webp)` and
  `background-position: -Xpx -Ypx`, scaled with `background-size`.
- **Three sizes:** `micro` (≈60px wide, for stacks/counts), `board` (≈120px), `hand` (≈200px).
  Use one atlas at the largest needed resolution; scale down in CSS.
- **Single click → detail overlay** at full resolution with a **rules-text sidebar** listing
  each operation, its type, whether it costs an action, and — critically — **whether you can
  currently resolve it and why not**. This is where `canPlay(...).reasons` surfaces. Hover also
  shows a quick magnified preview; the full detail (with working action buttons) opens on click.
  A double click is the _fast path_: it runs the card's single legal action directly (see §4).
- The detail lists the operations usable from the card's zone first and folds the rest into
  **Not usable from here (n)**: lines that can never run from that zone, table lines on a card
  in hand, activations in the Staging Area. A card in Development keeps its lines open, since
  they are what you read before enlisting it.
- A **Play** / **Activate** button whose operation costs an action leads with the printed action
  token; a free operation gets a plain button. Play closes the detail; an activation started
  from it closes it once nothing is left to answer (unless another card's detail was opened in
  the meantime).
- The printed text is paired with each operation by splitting the card text on its headers
  (`Play:`, `Attack Play [[inf3]]:` with a requirement before the colon, …); an operation
  without a match falls back to the generated English (`describe()`).

### Overlays drawn on top of the sprite

The sprite is the printed card; the _state_ is drawn over it:

| State                        | Visual                                                    |
| ---------------------------- | --------------------------------------------------------- |
| exhausted                    | rotate 90°, desaturate slightly                           |
| action token(s) on card      | small chip badges, bottom-left                            |
| beamed cards                 | chips under the host card; each opens the card it names   |
| resource tokens (Market)     | token pips on the card's corner                           |
| ship token at a Location     | a standee on the Location: the SHIP icon in seat colour   |
| Away Teams at a Location     | token icons down the card's edges, P1 left, P2 right      |
| illegal to play              | 55% opacity + no pointer cursor + tooltip with the reason |
| currently a choice candidate | animated accent ring                                      |

Beamed chips are headed _Beamed aboard_ on a ship and _Beamed here_ on a Location. A standee
names its ship in the tooltip and opens it on click; the ship's Fleet card carries an
_at ‹Location›_ tab. Every surface that draws a Location at board size (both Location Areas, the
Neutral Zone with its secured badge, the Location picker) draws all three.

## 4. The choice panel — the heart of the UI

One component per `PendingChoice` variant (`docs/state-machine.md` §4). Contract:

- **Placement:** while a choice is pending, the panel is a `position: fixed` dialog centred
  over the board. It is as wide as its content (420px floor, 1180px or the viewport as the
  ceiling; long prompts wrap at 640px), so a two-button choice stays compact. It renders
  nothing (and disappears) as soon as the choice is resolved.
- **Legality is never silently guessed.** A single click always opens the full card detail — the
  "what can I do right now" view. A **double click** runs the card's _single_ legal action
  (PLAY from the hand, or ACTIVATION on a deployed card) and skips the detail. A card with more
  than one legal operation (e.g. UTILIZE: pay an action for one effect, or a free one) has no
  single legal action — double click does nothing and the player picks from the detail, which
  shows one **Play** button per legal PLAY op; it never silently plays the first one.
- **The Play button on the card** is the same fast path in one click (`src/ui/quickPlay.tsx`):
  a card in your hand or on your table with a single legal action carries a small button in its
  top-left corner, drawn with the operation's timing mark and, when it costs an action, the
  printed action token. It shows only on your ACTION step with no choice pending and never while
  the house AI or the solo Bot is to move, and a click on it neither opens nor zooms the card.
- **Always show the prompt**, the **source card** that caused it, and a **Cancel/Decline** button
  when the choice is optional.
- `CHOOSE_CARDS`: candidates get the accent ring **wherever they physically are** — in hand, in
  the Market, at a Location — and can be selected there. The panel repeats them, grouped by zone,
  so the decision stays readable while the dialog covers the board; disabled candidates stay
  greyed with their reason, and a Fleet ship names where its token is (at ‹Location›, on card,
  in supply). Show `min`/`max` and a live count.
- **Locations:** `CHOOSE_LOCATION` and a `CHOOSE_CARDS` that offers only Locations in play (a
  SELECT such as 1SIS11-25's "a controlled Location") share one **Location picker**, laid out like
  the board: Your Location Area and the Neutral Zone always, the opponent's area when it holds a
  Location on offer. Every Location shows its Away Teams, the ships standing on it and the
  secured badge; those not on offer stay greyed (with the engine's reason) so the tokens around
  the table remain readable.
- **Operations:** a choice whose options are one card's operations ("resolve which play
  operation?" on a free play, "duplicate which operation?") shows that card with each printed
  operation as a clickable block, with the card detail's "does nothing right now" warning.
- `CHOOSE_DESTINATION` (gain/scan placement): **[Top of deck]** stacked above
  **[Discard pile]**, beside the gained card shown large. This one fires constantly, so it is one
  click; a single **Remember decision** checkbox keeps the pick as the highlighted default for
  the rest of the game.
- `OPTIONAL_TRIGGERS`: a list of reaction cards, each row the card and its printed operation,
  toggled by **[Use]** (numbered in pick order when several are offered), then **[Use selected]** /
  **[Skip all]**. The triggering card heads the dialog, face up even when it went onto the deck top,
  as long as both players know it. Highlight the card on the board as you hover.
- `ORDER_OPERATIONS`: drag-to-order list, plus a **[Resolve in this order]** confirm. Offer
  **[Auto — no meaningful choice]** when the engine can prove order-independence (all pending
  operations are non-interacting), which will be the common case.

## 5. Information the player must always be able to reach

| Info                                   | Access                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Your hand                              | always visible                                                                    |
| Both Discard piles                     | click the pile → scrollable grid                                                  |
| Junk pile                              | click → grid                                                                      |
| Your Development pile & its costs      | always visible as a small stack; click → grid                                     |
| Your Reserve deck **count**            | visible; **contents hidden**                                                      |
| **Your** Captain's Log                 | click your Captain → grid                                                         |
| **Opponent's** Log                     | **count only** — contents hidden (`rules/04` §4.5)                                |
| Common-deck composition                | a "Card List" reference panel — the box includes this sheet, so it is public info |
| Neutral Zone token counts              | rendered directly at each Location                                                |
| Whether a Location is _secured_ by you | a badge on the Location                                                           |

The **Card List panel** is worth building early: filter by suit/trait/skill, showing what remains
in each Market deck. The physical game hands you this sheet; withholding it would make the
digital version _harder_ than the real one.

## 6. Log panel

Every primitive emits a `LogEntry`. Render grouped by turn → phase → operation:

```
▾ Turn 7 — You
   ▾ Action: played Confiscate  [action]
       spent 2 Dilithium
       gained Tribbles (CARGO) → top of deck
   ▾ Action: activated Thy'lek Shran  [action]
       discarded Tribbles
       sent 1 Away Team → Weytahn
   ▾ completed mission "Peace Negotiations"
       gained 4 Dilithium, drew 4
       dismissed Bynars, Bolians, Tamarians (beamed contributors)
```

Clicking an entry highlights the cards involved. This is the single most valuable debugging tool
you will build — and it doubles as the rules-teaching device for players.

Entries name cards, never instance ids. A card that leaves the table — dismissed, destroyed or
logged — and an opponent's Away Teams removed each get a line of their own
(`src/engine/resolver/chronicle.ts`), so nothing vanishes from the board without a trace;
`LogEntry.about` names the player it happened to when that is not the acting seat.

### The House AI's turn

In a game against the House AI (`docs/bot.md`), a ticker under the bot bar states its latest
move in plain English, with the cards that hit you named "your …" first. **AI turn** opens the
move history, grouped by turn: each turn starts with a **What it did to you** box (cards that
left your play, control or hand, Away Teams removed, Incidents), and each move expands into the
card it played or activated (drawn beside the steps, above them on a phone), its steps and log
lines, and the "Why?" panel of the bot's decisions. When your turn begins the history opens by
itself once; Settings → **Show the AI's turn** decides when: _When it affects you_ (default),
_After every AI turn_ or _Only from AI turn_ (never by itself). It sits above a pending choice.

## 7. Rules help, inline

Every keyword in a card's text is a link to the matching section in `rules/08`. Ship the rules
markdown as part of the app and render it in a side drawer. At complexity 5+, "what does
_duplicate_ do again?" must be one click, not a PDF search.

## 8. Accessibility & input

- Full keyboard: `Tab` between candidates, `Enter` to select, `Esc` to decline.
- Single vs double click: the detail-open on a single-legal-action card is deferred by ~300 ms
  (`DETAIL_CLICK_WINDOW_MS`) so a second click inside that window can run the action instead.
- **Never rely on colour alone.** The three Specialties are red/blue/yellow — pair every colour
  with its icon glyph and a text label.
- Respect `prefers-reduced-motion`: skip card-movement animations entirely.
- Minimum tap target 44px even on desktop (the `micro` card size is for display, never for input).

## 9. What to build last

Animations, sound, a table-felt theme, 3D card flips. None of these make the game playable.
Get `todo/14-ui-shell.md` to "I can finish a Cadet Training game without opening the PDF" first.

## 10. The end of a game

The **Final Score** screen opens with a banner in the winner's seat colour ("You win",
"House AI (Easy) wins", a tie, or the Cadet Training result) and the reason: the margin, or the
Incident counts after the Burn. Both totals follow side by side, then one table comparing the
breakdown in `rules/07` §7.4.1 order. The Focus row lists icons × multiplier for every
specialty; with no mission completed it says "not counted" and strikes out the would-be VP
(Focus then scores 0, `rules/12` §12.27).

A finished game stays in the saved-games list as ended: "ended on turn 21", "Game over · You won
· 43–20", and a **View result** button that opens the end screen.
