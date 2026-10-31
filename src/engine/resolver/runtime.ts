// Shared actor for primitives (todo/04). Centralises the tricky cross-cutting
// mechanics so the per-node files stay thin:
//   - suspension: emit a PendingChoice and push a resumable frame
//   - card picking with auto-select (no gratuitous prompts)
//   - resource accounting incl. Glory substitution
//   - cost resolvability (per the §4 selection-exists rule)
//   - fail-upward (rules/12 §12.1) / benefit skipping
//   - events & log (suppressed in probe mode where the docs demand it)

import {
	player,
	otherSeat,
	zonesOf,
	inPlayCards,
	isInPlay,
	moveCard,
	type GameState,
	type EffectCtx,
	type LogEntry,
	type GameEvent,
	type JsonValue,
} from '../state'
import { cardDef, isLocationDef } from '../cards'
import type { ChoiceSeed, ChoiceDisabledCard, PendingChoice } from './choices'
import type { Effect } from './nodes'
import type { CardInstanceId } from '../ids'
import type {
	Seat,
	ZoneRef,
	ZoneSpec,
	CardFilter,
	Query,
	Amount,
} from './queries'
import {
	resolveQuery,
	evalAmount,
	evalPredicate,
} from '../queries/resolveQuery'
import { cardIsWildcard } from '../queries/traits'
import {
	gainRedirect,
	canSubstituteGlory as canSubstituteGloryFor,
	stolenSources,
	stealProtected,
} from '../modifiers'
import type { GainCtx } from '../modifiers'
import type { ResourceId, SpecialtyId, TraitId } from '../../data/ids'
import {
	isCadetOpponent,
	opponentAwayTeamsAt,
	opponentResource,
} from '../../bot/cadet'

/** A neutral EffectCtx for queries/amounts that do not depend on the actor
 *  (seat-independent references such as MARKET_OFFER). */
export const EMPTY_CTX: EffectCtx = {
	actor: 0,
	source: '' as CardInstanceId,
	bindings: {},
}

// ===========================================================================
// Suspension (emit a choice, then keep going once it resolves)
// ===========================================================================

/** Deterministic choice id (todo/07 §1): FNV-1a hash of the suspend context —
 *  stack depth, top frame's instruction index and kind, turn number, and the
 *  RNG counter. A replay of the same (seed, intent log) rebuilds the stack and
 *  counter identically, so the id survives a replay unchanged and a saved
 *  RESOLVE_CHOICE from the log still matches. Not a counter and not a UUID.
 *  Every input is plain JSON, so the hash is stable across a mid-effect save.
 */
export function makeChoiceId(state: GameState): string {
	const top = state.stack[state.stack.length - 1]
	let frameIndex = 0
	if (top?.k === 'EFFECT') frameIndex = top.ip
	else if (top?.k === 'OPERATION') frameIndex = top.phase
	const nodeKind = top?.k ?? 'none'
	const material = `${state.stack.length}:${frameIndex}:${nodeKind}:${state.turnNumber}:${state.rng.counter}`
	let hash = 0x811c9dc5
	for (let i = 0; i < material.length; i++) {
		hash ^= material.charCodeAt(i)
		hash = (hash * 0x01000193) >>> 0
	}
	return `c${hash.toString(16).padStart(8, '0')}`
}

export function nextRng(state: GameState): GameState {
	return { ...state, rng: { ...state.rng, counter: state.rng.counter + 1 } }
}

/** The printed operation of `card` that is resolving: the nearest OPERATION
 *  frame below the running node, when it is that card's own and not a granted
 *  ALT_PLAY. A choice asked for by anything else gets no operation. */
function resolvingOpOf(
	state: GameState,
	card: CardInstanceId,
): number | undefined {
	for (let i = state.stack.length - 1; i >= 0; i--) {
		const frame = state.stack[i]
		if (frame?.k !== 'OPERATION') continue
		return frame.card === card && frame.via === undefined
			? frame.opIndex
			: undefined
	}
	return undefined
}

/**
 * Halt on `choice` and install a resume frame that re-runs `node` with the
 * answered selection in `ctx.bindings[choiceId]` (see choices.ts). The
 * primitive checks `answered(ctx, key)` on re-entry.
 */
