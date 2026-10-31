// Engine state (final — todo/05). Mirrors docs/data-model.md §2–§6 and
// docs/state-machine.md §1/§3 exactly:
//   - ZoneRef union + the zone-properties table in §3 (driven from the lookup,
//     never from hand-written zone lists);
//   - CardInstance / PlayerState / GameState shapes per §2/§4/§5;
//   - the single sanctioned card mover `moveCard` with the full cascade
//     bookkeeping (rules/12 §12.6, §12.7) and per-zone event emission.
//
// Where the docs leave a hole (scoring internals, shared-zone properties) the
// field/table is filled with a clearly-marked provisional value. GameState
// must remain plain JSON — `assertSerialisable` runs over every state a test
// or a reducer produces.

import type { Effect } from './resolver/nodes'
import type { Predicate } from './resolver/queries'
import type { PendingChoice } from './resolver/choices'
import type { CardInstanceId } from './ids'
import type { AltPlayRef } from './altPlay'
import type {
	DeckId,
	MarketSuit,
	ResourceId,
	SpecialtyId,
	TraitId,
} from '../data/ids'
import type { Seat, ZoneRef } from './resolver/queries'
import { cardDef, isLocationDef } from './cards'

// ---------------------------------------------------------------------------
// Small shared runtime types
// ---------------------------------------------------------------------------

export interface Rng {
	seed: number
	counter: number
}

export interface OperationRef {
	card: CardInstanceId
	opIndex: number
	seat: Seat
}

// Game result lifecycle (todo/10): the BURN / FINAL_SCORING variants are the
// *triggers* — checkEndgame / handOffTurn set them and every existing guard just
// tests `result !== null`. `finalizeGame` (scoring.ts) upgrades the trigger to
// the FINAL record `{ kind: 'COMPLETE', scoreboard }` exactly once; the raw
// trigger stays observable on states that skip finalisation (unit tests).
export type GameResult =
	| null
	| { kind: 'BURN' }
	| { kind: 'FINAL_SCORING' }
	| { kind: 'COMPLETE'; scoreboard: import('./scoring').FinalScoreboard }

// Provisional phase union — the exact lifecycle wiring is todo/06. Kept close
// to docs/state-machine.md §1 so the resolver story doesn't drift.
export type CleanupSub =
	| 'OPERATIONS'
	| 'STARDATE'
	| 'GLORY_PLACEMENT'
	| 'GLORY_TAKEN' // the placed Glory leaves the Stardate card (§3.6.3–§3.6.4)
	| 'CADET_WIPE' // solo-only extra substep (rules/10 §10.3)
	| 'DISCARD'
	| 'DRAW'
	| 'REFRESH'

export type Phase =
	| { k: 'SETUP' }
	| { k: 'RESUPPLY'; pending: OperationRef[] }
	| { k: 'CONTROL' }
	| { k: 'ACTION' }
	| { k: 'CLEANUP'; sub: CleanupSub }
	| { k: 'GAME_OVER' }

export type LogKind =
	'COST' | 'BENEFIT' | 'SKIPPED' | 'EVENT' | 'CHOICE' | 'INFO' | 'FAILED'

/** A token pool the UI can draw a flight from / to (src/engine/fx.ts). */
export type TokenPool =
	| { k: 'PLAYER'; seat: Seat; res: ResourceId | 'ACTION' }
	| { k: 'CARD'; iid: CardInstanceId; res: ResourceId | 'ACTION' }
	| { k: 'STARDATE' }

/** One EFFECT step's net token changes and the card whose effect made them. */
export interface TokenFx {
	source: CardInstanceId | null
	changes: { pool: TokenPool; delta: number }[]
}

export interface LogEntry {
	kind: LogKind
	seat?: Seat | undefined
	message: string
	iid?: CardInstanceId | undefined
	/** the player the entry happened to, when that is not necessarily `seat`
	 *  (whose card was dismissed, whose Away Teams were removed) */
	about?: Seat | undefined
}

