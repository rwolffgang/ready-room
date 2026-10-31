// The 4-phase turn loop (todo/06 §2, rules/03, docs/state-machine.md §1).
//
// Phases push PHASE_STEP frames onto the SAME stack the resolver uses. A
// resupply operation can open a REACTION window and that window must be able
// to interrupt — so the phase machine never runs "outside" the stack machine;
// `executeOne` (resolver/stack.ts) delegates PHASE_STEP frames here, and every
// phase choice resumes through the same PHASE_STEP frame that asked (the
// selection lands in `frame.ctx.bindings`, see resolver/choices.ts).
//
//   RESUPPLY  →  CONTROL  →  ACTION  →  CLEANUP  →  (next player) RESUPPLY
//
// RESUPPLY and CONTROL are automatic (plus choices). ACTION is intent-driven.
// CLEANUP runs six substeps (OPERATIONS → STARDATE → GLORY_PLACEMENT → [CADET
// WIPE] → DISCARD → DRAW → REFRESH), then hands the turn over via the same
// RESUPPLY entry. base action budget and resolution turn bookkeeping live here
// (todo/06 §3).

import type { EffectCtx, Frame, GameState, OperationRef, Phase } from './state'
import {
	player,
	otherSeat,
	zonesOf,
	zoneProps,
	moveCard,
	inPlayCards,
	owned,
} from './state'
import type { Seat } from './resolver/queries'
import { cardDef } from './cards'
import { run } from './resolver/stack'
import type { Effect } from './resolver/nodes'
import type { CardInstanceId } from './ids'
import type { OperationType } from '../data/ids'
import { isSecured } from './queries/board'
import {
	marketOffers as boardMarketOffers,
	refillMarket as boardRefillMarket,
	refillNeutralZone as boardRefillNeutralZone,
} from './market'
import {
	effectiveHandSize,
	cleanupGloryEffect,
	dropTurnModifiers,
} from './modifiers'
import { drawCards } from './resolver/primitives/draw'
import {
	emit,
	handoffStardate,
	makeChoiceId,
	nextRng,
} from './resolver/runtime'
import type { ChoiceSeed, PendingChoice } from './resolver/choices'
import { SKIP_LOCATION } from './resolver/choices'

const phaseCtx = (actor: Seat): EffectCtx => ({
	actor,
	source: '' as CardInstanceId,
	bindings: {},
})

/** Push a PHASE_STEP frame and record the phase on the state. */
function pushStep(state: GameState, phase: Phase, ctx: EffectCtx): GameState {
	const frame: Frame = { k: 'PHASE_STEP', phase, ctx }
	return { ...state, phase, stack: [...state.stack, frame] }
}

/** A phase-machine choice: set pendingChoice and install a resume PHASE_STEP
 *  whose ctx holds the `key → choiceId` binding (same contract as the effect
 *  layer's suspend()). */
function phaseSuspend(
	state: GameState,
	seat: Seat,
	phase: Phase,
	ctx: EffectCtx,
	key: string,
	choice: ChoiceSeed,
): GameState {
	const id = makeChoiceId(state)
	const next = nextRng(state)
	// Defensive copy: a published choice must never alias a live zone/game
	// array (assertSerialisable treats shared references as a serialisation
	// hazard — clean-up's DISCARD offers, for example, start from the HAND zone
	// array). The choice is plain JSON, so a structured clone is exact.
	// todo/07 §1: phase-level choices carry no source card; the deciding seat
	// and the deterministic id are stamped here (same contract as suspend()).
	const full: PendingChoice = {
		...structuredClone(choice),
		id,
		seat,
		sourceCard: ctx.source === ('' as CardInstanceId) ? null : ctx.source,
	}
	next.pendingChoice = full
	next.stack = [
		...next.stack,
		{
			k: 'PHASE_STEP',
			phase,
			ctx: { ...ctx, bindings: { ...ctx.bindings, [key]: id } },
		},
	]
	return next
}

// ---------------------------------------------------------------------------
// Public phase surface
// ---------------------------------------------------------------------------

/** Start (or hand over to) a player's turn by pushing the RESUPPLY step onto
 *  the stack (rules/03 §3.3). Frame-push only — the stack machine (or the
 *  intent layer's `runCollecting`) executes the automatic part to a halt. */