export function suspend(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	key: string,
	choice: ChoiceSeed,
	extra?: Record<string, JsonValue>,
	/** instruction pointer of the resume frame (a node that keeps a round
	 *  counter in `frame.ip`, e.g. REPEAT UP_TO / CHOOSE_N); default 0 */
	ip = 0,
): GameState {
	const id = makeChoiceId(state)
	const next = nextRng(state)
	// todo/07 §1: every choice carries the card whose effect caused it, or null
	// for phase-level prompts (rules/12 §12.14 — seat is the deciding player).
	const sourceCard = ctx.source === ('' as CardInstanceId) ? null : ctx.source
	const full: PendingChoice = {
		...choice,
		id,
		seat: ctx.actor,
		sourceCard,
	}
	const sourceDef =
		sourceCard === null ? undefined : state.cards[sourceCard]?.def
	if (sourceDef !== undefined) full.sourceDef = sourceDef
	const sourceOp =
		sourceCard === null ? undefined : resolvingOpOf(state, sourceCard)
	if (sourceOp !== undefined) full.sourceOp = sourceOp
	next.pendingChoice = full
	// The key -> choiceId link and any `extra` fields are written IN PLACE on
	// the shared ctx.bindings object, not on a per-frame clone. Every control
	// node (SEQ/MAY/PAY_THEN/IF/OPPONENT/...) pushes its children with the same
	// ctx, so an in-place binding write from a step (e.g. DISCARD bind) stays
	// visible to the sibling steps that run after the choice resumes — the
	// OFFERED/payoff "the card just discarded/gained is X" pattern (todo/13).
	// LET/FOR_EACH still copy deliberately, to scope their loop bindings.
	ctx.bindings[key] = id
	if (extra !== undefined) {
		for (const k of Object.keys(extra)) {
			const v = extra[k]
			if (v !== undefined) ctx.bindings[k] = v
		}
	}
	next.stack = [...next.stack, { k: 'EFFECT', node, ctx, ip }]
	return next
}

/** Has a suspended pick for `key` been answered yet? */
export function answered(ctx: EffectCtx, key: string): boolean {
	return ctx.bindings[key] !== undefined
}

/** Read the selection stored for `key` (see choices.ts). Throws if unanswered. */
export function answer<T = JsonValue>(ctx: EffectCtx, key: string): T {
	const choiceId = ctx.bindings[key]
	if (choiceId === undefined) throw new Error(`answer(${key}): not answered`)
	if (typeof choiceId !== 'string')
		throw new Error(`answer(${key}): expected a choice id`)
	return ctx.bindings[choiceId] as T
}

/** The single picked card behind a CHOOSE_CARDS-typed binding (the selection
 *  is always an array). Picker resume branches must unwrap it before treating
 *  the value as a bare CardInstanceId — a raw array would be coerced to a
 *  bogus zone key and, when re-published inside another choice (e.g.
 *  CHOOSE_DESTINATION.card), alias the stored selection and fail
 *  assertSerialisable. Resolves through the same choiceId indirection as
 *  `answer` (the bound value is a choice id, the selection sits at
 *  `bindings[choiceId]`), and tolerates a direct string binding. */
export function answerSingle(ctx: EffectCtx, key: string): CardInstanceId {
	const v = answer<unknown>(ctx, key)
	if (Array.isArray(v)) {
		const first = v[0]
		if (typeof first !== 'string')
			throw new Error(`answerSingle(${key}): empty picker selection`)
		return first as CardInstanceId
	}
	if (typeof v === 'string') return v as CardInstanceId
	throw new Error(`answerSingle(${key}): not a card id`)
}

// ===========================================================================
// Card picking (with auto-select)
// ===========================================================================
// ===========================================================================
// Amount resolution (todo/04 §10, todo/07) — the UP_TO auto-resolve policy
// ===========================================================================

export type AmountResult =
	| { kind: 'done'; state: GameState; amount: number }
	| { kind: 'suspended'; state: GameState }

export interface ResolveAmountOpts {
	prompt: string
	amount: Amount
	/**
	 * true when this UP_TO is a pure benefit with no downside → auto-resolve to
	 * `max` (todo/04 §10, todo/07 §2) so the game doesn't stop for a choice the
	 * player would always make the same way. false when a larger choice has a
	 * real cost (an opponent mirrors it, it spends per unit, ...) → suspend a
	 * CHOOSE_AMOUNT and let the player weigh it.
	 */
	pure: boolean
}

/**
 * Resolve a benefit Amount for `key`, halting only when the player genuinely
 * has something to choose:
 *   - non-UP_TO amounts → fixed value, no choice;
 *   - UP_TO with max === 0 → 0 (no pointless 0..0 prompt);
 *   - UP_TO on a pure benefit → max;
 *   - UP_TO on a benefit with a downside → a CHOOSE_AMOUNT (0..max).
 * Resumable: on re-entry through the suspended EFFECT frame the answered
 * amount is read back from ctx.bindings, so the primitive applies it.
 */
export function resolveAmount(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	key: string,
	opts: ResolveAmountOpts,
): AmountResult {
	if (answered(ctx, key)) {
		const choiceId = ctx.bindings[key]
		if (typeof choiceId !== 'string') {
			throw new Error(`resolveAmount(${key}): no choice id in bindings`)
		}
		const stored = ctx.bindings[choiceId]
		if (typeof stored !== 'number' || !Number.isInteger(stored)) {
			throw new Error(
				`resolveAmount(${key}): stored selection is not an integer amount`,
			)
		}
		return { kind: 'done', state, amount: stored }
	}
	const amount = opts.amount
	if (typeof amount !== 'object' || amount === null || amount.k !== 'UP_TO') {
		return { kind: 'done', state, amount: evalAmount(state, amount, ctx) }
	}
	const max = evalAmount(state, amount.max, ctx)
	if (max <= 0) return { kind: 'done', state, amount: 0 }
	if (opts.pure) return { kind: 'done', state, amount: max }
	const next = suspend(state, node, ctx, key, {
		k: 'CHOOSE_AMOUNT',
		prompt: opts.prompt,
		min: 0,
		max,
	})
	return { kind: 'suspended', state: next }
}