// Provisional event vocabulary — the set primitives emit today plus the
// mirrors moveCard emits for cascade moves (children, dismissed ships, returned
// Away Teams). todo/09 wires these to PASSIVE/REACTION triggers.
export type GameEvent =
	| { k: 'CARD_PLAYED'; iid: CardInstanceId; seat: Seat }
	| { k: 'INCIDENT_TAKEN'; iid: CardInstanceId; seat: Seat }
	| { k: 'ENCOUNTER_TAKEN'; iid: CardInstanceId; seat: Seat }
	| { k: 'MISSION_COMPLETED'; seat: Seat; index: number }
	| { k: 'ATTACKED'; seat: Seat; victim: Seat }
	// "When you would be attacked" window (docs/effect-dsl.md §6): an opponent's
	// ATTACK (seat = attacker) is about to apply a negative effect to `victim`.
	// `first` = the attack's first such effect (the generic window); `effects`
	// names what this effect would do (DISMISS_DUTY_OFFICER, REMOVE_AWAY_TEAM).
	// `pending` keys the GameState.pending record the reactions write to.
	| {
			k: 'WOULD_BE_ATTACKED'
			seat: Seat
			victim: Seat
			pending: string
			first: boolean
			effects: AttackEffectKind[]
	  }
	// "When you would gain a card": a GAIN_CARD picked a card of `suit`
	| { k: 'WOULD_GAIN_CARD'; seat: Seat; pending: string; suit: MarketSuit }
	| { k: 'PUT_INTO_PLAY'; iid: CardInstanceId; seat: Seat }
	| {
			k: 'CARD_GAINED'
			iid: CardInstanceId
			seat: Seat
			/** where the gained card was placed (deck top matters to 1SHI06);
			 *  absent = unknown/other. */
			dest?: 'DECK_TOP' | 'DISCARD' | undefined
			/** the card lay face up before it moved (a Market offer, the Junk
			 *  pile), so both players know what was gained even once it lies
			 *  face-down on the deck top; absent = a blind deck-top gain. */
			seen?: boolean | undefined
	  }
	| { k: 'CARD_DEPLOYED'; iid: CardInstanceId; seat: Seat } // DEPLOY: Staging → Fleet (SHIP or ONGOING)
	| { k: 'CARD_DRAWN'; iid: CardInstanceId; seat: Seat }
	| { k: 'CARD_DISCARDED'; iid: CardInstanceId; seat: Seat }
	| {
			k: 'CARD_LOGGED'
			iid: CardInstanceId
			seat: Seat
			/** the card's `beforeLeaving` SPECIALs already resolved (LOG ran them
			 *  before the move), so the post-log collection skips them */
			specialsRan?: boolean | undefined
	  }
	| { k: 'CARD_DISMISSED'; iid: CardInstanceId; seat: Seat }
	| { k: 'CARD_DESTROYED'; iid: CardInstanceId; seat: Seat }
	| { k: 'CARD_RETURNED_INCIDENT'; iid: CardInstanceId; seat: Seat }
	| {
			k: 'RESOURCE_GAINED'
			seat: Seat
			res: 'DIL' | 'LAT' | 'GLO'
			amount: number
	  }
	| {
			k: 'RESOURCE_SPENT'
			seat: Seat
			res: 'DIL' | 'LAT' | 'GLO'
			amount: number
	  }
	| {
			k: 'OPERATION_RESOLVED'
			seat: Seat
			iid: CardInstanceId
			paid: ResourceId[] // resources paid as a cost while it resolved
	  }
	| { k: 'ACTION_SPENT'; seat: Seat }
	| { k: 'ACTION_GAINED'; seat: Seat; amount: number }
	| { k: 'AWAY_TEAM_SENT'; seat: Seat; location: string; count: number }
	| { k: 'AWAY_TEAM_REMOVED'; seat: Seat; location: string; count: number }
	| { k: 'LOCATION_CONTROLLED'; iid: CardInstanceId; seat: Seat }
	| { k: 'SHIP_WARPED'; iid: CardInstanceId; seat: Seat }
	| {
			k: 'SPECIALTY_ADVANCED'
			seat: Seat
			specialty: 'RESEARCH' | 'INFLUENCE' | 'MILITARY'
			amount: number
	  }

/** What a pending attack effect would do to the victim (WOULD_BE_ATTACKED). */
export type AttackEffectKind = 'DISMISS_DUTY_OFFICER' | 'REMOVE_AWAY_TEAM'

/** A replacement window in progress (docs/effect-dsl.md §6 "would" windows).
 *  ATTACK lives for the whole ATTACK operation (keyed by `$attack.id`);
 *  GAIN for one pending GAIN_CARD. Plain JSON. */
export type PendingReplacement =
	| {
			k: 'ATTACK'
			attacker: Seat
			victim: Seat
			/** the generic "would be attacked" window was already opened */
			asked: boolean
			/** IGNORE_ATTACK scope ATTACK: skip every remaining negative effect */
			ignored: boolean
			/** IGNORE_ATTACK scope EFFECT: skip the effect that opened the window */
			ignoreEffect: boolean
	  }
	| {
			k: 'GAIN'
			seat: Seat
			suit: MarketSuit
			/** REPLACE_GAIN: scan this many of `suit` instead */
			scan: number | null
	  }

// ---------------------------------------------------------------------------
// Players / cards
// ---------------------------------------------------------------------------