export function beginTurnStep(state: GameState): GameState {
	if (state.result !== null) return state
	const seat = state.activeSeat
	const phase: Phase = { k: 'RESUPPLY', pending: [] }
	return pushStep(state, phase, phaseCtx(seat))
}

/** Start (or hand over to) a player's turn and run to a halt. */
export function beginTurn(state: GameState): GameState {
	return run(beginTurnStep(state))
}

/** User-driven phase boundary — frame-push only: RESUPPLY → CONTROL → ACTION →
 *  CLEANUP. The intent layer wraps this in `runCollecting`. */
export function advancePhaseStep(state: GameState): GameState {
	switch (state.phase.k) {
		case 'RESUPPLY':
			return pushStep(state, { k: 'CONTROL' }, phaseCtx(state.activeSeat))
		case 'CONTROL':
			// taking control is a *may* — treating the boundary as Skip is legal
			return pushStep(state, { k: 'ACTION' }, phaseCtx(state.activeSeat))
		case 'ACTION':
			return pushStep(
				state,
				{ k: 'CLEANUP', sub: 'OPERATIONS' },
				phaseCtx(state.activeSeat),
			)
		case 'CLEANUP':
			throw new Error('advancePhase: CLEANUP advances through its own substeps')
		default:
			throw new Error(
				`advancePhase: cannot advance from phase ${state.phase.k}`,
			)
	}
}

/** User-driven phase boundary — run to a halt. */
export function advancePhase(state: GameState): GameState {
	return run(advancePhaseStep(state))
}

/** One PHASE_STEP frame — invoked by the stack machine's executeOne. */
export function executePhaseStep(
	state: GameState,
	frame: Frame & { k: 'PHASE_STEP' },
): GameState {
	const ctx = frame.ctx ?? phaseCtx(state.activeSeat)
	switch (frame.phase.k) {
		case 'RESUPPLY':
			return stepResupply(state, frame, ctx)
		case 'CONTROL':
			return stepControl(state, ctx)
		case 'ACTION':
			return state
		case 'CLEANUP':
			return stepCleanup(state, frame, ctx)
		case 'SETUP':
			return state
		case 'GAME_OVER':
			// the "Before scoring" SPECIALs have resolved: score now
			return state.result === null
				? { ...state, result: { kind: 'FINAL_SCORING' } }
				: state
	}
}

/** The Resolution's final scoring (rules/07 §7.4). "SPECIAL: Before scoring,
 *  …" operations (trigger BEFORE_SCORING — 1PER22) of every card a
 *  player owns resolve first, the active player's first; a GAME_OVER
 *  PHASE_STEP beneath them then sets the FINAL_SCORING result. Without any
 *  such operation the result is set at once. (A Burn ends the game on the
 *  spot and is decided by INCIDENT counts — no "before scoring" there.) */
function beginFinalScoring(state: GameState): GameState {
	const ops: Frame[] = []
	for (const seat of [state.activeSeat, otherSeat(state.activeSeat)]) {
		for (const iid of owned(state, seat)) {
			cardDef(state.cards[iid]!.def).operations.forEach((op, opIndex) => {
				if (op.type !== 'SPECIAL' || op.trigger?.on !== 'BEFORE_SCORING') return
				ops.push({
					k: 'OPERATION',
					card: iid,
					opIndex,
					ctx: { actor: seat, source: iid, bindings: {} },
					phase: 0,
				})
			})
		}
	}
	if (ops.length === 0) return { ...state, result: { kind: 'FINAL_SCORING' } }
	return {
		...state,
		stack: [
			...state.stack,
			{
				k: 'PHASE_STEP',
				phase: { k: 'GAME_OVER' },
				ctx: phaseCtx(state.activeSeat),
			},
			// LIFO: the first collected resolves first
			...ops.reverse(),
		],
	}
}

/** Neutral LOCATIONs `seat` can take control of this Control Step: ≥3 tokens
 *  and ≥2 more than the opponent (rules/03 §3.4.1, rules/12 §12.15). */
export function securedLocations(
	state: GameState,
	seat: Seat,
): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const slot of [0, 1, 2] as const) {
		for (const iid of zonesOf(state, { k: 'NEUTRAL_ZONE', slot })) {
			if (isSecured(state, iid, seat)) out.push(iid)
		}
	}
	return out
}

