# The Effect DSL

Card operations are **data**. This file specifies that data.

Design goals: (1) every keyword in `rules/08` maps to exactly one primitive; (2) costs and
benefits are distinguishable _before_ execution; (3) every node is JSON.

## 1. Shape

```ts
type Effect = ControlNode | CostNode | PrimitiveNode
```

## 2. Control nodes

| Node                                                               | Meaning                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ k: 'SEQ', steps: Effect[] }`                                    | resolve in order                                                                                                                              |
| `{ k: 'MAY', body: Effect }`                                       | player may decline the whole thing (→ `CONFIRM` choice); not offered when it could do nothing (below)                                         |
| `{ k: 'CHOOSE_ONE', options: { label, body: Effect }[], count? }`  | "either A or B"; **only options the actor can fully resolve are offered**; `count: N` = "choose N of the following" (N **different** options) |
| `{ k: 'PAY_THEN', cost: Effect, body: Effect }`                    | "do A to do B" — A is a **cost**                                                                                                              |
| `{ k: 'IF', cond: Predicate, then: Effect, else?: Effect }`        |                                                                                                                                               |
| `{ k: 'REPEAT', times: Amount, body: Effect }`                     | `times: { k:'UP_TO', max }` = "up to N times": round by round, each round optional (below)                                                    |
| `{ k: 'FOR_EACH', over: Query, body: Effect, bind: string }`       | binds each match                                                                                                                              |
| `{ k: 'LET', bind: string, value: Amount \| Query, body: Effect }` | local variable                                                                                                                                |
| `{ k: 'OPPONENT', body: Effect }`                                  | switch the acting seat (used by `FORCE`)                                                                                                      |
| `{ k: 'NOOP' }`                                                    | explicit no-op (for unimplemented keywords)                                                                                                   |

### Choices and conditions

**Choice-key scoping.** A primitive publishes its answer under a fixed key (`may.accept`,
`discard`, …) on the ctx it shares with its sibling steps. The stack records the
`[key, choiceId]` pairs a node published on its resume frame (`Frame.resume`) and scrubs them
once the node finishes, so two MAYs (or two DISCARDs) in one SEQ each ask. A node that keeps a
round counter (REPEAT UP_TO, CHOOSE_ONE `count`) carries its pairs onto its own continuation.
Answers land on every frame sharing the answered frame's **bindings object** (not only the same
ctx object), so a bind written inside a FORCE/OPPONENT/accepted-MAY body stays visible to the
parent SEQ.

**"If you do" / "if you do both".** Primitives with a `bind` write it only when the thing
actually happened (FREE_PLAY, BEAM, DISMISS, DISCARD, LOG, FIND, TAKE, SEND_AWAY_TEAM,
REMOVE_AWAY_TEAM, WARP, GAIN_CARD, COST_LOG …). `{ k: 'DID', bind: name | name[] }` is true iff
every named binding is set, so:

```json
{ "k": "SEQ", "steps": [
  { "k": "MAY", "body": { "k": "SEND_AWAY_TEAM", "count": 1, "target": { … }, "bind": "$joann.sent" } },
  { "k": "MAY", "body": { "k": "BEAM", "count": 1, "to": { … }, "bind": "$joann.beamed" } },
  { "k": "IF", "cond": { "k": "DID", "bind": ["$joann.sent", "$joann.beamed"] },
    "then": { "k": "GAIN_RESOURCE", "res": "GLO", "amount": 1 } } ] }
```

Users: 1SIS08 Bashir, 1BUR13 Culber, 1BUR21 Joann, 1PER09 Joret Dal, 1CAR08 Lirpa, 1CAR13
Tachyon Detection Grid, 1ENC07 Sha Ka Ree, 1SEL06 Shinzon, 1SEL07 Scimitar, 1SEL15/1KOL19
Disruptors, 1SHR13 United Earth, 1PER07/1CAR15 (same-Location removals). "X to Y" with a real cost
stays `PAY_THEN`.

**Optional effects.** A MAY is not offered when accepting could not change anything: a benefit
leaf that cannot resolve, a PAY_THEN whose cost cannot be paid, an IF whose branch would not run
(e.g. a DID on binds no step will make), a CHOOSE_ONE with no resolvable option, or a SEQ whose
steps all do nothing or whose first effective step is an unpayable PAY_THEN. The accepted body
runs with `ctx.optional`: a PAY_THEN whose cost has become unpayable there is **skipped**
(SKIPPED log) and the operation continues — only a mandatory PAY_THEN fails the operation
(rules/12 §12.1). 1PIC04 Tamarians offers only the discards the hand can pay and still logs itself.

**One dialog per "you may".** A body that asks before it changes anything gets no CONFIRM: its
first prompt carries the decline. The MAY pushes the body with `ctx.declinable` (the stack depth
it starts at and the card's "You may …" wording); declining drops every frame from that depth up
(`declineMay`), so nothing of the body runs, and the operation goes on. The path to that prompt
is a SEQ's first step, a PAY_THEN's cost (a SEQ cost: its first step) or a single CHOOSE_ONE;
`withoutDecline` keeps it off every later step, the body after a cost and the chosen option.

- A pick-first primitive declares `offersDecline` and passes `declinable: true` to its first
  `pickCards`: the pick shows the may's wording, is asked even with one candidate (it is the only
  prompt), and is `optional` — the empty selection declines, even below `min` (`checkSelection`).
  Costs (COST_DISCARD "you may discard a card to …", COST_LOG, COST_PUT, …) and benefits
  (PROMOTE, FREE_PLAY, BEAM, LOG, JUNK, ENLIST_DEVELOPMENT, …) do this.
- WARP, SEND_AWAY_TEAM and REMOVE_AWAY_TEAM ask their Location with a Skip (`SKIP_LOCATION`),
  even when only one is left; CHOOSE_ONE adds a Decline row (`DECLINE_OPTION`).
- The prompt is marked `mayDecline`; `declineSelection(choice)` is its decline. The probe, the
  Cadet and the first-legal script answer it, as they answered the CONFIRM with No.
- A REPEAT UP_TO round asks the same way: its first prompt carries a decline that ends the
  repeat ("discard up to 3 cards …": each round is its discard pick).

The CONFIRM stays when its first prompt would show what the player could not see before (FIND,
TAKE with a look, the scans: a face-down deck; a discard from the opponent's hand), when the
attack gate would open the victim's window first (`attackGated`), when a cost would be paid in
Glory (only the CONFIRM says so), and for bodies that ask nothing (DRAW, GAIN_RESOURCE, a plain
resource cost).

**"Up to N".**

- `REPEAT { times: { k:'UP_TO', max } }` asks a `CONFIRM` before each round ("… again? (1 of up to
  3 done)"), stops when declined, after `max` rounds, or as soon as a round could do nothing
  (the MAY test). Each round has its own bindings scope and is optional. `max` is re-evaluated
  each round. A REPEAT UP_TO is always resolvable (zero rounds is legal).
- Distinct targets: `WARP { count }` picks the **different** ships first (`CHOOSE_CARDS`, `0..max`
  for UP_TO) and then warps each ("warp up to 2 of your SHIPs" — 1PIC22, 1SIS20, 1SEL21,
  1PER02). "Remove up to 2 AWAY TEAMs from the **same** LOCATION" (1PER07, 1CAR15) is a first
  REMOVE with `bind`, then an optional second REMOVE whose target is `bound` to it.

### `CHOOSE_ONE` and resolvability

`rules/03` §3.5.3: when an ATTACK makes the opponent pick between effects, the pick is limited
to an effect they are able to carry out completely. Combined with `rules/08` → `force`, the rule generalises:
**when presenting options, filter to those the actor can fully resolve.** If none are resolvable,
the node is skipped (or, if it is a cost, the parent fails).

With `count: N` the player picks N **different** options one round at a time; each resolves
before the next pick, already-chosen options are shown disabled ("already chosen"), and a round
with nothing resolvable left ends it early (1SIS08, 1SIS09, 1SHI11).

## 3. Cost nodes

Tagged separately so the resolver can **pre-validate the whole cost set before any mutation**
(`rules/12` §12.1).

| Node                                                                     | Rule                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{ k: 'COST_RESOURCE', res, amount }`                                    | `spend resources`; Glory substitution applies                                                                                                    |
| `{ k: 'COST_ACTION' }`                                                   | the `[action]` prefix (usually on `Operation.costsAction`)                                                                                       |
| `{ k: 'COST_DISCARD', filter?, count, bind?, exceptBound?, onlyBound? }` | from hand; `exceptBound` = "a different card" than that bound one; `onlyBound: string[]` = only the cards bound under those names ("discard IT") |
| `{ k: 'COST_PUT', filter?, count, to: ZoneSpec, from? }`                 | `put a card (somewhere)`; `from` = source zone(s) (default hand; "from your hand or Discard pile" — 1CAR02); `to` DRAW = the **top** of the deck |
| `{ k: 'COST_EXHAUST', filter, bind? }`                                   | must be an in-play card; `bind` = the exhausted card ("exhaust a SHIP to refresh **its** LOCATION" — 1BUR21)                                     |
| `{ k: 'COST_REFRESH', filter, bind? }`                                   | refresh one of your exhausted in-play cards as the cost ("Refresh a BAJORAN to draw a card" — 1SIS04)                                            |
| `{ k: 'COST_REMOVE_AWAY_TEAM', count, from?, distinct? }`                | `distinct` = one Away Team from each of `count` different Locations ("from 3 different controlled LOCATIONs")                                    |
| `{ k: 'COST_TAKE_INCIDENT', count }`                                     | used by Development costs                                                                                                                        |
| `{ k: 'COST_DISMISS', filter, count, from? }`                            | `from: ZoneSpec` (default in play) — "dismiss a PERSON … that is beamed here" = `from: {k:'BEAMED_TO', host:'THIS'}` (1SHI12)                    |
| `{ k: 'COST_LOG', filter?, from?, bind? }`                               | log an in-play card (or from `from`); `bind` names the logged card ("if the logged card shares no traits…")                                      |
| `{ k: 'COST_LOG_THIS' }`                                                 | when logging is phrased as a cost                                                                                                                |