export interface MissionState {
	index: 0 | 1 | 2
	goal: Predicate
	reward: Effect
	vp: number
	completed: boolean
	/** the STCC mission record (`1PIC/M1` …) — title, crosscheck + printed text */
	cardId?: string | undefined
	/** an "Attack Reward" (1KOL/M3): the reward resolves as an ATTACK on the
	 *  opponent — "would be attacked" windows and ATTACKED reactions fire */
	isAttack?: boolean | undefined
}

/** One printed VP-multiplier glyph on a Specialty track (rules/07 §7.1.4). */
export interface TrackStep {
	step: number // the track step that carries the glyph
	value: number // ×N
}

/** The chosen Crew board side's multiplier glyphs per track — per crew and
 *  per side (src/data/cards/boards/*.json). Final scoring multiplies Focus
 *  icons by the highest glyph reached; no glyph reached = ×0 (the Advanced
 *  side prints nothing at step 0). */
export type TrackTable = Record<SpecialtyId, TrackStep[]>

/** Minimal, serialisable rule-modifier layer (docs/data-model.md §7). The
 *  hooks themselves resolve by id from src/engine/modifiers.ts. */
export interface RuleModifier {
	id: string
	source: CardInstanceId
}

export interface PlayerState {
	seat: Seat
	deckId: DeckId
	boardSide: 'BASIC' | 'ADVANCED'
	resources: { DIL: number; LAT: number; GLO: number }
	actions: { available: number; spent: number }
	specialties: { RESEARCH: number; INFLUENCE: number; MILITARY: number }
	/** the board side's multiplier glyphs (setup copies them from the board) */
	tracks: TrackTable
	awayTeamsInPool: number // on the Captain card
	awayTeamsTotal: number // never decreases
	missions: MissionState[]
	missionTokens: number // 1 on Basic, 3 on Advanced
	handSize: number // 5, or 6 for BUR w/ 1BUR02
	dutyOfficerLimit: number // 1 by default
	heldStardate: CardInstanceId | null // handed over; resolves in their Clean-up
	modifiers: RuleModifier[]
}

/** Where a token lives: a Location CardInstanceId, `'SUPPLY'`, or null (on the
 *  ship card / in the pool). JSON-safe by construction. */
export type LocationRef = CardInstanceId | 'SUPPLY' | null

export interface CardInstance {
	iid: CardInstanceId
	def: string // CardDefId
	owner: Seat | null // null for common cards not yet gained
	zone: ZoneRef
	exhausted: boolean
	actionTokens: number // reminder counters only — never refunded, never block
	beamedTo: CardInstanceId | null
	resourceTokens: Partial<Record<ResourceId, number>> // Glory sitting on a Market card
	shipTokenAt: LocationRef // where this SHIP's token is: on-card | a Location | supply
	wildcardAs: TraitId | null // transient; cleared after each operation
}

// ---------------------------------------------------------------------------
// Stack (docs/state-machine.md §3)
// ---------------------------------------------------------------------------

export interface EffectCtx {
	actor: Seat // who resolves — flipped by OPPONENT / FORCE
	source: CardInstanceId // "this card"
	bindings: Record<string, JsonValue> // LET / FOR_EACH / choice results
	duplicating?: CardInstanceId | undefined // set inside DUPLICATE (self-ref redirection)
	noNestedDuplicate?: boolean | undefined // set inside DUPLICATE; nested DUPLICATE is a no-op
	/** set on the body of an accepted MAY (and inherited by its children): an
	 *  optional effect whose PAY_THEN cost turns out unpayable is skipped
	 *  instead of failing the whole operation (rules/12 §12.1 — "may"). A
	 *  free-played card's own operation starts without it. */
	optional?: boolean | undefined
	/** An open "you may" decline (may.ts): set on the body of a MAY, or a REPEAT
	 *  UP_TO round, that asked no CONFIRM because the body's first prompt
	 *  carries the decline (`Primitive.offersDecline`). Only that first prompt
	 *  reads it — SEQ, PAY_THEN and CHOOSE_ONE pass it to their first step
	 *  alone (`withoutDecline`). */
	declinable?: Declinable | undefined
}

/** See EffectCtx.declinable. A decline drops every frame from `base` up (the
 *  stack depth the optional body was pushed at); `prompt` is the "you may"
 *  wording the declinable prompt shows. */
export interface Declinable {
	base: number
	prompt: string
}