/** RESUPPLY (rules/03 §3.3) or CLEAN-UP operation collection: every operation
 *  of the type on the player's in-play cards, excluding beamed cards. Staging
 *  Area cards are included for CLEAN-UP (rules/12 §12.3). */
export function collectStepOperations(
	state: GameState,
	seat: Seat,
	type: OperationType,
): OperationRef[] {
	const out: OperationRef[] = []
	for (const iid of inPlayCards(state, seat)) {
		const card = state.cards[iid]!
		if (card.zone.k === 'BEAMED') continue // beamed: operations unavailable
		cardDef(card.def).operations.forEach((op, opIndex) => {
			if (op.type === type) out.push({ card: iid, opIndex, seat })
		})
	}
	return out
}

// ---------------------------------------------------------------------------
// RESUPPLY (rules/03 §3.3)
// ---------------------------------------------------------------------------

function stepResupply(
	state: GameState,
	_frame: Frame & { k: 'PHASE_STEP' },
	ctx: EffectCtx,
): GameState {
	const seat = ctx.actor
	const key = '$res.order'
	if (answered(ctx, key)) {
		const order = answer<OperationRef[]>(ctx, key)
		return scheduleOperations(state, order, { k: 'CONTROL' }, ctx)
	}
	const pending = collectStepOperations(state, seat, 'RESUPPLY')
	if (pending.length === 0)
		return pushStep(state, { k: 'CONTROL' }, phaseCtx(seat))
	if (pending.length === 1)
		return scheduleOperations(state, pending, { k: 'CONTROL' }, ctx)
	// Offer an "auto — order doesn't matter" shortcut when the engine can prove
	// independence (todo/06 §2.1): a conservative prover that auto-resolves
	// purely-GAIN/DRAW pendings, and only then asks for the order.
	if (pending.every((r) => isAutoResolvable(state, r))) {
		return scheduleOperations(state, pending, { k: 'CONTROL' }, ctx)
	}
	return phaseSuspend(state, seat, { k: 'RESUPPLY', pending }, ctx, key, {
		k: 'ORDER_OPERATIONS',
		prompt: 'Resupply — choose the order',
		pending,
	})
}

// ---------------------------------------------------------------------------
// CONTROL (rules/03 §3.4)
// ---------------------------------------------------------------------------

function stepControl(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const key = '$ctrl.loc'
	if (answered(ctx, key)) {
		const sel = answer<string>(ctx, key)
		if (sel === SKIP_LOCATION)
			return pushStep(state, { k: 'ACTION' }, phaseCtx(seat))
		const loc = sel as CardInstanceId
		if (answered(ctx, '$ctrl.takeDone')) {
			// resume #2: TAKE_CONTROL resolved — refill the Neutral Zone, advance.
			const refilled = boardRefillNeutralZone(state)
			return pushStep(refilled, { k: 'ACTION' }, phaseCtx(seat))
		}
		return runTakeControl(state, seat, ctx, loc)
	}
	const secured = securedLocations(state, seat)
	if (secured.length === 0)
		return pushStep(state, { k: 'ACTION' }, phaseCtx(seat))
	return phaseSuspend(state, seat, { k: 'CONTROL' }, ctx, key, {
		k: 'CHOOSE_LOCATION',
		prompt: 'Take control of one secured Location? (Skip declines)',
		candidates: [...secured, SKIP_LOCATION],
	})
}

/** Push TAKE_CONTROL for the chosen Location, with a CONTROL continuation that
 *  refills the Neutral Zone once it completes (rules/03 §3.4.2 #4). This does
 *  NOT fire the Location's RESUPPLY operation — Resupply already passed
 *  (rules/12 §12.18) — regression-tested in phases.test.ts. */