**"This card".** Every card-picking cost (`COST_DISCARD`, `COST_PUT`, `COST_EXHAUST`,
`COST_REFRESH`, `COST_DISMISS`, `COST_RECALL`, `COST_LOG`, `COST_BEAM`) takes `target: 'THIS'`:
only the resolving card itself is a candidate (the duplicating card inside `DUPLICATE`), so
"dismiss this card to …" never names the card (1SIS10 WORF, 1BUR24, 1PER08, 1CAR11, 1SHI04,
1SHI09). `filter` is optional on `COST_EXHAUST`/`COST_REFRESH`/`COST_DISMISS`. Queries use
`thisCard: true` (§5) — "beam a card here", "deploy this card", "the traits it shares with Riva".

**Events.** A cost that moves a card raises the same event as its effect twin: `COST_DISCARD`
→ `CARD_DISCARDED`, `COST_DISMISS` → `CARD_DISMISSED`, `COST_LOG`/`COST_LOG_THIS` →
`CARD_LOGGED`, `COST_BEAM`/`COST_PUT` into Staging → `PUT_INTO_PLAY`. (RECALL/EXHAUST/REFRESH
have no event in either form.)

**Validation contract:** every cost node implements
`canPay(state, ctx): boolean` and `pay(state, ctx): state`. `PAY_THEN` calls `canPay` on the
whole cost subtree first; only if every leaf can pay does it execute.

> Subtlety: `canPay` for a choice-bearing cost ("discard a `WEAPON`") must check that **at least
> one legal selection exists**, not that the player has _some_ card.

## 4. Primitive nodes — one per keyword

Derived directly from `rules/08-keywords-reference.md`. The `id` column matches that file.

### Card movement

