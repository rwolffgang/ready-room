# State Machine, Intents & Choices

## 1. Phases

```ts
type Phase =
	| { k: 'SETUP' }
	| { k: 'RESUPPLY'; pending: OperationRef[] } // player picks the order
	| { k: 'CONTROL' } // may take one secured Location
	| { k: 'ACTION' }
	| { k: 'CLEANUP'; sub: CleanupSub }
	| { k: 'GAME_OVER' }

type CleanupSub =
	| 'OPERATIONS' // fire every CLEAN-UP operation, player-chosen order
	| 'STARDATE' // resolve a Stardate card handed to you
	| 'GLORY_PLACEMENT' // move 1 Glory from the Stardate onto a Market card
	| 'DISCARD' // Staging -> Discard; optionally discard from hand
	| 'DRAW' // draw to hand size
	| 'REFRESH' // refresh cards; reset actions to 3
```

Phase order is fixed: `RESUPPLY → CONTROL → ACTION → CLEANUP → (next player) RESUPPLY`.

### Phases that need player input even when "automatic"

- **`RESUPPLY`** and **`CLEANUP.OPERATIONS`**: all effects are mandatory, but **the order is the
  player's choice** (`rules/03` §3.3, §3.6.1). Emit an `ORDER_OPERATIONS` choice whenever more
  than one is pending — but **auto-resolve when only one remains**, and offer a "resolve all in
  listed order" shortcut in the UI.
- **`CONTROL`**: emit a choice only if ≥1 neutral Location is secured. Taking control is
  optional ("you _may_").
- **`CLEANUP.GLORY_PLACEMENT`**: always a choice among the ≤4 Market cards.

## 2. Intents (what the UI dispatches)

```ts
type Intent =
	// Action Step
	| { t: 'PLAY_CARD'; iid: CardInstanceId; operationIndex: number }
	| { t: 'ACTIVATE'; iid: CardInstanceId; operationIndex: number }
	| { t: 'COMPLETE_MISSION'; index: number }
	| { t: 'END_ACTION_STEP' }
	// Control Step
	| { t: 'TAKE_CONTROL'; locationIid: CardInstanceId }
	| { t: 'SKIP_CONTROL' }
	// Clean-up
	| { t: 'DISCARD_FROM_HAND'; iids: CardInstanceId[] }
	| { t: 'ADVANCE_PHASE' }
	// universal
	| { t: 'RESOLVE_CHOICE'; choiceId: string; selection: Selection }
	| { t: 'TRIGGER_REACTION'; iid: CardInstanceId; operationIndex: number }
	| { t: 'DECLINE_REACTIONS' }
	| { t: 'UNDO' } // handled by the session layer, not the engine
```

**`reduce(state, intent)` contract:**