function runTakeControl(
	state: GameState,
	seat: Seat,
	ctx: EffectCtx,
	loc: CardInstanceId,
): GameState {
	const locCard = state.cards[loc]
	if (!locCard || locCard.zone.k !== 'NEUTRAL_ZONE') {
		throw new Error(
			`stepControl: ${loc} is not a neutral Location in the Neutral Zone`,
		)
	}
	const zone = locCard.zone
	// Phases pre-gates with `securedLocations`; the TAKE_CONTROL primitive's own
	// `requireSecured` filter (away teams only) must NOT re-filter here, or a
	// ship-only secured Location would be silently skipped (rules/03 §3.4).
	const effect: Effect = {
		k: 'TAKE_CONTROL',
		target: { zones: [{ k: 'NEUTRAL_ZONE', slot: zone.slot }] },
	}
	const resumedCtx: EffectCtx = {
		...ctx,
		bindings: { ...ctx.bindings, '$ctrl.takeDone': true },
	}
	const continuation: Frame = {
		k: 'PHASE_STEP',
		phase: { k: 'CONTROL' },
		ctx: resumedCtx,
	}
	const op: Frame = {
		k: 'EFFECT',
		node: effect,
		ctx: { actor: seat, source: loc, bindings: {} },
		ip: 0,
	}
	return { ...state, stack: [...state.stack, continuation, op] }
}

// ---------------------------------------------------------------------------
// CLEANUP (rules/03 §3.6)
// ---------------------------------------------------------------------------

function stepCleanup(
	state: GameState,
	frame: Frame & { k: 'PHASE_STEP' },
	ctx: EffectCtx,
): GameState {
	if (frame.phase.k !== 'CLEANUP') return state
	const sub = frame.phase.sub
	switch (sub) {
		case 'OPERATIONS':
			return cleanupOperations(state, ctx)
		case 'STARDATE':
			return cleanupStardate(state, ctx)
		case 'GLORY_PLACEMENT':
			return cleanupGloryPlacement(state, ctx)
		case 'GLORY_TAKEN':
			return cleanupGloryTaken(state, ctx)
		case 'CADET_WIPE':
			return cleanupCadetWipe(state, ctx)
		case 'DISCARD':
			return cleanupDiscard(state, ctx)
		case 'DRAW':
			return cleanupDraw(state, ctx)
		case 'REFRESH':
			return cleanupRefresh(state, ctx)
	}
}

/** §3.6.1 — every CLEAN-UP operation in play (Staging included), in an order
 *  of your choosing; same auto-order convention as Resupply. */
function cleanupOperations(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const key = '$cl.order'
	if (answered(ctx, key)) {
		const order = answer<OperationRef[]>(ctx, key)
		return scheduleOperations(
			state,
			order,
			{ k: 'CLEANUP', sub: 'STARDATE' },
			ctx,
		)
	}
	const pending = collectStepOperations(state, seat, 'CLEANUP')
	if (pending.length === 0)
		return pushStep(state, { k: 'CLEANUP', sub: 'STARDATE' }, phaseCtx(seat))
	if (pending.length === 1)
		return scheduleOperations(
			state,
			pending,
			{ k: 'CLEANUP', sub: 'STARDATE' },
			ctx,
		)
	if (pending.every((r) => isAutoResolvable(state, r))) {
		return scheduleOperations(
			state,
			pending,
			{ k: 'CLEANUP', sub: 'STARDATE' },
			ctx,
		)
	}
	return phaseSuspend(
		state,
		seat,
		{ k: 'CLEANUP', sub: 'OPERATIONS' },
		ctx,
		key,
		{
			k: 'ORDER_OPERATIONS',
			prompt: 'Clean-up — choose the order',
			pending,
		},
	)
}

/** §3.6.2 — resolve the held Stardate card's effect (wipe the Market, possibly
 *  the Neutral Zone), return it to the box, clear heldStardate. */
function cleanupStardate(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const nextPhase = (s: GameState): Phase =>
		s.mode === 'CADET'
			? { k: 'CLEANUP', sub: 'CADET_WIPE' }
			: { k: 'CLEANUP', sub: 'GLORY_PLACEMENT' }
	const held = player(state, seat).heldStardate
	if (held === null) return pushStep(state, nextPhase(state), phaseCtx(seat))
	const sd = held
	const ops = cardDef(state.cards[sd]!.def).operations
	const wipeIdx = ops.findIndex((o) => o.type === 'CLEANUP')
	let s = clearHeldStardate(state, seat)
	s = moveCard(s, sd, { k: 'BOX' }) // "return the resolved Stardate card to the box"
	if (wipeIdx < 0) return pushStep(s, nextPhase(s), phaseCtx(seat))
	const continuation: Frame = {
		k: 'PHASE_STEP',
		phase: nextPhase(s),
		ctx: phaseCtx(seat),
	}
	const op: Frame = {
		k: 'OPERATION',
		card: sd,
		opIndex: wipeIdx,
		ctx: { actor: seat, source: sd, bindings: {} },
		phase: 0,
	}
	return { ...s, stack: [...s.stack, continuation, op] }
}