| Node                | Params                                                                                             | Notes                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BEAM`              | `from: ZoneSpec = HAND`, `filter?`, `to: CardQuery`, `count`, `bound?`, `bind?`, `target?: 'THIS'` | Location can never be beamed; `bound` = only that bound card ("beam the gained card"); `bind` = the beamed card, set only if a beam happened; `target: 'THIS'` = only the resolving card (1PER18's mandatory self-beam onto a deployed SHIP); several legal hosts → the player chooses (so does `COST_BEAM`, 1PER13) |
| `DEPLOY`            | `target: CardQuery`                                                                                | SHIP or `ONGOING` only (both Staging → Fleet); else no-op                                                                                                                                                                                                                                                            |
| `DESTROY`           | `target: CardQuery`                                                                                | to the box; ownership lost; cascades                                                                                                                                                                                                                                                                                 |
| `DISCARD`           | `filter?`, `count`, `from: 'HAND' \| 'DECK_TOP'`, `bind?`, `onlyBound?`                            | `onlyBound: string[]` = only those bound cards ("draw 2 cards and discard one of THEM")                                                                                                                                                                                                                              |
| `DISMISS`           | `target: CardQuery \| 'THIS'`, `bind?`                                                             | not from Staging; a query never offers a Captain/Status card (card-rulings 042) or a Location — only `'THIS'` dismisses a Location (itself: 1SHR12 Weytahn Clean-up; its Ships are dismissed, Away Teams return); `bind` = the dismissed card ("If they do" — 1CAR08)                                                |
| `DRAW`              | `count: Amount`, `bind?`                                                                           | triggers deck cycling; `bind` = the (last) drawn card ("draw a card, then discard IT")                                                                                                                                                                                                                               |
| `DRAW_FROM_DISCARD` | `filter?`, `count`, `bind?`                                                                        | `bind` = the (last) drawn card (1SIS13 recovers a SHIP from the Discard pile, then free plays that card: `FREE_PLAY bound`)                                                                                                                                                                                          |
| `RECALL`            | `target: CardQuery`                                                                                | in play → hand; cascades                                                                                                                                                                                                                                                                                             |
| `LOG`               | `target: CardQuery \| 'THIS'`                                                                      | cascades; Location clears tokens                                                                                                                                                                                                                                                                                     |
| `PROMOTE`           | `from: 'HAND' \| 'STAGING' \| 'DISCARD'`, `filter?`, `target?: 'THIS'`                             | PERSON only; `THIS` = only the resolving card; at the limit a Duty Officer is dismissed to make room — see below                                                                                                                                                                                                     |
| `JUNK`              | `target: MarketQuery`                                                                              | never a card bearing resource tokens                                                                                                                                                                                                                                                                                 |
| `PUT_INTO_STAGING`  | `target: CardQuery`                                                                                | counts as _put into play_                                                                                                                                                                                                                                                                                            |

### Acquisition

| Node                 | Params                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAIN_CARD`          | `suits: MarketSuit[]`, `includeJunk?`, `onlyJunk?`, `to?: ('DECK_TOP'\|'DISCARD')[]`, `bind?`             | faceup **or** deck top; `onlyJunk` = "gain X **from the Junk**" (Junk only — 1PER05, 1SHI07, 1BUR17); a single `to` entry places without asking ("gain … to your Discard pile" — 1BUR07)                                                                                                                                                                                                                                                                                                                                                                                            |
| `SCAN_N`             | `n: Amount`, `suits: MarketSuit[]`, `includeJunk?`                                                        | one suit only, no take-backs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `SCAN_FOR_TRAIT`     | `traits: TraitId[]`, `includeJunk?`                                                                       | 2 Glory consolation if exhausted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TAKE`               | `deck: 'INCIDENT' \| 'ENCOUNTER' \| 'REINFORCEMENT'`, `count`, `look?`, `returnUnpicked?`, `to?`, `bind?` | → hand by default. `REINFORCEMENT`: the taker picks any `count` cards of their own Five-Year Mission Reinforcement pile (rules/14 §14.4, the campaign Directive 1DIR02/2); no event. `look: N` = look at the top N and the taker **chooses** `count` (CHOOSE_CARDS; 1PIC18/1SIS11/1BUR18, 1SHR16/1SEL11, 1ALL05); `returnUnpicked` → the rest to the deck bottom. `to: 'DISCARD' \| 'DECK_TOP' \| 'DECK_BOTTOM'` ("take an INCIDENT to your Discard pile" — 1PIC23; "… on the bottom of your Draw deck" — 1LOC17); still a take (ownership, INCIDENT_TAKEN)                         |
| `SELECT`             | `target: CardQuery`, `bind`                                                                               | choose one card and bind it; nothing moves ("Select a controlled LOCATION … log the selected LOCATION")                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `FIND`               | `filter`, `zones: ZoneSpec[]`, `bind?`                                                                    | → hand; afterwards every facedown deck in `zones` (Draw, Reserve) is shuffled (rules/08 find; consumes `state.rng`, never in probe mode; a FIND with no match is skipped like any unresolvable benefit); `bind` = the found card. `zones` = HAND + DISCARD + DRAW + RESERVE unless the text restricts ("except in your Reserve deck", "in your Draw deck")                                                                                                                                                                                                                          |
| `RETURN_INCIDENT`    | `target: CardQuery`                                                                                       | → **bottom** of the Incident deck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ENLIST_RESERVE`     | —                                                                                                         | no-op if Reserve empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ENLIST_DEVELOPMENT` | `free?: boolean`, `discount?: { res: ResourceId \| ResourceId[], amount: Amount }[]`, `filter?`           | pays the development cost unless `free`; `discount` lowers its `COST_RESOURCE`s of `res` (never below 0; a SEQ threads the rest of the discount, each IF/CHOOSE_ONE alternative gets all of it) — "reducing the cost by 1 {DIL} and 1 {LAT}" (1SIS04). A list `res` is an **"or" pool**: each of the `amount` points lowers one of those resources; when several splits give different payable costs the player picks one (CHOOSE_ONE) — "by 1 {DIL} or 1 {LAT} for each STARBASE" (1SIS/M1). `filter` = only matching Developments ("enlist _Prototype Cloak_ for free" — 1KOL/M2) |

### Resources & actions

| Node                | Params                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAIN_RESOURCE`     | `res`, `amount: Amount`, `fromSupply?` — `fromSupply`: Glory "from the supply (not the Stardate card)" (1SEL/M3): straight to the pool, the Stardate card is untouched and never handed over |
| `SPEND_RESOURCE`    | `res`, `amount: Amount` _(prefer `COST_RESOURCE`)_                                                                                                                                           |
| `STEAL`             | `res`, `amount: Amount`                                                                                                                                                                      |
| `GAIN_ACTION`       | `amount: Amount`                                                                                                                                                                             |
| `ADVANCE_SPECIALTY` | `specialty: SpecialtyId \| 'CHOICE' \| 'LOWEST'`, `amount: Amount` — `LOWEST` = the lowest track, player's pick on a tie (1SIS22): a CHOOSE_SPECIALTY only over the tied tracks              |
| `RECRYSTALLIZE`     | `amount: Amount \| 'ALL'` — Burnham only; moves parked {DIL} to the pool (not an operation gain, so never re-parked); `ALL` = every parked {DIL} (1BUR10)                                    |

### Board

| Node                       | Params                                                                        | Notes                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEND_AWAY_TEAM`           | `count: Amount`, `target: LocationQuery`, `ignoreBlocking?: boolean`, `bind?` | `bind` = the targeted Location ("if you targeted a controlled LOCATION")                                                                                                         |
| `REMOVE_AWAY_TEAM`         | `count`, `target`, `whose: 'SELF' \| 'OPPONENT'`, `bind?`                     | `bind` = the Location the token came off                                                                                                                                         |
| `WARP`                     | `ship: CardQuery`, `to: LocationQuery`, `bind?`, `count?: Amount`             | staying put is not warping; `bind` = the destination ("the LOCATION you warped to"); `count` = warp that many **different** ships (UP_TO: 0..max), each with its own destination |
| `TAKE_CONTROL`             | `target: LocationQuery \| 'FROM_LOCATION_DECK' \| 'THIS'`, `requireSecured?`  | pays opponent Glory                                                                                                                                                              |
| `TRIGGER_CONTROL`          | `target: LocationQuery`                                                       | not a "take control" event                                                                                                                                                       |
| `EXHAUST`                  | `target: CardQuery`                                                           |
| `REFRESH`                  | `target: CardQuery`, `count?: Amount`                                         |
| `PLACE_RESOURCE_ON_MARKET` | `res`, `amount`, `target?`                                                    | Clean-up Glory placement                                                                                                                                                         |
| `WIPE_MARKET`              | —                                                                             |
| `WIPE_NEUTRAL_ZONE`        | —                                                                             | spares Locations bearing tokens                                                                                                                                                  |
| `DRONE`                    | `verb: 'REGENERATE' \| 'SEND'`, `count`, `to?`                                | Borg drones: reserved, no meaning in this box (rules/12 §12.30), a logged no-op (1CAR02)                                                                                         |
| `ASSIMILATE`               | `target: CardQuery \| 'THIS'`                                                 | Borg assimilate: reserved (rules/12 §12.30), a logged no-op; the card stays put (1SHI02 "assimilate it instead")                                                                 |
| `REMOVE_STARDATE_GLORY`    | `amount`                                                                      | "Remove 1 {GLO} from the Stardate card" (1BUR12): back to the supply; emptying the card runs the §3.6.4 handoff; nothing after a Resolution                                      |
| `ARRANGE_DECK`             | `decks: ('LOCATION' \| 'ENCOUNTER')[]`, `n`                                   | peek at N cards, then return each above or beneath the rest, ordered freely (1SIS21, 1CAR16): pick the deck (several), CHOOSE_CARDS → bottom, ORDER_CARDS each group             |

### Meta

| Node                                  | Params                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FREE_PLAY`                           | `filter`, `from: ZoneSpec \| ZoneSpec[] = HAND`, `bound?`, `bind?`                                                                            | action cost waived; other costs stand; the card goes to Staging and an OPERATION frame runs the play like a normal play (its costs fail only that operation, ATTACK notifies, recorded as resolved); only cards with a PLAY op that can resolve now are offered, and with several the player **chooses** which (CHOOSE_OPTION); `bound` = exactly that bound card, wherever it is; `bind` = the played card                                                                                |
| `DUPLICATE`                           | `suits`, `from: ('MARKET' \| 'DISCARD' \| 'LOG' \| 'RESOLVED_THIS_TURN' \| 'DEPLOYED' \| 'BOUND')[]`, `opType`, `filter?`, `bound?`, `other?` | no action cost; restrictions still apply; self-ref redirects; not nestable; `RESOLVED_THIS_TURN` = an `opType` operation you already completed this turn (1PER11); `DEPLOYED` = either player's Fleet ("deployed by any player") and `filter` narrows the source ("a non-TIME TRAVEL SHIP" — 1SHI04); `BOUND` = exactly the card bound under `bound`, and `other` skips the operations of it you resolved this turn ("duplicate Utilize's other play operation" — 1LOC20 on `$event.card`) |
| `FORCE`                               | `body: Effect`                                                                                                                                | sugar for `{ k:'OPPONENT', body }` with choice ownership flipped                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `COMPLETE_MISSION`                    | `index?`                                                                                                                                      | normally a player Intent, not an effect. Order (rules/07 §7.2.1): the reward resolves, then the **witness** — the beamed cards the goal needs — is dismissed (see §5 "Mission goals"). A mission with `isAttack` ("Attack Reward", 1KOL/M3) resolves its reward as an ATTACK: its negative effects open the victim's "would be attacked" windows and ATTACKED fires once it is done                                                                                                        |
| `MODIFIER_ATTACH` / `MODIFIER_DETACH` | `id`, `stack?`, `target?: CardQuery` (attach only)                                                                                            | rule-modifier layers; `target` sources the layer from each matched card (temporary trait grants, §6)                                                                                                                                                                                                                                                                                                                                                                                       |
| `ALT_PLAY`                            | `suits: Suit[]`, `operation: Operation` (type `PLAY`)                                                                                         | static PASSIVE declaration: "you may treat any `<suit>`'s play operation as `<operation>`" — see below                                                                                                                                                                                                                                                                                                                                                                                     |