1. Validate the intent against the current phase and legality queries. **Invalid → throw**;
   the UI should never have offered it. (Expose `legalIntents(state)` so it can't.)
2. Push the corresponding work onto `state.stack`.
3. **Run the stack to a halt** (empty, or `pendingChoice` set, or game over).
4. Return the new state.

## 3. The effect stack

```ts
type Frame =
	| { k: 'EFFECT'; node: Effect; ctx: EffectCtx; ip: number }
	| { k: 'OPERATION'; card: CardInstanceId; opIndex: number; ctx: EffectCtx }
	| {
			k: 'REACTION_WINDOW'
			event: GameEvent
			offered: OperationRef[]
			seat: Seat
	  }
	| { k: 'PHASE_STEP'; phase: Phase }

interface EffectCtx {
	actor: Seat // who resolves — flipped by OPPONENT / FORCE
	source: CardInstanceId // "this card"
	bindings: Record<string, JsonValue> // LET / FOR_EACH / choice results
	duplicating?: CardInstanceId // set when inside DUPLICATE (self-ref redirection)
	noNestedDuplicate?: boolean // set inside DUPLICATE; makes nested DUPLICATE a no-op
}
```

### The run loop

```
run(state):
  while state.pendingChoice == null and state.stack.length > 0:
     if state.result != null: break                  // Burn / Resolution ended it
     frame = top(state.stack)
     state = executeOne(state, frame)                // may push frames, may set pendingChoice
     state = drainEvents(state)                      // fire PASSIVEs, open REACTION windows
  return state
```

`executeOne` advances **one primitive** — never a whole subtree — so that:

- REACTION windows can open between any two primitives,
- the Burn / Stardate-empty checks run at every granular step (`rules/12` §12.9, §12.11),
- a mid-effect save is always possible.

### Event draining

After each primitive:

1. Pop every `GameEvent` from `state.eventQueue`.
2. For each, collect matching **PASSIVE** operations on **both** players' in-play cards →
   push them (mandatory, no choice).
3. Collect matching **REACTION** operations on **unexhausted, in-play, non-beamed,
   non-Staging** cards → if any, push a `REACTION_WINDOW` frame for the owning seat.
4. A `REACTION_WINDOW` emits a `PendingChoice` of kind `OPTIONAL_TRIGGERS`, and stays on the
   stack until the player declines or exhausts the list — so multiple reactions to the same
   event can be taken in any order (`rules/08` → REACTION).

Because the window frame sits **above** the interrupted `EFFECT` frame, the interrupted
operation resumes naturally when the window pops (`rules/12` §12.24).

Before the queue is drained, `chronicle` (`resolver/chronicle.ts`) writes a log line for every
event that takes something off the table — a card dismissed, destroyed or logged, an
opponent's Away Teams removed — with `LogEntry.about` set to the player it happened to.
Primitives and `moveCard`'s cascades (a beamed card following its host) only queue these
events, so this one call in `runCollecting` covers every path.

### Token trail (`state.fx`)

After each `EFFECT` step the stack diffs the token pools (both players' resources and
`actions.available`, every card's `resourceTokens` / `actionTokens`, the Stardate card's
Glory) and, when anything moved, appends `{ source: ctx.source, changes }` to `state.fx`
(`src/engine/fx.ts`). The rules never read it — it tells the UI which card a token came from
or went to (a passive's gain, a cost paid into the card being played, a steal), so tokens can
fly across the board. Phase bookkeeping outside an effect (Clean-up's action reset) is not
recorded; the UI attributes that remainder to the supply. `actions.spent` counts the actions
paid this turn and resets with `available` in Clean-up.

## 4. Pending choices

One discriminated union; one React component per variant.

```ts
type PendingChoice =
	| { k: 'CONFIRM'; id; seat; prompt } // MAY
	| {
			k: 'CHOOSE_OPTION'
			id
			seat
			prompt
			options: { key; label; enabled; reason? }[]
	  }
	| {
			k: 'CHOOSE_CARDS'
			id
			seat
			prompt
			candidates: CardInstanceId[]
			min: number
			max: number
			from: ZoneRef
	  }
	| { k: 'CHOOSE_LOCATION'; id; seat; prompt; candidates: CardInstanceId[] }
	| { k: 'CHOOSE_SUIT'; id; seat; prompt; suits: MarketSuit[] }
	| { k: 'CHOOSE_TRAIT'; id; seat; prompt; traits: TraitId[] }
	| { k: 'CHOOSE_SPECIALTY'; id; seat; prompt; specialties; gains } // gains: per track, after the clamp
	| {
			k: 'CHOOSE_DESTINATION'
			id
			seat
			prompt
			card: CardInstanceId
			options: ('DECK_TOP' | 'DISCARD')[]
	  } // gain/scan placement
	| { k: 'CHOOSE_AMOUNT'; id; seat; prompt; min: number; max: number } // UP_TO
	| { k: 'ORDER_OPERATIONS'; id; seat; prompt; pending: OperationRef[] }
	| { k: 'OPTIONAL_TRIGGERS'; id; seat; prompt; offered: OperationRef[] }
	| { k: 'CHOOSE_WITNESS'; id; seat; prompt; sets: CardInstanceId[][] } // mission contributors
	| {
			k: 'CHOOSE_WILDCARD_AS'
			id
			seat
			prompt
			card: CardInstanceId
			traits: TraitId[]
	  }
	| { k: 'ORDER_CARDS'; id; seat; prompt; cards: CardInstanceId[] } // scan -> bottom of deck
```

**Every choice carries `seat`** — because REACTIONs and `FORCE` mean the deciding player is often
**not** the active player. The UI must route the choice to the right side (and, in hot-seat mode,
put up a "pass the device" screen when `choice.seat !== activeSeat`).

**Validation:** `RESOLVE_CHOICE` must re-validate the selection against the published candidate
set. Never trust the client.

## 5. Legality queries (drive the UI)

```ts
function legalIntents(state, seat): Intent[]
function canPlay(
	state,
	seat,
	iid,
): { ok: boolean; operations: number[]; reasons: string[] }
function canActivate(
	state,
	seat,
	iid,
	opIndex,
): { ok: boolean; reason?: string }
function securedLocations(state, seat): CardInstanceId[]
function completableMissions(state, seat): number[]
```

`canPlay` must **dry-run** each PLAY operation's cost chain (`rules/12` §12.2). Implement it by
running the resolver in a **`probe` mode** against a cloned state, where any `PendingChoice`
resolves to "is there at least one legal selection?" rather than halting. Keep probe mode
side-effect free and bounded in depth.

**Return `reasons` strings.** The UI showing _"Requires Research 4 (you have 2)"_ on a greyed-out
card is worth a great deal at this rules weight.

## 6. Game-end detection

Run after **every** primitive, in this order (`rules/12` §12.11):

```
1. if INCIDENT_DECK is empty              -> BURN, end immediately
2. if last Stardate emptied               -> resolutionTriggered = true
3. if resolutionTriggered and turn budget exhausted -> FINAL_SCORING
```

**Resolution turn budget:** play runs on until the second player's turn is over, after which
each player gets exactly one extra turn. Implement as:

```
onResolutionTriggered:
  // finish the current round so both have equal turns...
  extraTurnsRemaining = (turnsTaken[0] === turnsTaken[1] ? 0 : 1) + 2
```

Then decrement at each turn end; at zero, score. **Write a test for each of: Resolution on the
starting player's turn; on the second player's turn; Burn during the extra turns.**

## 7. Session layer: log, replay, undo

```ts
interface Session {
	seed: number
	setup: SetupConfig // decks chosen, board sides, mode
	log: Intent[]
}

function replay(session): GameState // setup(seed, config), then reduce each intent
```

- **Save** = serialise `Session` (tiny — a few KB).
- **Undo** = drop the last _player-visible_ intent (and any auto-resolved trailing ones), replay.
- **Full-state snapshots** every N intents as a replay cache if replay ever gets slow. Measure
  first; it probably won't.

Because setup itself consumes RNG, **setup must be deterministic from `(seed, config)`**. Never
call `Math.random()` anywhere in `src/engine`. Add an ESLint rule banning it.

## 8. Hot-seat, and the shape of a future online mode

`project(state, viewerSeat)` strips hidden information (`docs/architecture.md` §5). For hot-seat:

- Show `project(state, activeSeat)`.
- On seat change, show a "Pass the device" interstitial.
- A "solo/analysis" toggle can reveal everything — useful for debugging, keep it behind a flag.

If you later add online play, the same `project` output is the message payload and the same
`reduce` runs authoritatively on the server. Nothing in the engine changes. **Do not build this
now** — but don't foreclose it by leaking hidden state into the UI layer.