/** §3.6.3 — move 1 Glory from the current Stardate card onto a chosen Market
 *  card (from the supply once a Resolution was triggered; through the
 *  cleanupGloryPlacement modifier hook when one overrides it). The token
 *  leaves the Stardate card only once the placement has resolved
 *  (GLORY_TAKEN), so the Stardate does not change while the player is still
 *  choosing the Market card. */
function cleanupGloryPlacement(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const repl = cleanupGloryEffect(state, seat) // BUR replaces the placement (rules/11 §11.6.1 #2)
	const effect: Effect = repl ?? {
		k: 'PLACE_RESOURCE_ON_MARKET',
		res: 'GLO',
		amount: 1,
	}
	const continuation: Frame = {
		k: 'PHASE_STEP',
		phase: { k: 'CLEANUP', sub: 'DISCARD' },
		ctx: phaseCtx(seat),
	}
	const taken: Frame = {
		k: 'PHASE_STEP',
		phase: { k: 'CLEANUP', sub: 'GLORY_TAKEN' },
		ctx: phaseCtx(seat),
	}
	const placement: Frame = {
		k: 'EFFECT',
		node: effect,
		ctx: { actor: seat, source: '' as CardInstanceId, bindings: {} },
		ip: 0,
	}
	return { ...state, stack: [...state.stack, continuation, taken, placement] }
}

/** §3.6.3 — the placed Glory came from the current Stardate card (not from
 *  the supply once a Resolution was triggered); an emptying handoff runs the
 *  §3.6.4 rule. */
function cleanupGloryTaken(state: GameState, ctx: EffectCtx): GameState {
	if (
		state.resolutionTriggered ||
		state.stardates.pile.length === 0 ||
		state.stardates.gloryOnTop <= 0
	)
		return state
	const gloryOnTop = state.stardates.gloryOnTop - 1
	const s = { ...state, stardates: { ...state.stardates, gloryOnTop } }
	return gloryOnTop <= 0 ? handoffStardate(s, ctx.actor) : s
}

/** Cadet Training extra substep (rules/10 §10.3 #1): wipe one Market card of
 *  your choice — tokens to the supply, junk, refill — before Glory placement. */
function cleanupCadetWipe(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const key = '$cwipe.iid'
	if (answered(ctx, key)) {
		// CHOOSE_CARDS returns an array (min/max 1) — phases.answer gives the raw
		// selection, so unwrap the single picked card.
		const picked = answer<CardInstanceId[]>(ctx, key)
		const iid = picked[0]
		if (iid === undefined)
			return pushStep(
				state,
				{ k: 'CLEANUP', sub: 'GLORY_PLACEMENT' },
				phaseCtx(seat),
			)
		return pushStep(
			wipeOneMarketCard(state, iid),
			{ k: 'CLEANUP', sub: 'GLORY_PLACEMENT' },
			phaseCtx(seat),
		)
	}
	const offers = boardMarketOffers(state)
	if (offers.length === 0)
		return pushStep(
			state,
			{ k: 'CLEANUP', sub: 'GLORY_PLACEMENT' },
			phaseCtx(seat),
		)
	return phaseSuspend(
		state,
		seat,
		{ k: 'CLEANUP', sub: 'CADET_WIPE' },
		ctx,
		key,
		{
			k: 'CHOOSE_CARDS',
			prompt: 'Cadet Training — wipe one Market card of your choice',
			candidates: offers,
			min: 1,
			max: 1,
			from: 'MARKET',
		},
	)
}

/** Market offer → Junk (tokens to the supply), refill the same suit. */
function wipeOneMarketCard(state: GameState, iid: CardInstanceId): GameState {
	const card = state.cards[iid]
	if (!card) return state
	const suit = card.zone.k === 'MARKET_OFFER' ? card.zone.suit : undefined
	let s = {
		...state,
		cards: { ...state.cards, [iid]: { ...card, resourceTokens: {} } },
	}
	s = moveCard(s, iid, { k: 'JUNK' })
	if (suit !== undefined) s = boardRefillMarket(s, suit)
	return s
}