### Replacement effects — "would" windows

`src/engine/resolver/replacement.ts`. A node that is about to do the replaceable thing re-pushes
itself (its EFFECT frame records the passed gate in `gates`), opens a `GameState.pending` record
and emits a `WOULD_*` event. The normal event drain pushes the matching PASSIVEs (mandatory) and a
REACTION_WINDOW (optional) above it; their replacement node writes to the record
(`$event.pending`), and the re-run node reads it back. A window whose outcome is decided (attack
ignored, gain replaced) offers nothing more. Probe mode never opens a window.

| Node                             | Trigger (schema-enforced) | Meaning                                                                                                                                                                                                  |
| -------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ k: 'IGNORE_ATTACK', scope? }` | `WOULD_BE_ATTACKED`       | "… to ignore the negative effect": scope `ATTACK` (default) skips every remaining negative effect of that attack (1SIS06, 1SIS10, 1PER19); `EFFECT` only the one that opened the window (1BUR15, 1CAR11) |
| `{ k: 'REPLACE_GAIN', scan: N }` | `WOULD_GAIN_CARD`         | "When you would gain a card, scan N of the same suit instead" (1SIS22, 1BUR06): the GAIN_CARD resolves as `SCAN_N { n, suits: [its suit] }` with its own `bind`/`includeJunk`                            |

**Being attacked** (rules/03 §3.5.3: an ATTACK "negatively affects your opponent"). An ATTACK
operation opens an ATTACK record (`$attack.id`, closed when it completes or fails; a nested
non-attack operation — a free play — is not the attack). You _would be attacked_ when, while the
attacker acts, one of these is about to resolve and could (`canResolve`): a `FORCE`/`OPPONENT`
(you act), `STEAL`, `DISCARD`/`COST_DISCARD` `whose: OPPONENT`, `REMOVE_AWAY_TEAM` `whose:
OPPONENT`, a `DISMISS`/`LOG`/`RECALL`/`DESTROY`/`EXHAUST`/`PUT_ON_DECK_TOP`/`RETURN_INCIDENT` whose
candidates include a card you own, or a `PAY_THEN` whose cost has such a leaf (1CAR09). The
generic window (`WOULD_BE_ATTACKED` without `effect`) opens once per attack, at its first such
effect. Effect-specific windows open per effect: `REMOVE_AWAY_TEAM` (a removal of yours, or a
FORCE body that removes) and `DISMISS_DUTY_OFFICER` (DISMISS picked your Duty Officer — the check
runs after the pick). The attacker's own benefits always resolve; skipped negative effects log
SKIPPED and set no `bind`, so "if they do" follow-ups lapse.

### Duty Officer slots and passive rule modifiers

rules/08 `promote` (src/engine/dutyOfficers.ts):

- A seat has `player.dutyOfficerLimit` (1) open slots plus one slot per active modifier with a
  `dutyOfficerSlot` hook ("You may have an additional PERSON [with TRAIT] on duty"). The slot
  may be trait-restricted: `STARBASE_74_DUTY` and `FORCED_SINGULARITY_DUTY` are open,
  `ADIRA_TAL_DUTY` takes SCIENTIST/ENGINEER, `JAROK_DUTY` takes STARFLEET. Seating is a
  bipartite match of Duty Officers to slots.
- `PROMOTE` at the limit asks the player to dismiss a Duty Officer whose removal makes room
  (`CARD_DISMISSED`). It auto-picks when only one qualifies. The check runs on the board after
  the move, so a slot granted by the promoted PERSON counts and a slot granted by the dismissed
  one does not. The optional "you may dismiss one" when a slot is free is not offered.
- Over the limit (a slot-granting card left play, or a `requires` threshold dropped): whenever
  the stack settles, the over-limit seat must `DISMISS` a surplus Duty Officer. This repeats
  until the seat fits.
- `PROMOTE` never offers a card with `cannotBePromoted: true` (1SIS13) or a non-PERSON. While a
  `forbidsAttackCards` modifier is active (`JAROK_DUTY`), it also never offers a card that
  prints an ATTACK operation. Such cards also cannot be played (`canPlay`, `FREE_PLAY`).

A card's `passives: [id]` contribute to `activeModifiers` only while its table operations are
available (rules/03 §3.5.5: not Staging, not beamed, so a PERSON only as Duty Officer). They
also need the `requires` threshold of the declaring `PASSIVE { MODIFIER_ATTACH id }` operation
to be met (e.g. "Passive [mil3]"). Both are re-evaluated on every read. `KOVICH_HAND` counts
the RESEARCH, INFLUENCE and MILITARY tracks that are at 5+.

Other hooks: `protectsFromSteal: ResourceId[]` ("Your {DIL} cannot be stolen" — 1BUR03
`DISCOVERY_A_NO_STEAL`: a STEAL of it takes nothing and does not resolve), `cannotBeWarped` ("This
ship cannot be warped" — 1SIS03 `DS9_NO_WARP`: WARP never offers the source card).

Card-level rules outside the modifier registry:

- `variableSkill: { counts: { specialty, amount: Amount }[] }` — a SKILL_VARIABLE icon that counts
  `amount` times as `specialty` for its owner (1BUR12 NI'VAR: one {RES-skill} per matching trait
  in play, the card's own traits counted; `NI_VAR_ICONS` is describe-only). The older
  `{ condition, skills }` shape still counts once while `condition` holds.
- `treatedAsLocation: true` — the card is a LOCATION in every respect and deploying it is a
  take-control of a LOCATION (1ENC07 SHA KA REE): it also matches a LOCATION
  suit filter, every LOCATION rule (never dismissed/beamed/recalled by a query, leaving play returns
  its Away Teams) uses `isLocationDef`, and `DEPLOY` puts it into your Location area and emits
  `CARD_DEPLOYED` + `LOCATION_CONTROLLED`. Its SPECIAL carries the describe-only
  `SHA_KA_REE_LOCATION` modifier.

### `ALT_PLAY` — alternate play operations

_1PIC08 DEANNA TROI_: a PASSIVE that lets any INCIDENT be played with a substitute Play (pay one
discard to take the INCIDENT back to hand, and on success draw two). This is an engine hook, not a trigger:

- `ALT_PLAY` is legal **only as the whole effect of an untriggered `PASSIVE`** operation (schema
  refinement); resolving the node does nothing. The engine reads it from the card
  (`src/engine/altPlay.ts`).
- While the granting card's table operations are available (in play, not Staging, not beamed —
  exhausted is fine, rules/12 §12.25), every card of `suits` in its owner's hand that has at
  least one printed PLAY operation may be played with the granted `operation` instead. The
  printed ops stay available ("you may").
- `canPlay` reports the resolvable grants in `altPlays: AltPlayRef[]` (`{ source, opIndex }` =
  the granting PASSIVE). The intent is `PLAY_CARD { iid, operationIndex, via: AltPlayRef }`
  (`operationIndex` = the printed PLAY op being treated; `legalIntents` uses the first). The
  card goes to Staging and emits `CARD_PLAYED` like any play; `THIS` is the played card.
- The `OPERATION` frame carries `via`, so the granted text keeps resolving even if the granting
  card leaves play mid-effect. The granted op's own `costsAction` applies (Troi's quoted
  "Play:" has no `[action]`). A granted op is not recorded for `DUPLICATE`
  `RESOLVED_THIS_TURN` (it is not one of the card's printed operations).

```json
{
	"type": "PASSIVE",
	"costsAction": false,
	"isAttack": false,
	"effect": {
		"k": "ALT_PLAY",
		"suits": ["INCIDENT"],
		"operation": {
			"type": "PLAY",
			"costsAction": false,
			"isAttack": false,
			"effect": {
				"k": "PAY_THEN",
				"cost": { "k": "COST_DISCARD", "count": 1 },
				"body": {
					"k": "SEQ",
					"steps": [
						{ "k": "RETURN_INCIDENT", "target": "THIS" },
						{ "k": "DRAW", "count": 2 }
					]
				}
			}
		}
	}
}
```

### The solo Bot — Automated Command rows (`rules/13`)

The official solo Bot never reads its cards' text. It resolves every card through a row of its
crew's Automated Command cards (`src/data/cards/solo/bots.json`, schema `BotCardSchema`). Each row
is an ordinary effect tree, run as an `OPERATION` frame whose `row` names it, with "this card" =
the card being resolved. These nodes exist for those rows and for SURPRISE operations. The `BOT_*`
nodes always act for the Bot and choose by its rules, never by a player's choice.

| Node                                                                         | Meaning                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRY {body, otherwise?, test?}`                                              | "If able, X. Otherwise, Y.". Decided once, before anything runs: can `test` (default `body`) fully resolve now? FORCE/OPPONENT/ATTACK are looked through. A cancelled attack inside X still counts as done.                                                                                    |
| `ATTACK {body}`                                                              | The red part of a row: an attack on the opponent around `body`. It opens and closes the attack record like an ATTACK operation, so "would be attacked" windows, cancels and ATTACKED apply.                                                                                                    |
| `BOT_DECK {from: DECK\|SUPPLEMENT, op: LOG\|DISCARD\|TAKE, count}`           | The top cards of the Bot deck (reshuffling it, `rules/13` §13.5) or of the Supplement deck. A logged INCIDENT is returned instead; TAKE puts a Supplement card onto the Bot deck.                                                                                                              |
| `BOT_ACQUIRE {mode: GAIN\|TAKE, from?, pref?, bind?}`                        | A Market card by preference: `pref` = `[[A], [B, C]]` for "A > B / C", where terms are card filters or `{most: res}`. The best card is chosen by value to the Bot. GAIN goes to the Bot Discard pile, TAKE to the top of the Bot deck. `from: ENCOUNTER\|INCIDENT` takes that deck's top card. |
| `BOT_JUNK`                                                                   | Junks the token-free Market card most valuable to the opponent.                                                                                                                                                                                                                                |
| `BOT_SEND_AWAY_TEAM {count, prefer?, ignoreShips?}`                          | Sends to the neutral LOCATION with the most Bot tokens, after trait preferences. It never sends where it over-secures. With no Away Team left on its Captain, it pulls one back from where it has the fewest.                                                                                  |
| `BOT_DEPLOY {target: THIS\|DISCARD\|{bound}, then?: EXPLORE\|ENGAGE}`        | Deploys a SHIP, then warps it to the emptiest Location (explore) or to the one where the opponent has the most tokens (engage).                                                                                                                                                                |
| `BOT_PROMOTE {target}`                                                       | Promotes a PERSON into the Bot's single Duty Officer slot, dismissing the previous Duty Officer.                                                                                                                                                                                               |
| `BOT_RESOLVE {from: ROW\|DECK_TOP\|SUPPLEMENT_TOP\|DISCARD\|BOUND, filter?}` | Resolves another card through its row, then carries on. A LOCATION left in Staging joins the Control Area.                                                                                                                                                                                     |
| `BOT_TAKE_CONTROL`                                                           | Takes control of the neutral LOCATION with the most Bot tokens (minimum 1).                                                                                                                                                                                                                    |
| `BOT_REMOVE_AWAY_TEAM {count}`                                               | The Bot removes its own Away Teams one at a time, each from where it has the fewest tokens (ruling 055).                                                                                                                                                                                       |