/** Any JSON value — the state must stay serialisable, so bindings are JSON. */
export type JsonValue =
	string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export type Frame =
	| {
			k: 'EFFECT'
			node: Effect
			ctx: EffectCtx
			ip: number
			/** choice keys this node published, as [key, choiceId] pairs. Carried
			 *  from a suspended node to its resume frame (and to a continuation of
			 *  the same node, e.g. REPEAT / CHOOSE_N); scrubbed from the bindings
			 *  once the node finishes, so a SIBLING node of the same kind asks
			 *  afresh instead of replaying this answer (two MAYs in one SEQ). */
			resume?: [string, string][] | undefined
			/** replacement windows this node already passed (src/engine/resolver/
			 *  replacement.ts): 'ATTACK' (the pre-check before a negative effect of
			 *  an opponent's ATTACK), 'ATTACK_DO' (DISMISS picked a victim's Duty
			 *  Officer), 'GAIN' (GAIN_CARD picked its card). A re-pushed node
			 *  carries them so the window opens once; `pending` = the record id. */
			gates?: string[] | undefined
			pending?: string | undefined
	  }
	| {
			k: 'OPERATION'
			card: CardInstanceId
			opIndex: number
			ctx: EffectCtx
			phase: 0 | 1
			/** resolve the operation granted by this ALT_PLAY PASSIVE instead of
			 *  the card's printed #opIndex (1PIC08; src/engine/altPlay.ts). */
			via?: AltPlayRef | undefined
			/** resources paid as a cost by this operation (set by COST_RESOURCE /
			 *  SPEND_RESOURCE on the nearest OPERATION frame; 1SIS24). */
			paid?: ResourceId[] | undefined
			/** the GameState.pending ATTACK record of this ATTACK operation
			 *  (set in phase 0, closed in phase 1 — resolver/replacement.ts) */
			attack?: string | undefined
	  }
	| {
			k: 'REACTION_WINDOW'
			event: GameEvent
			offered: OperationRef[]
			seat: Seat
			/** choiceId of the OPTIONAL_TRIGGERS choice this window published, or
			 *  undefined when freshly pushed / after the answer was consumed. */
			choiceId?: string | undefined
			/** refs already taken by the reacting player (not re-offered). */
			taken?: OperationRef[] | undefined
			/** answers to published choices, keyed by choiceId (plain JSON). */
			bindings?: Record<string, JsonValue> | undefined
	  }
	| { k: 'PHASE_STEP'; phase: Phase; ctx?: EffectCtx | undefined }
	| {
			k: 'EMIT'
			event: GameEvent
			ifInPlay?: { iid: CardInstanceId; seat: Seat } | undefined
	  }

// ---------------------------------------------------------------------------
// Game state (docs/data-model.md §5)
// ---------------------------------------------------------------------------

export interface GameState {
	version: number
	rng: Rng
	mode: 'TWO_PLAYER' | 'CADET'
	cards: Record<string, CardInstance>
	zones: Record<string, CardInstanceId[]> // keyed by zoneKey(ref) (see below)
	players: [PlayerState, PlayerState]
	activeSeat: Seat
	startingSeat: Seat
	phase: Phase
	turnNumber: number
	turnsTaken: [number, number] // completed turns per seat (todo/06 §3)
	stardates: {
		pile: CardInstanceId[] // index 0 = topmost/current
		gloryOnTop: number
		/** Printed Glory of each card still in `pile` (index 0 = top), populated by
		 *  setup from the catalog spec. The Clean-up handoff refills the new top
		 *  card with ITS printed Glory — the data-driven replacement for the old
		 *  flat STARDATE_REFILL_GLORY (docs/data-model.md §1, rules/03 §3.6.4).
		 *  Optional so bare test states (endgame.test etc.) construct without it. */
		glories?: number[] | undefined
	}
	awayTeamsAt: Record<string, [number, number]> // LocationRef key -> [seat0, seat1]
	resolutionTriggered: boolean
	turnsAfterResolution: number
	stack: Frame[]
	pendingChoice: PendingChoice | null
	eventQueue: GameEvent[]
	/** todo/09 PASSIVE feedback-loop guard: (passive op, canonical event key)
	 *  pairs whose op is currently resolving. A re-fired identical pair means a
	 *  self-retrigger loop — drainEvents refuses and warns. Plain JSON. */
	triggerGuard: { passives: { op: string; eventKey: string }[] }
	log: LogEntry[]
	/** Token-movement trail for the UI (src/engine/fx.ts): one entry per EFFECT
	 *  step that changed a token pool, tagged with the card that caused it.
	 *  Append-only like `log`; never read by the rules. */
	fx: TokenFx[]
	result: GameResult
	/** SCORE_VP accumulation per seat: live ENDGAME/SPECIAL resolutions during
	 *  play park here (provisional), and `finalizeGame` overwrites both with the
	 *  final breakdown totals once. PlayerState carries no score field per
	 *  docs/data-model.md §4. */
	scoreVp: Record<Seat, number>
	/** Operations resolved (completed) during turn `turn` — DUPLICATE
	 *  RESOLVED_THIS_TURN reads it (1PER11). Stale when `turn` is not the
	 *  current turnNumber; optional so bare test states construct without it. */
	resolvedOps?: { turn: number; refs: OperationRef[] } | undefined
	/** Replacement windows in progress, keyed by id (see PendingReplacement). */
	pending?: Record<string, PendingReplacement> | undefined
	/** Probe mode (docs/state-machine.md §5): run on a clone, auto-resolve every
	 *  choice to the first legal selection, suppress events/reactions. Never set
	 *  on a persisted state. */
	probe?: boolean | undefined
}