export type PickResult =
	| { kind: 'none' }
	| { kind: 'suspended'; state: GameState }
	| { kind: 'selected'; iids: CardInstanceId[] }

export interface PickOpts {
	prompt: string
	candidates: CardInstanceId[]
	min: number
	max: number
	/** Zone serialisation shown in the choice (for validation bookkeeping). */
	from: string
	/** Deliberately non-selectable candidates, surfaced greyed with a reason
	 *  (todo/07 §5); never part of the legal set for auto-select or validation. */
	disabled?: ChoiceDisabledCard[] | undefined
	/** Face-down (unseen) candidates — selectable, but the UI must not reveal
	 *  their faces yet (GAIN_CARD's "top of the deck (unknown)" option). */
	hidden?: CardInstanceId[] | undefined
	/** An empty selection declines (the UI offers a Decline button). */
	optional?: boolean | undefined
}

/**
 * Pick `min..max` of `candidates`. Auto-selects when exactly `min` candidates
 * exist (no gratuitous prompt); suspends with a CHOOSE_CARDS otherwise; returns
 * 'none' when fewer than `min` legal candidates exist.
 */
export function pickCards(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	key: string,
	opts: PickOpts,
): PickResult {
	if (answered(ctx, key)) {
		return { kind: 'selected', iids: answer<CardInstanceId[]>(ctx, key) }
	}
	const { candidates, min, max } = opts
	const disabledSet = new Set((opts.disabled ?? []).map((d) => d.iid))
	const legal = candidates.filter((iid) => !disabledSet.has(iid))
	if (legal.length < min) return { kind: 'none' }
	if (legal.length === min) return { kind: 'selected', iids: [...legal] }
	const next = suspend(state, node, ctx, key, {
		k: 'CHOOSE_CARDS',
		prompt: opts.prompt,
		candidates: [...candidates],
		disabled: opts.disabled,
		hidden: opts.hidden,
		min,
		max,
		from: opts.from,
		...(opts.optional === true ? { optional: true } : {}),
	})
	return { kind: 'suspended', state: next }
}

/** `onlyBound` (DISCARD / COST_DISCARD): "discard IT" / "discard one of
 *  THEM" — only a card bound under one of these names is legal (1PIC08,
 *  1PIC16). Unset = no restriction; set but nothing bound = nothing legal. */
export function onlyBoundAllows(
	ctx: EffectCtx,
	names: string[] | undefined,
	iid: CardInstanceId,
): boolean {
	if (names === undefined) return true
	return names.some((n) => ctx.bindings[n] === iid)
}

/** Convenience: choose exactly one card. Auto-selects a single candidate. */
export function pickSingle(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	key: string,
	opts: { prompt: string; candidates: CardInstanceId[]; from: string },
): PickResult {
	return pickCards(state, node, ctx, key, { ...opts, min: 1, max: 1 })
}

/** Record that `iid`'s WILDCARD trait now stands for `trait` (rules/12 §12.12). */
export function declareWildcard(
	state: GameState,
	iid: CardInstanceId,
	trait: TraitId,
): GameState {
	const card = state.cards[iid]
	if (!card || !cardIsWildcard(card)) return state
	return {
		...state,
		cards: { ...state.cards, [iid]: { ...card, wildcardAs: trait } },
	}
}

// ===========================================================================
// Candidate sets
// ===========================================================================

/** A cost node's `target: 'THIS'` ("dismiss this card to …" — 1SIS10):
 *  narrow its candidates to the resolving card itself (the duplicating card
 *  inside DUPLICATE, like every self-reference). */
export function thisOnly(
	iids: CardInstanceId[],
	node: { target?: 'THIS' | undefined },
	ctx: EffectCtx,
): CardInstanceId[] {
	if (node.target !== 'THIS') return iids
	const self = ctx.duplicating ?? ctx.source
	return iids.filter((iid) => iid === self)
}

/** Cards in `zone` (shared ref) or per-player zone resolved for `ctx.actor`. */
export function handCandidates(
	state: GameState,
	ctx: EffectCtx,
	filter?: CardFilter,
): CardInstanceId[] {
	return resolveQuery(state, { zones: [{ k: 'HAND', seat: 0 }], filter }, ctx)
}

/** A Captain (or Status) card is in play but can never be dismissed: like a
 *  LOCATION it can never enter your deck (rules/08 → dismiss gives that as the
 *  reason Locations are exempt), and it holds your Log and Away Team pool
 *  (card-rulings 042 — "dismiss an opponent ROMULAN" never hits SEL). */
export function isCaptainZone(k: string): boolean {
	return k === 'CAPTAIN' || k === 'STATUS'
}

/** Dismissible in-play cards: not Staging, not Locations, not the Captain /
 *  Status card (rules/08 → dismiss; card-rulings 042). */
export function dismissibleCandidates(
	state: GameState,
	ctx: EffectCtx,
	filter?: CardFilter,
	from: ZoneSpec = 'IN_PLAY',
): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const iid of resolveQuery(
		state,
		{ zones: [from], seat: 'SELF', filter },
		ctx,
	)) {
		if (!isInPlay(state, iid)) continue
		const card = state.cards[iid]!
		if (card.zone.k === 'STAGING') continue
		if (isCaptainZone(card.zone.k)) continue
		if (isLocationDef(cardDef(card.def))) continue
		out.push(iid)
	}
	return out
}