`ADVANCE_SPECIALTY.specialty` may also be `{pick: LOWER|HIGHER, of: [...]}`: "gain 1 R / I
(whichever is lower)". Ties go to the first listed track. Card value and every Location pick are
in `src/engine/solo/value.ts` and `rank.ts`.

## 5. Predicates & queries

```ts
type Predicate =
	| { k: 'SPECIALTY_AT_LEAST'; specialty: SpecialtyId; value: number }
	| { k: 'COUNT_AT_LEAST'; query: Query; value: number }
	| { k: 'HAS_TRAIT_IN_PLAY'; trait: TraitId; count?: number }
	| {
			k: 'DIFFERENT_SPECIES_IN_PLAY'
			count: number
			filter?: CardFilter // "(excluding cards with HUMAN / STARFLEET)" = { not: … }
			eachDistinct?: TraitId[] // every card with one of these traits is its own species (1PIC/M3)
	  }
	| { k: 'SAME_SHIP'; requirements: SameShipRequirement[] } // mission goals
	| { k: 'CONTROLS_LOCATION'; count: number }
	| { k: 'COLLECTIVE_AT_LEAST'; value: number } // "6+ {COLLECTIVE} value" (1CAR02): always 0 in this box (rules/12 §12.30)
	| { k: 'AND' | 'OR'; terms: Predicate[] }
	| { k: 'NOT'; term: Predicate }
	| { k: 'DID'; bind: string | string[] } // "if you do (both)": every named bind was set

interface CardFilter {
	suits?: Suit[]
	traits?: TraitId[] // OR within the list
	allTraits?: TraitId[] // AND
	names?: string[]
	exhibits?: SpecialtyId[] // Skill OR Focus icon — NOT restriction icons (rules/07 §7.1.3)
	focus?: SpecialtyId[] // a FOCUS icon only ("cards with {INF-focus}/{MIL-focus}" — 1BUR04)
	minVp?: number
	not?: CardFilter
}

interface Query {
	zones: ZoneSpec[] // defaults to "in play, mine"
	seat?: 'SELF' | 'OPPONENT' | 'ANY'
	filter?: CardFilter
	countIcons?: 'SKILL' | 'FOCUS' // count icons rather than cards
	bound?: string | string[] // only the card(s) bound under this name / these names (e.g. '$event.card';
	//   a list = "one of THE drawn cards"); a name bound to a list — a LET over a Query — matches
	//   every card in it ("dismiss all … If any were dismissed" — 1SEL14: LET the candidates,
	//   FOR_EACH dismiss, then COUNT_AT_LEAST over their DISCARD with `bound` = the LET)
	withShip?: boolean | CardFilter // LOCATIONs where the actor has a SHIP token; a CardFilter = a
	//   SHIP matching it ("the U.S.S. Discovery's LOCATION" — 1BUR21)
	shipSeat?: 'SELF' | 'OPPONENT' | 'ANY' // whose SHIP `withShip` looks for ("if the opponent has a
	//   SHIP at the U.S.S. Defiant's LOCATION" — 1SIS15, with atThisShip)
	atBound?: string // the LOCATION the bound card is at ("exhaust a SHIP to refresh its LOCATION")
	withAwayTeam?: boolean // LOCATIONs where the actor has an Away Team
	thisCard?: boolean // only the resolving card ("this card"; the duplicating card inside DUPLICATE)
	exceptThis?: boolean // every match but the resolving card ("(excluding this card)" — 1CAR08, 1ENC04;
	//   other copies still count; "one other LOCATION" — 1LOC01)
	atThisShip?: boolean // the LOCATION the resolving card is at: a SHIP's own token, or the token of
	//   the SHIP it is beamed to ("this ship's LOCATION"; 1PER13's beam-then-send to the host's
	//   LOCATION)
}
// ZoneSpec shorthands (SELF-relative per Query.seat):
//   'ALL_OWNED' | 'IN_PLAY'
//   'BEAMED_ANY'        cards beamed to any of the seat's cards (SHIP or LOCATION hosts)
//   'BEAMED_TO_SHIP'    cards beamed to one of the seat's SHIPs ("a card beamed to a SHIP")
//   'LOCATIONS'         the seat's controlled LOCATIONs + all three Neutral Zone slots — "a LOCATION"
//                       for warp / send / remove (rules/06 §6.2.2, §6.3.1). seat 'ANY' adds the
//                       opponent's controlled LOCATIONs ("remove an opponent AWAY TEAM from a LOCATION").
//                       NB 'IN_PLAY' never reaches the Neutral Zone: NZ Locations are unowned.
//   'NEUTRAL_LOCATIONS' the three Neutral Zone slots — "a neutral LOCATION"
//   { k: 'BEAMED_TO', host: 'THIS' }  cards beamed to the resolving card — "a card beamed here"
//   { k: 'BEAMED_TO', bound: name }   cards beamed to the card bound under `name`
// "your (controlled) LOCATION" stays { k: 'LOCATION_AREA', seat: 0 }. The runtime ref
// { k: 'BEAMED', host: <instance id> } is not valid in card data (a card name never matches).

type Amount =
	| number
	| { k: 'COUNT'; query: Query }
	| { k: 'SPECIALTY'; specialty: SpecialtyId }
	| { k: 'RESOURCE'; res: ResourceId; seat?: 'SELF' | 'OPPONENT' }
	| { k: 'UNUSED_ACTIONS' }
	| { k: 'MIN' | 'MAX'; terms: Amount[] }
	| { k: 'SUM'; terms: Amount[] } // "1 {LAT} for each FERENGI and each BUSINESS": a card with both counts twice (1CAR04)
	| { k: 'UP_TO'; max: Amount } // player chooses 0..max
	| { k: 'SKILL_ICONS'; specialty: SpecialtyId | 'CHOSEN' } // Skill icons of one track in play, beamed excluded;
	// 'CHOSEN' = the track picked by ADVANCE_SPECIALTY CHOICE (UTILIZE)
	| { k: 'TRAIT_COUNT'; bind: string } // traits of the bound card ("if the gained card has 3+ traits" — 1BUR11, via COMPARE)
	| { k: 'SHARED_TRAITS'; bind: string; with: Query } // traits the bound card shares with the first match
// (1PER19: Glory per trait in common between the discarded card and the named PERSON)
```