/** §3.6.5 — move every Staging card to Discard, then optionally discard any
 *  number of hand cards (a real choice — min 0). */
function cleanupDiscard(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const key = '$disc.iids'
	if (answered(ctx, key)) {
		const iids = answer<CardInstanceId[]>(ctx, key)
		let s = state
		for (const iid of iids) s = moveToDiscard(s, iid, seat)
		return pushStep(s, { k: 'CLEANUP', sub: 'DRAW' }, phaseCtx(seat))
	}
	let s = state
	for (const iid of zonesOf(state, { k: 'STAGING', seat }))
		s = moveToDiscard(s, iid, seat)
	const hand = zonesOf(state, { k: 'HAND', seat })
	if (hand.length === 0)
		return pushStep(s, { k: 'CLEANUP', sub: 'DRAW' }, phaseCtx(seat))
	return phaseSuspend(s, seat, { k: 'CLEANUP', sub: 'DISCARD' }, ctx, key, {
		k: 'CHOOSE_CARDS',
		prompt: 'Discard any cards from hand?',
		candidates: hand,
		min: 0,
		max: hand.length,
		from: 'HAND',
	})
}

function moveToDiscard(
	state: GameState,
	iid: CardInstanceId,
	seat: Seat,
): GameState {
	return emit(moveCard(state, iid, { k: 'DISCARD', seat }), {
		k: 'CARD_DISCARDED',
		iid,
		seat,
	})
}

/** §3.6.6 — draw to hand size (not a hand limit — rules/12 §12.21). Deck
 *  cycling mid-draw is handled by the DRAW primitive. */
function cleanupDraw(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	const hand = zonesOf(state, { k: 'HAND', seat }).length
	const size = effectiveHandSize(state, seat)
	const n = Math.max(0, size - hand)
	if (n === 0)
		return pushStep(state, { k: 'CLEANUP', sub: 'REFRESH' }, phaseCtx(seat))
	const continuation: Frame = {
		k: 'PHASE_STEP',
		phase: { k: 'CLEANUP', sub: 'REFRESH' },
		ctx: phaseCtx(seat),
	}
	const s: GameState = { ...state, stack: [...state.stack, continuation] }
	// `untilHandSize`: the draw stops as soon as the hand reaches hand size —
	// even mid-draw, if a Development enlistment's cost filled the hand
	// (rules/12 §12.23).
	return drawCards(s, seat, n, { untilHandSize: size })
}

/** §3.6.7 — refresh exhausted in-play cards, clear action-token reminders,
 *  reset the action budget to exactly 3 (excess back to the supply), then hand
 *  the turn to the other player. */
function cleanupRefresh(state: GameState, ctx: EffectCtx): GameState {
	const seat = ctx.actor
	let cards = state.cards
	for (const [iid, c] of Object.entries(state.cards)) {
		if (c.owner !== seat) continue
		if (c.exhausted && zoneProps(c.zone).inPlay) {
			cards = { ...cards, [iid]: { ...c, exhausted: false } }
		}
		if (c.actionTokens > 0) {
			cards = { ...cards, [iid]: { ...cards[iid]!, actionTokens: 0 } }
		}
	}
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, actions: { available: 3, spent: 0 } } : pl,
	) as GameState['players']
	// "for the remainder of the turn" layers end with THIS turn — also the
	// ones the other seat attached during it (a REACTION on the active
	// player's turn), not only the active seat's own.
	return handOffTurn(
		dropTurnModifiers(
			dropTurnModifiers({ ...state, cards, players }, seat),
			otherSeat(seat),
		),
		seat,
	)
}

// ---------------------------------------------------------------------------
// Turn bookkeeping (todo/06 §3)
// ---------------------------------------------------------------------------

/** How many Action tokens `seat` still has available right now — CLEAN-UP
 *  operations that reward unused actions read this *before* the REFRESH
 *  substep resets the budget (rules/03 §3.5.1, §3.6.7). */
export function unusedActions(state: GameState, seat: Seat): number {
	return player(state, seat).actions.available
}