// ---------------------------------------------------------------------------
// Zones — zoneKey / zoneProps (docs/data-model.md §3; the table is the law)
// ---------------------------------------------------------------------------

export const ZONES = [
	'MARKET_DECK',
	'MARKET_OFFER',
	'ENCOUNTER_DECK',
	'INCIDENT_DECK',
	'LOCATION_DECK',
	'NEUTRAL_ZONE',
	'JUNK',
	'STARDATE_PILE',
	'BOX',
	'HAND',
	'DRAW',
	'DISCARD',
	'RESERVE',
	'DEVELOPMENT',
	'LOG',
	'STAGING',
	'FLEET',
	'LOCATION_AREA',
	'DUTY_OFFICER',
	'CAPTAIN',
	'STATUS',
	'BEAMED',
] as const

export interface ZoneProps {
	inPlay: boolean
	traitsCount: boolean
	skillsCount: boolean
	tableOps: boolean
	ordered: boolean
	visibleTo: 'ALL' | 'OWNER' | 'NONE'
}

/** Canonical, injective serialisation of a ZoneRef (docs/data-model.md §3
 *  examples: `HAND:0`, `MARKET_OFFER:CARGO`, `BEAMED:p0#0042`). */
export function zoneKey(ref: ZoneRef): string {
	switch (ref.k) {
		case 'MARKET_DECK':
			return `MARKET_DECK:${ref.suit}`
		case 'MARKET_OFFER':
			return `MARKET_OFFER:${ref.suit}`
		case 'NEUTRAL_ZONE':
			return `NEUTRAL_ZONE:${ref.slot}`
		case 'BEAMED':
			return `BEAMED:${ref.host}`
		case 'HAND':
		case 'DRAW':
		case 'DISCARD':
		case 'RESERVE':
		case 'DEVELOPMENT':
		case 'LOG':
		case 'STAGING':
		case 'FLEET':
		case 'LOCATION_AREA':
		case 'DUTY_OFFICER':
		case 'CAPTAIN':
		case 'STATUS':
			return `${ref.k}:${ref.seat}`
		default:
			return ref.k // ENCOUNTER_DECK, INCIDENT_DECK, LOCATION_DECK, JUNK, STARDATE_PILE, BOX
	}
}

/** A fresh, plain-JSON copy of a ZoneRef. moveCard/addCard store a card's
 *  `zone` as its own instance — a single cascade move must never leave several
 *  cards sharing one object reference (assertSerialisable treats shared refs
 *  as a serialisation hazard, and JSON round-trips should keep identity per
 *  card). */
function cloneRef(ref: ZoneRef): ZoneRef {
	// every ZoneRef variant is flat (k + one primitive field), so a spread is
	// an exact copy, and much cheaper than structuredClone on this hot path
	return { ...ref }
}

/**
 * The zone-properties lookup (docs/data-model.md §3 table + provisional values
 * for the shared zones the table omits). Drive ALL zone semantics from here —
 * in-play membership (rules/08), trait/skill counting (rules/12 §12.3/§12.5),
 * table operations, ordering and visibility — never from hand-written lists.
 */
export function zoneProps(ref: ZoneRef): ZoneProps {
	switch (ref.k) {
		case 'LOCATION_AREA':
		case 'FLEET':
		case 'DUTY_OFFICER':
		case 'CAPTAIN':
		case 'STATUS':
			return {
				inPlay: true,
				traitsCount: true,
				skillsCount: true,
				tableOps: true,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'STAGING':
			return {
				inPlay: true,
				traitsCount: true,
				skillsCount: true,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'BEAMED':
			return {
				inPlay: true,
				traitsCount: true,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'HAND':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'OWNER',
			}
		case 'DRAW':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: true,
				visibleTo: 'NONE',
			}
		case 'DISCARD':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'RESERVE':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: true,
				visibleTo: 'NONE',
			}
		case 'DEVELOPMENT':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'LOG':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'OWNER',
			}
		case 'MARKET_OFFER':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'MARKET_DECK':
		case 'ENCOUNTER_DECK':
		case 'INCIDENT_DECK':
		case 'LOCATION_DECK':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: true,
				visibleTo: 'NONE',
			}
		case 'NEUTRAL_ZONE':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'JUNK':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
		case 'STARDATE_PILE':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: true,
				visibleTo: 'ALL',
			}
		case 'BOX':
			return {
				inPlay: false,
				traitsCount: false,
				skillsCount: false,
				tableOps: false,
				ordered: false,
				visibleTo: 'ALL',
			}
	}
}