### `WILDCARD` handling

Trait matching takes a flag:

```ts
matchTrait(state, iid, trait, opts: { allowWildcard: boolean; actorMayOptIn: boolean }): boolean
```

- **Benefits / goals / `find`** → `allowWildcard: true, actorMayOptIn: true`
  (the owner chooses; surface a choice if the wildcard is load-bearing).
- **Forced dismissals / attacks** → `allowWildcard: false` (never compelled — `rules/12` §12.12).
- **Final scoring** → `allowWildcard: false`.

### `DIFFERENT_SPECIES`

Requires a **matching**, not a count: with `n` species-bearing cards, some of which are
`WILDCARD`, determine whether `k` distinct species can be assigned. Use a small
bipartite-matching / greedy-with-backtracking routine; `n` is tiny (< 20).

`filter` narrows the counted cards before the matching ("excluding cards with KLINGON" =
`{ not: { traits: ['KLINGON'] } }`). A card bearing a trait in `eachDistinct` stands for its
own, unique species (1PIC/M3: every ALIEN and every TRANSCENDENT card is a separate species);
without that clause two ALIENs are one species. An exclusion (`not`) never compels a
`WILDCARD` — it only matches the card's genuine or declared traits, so a WILDCARD still counts.

### Mission goals — `SAME_SHIP` and witnesses

```ts
interface SameShipRequirement {
	count?: number // default 1: this many DISTINCT cards …
	filter?: CardFilter // … matching this
	different?: TraitId[] | 'SPECIES' // … standing for pairwise different traits / species
	eachDistinct?: TraitId[] // as DIFFERENT_SPECIES_IN_PLAY
}
```