/** Turn end: increment the finished player's turn count, run the Resolution
 *  extra-turn budget (docs/state-machine.md §6), pass the turn, and push the
 *  opponent's RESUPPLY step onto the stack (frame-only — the stack machine
 *  executes it; a nested run here would mask phase states, so the caller owns
 *  the loop). Exported for the Resolution-budget tests (docs/state-machine §6).
 *
 *  Cadet Training (rules/10 §10.3): the virtual opponent never takes a turn,
 *  so the human (seat 0) stays active and the fixed timeline is the human's
 *  own — the two Cadet Stardate cards (5 Glory each) empty on their 5th and
 *  10th turns, and the Resolution budget is exactly ONE more turn (turn 11,
 *  then score) instead of "finish the round + 1 each". */
export function handOffTurn(state: GameState, seat: Seat): GameState {
	let s: GameState = {
		...state,
		turnNumber: state.turnNumber + 1,
		turnsTaken: state.turnsTaken.map((n, i) => (i === seat ? n + 1 : n)) as [
			number,
			number,
		],
	}
	if (s.resolutionTriggered && s.result === null) {
		if (s.turnsAfterResolution === 0) {
			if (s.mode === 'CADET') {
				// Solo: one final turn, then score (rules/10 §10.3 — "turn 11: play
				// one final turn, then score").
				s = { ...s, turnsAfterResolution: 1 }
			} else {
				// budget not yet computed — finish the interrupted round, then one more
				// turn each; computed from the completed-turn counts at this turn end.
				s = {
					...s,
					turnsAfterResolution:
						(s.turnsTaken[0] === s.turnsTaken[1] ? 0 : 1) + 2,
				}
			}
		} else {
			const remaining = s.turnsAfterResolution - 1
			if (remaining <= 0) {
				const over: GameState = {
					...s,
					turnsAfterResolution: 0,
					phase: { k: 'GAME_OVER' },
				}
				return beginFinalScoring(over)
			}
			s = { ...s, turnsAfterResolution: remaining }
		}
	}
	s = { ...s, activeSeat: s.mode === 'CADET' ? 0 : otherSeat(seat) }
	return pushStep(s, { k: 'RESUPPLY', pending: [] }, phaseCtx(s.activeSeat))
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function clearHeldStardate(state: GameState, seat: Seat): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, heldStardate: null } : pl,
	) as GameState['players']
	return { ...state, players }
}

function answered(ctx: EffectCtx, key: string): boolean {
	return ctx.bindings[key] !== undefined
}

function answer<T = unknown>(ctx: EffectCtx, key: string): T {
	const choiceId = ctx.bindings[key]
	if (typeof choiceId !== 'string')
		throw new Error(`phases.answer(${key}): not answered`)
	return ctx.bindings[choiceId] as T
}

/** Schedule operations to run (in the given order) followed by the resource
 *  continuation PHASE_STEP — both on the live stack. */
function scheduleOperations(
	state: GameState,
	ops: OperationRef[],
	nextPhase: Phase,
	ctx: EffectCtx,
): GameState {
	const frames: Frame[] = [{ k: 'PHASE_STEP', phase: nextPhase, ctx }]
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i]!
		frames.push({
			k: 'OPERATION',
			card: op.card,
			opIndex: op.opIndex,
			// Each operation is its own card's effect: "this card" is op.card
			// (the phase ctx has no source), and bindings stay per-operation.
			ctx: { ...ctx, source: op.card, bindings: { ...ctx.bindings } },
			phase: 0,
		})
	}
	return { ...state, stack: [...state.stack, ...frames] }
}

/** Conservative independence prover (todo/06 §2.1): a pending effect that is a
 *  pure GAIN_RESOURCE/DRAW sequence reads no shared counts and touches only the
 *  actor's pool, so its order relative to its siblings cannot matter. */
function isAutoResolvable(state: GameState, ref: OperationRef): boolean {
	const op = cardDef(state.cards[ref.card]!.def).operations[ref.opIndex]
	if (!op) return false
	return isPureGain(op.effect)
}

function isPureGain(node: Effect): boolean {
	switch (node.k) {
		case 'GAIN_RESOURCE':
		case 'DRAW':
		case 'NOOP':
			return true
		case 'SEQ':
			return node.steps.every(isPureGain)
		default:
			return false
	}
}

export { boardMarketOffers as marketOffers }