// ---------------------------------------------------------------------------
// Basic state accessors
// ---------------------------------------------------------------------------

export function player(state: GameState, seat: Seat): PlayerState {
	return state.players[seat]!
}

export function otherSeat(seat: Seat): Seat {
	return seat === 0 ? 1 : 0
}

/**
 * A copy of `state` that is safe to run the engine on while the original stays
 * untouched — for probes, and for searches that branch several continuations
 * off one state (src/bot/). Much cheaper than `structuredClone(state)`.
 *
 * The engine updates `cards`, `zones`, `players`, `log`, `fx`, `pending` and the
 * rest by copy-on-write (spread), never in place. The one in-place write is to
 * the `ctx.bindings` objects of stack frames: suspend() and the binding
 * primitives write there so that sibling steps sharing a ctx see the result
 * (resolver/runtime.ts). So deep-copying the stack is enough. `structuredClone`
 * keeps the bindings objects that frames share shared inside the copy. Every
 * other field is shared with the original, so neither copy may be mutated
 * outside the engine.
 */
export function forkState(state: GameState): GameState {
	if (state.stack.length === 0) return { ...state, stack: [] }
	return { ...state, stack: structuredClone(state.stack) as Frame[] }
}

export function zonesOf(state: GameState, ref: ZoneRef): CardInstanceId[] {
	return state.zones[zoneKey(ref)] ?? []
}

/** Total away-team tokens in play: pools + every Location (todo/08 §8). The
 *  total NEVER decreases during play — tokens only move between a player's
 *  Captain card and Locations, and every removal returns them to the pool.
 *  Asserted at the stack boundary (resolver/stack.ts) after every primitive. */
export function awayTeamsTotal(state: GameState): number {
	let total = 0
	for (const pl of state.players) total += pl.awayTeamsInPool
	for (const at of Object.values(state.awayTeamsAt))
		total += (at[0] ?? 0) + (at[1] ?? 0)
	return total
}

export function isInPlay(state: GameState, iid: CardInstanceId): boolean {
	const card = state.cards[iid]
	if (!card) return false
	return zoneProps(card.zone).inPlay
}

/** All instances a player owns (every zone). */
export function owned(state: GameState, seat: Seat): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const [iid, card] of Object.entries(state.cards)) {
		if (card.owner === seat) out.push(iid as CardInstanceId)
	}
	return out
}

/** All of a player's in-play instances (rules/08 → in play). The canonical
 *  "in play for you" set: Location Area, Fleet, Duty Officer, Captain, Status,
 *  Staging and beamed cards — driven purely by zoneProps. */
export function inPlayCards(state: GameState, seat: Seat): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const [iid, card] of Object.entries(state.cards)) {
		if (card.owner === seat && zoneProps(card.zone).inPlay)
			out.push(iid as CardInstanceId)
	}
	return out
}

// ---------------------------------------------------------------------------
// Card movement — the ONLY place a card changes zone (grep: no other
// `zones[...].push(` outside `moveCard` and the setup factory `addCard`).
// ---------------------------------------------------------------------------

export interface MoveOpts {
	toTop?: boolean | undefined // insert at the front (top of a deck), else append
}

/** Append a cascade GameEvent (mirrors emitted for indirectly-moved cards). */
function queueEvent(state: GameState, ev: GameEvent): GameState {
	return { ...state, eventQueue: [...state.eventQueue, ev] }
}

/** The event a card "suffering the same effect" as its host should raise. */
function cascadeEventFor(
	to: ZoneRef,
	iid: CardInstanceId,
	seat: Seat,
): GameEvent | null {
	switch (to.k) {
		case 'DISCARD':
			return { k: 'CARD_DISMISSED', iid, seat }
		case 'LOG':
			return { k: 'CARD_LOGGED', iid, seat }
		case 'BOX':
			return { k: 'CARD_DESTROYED', iid, seat }
		default:
			return null // recall / other: no typed event in the current vocabulary
	}
}

/**
 * The only sanctioned way a card changes zone. Beyond the base relocation it
 * owns every cascade rule so no primitive ever re-implements them:
 *   1. clear transient state that never survives: wildcardAs always, exhausted
 *      when leaving play, resourceTokens when leaving a Market offer;
 *   2. maintain beamedTo (set on entry to a BEAMED zone, cleared on exit);
 *   3. a SHIP leaving play sends its token to the supply ('SUPPLY') — it can
 *      never return to the card except via DEPLOY (rules/12 §12.16);
 *   4. Action tokens stay on the card forever — they are reminder counters,
 *      "move or set aside, never refunded" (rules/12 §12.7);
 *   5. children beamed to a leaving-play host suffer the same effect
 *      (rules/12 §12.6) — dismiss / recall / log / destroy recursively;
 *   6. a LOCATION leaving play dismisses the Ships present and returns Away
 *      Teams to their owners' Captain cards (rules/08 → log / destroy);
 *   7. rule modifiers attached to the leaving card detach automatically
 *      (docs/data-model.md §7, todo/05 §7);
 *   8. cascade moves emit the matching GameEvents.
 */