`SAME_SHIP` is met when **one** SHIP plus the cards beamed to it satisfies every requirement,
each requirement with its **own** cards — no card fills two ("a ROMULAN on a SHIP that has
KLINGON": a Romulan-Klingon alone does not). Examples: "3 ALLY on the same SHIP" =
`[{ count: 3, filter: { suits: ['ALLY'] } }]`; "1 HUMAN and 3 different of VULCAN / TELLARITE
/ …" = `[{ filter: { traits: ['HUMAN'] } }, { count: 3, different: ['VULCAN', …] }]`; three
species on one SHIP, STARFLEET cards not counted = `[{ count: 3,
different: 'SPECIES', filter: { not: { traits: ['STARFLEET'] } } }]`. The SHIP itself may fill
a requirement. Separate clauses of a goal outside `SAME_SHIP` (terms of an `AND`) are counted
independently, as printed.

**Witnesses** (rules/07 §7.2.1 step 2, rules/12 §12.26): on completion the engine dismisses
the beamed cards the goal needs, goal-agnostically — a set W of the actor's beamed cards is a
witness when the goal still holds with every other beamed card taken out of play. The smallest
such sets are offered (one → automatic, several → `CHOOSE_WITNESS`); a goal met without any
beamed card dismisses nothing. This covers every form (COUNT, SAME_SHIP, DIFFERENT_SPECIES,
AND/OR). Non-beamed contributors (deployed SHIPs, LOCATIONs, Staging cards) and beamed skill
icons (§12.5) are never dismissed.

## 6. Triggers (for REACTION operations)

```ts
type TriggerSeat = 'SELF' | 'OPPONENT' | 'ANY' // default SELF everywhere

type TriggerSpec =
	| { on: 'CARD_PLAYED'; filter?: CardFilter; seat?: TriggerSeat }
	| {
			on: 'CARD_GAINED'
			filter?: CardFilter
			seat?: TriggerSeat
			dest?: 'DECK_TOP' | 'DISCARD' // gain straight onto the Draw deck (1SHI06)
	  } // gain AND scan, not take
	| { on: 'RESOURCE_GAINED'; res?: ResourceId } // NOT on steal
	| {
			on: 'SPECIALTY_ADVANCED'
			specialty?: SpecialtyId
			specialties?: SpecialtyId[] // any of ("INFLUENCE/MILITARY", 1SIS06)
			seat?: TriggerSeat
	  } // a gain of at least 1 on the track
	| { on: 'PUT_INTO_PLAY'; filter?: CardFilter; seat?: TriggerSeat }
	| { on: 'CARD_DEPLOYED'; filter?: CardFilter; seat?: TriggerSeat } // DEPLOY: Staging → Fleet (1KOL03, 1CAR03)
	| { on: 'LOCATION_CONTROLLED'; seat?: 'SELF' | 'OPPONENT' }
	| { on: 'CARD_LOGGED'; filter?: CardFilter; seat?: TriggerSeat }
	| { on: 'AWAY_TEAM_SENT'; neutral?: boolean } // neutral = "to a neutral LOCATION" (1PER18)
	| { on: 'SHIP_WARPED' }
	| { on: 'INCIDENT_TAKEN'; orReturned?: boolean } // orReturned = "take or return an INCIDENT" (1PER22)
	| { on: 'INCIDENT_RETURNED' } // CARD_RETURNED_INCIDENT event
	| { on: 'ATTACKED' } // opponent resolved an ATTACK on you
	| { on: 'ATTACK_MADE' } // you resolved an ATTACK against the opponent
	| {
			on: 'WOULD_BE_ATTACKED'
			effect?: 'DISMISS_DUTY_OFFICER' | 'REMOVE_AWAY_TEAM'
	  } // §4 "would" windows
	| { on: 'WOULD_GAIN_CARD' } // your GAIN_CARD picked its card (1SIS22, 1BUR06)
	| { on: 'BEFORE_SCORING' } // SPECIAL only: "Before scoring, …" (1PER22)
	| { on: 'MISSION_COMPLETED' }
	| { on: 'ENCOUNTER_TAKEN' }
	| { on: 'OPERATION_RESOLVED'; paid?: ResourceId } // your operation completed having paid `paid` as a cost (1SIS24)
```

**Rulings encoded here:**

- **Offerable reactions.** A REACTION is offered in a window only if it could be taken: its card's
  table operations are available and not exhausted, its `[action]` and `requires` threshold are
  met, and a probe of its effect (with `$event.card`/`$event.pending` bound) does not fail — an
  unpayable mandatory cost (rules/12 §12.1) hides it (1PIC01 PICARD with an empty hand). A "would"
  window additionally needs the replacement to fully resolve. The remaining set is re-checked each
  time the window is re-offered, so a reaction that paid with the last card in hand drops the next.

- **Seat scoping.** Every trigger listens to the card owner's **own** events by default ("after
  gaining", "after putting a CLOAK into play", "after logging a card", "after deploying").
  `seat: 'OPPONENT'` is "after your opponent …" and `seat: 'ANY'` is "after you or your opponent
  …". The triggers without a `seat` field (`RESOURCE_GAINED`, `AWAY_TEAM_SENT`, `SHIP_WARPED`,
  `INCIDENT_*`, `MISSION_COMPLETED`, `ENCOUNTER_TAKEN`, `OPERATION_RESOLVED`) are always owner-only.
  `ATTACKED` matches the victim and `ATTACK_MADE` matches the aggressor.
- `CARD_GAINED` fires for `gain` **and** `scan`, **never** for `take` (`rules/08` → scan, take).
  The event carries `dest` (where the gained card was placed), which `dest` on the trigger can require.
- `CARD_DEPLOYED` is emitted by `DEPLOY` right after the card (a SHIP or an ONGOING card) moves
  from Staging to the Fleet. The reaction window opens there, mid-operation, before the rest of
  the deploying card's PLAY resolves. Playing a SHIP is `PUT_INTO_PLAY` (into Staging) and is
  **not** a deploy.
- A chosen REACTION, and a triggered PASSIVE, start with `$event.card` bound to the event's card.
  So "free play it", "return the INCIDENT", "the gained card" and "that SHIP" use
  `FREE_PLAY { bound: '$event.card' }` or a `Query { bound: '$event.card' }`.