export function inPlayFiltered(
	state: GameState,
	ctx: EffectCtx,
	filter: CardFilter | undefined,
): CardInstanceId[] {
	return resolveQuery(state, { zones: ['IN_PLAY'], seat: 'SELF', filter }, ctx)
}

export function exhaustibleCandidates(
	state: GameState,
	ctx: EffectCtx,
	filter: CardFilter | undefined,
): CardInstanceId[] {
	return inPlayFiltered(state, ctx, filter).filter(
		(iid) => !state.cards[iid]!.exhausted,
	)
}

/** Exhausted in-play cards of the actor matching `filter` (COST_REFRESH). */
export function refreshableCandidates(
	state: GameState,
	ctx: EffectCtx,
	filter: CardFilter | undefined,
): CardInstanceId[] {
	return inPlayFiltered(state, ctx, filter).filter(
		(iid) => state.cards[iid]!.exhausted,
	)
}

/** COST_PUT source cards: `from` (default HAND; a list = any of those zones —
 *  "from your hand or Discard pile", 1CAR02), never a Location. */
export function putCandidates(
	state: GameState,
	ctx: EffectCtx,
	filter: CardFilter | undefined,
	from: ZoneSpec | ZoneSpec[] | undefined,
): CardInstanceId[] {
	if (from === undefined) return handCandidates(state, ctx, filter)
	const zones = Array.isArray(from) ? from : [from]
	return resolveQuery(state, { zones, seat: 'SELF', filter }, ctx).filter(
		(iid) => !isLocationDef(cardDef(state.cards[iid]!.def)),
	)
}

/** Ownership-preserving zone query for the shared helpers above. */
export function queryIn(
	state: GameState,
	query: Query,
	ctx: EffectCtx,
): CardInstanceId[] {
	return resolveQuery(state, query, ctx)
}

/**
 * Resolve a (query-shorthand) ZoneSpec to a concrete ZoneRef for `actor`.
 * Per-player specs use SELF-relative seats (todo/03 locked shape): `seat: 0`
 * means the actor, `seat: 1` the other player. The bare-string shorthands
 * ('ALL_OWNED', 'IN_PLAY', 'LOCATIONS', …) and BEAMED_TO are not single zones
 * and cannot be a concrete destination.
 */
export function specToRef(spec: ZoneSpec, actor: Seat): ZoneRef {
	if (typeof spec === 'string') {
		throw new Error(`specToRef: '${spec}' is not a concrete zone`)
	}
	if (spec.k === 'BEAMED') return spec
	if (spec.k === 'BEAMED_TO') {
		throw new Error(`specToRef: BEAMED_TO is a query, not a concrete zone`)
	}
	if (
		spec.k === 'MARKET_DECK' ||
		spec.k === 'MARKET_OFFER' ||
		spec.k === 'NEUTRAL_ZONE'
	)
		return spec
	// shared single zones
	switch (spec.k) {
		case 'ENCOUNTER_DECK':
		case 'INCIDENT_DECK':
		case 'LOCATION_DECK':
		case 'JUNK':
		case 'STARDATE_PILE':
		case 'BOX':
			return spec
		default:
			// per-player zone: SELF-relative seat
			return {
				k: spec.k,
				seat: spec.seat === 0 ? actor : otherSeat(actor),
			} as ZoneRef
	}
}

// ===========================================================================
// Events & log
// ===========================================================================

/** Push a GameEvent; NO-OP in probe mode (no reactions, docs/state-machine §5). */
export function emit(state: GameState, ev: GameEvent): GameState {
	if (state.probe === true) return state
	return { ...state, eventQueue: [...state.eventQueue, ev] }
}

export function addLog(state: GameState, entry: LogEntry): GameState {
	return { ...state, log: [...state.log, entry] }
}

/** A benefit that cannot resolve this turn → skip silently, log SKIPPED. */
export function skipBenefit(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	why: string,
): GameState {
	return addLog(state, {
		kind: 'SKIPPED',
		seat: ctx.actor,
		message: `${node.k}: ${why}`,
	})
}

/**
 * Fail upward (rules/12 §12.1): a cost that cannot be paid means the whole
 * current operation is not resolvable — pop everything above and including the
 * nearest OPERATION frame. Probe mode records a FAILED log entry so `probe()`
 * can report false.
 */
export function failOperation(state: GameState, reason: string): GameState {
	const stack = [...state.stack]
	let opIndex = -1
	for (let i = stack.length - 1; i >= 0; i--) {
		if (stack[i]!.k === 'OPERATION') {
			opIndex = i
			break
		}
	}
	const popped = opIndex >= 0 ? stack.slice(0, opIndex) : []
	let next: GameState = { ...state, stack: popped }
	// a failed ATTACK operation closes its "would be attacked" record too
	const failed = opIndex >= 0 ? stack[opIndex]! : undefined
	if (
		failed?.k === 'OPERATION' &&
		failed.attack !== undefined &&
		next.pending?.[failed.attack] !== undefined
	) {
		const pending = { ...next.pending }
		delete pending[failed.attack]
		next = { ...next, pending }
	}
	if (state.probe === true) {
		return addLog(next, { kind: 'FAILED', message: reason })
	}
	return next
}