export function moveCard(
	state: GameState,
	iid: CardInstanceId,
	to: ZoneRef,
	opts?: MoveOpts,
): GameState {
	const card = state.cards[iid]
	if (!card) throw new Error(`moveCard: no card ${iid}`)
	const from = card.zone
	const leavingPlay = zoneProps(from).inPlay && !zoneProps(to).inPlay

	let next = applyBaseMove(state, iid, to, opts)
	if (!leavingPlay) return next

	next = detachModifiers(next, iid)
	next = cascadeBeamed(next, iid, to)
	if (isLocationDef(cardDef(card.def))) next = cascadeLocationLeave(next, iid)
	return next
}

/** The base relocation: zone arrays, CardInstance.zone, transient clears,
 *  beamedTo maintenance and ship-token bookkeeping. Pure per move. */
function applyBaseMove(
	state: GameState,
	iid: CardInstanceId,
	to: ZoneRef,
	opts?: MoveOpts,
): GameState {
	const card = state.cards[iid]!
	const from = card.zone
	const fromKey = zoneKey(from)
	const toKey = zoneKey(to)
	const fromArr = state.zones[fromKey] ?? []
	const toArr = state.zones[toKey] ?? []

	const leavingPlay = zoneProps(from).inPlay && !zoneProps(to).inPlay
	const leavingOffer = from.k === 'MARKET_OFFER'

	// Preserve every untouched zone: a move only re-writes its two zone keys.
	const zones: Record<string, CardInstanceId[]> = { ...state.zones }
	if (fromKey === toKey) {
		// same-zone move (rare reorder): drop the card, then re-insert
		const filtered = toArr.filter((x) => x !== iid)
		zones[toKey] =
			opts?.toTop === true ? [iid, ...filtered] : [...filtered, iid]
	} else {
		const remaining = fromArr.filter((x) => x !== iid)
		const added = opts?.toTop === true ? [iid, ...toArr] : [...toArr, iid]
		zones[fromKey] = remaining
		zones[toKey] = added
	}

	let shipTokenAt = card.shipTokenAt
	if (cardDef(card.def).suit === 'SHIP' && leavingPlay) {
		// A SHIP leaving play ALWAYS sends its token to the supply — the token can
		// never return to the card except via DEPLOY (todo/08 §7, rules/12 §12.16).
		// Recall of a warped/deployed ship therefore does NOT put the token back
		// on the card; only a fresh DEPLOY takes it from the supply onto the card.
		shipTokenAt = 'SUPPLY'
	}
	const beamedTo =
		to.k === 'BEAMED'
			? ((to as { k: 'BEAMED'; host: string }).host as CardInstanceId)
			: from.k === 'BEAMED'
				? null
				: card.beamedTo

	const nextCard: CardInstance = {
		...card,
		zone: cloneRef(to),
		wildcardAs: null,
		exhausted: leavingPlay ? false : card.exhausted,
		resourceTokens: leavingOffer ? {} : card.resourceTokens,
		shipTokenAt,
		beamedTo,
	}
	return { ...state, cards: { ...state.cards, [iid]: nextCard }, zones }
}

/** Beamed children travel with a leaving-play host (rules/12 §12.6), each
 *  recursively cascading its own children and emitting the matching event. */
function cascadeBeamed(
	state: GameState,
	host: CardInstanceId,
	to: ZoneRef,
): GameState {
	const children: CardInstanceId[] = []
	for (const [childIid, child] of Object.entries(state.cards)) {
		if (child.zone.k === 'BEAMED' && child.zone.host === host)
			children.push(childIid as CardInstanceId)
	}
	let next = state
	for (const child of children) {
		const seat = next.cards[child]?.owner ?? 0
		next = moveCard(next, child, to)
		const ev = cascadeEventFor(to, child, seat)
		if (ev !== null) next = queueEvent(next, ev)
	}
	return next
}

/** A LOCATION leaving play dismisses its Ships present and returns Away Teams
 *  to their owners' Captain cards (rules/08 → log / destroy / take control). */