- A `SPECIAL` operation may carry `trigger: { on: 'CARD_LOGGED' }` — "When you log this card (via any
  effect)": it fires for the logging player when THIS card is logged (the card is already out of play).
  With `beforeLeaving: true` a `LOG` resolves it **before** the move, while the card is still in play
  (the LOG re-pushes itself under the SPECIAL's OPERATION frame, gate `PRE_LOG`), so a LOCATION's
  Ships are not yet dismissed: 1LOC01 AMARGOSA OBSERVATORY (STCC FAQ "amargosa-warp"). The
  CARD_LOGGED event then carries `specialsRan` and the post-log collection skips it; a `COST_LOG`
  of such a card still runs it after the move.
- A `SPECIAL` operation may carry `trigger: { on: 'BEFORE_SCORING' }` — a pre-scoring search that
  hands back as many as 2 INCIDENTs (1PER22 SU'KAL): once the Resolution's last turn ends, the owners of such
  cards resolve them (active player first) before the FINAL_SCORING result is set (a GAME_OVER
  PHASE_STEP beneath them sets it). A Burn is decided by INCIDENT counts, so it has no "before
  scoring".
- `WOULD_BE_ATTACKED` / `WOULD_GAIN_CARD` open before the thing happens (§4 "would" windows); they
  bind `$event.pending`, which `IGNORE_ATTACK` / `REPLACE_GAIN` write to. `WOULD_BE_ATTACKED`
  matches the victim; `WOULD_GAIN_CARD` the gainer.
- A `PASSIVE` operation may carry a `trigger` — "PASSIVE: After taking an INCIDENT, you may …" (1SHR10):
  it resolves automatically (mandatory; wrap optional text in `MAY`) whenever the trigger matches,
  from any in-play card incl. exhausted/Staging ones.
- `RESOURCE_GAINED` **never** fires for `steal` (`rules/04` §4.3.3).
- `PUT_INTO_PLAY` timing differs per route (`rules/08` → put into play): **after** a PLAY
  operation, **before** a CONTROL operation.
- `AWAY_TEAM_SENT { neutral: true }` checks that the destination is in a Neutral Zone slot when
  the event drains, which is right after the send and before any take-control.

### Temporary trait grants

A SHIP gaining CLOAK until the end of the current turn (1KOL03, 1CAR03) is
`MODIFIER_ATTACH { id: 'TEMP_CLOAK', target: { zones: [{ k: 'FLEET', seat: 0 }], bound: '$event.card' } }`.

- With `target`, the layer is stored on the acting player with `source` set to **each matched
  card** instead of the resolving card. It therefore drops automatically when that card leaves
  play.
- A modifier with a `grantsTraits` hook adds those traits to its source card.
  `effectiveTraits(state, iid)` is the printed traits plus the granted ones, and every trait
  check goes through it: `matchTrait`, `cardTraits`, `CardFilter.traits` / `allTraits`,
  `BOUND_SHARES_TRAIT`, `HAS_TRAIT_IN_PLAY`, `SAME_SHIP`, `DIFFERENT_SPECIES` and mission goals.
- `TEMP_CLOAK` is `untilEndOfTurn`, so the Clean-up REFRESH substep of the current turn detaches
  it — from **both** seats, so a layer attached by a REACTION on the opponent's turn ends with that
  turn too.

## 7. Worked examples

### Simple: _Recruit_ — "Gain an ALLY."

```json
{
	"type": "PLAY",
	"costsAction": true,
	"isAttack": false,
	"effect": { "k": "GAIN_CARD", "suits": ["ALLY"] },
	"text": "Gain an ALLY."
}
```

### Cost/benefit: _Will Riker_ RESUPPLY — "Discard the top card of your deck, gain 1 Latinum."

```json
{
	"type": "RESUPPLY",
	"costsAction": false,
	"isAttack": false,
	"effect": {
		"k": "SEQ",
		"steps": [
			{ "k": "DISCARD", "from": "DECK_TOP", "count": 1 },
			{ "k": "GAIN_RESOURCE", "res": "LAT", "amount": 1 }
		]
	},
	"text": "(mill your top card, then +1 Latinum)"
}
```

_(Note: this is phrased as a sequence, not a `PAY_THEN` — both happen; nothing is conditional.
Compare the next example.)_

### `PAY_THEN`: _Confiscate_ — "Spend 2 Dilithium: gain a CARGO."

```json
{
	"type": "PLAY",
	"costsAction": true,
	"isAttack": false,
	"effect": {
		"k": "PAY_THEN",
		"cost": { "k": "COST_RESOURCE", "res": "DIL", "amount": 2 },
		"body": { "k": "GAIN_CARD", "suits": ["CARGO"] }
	},
	"text": "Spend 2 Dilithium to gain a CARGO."
}
```

### Variable amount: _Xindi-Reptilian Battleship_ — "Draw 1 card if you have 2+ ANOMALY in play."

```json
{
	"type": "RESUPPLY",
	"costsAction": false,
	"isAttack": false,
	"effect": {
		"k": "IF",
		"cond": { "k": "HAS_TRAIT_IN_PLAY", "trait": "ANOMALY", "count": 2 },
		"then": { "k": "DRAW", "count": 1 }
	},
	"text": "If you have 2 or more ANOMALY in play, draw a card."
}
```

### Choice + restriction: _Karemma_ — "MILITARY 3+: Spend 1 Latinum: gain an action."

```json
{
	"type": "PLAY",
	"costsAction": false,
	"isAttack": false,
	"requires": { "specialty": "MILITARY", "min": 3 },
	"effect": {
		"k": "PAY_THEN",
		"cost": { "k": "COST_RESOURCE", "res": "LAT", "amount": 1 },
		"body": { "k": "GAIN_ACTION", "amount": 1 }
	},
	"text": "MILITARY 3+ — Spend 1 Latinum: gain an [action]."
}
```

### REACTION: _Amargosa Observatory_ — on playing a DISCOVERY, +1 Glory and an optional log out of the Discard pile

```json
{
	"type": "REACTION",
	"costsAction": false,
	"isAttack": false,
	"trigger": {
		"on": "CARD_PLAYED",
		"filter": { "suits": ["ENCOUNTER"] },
		"seat": "SELF"
	},
	"effect": {
		"k": "SEQ",
		"steps": [
			{ "k": "GAIN_RESOURCE", "res": "GLO", "amount": 1 },
			{
				"k": "MAY",
				"body": {
					"k": "LOG",
					"target": { "zones": [{ "k": "DISCARD", "seat": "SELF" }], "pick": 1 }
				}
			}
		]
	},
	"text": "(REACTION on playing a DISCOVERY: +1 Glory, may log one Discard-pile card)"
}
```

### Self-logging: _Bynars_ — "[action] Gain a CARGO. Log this card."

```json
{
	"type": "PLAY",
	"costsAction": true,
	"isAttack": false,
	"effect": {
		"k": "SEQ",
		"steps": [
			{ "k": "GAIN_CARD", "suits": ["CARGO"] },
			{ "k": "LOG", "target": "THIS" }
		]
	},
	"text": "[action] Gain a CARGO. Log this card."
}
```

### ENDGAME: _Jean-Luc Picard_ — "1 VP per ALLY you own."

```json
{
	"type": "ENDGAME",
	"costsAction": false,
	"isAttack": false,
	"effect": {
		"k": "SCORE_VP",
		"amount": {
			"k": "COUNT",
			"query": {
				"zones": ["ALL_OWNED"],
				"seat": "SELF",
				"filter": { "suits": ["ALLY"] }
			}
		}
	},
	"text": "ENDGAME: Score 1 VP for each ALLY you own."
}
```

> `SCORE_VP` is a scoring-only primitive; it is illegal outside an `ENDGAME` or `SPECIAL`
> operation. The validator should enforce that.

## 8. Escape hatch

You **will** meet a card whose text no combination of nodes expresses. Two options, in order of
preference:

1. **Add a primitive.** Cheap; keeps everything uniform. Prefer this.
2. **`{ k: 'SCRIPT', fn: 'picard.phasing-cloak' }`** — a named function in a small registry of
   hand-written handlers.

**Budget: at most 5 `SCRIPT` cards across the whole game.** If you're at 10, the DSL is missing
an abstraction — stop and find it. Track the count in `todo/12` and `todo/13`.