// ===========================================================================
// Resources & actions
// ===========================================================================

/**
 * Glory substitution (rules/04 §4.3.2): 1 Glory = 1 Latinum, 1 Glory = 2
 * Dilithium for the paying player — gated by their rule modifiers (Inert
 * Dilithium disables the DIL rate; LAT substitution still works — rules/11
 * §11.6.1 #4). "No change is given."
 */
export function canSubstituteGlory(
	state: GameState,
	seat: Seat,
	res: ResourceId,
): boolean {
	return canSubstituteGloryFor(state, seat, res)
}

export function canPayResource(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): boolean {
	if (amount <= 0) return true
	const p = player(state, seat)
	if (res === 'GLO') return p.resources.GLO >= amount
	if (canSubstituteGlory(state, seat, res)) {
		const rate = res === 'DIL' ? 2 : 1
		return p.resources[res] + p.resources.GLO * rate >= amount
	}
	return p.resources[res] >= amount
}

/** Glory that paying `amount` of `res` would spend in place of `res` (the
 *  top-up `payResource` takes when the native pool falls short); 0 when the
 *  native tokens cover it or `res` is Glory itself. Prompts use it to say
 *  that an optional cost is really paid in Glory. */
export function glorySubstitutedFor(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): number {
	if (res === 'GLO' || amount <= 0) return 0
	const have = player(state, seat).resources[res]
	if (have >= amount || !canSubstituteGlory(state, seat, res)) return 0
	const rate = res === 'DIL' ? 2 : 1
	return Math.ceil((amount - have) / rate)
}

/**
 * Pay `amount` of `res`, using native tokens first and topping up with Glory
 * when the native pool falls short (1 GLO = 1 LAT, 1 GLO = 2 DIL, no change
 * given). The minimum-Glory plan is strictly dominant — Glory is worth 1 VP
 * each at game end — so no payment-planning choice is needed for a fixed
 * amount: spending the fewest Glory tokens is the only rational choice and is
 * what this does. (A genuine `UP_TO` "spend any amount" is the CHOOSE_AMOUNT
 * flow of todo/07.) Emits RESOURCE_SPENT.
 */
export function payResource(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): GameState {
	if (amount <= 0) return state
	const p = player(state, seat)
	if (!canPayResource(state, seat, res, amount)) {
		throw new Error(`payResource: ${seat} cannot afford ${amount} ${res}`)
	}
	const resources = { ...p.resources }
	const takeGlo = glorySubstitutedFor(state, seat, res, amount)
	if (res === 'GLO') {
		resources.GLO -= amount
	} else if (takeGlo > 0) {
		resources[res] = 0
		resources.GLO -= takeGlo
	} else {
		resources[res] -= amount
	}
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, resources } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return emit({ ...state, players }, { k: 'RESOURCE_SPENT', seat, res, amount })
}

/** Transfer market ownership to `seat` and take the card (top of their Draw
 *  deck, provisional placement — the DECK_TOP/DISCARD choice is todo/07). */
export function setOwner(
	state: GameState,
	iid: CardInstanceId,
	seat: Seat,
): GameState {
	const card = state.cards[iid]
	if (!card) return state
	if (card.owner === seat) return state
	return {
		...state,
		cards: { ...state.cards, [iid]: { ...card, owner: seat } },
	}
}

/** Gain a faceup Market card: ownership, resource tokens on it (Glory from the
 *  card, Dilithium etc. into the pool — via 'MARKET', so an 1BUR02
 *  redirect does NOT apply, rules/11 §11.6.1 #3 exception), then move to hand. */
export function gainMarketCard(
	state: GameState,
	iid: CardInstanceId,
	seat: Seat,
): GameState {
	const tokens = state.cards[iid]?.resourceTokens ?? {}
	let next = state
	for (const [res, amt] of Object.entries(tokens)) {
		if (amt !== undefined && amt > 0)
			next = gainResource(next, seat, res as ResourceId, amt, { via: 'MARKET' })
	}
	next = setOwner(next, iid, seat)
	return moveCard(next, iid, { k: 'DRAW', seat })
}

/** Glory tokens sitting on the topmost Stardate card when it is refilled
 *  (rules/03 §3.6.4 #2). The per-card printed number is sourced at setup;
 *  this is the engine's mid-effect refill constant. todo/13 pins the data. */
export const STARDATE_REFILL_GLORY = 3

/**
 * Gain `amount` of `res` for `seat`. Rules/04 §4.3.1 and rules/12 §12.9:
 *   - Glory comes from the topmost Stardate card's Glory tokens; once a
 *     Resolution is triggered (or no Stardate card is current) it comes from
 *     the supply instead;
 *   - emptying a Stardate card triggers the mid-effect handoff immediately
 *     (pass it to the inactive player, refill the next card's Glory, continue);
 *   - DIL/LAT come from the supply (direct pool increment).
 * Rule modifiers may redirect the gain onto a parked-token card (Inert
 * Dilithium, rules/11 §11.6.1 #3) unless `via` exempts it.
 */