function cascadeLocationLeave(
	state: GameState,
	iid: CardInstanceId,
): GameState {
	let next = state

	const toDismiss: CardInstanceId[] = []
	for (const [shipIid, ship] of Object.entries(state.cards)) {
		if (ship.zone.k === 'FLEET' && ship.shipTokenAt === iid)
			toDismiss.push(shipIid as CardInstanceId)
	}
	for (const ship of toDismiss) {
		const seat = next.cards[ship]?.owner ?? 0
		next = moveCard(next, ship, { k: 'DISCARD', seat })
		next = queueEvent(next, { k: 'CARD_DISMISSED', iid: ship, seat })
	}

	const at = state.awayTeamsAt[iid]
	if (at !== undefined) {
		const awayTeamsAt = { ...state.awayTeamsAt }
		delete awayTeamsAt[iid]
		let players = state.players
		if ((at[0] ?? 0) > 0 || (at[1] ?? 0) > 0) {
			players = state.players.map((pl) =>
				(at[pl.seat] ?? 0) > 0
					? { ...pl, awayTeamsInPool: pl.awayTeamsInPool + (at[pl.seat] ?? 0) }
					: pl,
			) as [PlayerState, PlayerState]
		}
		for (const seat of [0, 1] as const) {
			if ((at[seat] ?? 0) > 0) {
				next = queueEvent(next, {
					k: 'AWAY_TEAM_REMOVED',
					seat,
					location: iid as string,
					count: at[seat]!,
				})
			}
		}
		next = { ...next, awayTeamsAt, players }
	}
	return next
}

/** Rule modifiers detach when their source card leaves play (modifiers only
 *  apply while the card is in play — docs/data-model.md §7). */
function detachModifiers(state: GameState, iid: CardInstanceId): GameState {
	let touched = false
	const players = state.players.map((pl) => {
		const before = pl.modifiers
		const after = before.filter((m) => m.source !== iid)
		if (after.length !== before.length) touched = true
		return after.length === before.length ? pl : { ...pl, modifiers: after }
	}) as [PlayerState, PlayerState]
	return touched ? { ...state, players } : state
}

/**
 * Clear every transient wildcard declaration (operation end, rules/12 §12.12).
 */
export function clearWildcards(state: GameState): GameState {
	let touched = false
	const cards: Record<string, CardInstance> = {}
	for (const [iid, card] of Object.entries(state.cards)) {
		if (card.wildcardAs !== null) {
			touched = true
			cards[iid] = { ...card, wildcardAs: null }
		}
	}
	return touched ? { ...state, cards: { ...state.cards, ...cards } } : state
}

// ---------------------------------------------------------------------------
// Test factory
// ---------------------------------------------------------------------------

/** Minimal, deterministic state two players can be slotted into. */
export function newGameState(
	seed = 1,
	opts?: { mode?: 'TWO_PLAYER' | 'CADET' },
): GameState {
	const base = (seat: Seat): PlayerState => ({
		seat,
		deckId: 'COMMON',
		boardSide: 'BASIC',
		resources: { DIL: 0, LAT: 0, GLO: 0 },
		actions: { available: 0, spent: 0 },
		specialties: { RESEARCH: 0, INFLUENCE: 0, MILITARY: 0 },
		tracks: { RESEARCH: [], INFLUENCE: [], MILITARY: [] },
		awayTeamsInPool: 0,
		awayTeamsTotal: 0,
		missions: [],
		missionTokens: 1,
		handSize: 5,
		dutyOfficerLimit: 1,
		heldStardate: null,
		modifiers: [],
	})
	const p0 = base(0)
	const p1 = base(1)
	const state: GameState = {
		version: 1,
		rng: { seed, counter: 0 },
		mode: opts?.mode ?? 'TWO_PLAYER',
		cards: {},
		zones: {},
		players: [p0, p1],
		activeSeat: 0,
		startingSeat: 0,
		phase: { k: 'ACTION' },
		turnNumber: 1,
		turnsTaken: [0, 0],
		stardates: { pile: [], gloryOnTop: 0 },
		awayTeamsAt: {},
		resolutionTriggered: false,
		turnsAfterResolution: 0,
		stack: [],
		pendingChoice: null,
		eventQueue: [],
		triggerGuard: { passives: [] },
		log: [],
		fx: [],
		result: null,
		scoreVp: { 0: 0, 1: 0 },
	}
	return state
}

/** Add a populated CardInstance to a state (tests + future setup). Returns the
 *  updated state. This is the second (and only other) sanctioned zone mutator —
 *  both it and `moveCard` funnel through the zone-array bookkeeping. */
export function addCard(
	state: GameState,
	iid: CardInstanceId,
	def: string,
	owner: Seat | null,
	zone: ZoneRef,
): GameState {
	const card: CardInstance = {
		iid,
		def,
		owner,
		zone: cloneRef(zone),
		exhausted: false,
		actionTokens: 0,
		beamedTo: null,
		resourceTokens: {},
		shipTokenAt: null,
		wildcardAs: null,
	}
	const key = zoneKey(zone)
	return {
		...state,
		cards: { ...state.cards, [iid]: card },
		zones: { ...state.zones, [key]: [...(state.zones[key] ?? []), iid] },
	}
}