export function gainResource(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
	opts?: { via?: GainCtx['via']; fromSupply?: boolean | undefined },
): GameState {
	if (amount <= 0) return state
	const via = opts?.via ?? 'OPERATION'
	const gainCtx: GainCtx = { via }

	const redir = gainRedirect(state, seat, res, amount, gainCtx)
	if (redir !== null) {
		const target = state.cards[redir.to]
		if (target) {
			const tokens: GameState['cards'][string]['resourceTokens'] = {
				...target.resourceTokens,
				[res]: (target.resourceTokens[res] ?? 0) + redir.amount,
			}
			const next = {
				...state,
				cards: {
					...state.cards,
					[redir.to]: { ...target, resourceTokens: tokens },
				},
			}
			return emit(next, {
				k: 'RESOURCE_GAINED',
				seat,
				res,
				amount: redir.amount,
			})
		}
	}

	// "from the supply (not the Stardate card)" (1SEL/M3): straight to the pool
	if (res === 'GLO' && opts?.fromSupply !== true)
		return gainGlory(state, seat, amount)
	return gainPool(state, seat, res, amount)
}

/** Direct supply -> pool increment (DIL/LAT, or Glory with no stardate). */
function gainPool(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? {
					...pl,
					resources: { ...pl.resources, [res]: pl.resources[res] + amount },
				}
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return emit(
		{ ...state, players },
		{ k: 'RESOURCE_GAINED', seat, res, amount },
	)
}

/** Glory via the Stardate pile (rules/12 §12.9), with the mid-effect handoff.
 *  Cadet Training: all Glory gained comes from the supply (rules/10 §10.2 #1) —
 *  only the Clean-up placement still draws off the Stardate cards (§10.3). */
function gainGlory(state: GameState, seat: Seat, amount: number): GameState {
	if (state.mode === 'CADET') return gainPool(state, seat, 'GLO', amount)
	let next = state
	let remaining = amount
	while (remaining > 0) {
		if (next.resolutionTriggered) break // Resolution: supply only
		const top = next.stardates.pile[0]
		if (top === undefined) break // no Stardate card: supply
		if (next.stardates.gloryOnTop <= 0) {
			next = handoffStardate(next, seat)
			continue
		}
		const take = Math.min(remaining, next.stardates.gloryOnTop)
		remaining -= take
		const gloryOnTop = next.stardates.gloryOnTop - take
		if (gloryOnTop > 0) {
			next = { ...next, stardates: { ...next.stardates, gloryOnTop } }
			break // still Glory left; the gain is satisfied
		}
		// card emptied by this gain -> handoff immediately, continue gaining
		next = { ...next, stardates: { ...next.stardates, gloryOnTop: 0 } }
		next = handoffStardate(next, seat)
	}
	return gainPool(next, seat, 'GLO', amount)
}

/** The emptied-current-Stardate handoff (rules/03 §3.6.4): pass the card to the
 *  inactive player (their `heldStardate`), refill the next card's Glory; the
 *  final card instead triggers a Resolution and is not handed over. Exported
 *  for the phase machine, whose Clean-up Glory placement performs the same
 *  handoff when it empties the current Stardate card (todo/06 §2.4).
 *
 *  Cadet Training (rules/10 §10.3): the virtual opponent never takes a turn,
 *  so an emptied card is handed to the SAME player, who resolves it at the
 *  beginning of their next Clean-up ("turn 6 beginning of your Clean-up …
 *  wipe the Market …"). The refill uses the NEW top card's printed Glory
 *  (`stardates.glories`), which both Cadet cards print as 5 — the data-driven
 *  successor to the flat STARDATE_REFILL_GLORY. */
export function handoffStardate(state: GameState, seat: Seat): GameState {
	const glories = state.stardates.glories
	if (state.stardates.pile.length <= 1) {
		// The final Stardate card is NOT handed over and NOT refilled — it stays
		// in place, emptied, as the marker that a Resolution was triggered
		// (rules/03 §3.6.4, rules/12 §12.9).
		return {
			...state,
			resolutionTriggered: true,
			stardates: {
				pile: state.stardates.pile.slice(0, 1),
				gloryOnTop: 0,
				glories: glories === undefined ? undefined : [glories[0] ?? 0],
			},
		}
	}
	const emptied = state.stardates.pile[0]!
	const recipient = state.mode === 'CADET' ? seat : otherSeat(seat)
	const players = state.players.map((pl) =>
		pl.seat === recipient ? { ...pl, heldStardate: emptied } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	const nextGlories = glories === undefined ? undefined : glories.slice(1)
	const refill =
		nextGlories !== undefined && nextGlories.length > 0
			? nextGlories[0]!
			: STARDATE_REFILL_GLORY
	return {
		...state,
		players,
		stardates: {
			pile: state.stardates.pile.slice(1),
			gloryOnTop: refill,
			glories: nextGlories,
		},
	}
}

/**
 * Steal `amount` of `res` from `from` to `to`. Clamped to what the victim
 * actually has (parked tokens first, then pool). Emits NO RESOURCE_GAINED
 * event — stealing is not gaining (rules/04 §4.3.3, rules/12 §12.8) — and
 * consults the victim's onStolenFrom modifiers so parked Dilithium is taken
 * first (1BUR02, rules/11 §11.6.1 #7).
 */
export function stealResource(
	state: GameState,
	from: Seat,
	to: Seat,
	res: ResourceId,
	amount: number,
): GameState {
	if (amount <= 0) return state
	// "Your {DIL} cannot be stolen" (1BUR03)
	if (stealProtected(state, from, res))
		return addLog(state, {
			kind: 'SKIPPED',
			seat: to,
			message: `${res} cannot be stolen`,
		})
	if (isCadetOpponent(state.mode, from)) {
		// rules/10 §10.2 #3: the virtual opponent permanently holds 1 of every
		// resource — a steal takes exactly that 1 and never removes anything.
		const take = Math.min(amount, opponentResource(res))
		if (take <= 0)
			return addLog(state, {
				kind: 'EVENT',
				seat: to,
				message: `steals ${amount} ${res}`,
			})
		const next: GameState = {
			...state,
			players: bumpPool(state, to, res, take),
		}
		return addLog(next, {
			kind: 'EVENT',
			seat: to,
			message: `steals ${amount} ${res}`,
		})
	}
	let next = state
	let remaining = amount

	// 1. parked sources the victim's modifiers designate (1BUR02 card)
	const sources = stolenSources(state, from, res, amount)
	for (const src of sources) {
		if (remaining <= 0) break
		const card = next.cards[src.iid]
		const parked = card?.resourceTokens?.[res] ?? 0
		const take = Math.min(remaining, src.amount, parked)
		if (take <= 0) continue
		remaining -= take
		next = {
			...next,
			cards: {
				...next.cards,
				[src.iid]: {
					...card!,
					resourceTokens: { ...card!.resourceTokens, [res]: parked - take },
				},
			},
			players: bumpPool(next, to, res, take),
		}
	}

	// 2. the victim's pool
	if (remaining > 0) {
		const victim = player(next, from)
		const take = Math.min(remaining, victim.resources[res])
		const players = next.players.map((pl) => {
			if (pl.seat === from)
				return {
					...pl,
					resources: { ...pl.resources, [res]: victim.resources[res] - take },
				}
			return pl
		}) as [GameState['players'][0], GameState['players'][1]]
		next = { ...next, players }
		remaining -= take
		if (take > 0) next = { ...next, players: bumpPool(next, to, res, take) }
	}

	void remaining
	return addLog(next, {
		kind: 'EVENT',
		seat: to,
		message: `steals ${amount} ${res}`,
	})
}

/** Pool increment without any event (internal helper for steal). Returns the
 *  player tuple so callers can splice it into the next state. */
function bumpPool(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): [GameState['players'][0], GameState['players'][1]] {
	const p = player(state, seat)
	return state.players.map((pl) =>
		pl.seat === seat
			? {
					...pl,
					resources: { ...pl.resources, [res]: p.resources[res] + amount },
				}
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
}

/** Record that the resolving operation paid `res` as a cost: the nearest
 *  OPERATION frame on the stack is the operation whose effect is running
 *  (DUPLICATE pushes plain EFFECT frames, so a duplicated cost counts for the
 *  duplicating operation). Read at the operation's completion to emit
 *  OPERATION_RESOLVED (1SIS24 "an operation with a {LAT} cost"). */
export function markOperationPaid(
	state: GameState,
	res: ResourceId,
): GameState {
	for (let i = state.stack.length - 1; i >= 0; i--) {
		const f = state.stack[i]!
		if (f.k !== 'OPERATION') continue
		if (f.paid?.includes(res) === true) return state
		const stack = [...state.stack]
		stack[i] = { ...f, paid: [...(f.paid ?? []), res] }
		return { ...state, stack }
	}
	return state
}

/** Benefit-phrased spend (SPEND_RESOURCE): pay and record. */
export function spendResource(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): GameState {
	return payResource(state, seat, res, amount)
}

export function spendAction(state: GameState, seat: Seat): GameState {
	const p = player(state, seat)
	if (p.actions.available <= 0)
		throw new Error(`spendAction: ${seat} has no available action`)
	const players = state.players.map((pl) =>
		pl.seat === seat
			? {
					...pl,
					actions: {
						available: pl.actions.available - 1,
						spent: pl.actions.spent + 1,
					},
				}
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	const next = { ...state, players }
	return emit(next, { k: 'ACTION_SPENT', seat })
}

export function gainAction(
	state: GameState,
	seat: Seat,
	amount: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? {
					...pl,
					actions: { ...pl.actions, available: pl.actions.available + amount },
				}
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	const next = { ...state, players }
	return emit(next, { k: 'ACTION_GAINED', seat, amount })
}

/** Advance a specialty track, clamped at 15 (rules/07 §7.1). */
export function advanceSpecialty(
	state: GameState,
	seat: Seat,
	specialty: SpecialtyId,
	amount: number,
): GameState {
	const p = player(state, seat)
	const cur = p.specialties[specialty]
	const nextVal = Math.max(
		0,
		Math.min(15, cur + Math.max(0, Math.floor(amount))),
	)
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, specialties: { ...pl.specialties, [specialty]: nextVal } }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	const next = { ...state, players }
	return emit(next, {
		k: 'SPECIALTY_ADVANCED',
		seat,
		specialty,
		amount: nextVal - cur,
	})
}

// ===========================================================================
// Cost resolvability (rules/12 §12.1 + todo/04 §4)
// ===========================================================================

/**
 * canPay for a single cost leaf. Requirements:
 *   - choice-bearing costs verify AT LEAST ONE legal selection exists
 *     ("discard a WEAPON" ≠ "holds some card");
 *   - COST_RESOURCE honours Glory substitution.
 */
export function costCanResolve(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): boolean {
	switch (node.k) {
		case 'COST_RESOURCE':
			return canPayResource(
				state,
				ctx.actor,
				node.res,
				evalAmount(state, node.amount, ctx),
			)
		case 'COST_ACTION':
			return player(state, ctx.actor).actions.available > 0
		case 'COST_DISCARD': {
			// exceptBound: "discard a different card" than the bound one (1PIC07);
			// onlyBound: "discard IT" — only the bound card (1PIC08)
			const except =
				node.exceptBound !== undefined
					? ctx.bindings[node.exceptBound]
					: undefined
			return (
				thisOnly(handCandidates(state, ctx, node.filter), node, ctx).filter(
					(iid) => iid !== except && onlyBoundAllows(ctx, node.onlyBound, iid),
				).length >= node.count
			)
		}
		case 'COST_PUT':
			return (
				thisOnly(putCandidates(state, ctx, node.filter, node.from), node, ctx)
					.length >= node.count
			)
		case 'COST_EXHAUST':
			return (
				thisOnly(exhaustibleCandidates(state, ctx, node.filter), node, ctx)
					.length >= 1
			)
		case 'COST_REFRESH':
			return (
				thisOnly(refreshableCandidates(state, ctx, node.filter), node, ctx)
					.length >= 1
			)
		case 'COST_REMOVE_AWAY_TEAM': {
			const locs =
				node.from !== undefined ? resolveQuery(state, node.from, ctx) : []
			// The virtual cadet can always "remove" its one virtual Away Team
			// (rules/10 §10.2 #3).
			if (isCadetOpponent(state.mode, ctx.actor))
				return node.count <= opponentAwayTeamsAt('')
			// distinct: one token from each of `count` different Locations (1SHR16)
			if (node.distinct === true)
				return (
					locs.filter((iid) => (state.awayTeamsAt[iid]?.[ctx.actor] ?? 0) > 0)
						.length >= node.count
				)
			return awayTeamTotal(state, ctx.actor, locs) >= node.count
		}
		case 'COST_TAKE_INCIDENT':
			return zonesOf(state, { k: 'INCIDENT_DECK' }).length >= node.count
		case 'COST_DISMISS':
			return (
				thisOnly(
					dismissibleCandidates(state, ctx, node.filter, node.from),
					node,
					ctx,
				).length >= node.count
			)
		case 'COST_LOG_THIS':
			return true
		case 'COST_REQUIRE':
			return evalPredicate(state, node.cond, ctx)
		case 'COST_RETURN_INCIDENT':
			return (
				handCandidates(state, ctx, node.filter).filter(
					(iid) => cardDef(state.cards[iid]!.def).suit === 'INCIDENT',
				).length >= node.count
			)
		case 'COST_RECALL':
			return (
				thisOnly(
					resolveQuery(
						state,
						{
							zones: [node.from ?? 'IN_PLAY'],
							seat: 'SELF',
							filter: node.filter,
						},
						ctx,
					),
					node,
					ctx,
				).length >= 1
			)
		case 'COST_LOG': {
			const zones: ZoneSpec[] =
				node.from === undefined
					? ['IN_PLAY']
					: Array.isArray(node.from)
						? node.from
						: [node.from]
			return (
				thisOnly(
					resolveQuery(
						state,
						{ zones, seat: 'SELF', filter: node.filter },
						ctx,
					),
					node,
					ctx,
				).length >= 1
			)
		}
		case 'COST_BEAM': {
			const zones: ZoneSpec[] =
				node.from === undefined
					? [{ k: 'HAND', seat: 0 }]
					: Array.isArray(node.from)
						? node.from
						: [node.from]
			const candidates = thisOnly(
				resolveQuery(state, { zones, seat: 'SELF', filter: node.filter }, ctx),
				node,
				ctx,
			).filter((iid) => !isLocationDef(cardDef(state.cards[iid]!.def)))
			return (
				candidates.length >= node.count &&
				resolveQuery(state, node.to, ctx).length >= 1
			)
		}
		default:
			return false
	}
}

function awayTeamTotal(
	state: GameState,
	seat: Seat,
	locIids: CardInstanceId[],
): number {
	let total = 0
	for (const iid of locIids) {
		const counts = state.awayTeamsAt[iid]
		if (counts) total += counts[seat] ?? 0
	}
	return total
}

export { otherSeat, zonesOf, inPlayCards, moveCard, cardDef, resolveQuery }
export type { Query, ZoneRef, CardFilter }
