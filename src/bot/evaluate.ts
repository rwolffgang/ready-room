// Static evaluation for the house AI (todo/15 §4): a feature vector per seat
// and a VP-equivalent margin built from it.
//
//   features(state, seat)  → number[] aligned with FEATURE_NAMES (stable order:
//                            append new features at the END, never reorder;
//                            a learned value function trains on this vector)
//   evaluate(state, seat)  → (score(seat) − score(opp)).total
//                            + Σ EVAL_WEIGHTS[i] · (f_seat[i] − f_opp[i])
//                            terminal: ±1000 + the final margin
//   evaluateNormalized     → tanh(evaluate / EVAL_SCALE) ∈ [−1, 1] (for MCTS)
//
// All of it is pure, deterministic and DOM-free. It reads the state as given:
// pass a determinized state (src/bot/determinize.ts) when the evaluating seat
// must not see hidden information.

import type { GameState } from '../engine/state'
import { otherSeat, player, zoneProps } from '../engine/state'
import type { Seat } from '../engine/resolver/queries'
import type { CardInstanceId } from '../engine/ids'
import type { SpecialtyId } from '../data/ids'
import { cardDef, hasCardDef } from '../engine/cards'
import {
	finalizeGame,
	highestMultiplierReached,
	score,
	SPECIALTY_ORDER,
} from '../engine/scoring'
import { completableMissions } from '../engine/queries/legality'
import { securedLocations } from '../engine/phases'
import { shipTokensAt } from '../engine/queries/board'

/** The feature vector layout. Index i of `features()` is FEATURE_NAMES[i].
 *  Per-seat unless marked (global): globals are the same for both seats, so
 *  they cancel out of `evaluate`'s difference but inform a learned value. */
export const FEATURE_NAMES = [
	// final-scoring breakdown as if the game ended now (rules/07 §7.4)
	'score.total',
	'score.glory',
	'score.neutralTokens',
	'score.endgame',
	'score.printedVp',
	'score.focus',
	'score.missions',
	// resources in the pool
	'res.DIL',
	'res.LAT',
	'res.GLO',
	// Specialty tracks: position, highest multiplier reached
	'track.RESEARCH',
	'track.INFLUENCE',
	'track.MILITARY',
	'track.best',
	'mult.RESEARCH',
	'mult.INFLUENCE',
	'mult.MILITARY',
	// Focus × multiplier that is NOT yet in the score (no mission completed)
	'focus.unrealized',
	'focus.cards',
	// the board
	'away.pool',
	'away.neutral',
	'ships.neutral',
	'loc.secured',
	'loc.controlled',
	'loc.lead',
	// card counts per zone
	'cards.hand',
	'cards.draw',
	'cards.discard',
	'cards.log',
	'cards.inPlay',
	'cards.owned',
	// composition of the scoring cards (Reserve / Development excluded)
	'owned.avgVp',
	'owned.skillIcons',
	'owned.skillIconsBest',
	'owned.incidents',
	// missions
	'missions.completed',
	'missions.completable',
	'missions.remaining',
	// table
	'officers.duty',
	'fleet.ships',
	'actions.available',
	// (global) game clock
	'turn.number',
	'turn.phase',
	'turn.isActive',
	'game.resolution',
	'game.stardatesLeft',
	'game.incidentDeck',
	// appended features (keep the order above stable)
	'hand.value',
] as const

export type FeatureName = (typeof FEATURE_NAMES)[number]

/** Index of a feature by name. */
export const FEATURE_INDEX: Readonly<Record<FeatureName, number>> =
	Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i])) as Record<
		FeatureName,
		number
	>

/**
 * Weights of the static evaluation, in VP per unit of (seat − opponent)
 * difference. The real score difference is added on top, so every `score.*`
 * weight is 0. Hand-tuned; a later package may fit them.
 */
export const EVAL_WEIGHTS: Readonly<Record<FeatureName, number>> = {
	'score.total': 0, // added separately (the real margin)
	'score.glory': 0, // part of score.total
	'score.neutralTokens': 0, // part of score.total
	'score.endgame': 0, // part of score.total
	'score.printedVp': 0, // part of score.total
	'score.focus': 0, // part of score.total
	'score.missions': 0, // part of score.total
	'res.DIL': 0.4, // pays for operations on later turns
	'res.LAT': 0.4, // pays for operations on later turns
	'res.GLO': 0, // already 1 VP each in score.glory
	'track.RESEARCH': 0.2, // unlocks restricted operations and mission goals
	'track.INFLUENCE': 0.2, // (same)
	'track.MILITARY': 0.2, // (same)
	'track.best': 0.1, // depth in one track feeds its multiplier
	'mult.RESEARCH': 0, // valued through focus.unrealized / score.focus
	'mult.INFLUENCE': 0, // (same)
	'mult.MILITARY': 0, // (same)
	'focus.unrealized': 0.5, // Focus VP a first completed mission would unlock
	'focus.cards': 0.1, // more Focus cards → more VP per multiplier step
	'away.pool': 0.15, // Away Teams ready to send
	'away.neutral': 0, // 1 VP each, already in score.neutralTokens
	'ships.neutral': 0, // 1 VP each, already in score.neutralTokens
	'loc.secured': 1.5, // a Location the Control Step can take
	'loc.controlled': 1, // its ongoing operations (its VP is in the score)
	'loc.lead': 0.3, // token lead at neutral Locations, toward securing
	'cards.hand': 0.3, // cards carried into the next turn (the search compares
	// candidates after Clean-up, when the hand has been refilled)
	'cards.draw': 0,
	'cards.discard': 0,
	'cards.log': 0,
	'cards.inPlay': 0,
	'cards.owned': 0,
	'owned.avgVp': 0, // the VP itself is in score.printedVp
	'owned.skillIcons': 0.15, // a deck that advances tracks faster
	'owned.skillIconsBest': 0.1, // icons that feed the best track
	'owned.incidents': -0.5, // the Burn counts INCIDENTs (their −VP is in the score)
	'missions.completed': 1, // rewards resolved; the first unlocks Focus
	'missions.completable': 1, // completable on the next turn
	'missions.remaining': 0,
	'officers.duty': 0.5, // a Duty Officer's table operation
	'fleet.ships': 0.3, // a deployed SHIP's table operation
	'actions.available': 0, // unused actions are lost at Clean-up
	'turn.number': 0, // (global)
	'turn.phase': 0, // (global)
	'turn.isActive': 0, // (global-ish: 1 for exactly one seat)
	'game.resolution': 0, // (global)
	'game.stardatesLeft': 0, // (global)
	'game.incidentDeck': 0, // (global)
	'hand.value': 0, // Σ cardValuePrior over the hand (for a learned value; 0.2
	// did not beat 0 in a 10-game arena)
}

/** EVAL_WEIGHTS as a vector aligned with FEATURE_NAMES. */
export const WEIGHT_VECTOR: readonly number[] = FEATURE_NAMES.map(
	(n) => EVAL_WEIGHTS[n],
)

/** A weight vector with some weights replaced (for tuning experiments). */
export function weightVector(
	overrides: Partial<Record<FeatureName, number>> = {},
): number[] {
	return FEATURE_NAMES.map((n) => overrides[n] ?? EVAL_WEIGHTS[n])
}

/** Terminal value base: a won game is worth +1000 + margin, a lost one
 *  −1000 + margin, a tie the margin. */
export const WIN_VALUE = 1000

/** Margin scale of `evaluateNormalized` (tanh(margin / EVAL_SCALE)). */
export const EVAL_SCALE = 15

const PHASE_INDEX: Record<GameState['phase']['k'], number> = {
	SETUP: 0,
	RESUPPLY: 1,
	CONTROL: 2,
	ACTION: 3,
	CLEANUP: 4,
	BOT: 4, // the solo Bot's turn: its clean-up hands over to you
	GAME_OVER: 5,
}

/** The seat's best Specialty track (highest position; ties by track order). */
export function bestTrack(state: GameState, seat: Seat): SpecialtyId {
	const p = player(state, seat)
	let best: SpecialtyId = 'RESEARCH'
	for (const s of SPECIALTY_ORDER)
		if (p.specialties[s] > p.specialties[best]) best = s
	return best
}

/** A cheap static value of a card instance for `seat` (VP-ish units): printed
 *  VP, Skill icons (more for icons matching the seat's best track), a Focus
 *  icon, Glory waiting on a Market card, and a penalty for INCIDENTs.
 *  `hidden` cards (faces the seat cannot see) get 0. */
export function cardValuePrior(
	state: GameState,
	iid: CardInstanceId,
	seat: Seat,
	hidden?: ReadonlySet<string>,
): number {
	if (hidden?.has(iid) === true) return 0
	const card = state.cards[iid]
	if (card === undefined || !hasCardDef(card.def)) return 0
	const def = cardDef(card.def)
	const best = bestTrack(state, seat)
	let v = def.vp
	for (const icon of def.skills) {
		v += 0.5
		if (icon === `SKILL_${best}` || icon === 'SKILL_ANY') v += 0.3
	}
	if (def.focus !== null) v += 0.5
	v += card.resourceTokens.GLO ?? 0
	if (def.suit === 'INCIDENT') v -= 3
	return v
}

/** The feature vector of `seat` (see FEATURE_NAMES). */
export function features(state: GameState, seat: Seat): number[] {
	const f = new Array<number>(FEATURE_NAMES.length).fill(0)
	const set = (name: FeatureName, v: number): void => {
		f[FEATURE_INDEX[name]] = v
	}
	const p = player(state, seat)
	const opp = otherSeat(seat)
	const b = score(state, seat)
	set('score.total', b.total)
	set('score.glory', b.glory)
	set('score.neutralTokens', b.neutralTokens.vp)
	set(
		'score.endgame',
		b.endgame.reduce((n, e) => n + e.vp, 0),
	)
	set(
		'score.printedVp',
		b.printedVp.reduce((n, e) => n + e.vp, 0),
	)
	const focusVp = b.focus.reduce((n, e) => n + e.vp, 0)
	set('score.focus', focusVp)
	set(
		'score.missions',
		b.missions.reduce((n, e) => n + e.vp, 0),
	)
	set('res.DIL', p.resources.DIL)
	set('res.LAT', p.resources.LAT)
	set('res.GLO', p.resources.GLO)
	const best = bestTrack(state, seat)
	set('track.RESEARCH', p.specialties.RESEARCH)
	set('track.INFLUENCE', p.specialties.INFLUENCE)
	set('track.MILITARY', p.specialties.MILITARY)
	set('track.best', p.specialties[best])
	const mult = {
		RESEARCH: highestMultiplierReached(state, seat, 'RESEARCH'),
		INFLUENCE: highestMultiplierReached(state, seat, 'INFLUENCE'),
		MILITARY: highestMultiplierReached(state, seat, 'MILITARY'),
	}
	set('mult.RESEARCH', mult.RESEARCH)
	set('mult.INFLUENCE', mult.INFLUENCE)
	set('mult.MILITARY', mult.MILITARY)

	// one pass over the cards
	let hand = 0
	let draw = 0
	let discard = 0
	let log = 0
	let inPlay = 0
	let ownedAll = 0
	let scoring = 0
	let vpSum = 0
	let skillIcons = 0
	let skillBest = 0
	let incidents = 0
	let duty = 0
	let ships = 0
	let controlled = 0
	const focusCards = { RESEARCH: 0, INFLUENCE: 0, MILITARY: 0 }
	for (const card of Object.values(state.cards)) {
		if (card.owner !== seat) continue
		ownedAll++
		const z = card.zone.k
		if (z === 'HAND') hand++
		else if (z === 'DRAW') draw++
		else if (z === 'DISCARD') discard++
		else if (z === 'LOG') log++
		if (zoneProps(card.zone).inPlay) inPlay++
		if (z === 'DUTY_OFFICER') duty++
		if (z === 'LOCATION_AREA') controlled++
		const def = cardDef(card.def)
		if (z === 'FLEET' && def.suit === 'SHIP') ships++
		if (z === 'RESERVE' || z === 'DEVELOPMENT') continue
		scoring++
		vpSum += def.vp
		skillIcons += def.skills.length
		for (const icon of def.skills)
			if (icon === `SKILL_${best}` || icon === 'SKILL_ANY') skillBest++
		if (def.suit === 'INCIDENT') incidents++
		if (def.focus !== null) {
			const s = def.focus.slice('FOCUS_'.length) as SpecialtyId
			focusCards[s]++
		}
	}
	const potential =
		focusCards.RESEARCH * mult.RESEARCH +
		focusCards.INFLUENCE * mult.INFLUENCE +
		focusCards.MILITARY * mult.MILITARY
	set('focus.unrealized', Math.max(0, potential - focusVp))
	set(
		'focus.cards',
		focusCards.RESEARCH + focusCards.INFLUENCE + focusCards.MILITARY,
	)

	// neutral Locations
	let awayNeutral = 0
	let shipsNeutral = 0
	let lead = 0
	for (const slot of [0, 1, 2] as const) {
		for (const iid of state.zones[`NEUTRAL_ZONE:${slot}`] ?? []) {
			const loc = iid as CardInstanceId
			const mineAway = state.awayTeamsAt[loc]?.[seat] ?? 0
			const mineShips = shipTokensAt(state, loc, seat)
			const theirs =
				(state.awayTeamsAt[loc]?.[opp] ?? 0) + shipTokensAt(state, loc, opp)
			awayNeutral += mineAway
			shipsNeutral += mineShips
			lead += Math.min(2, Math.max(0, mineAway + mineShips - theirs))
		}
	}
	set('away.pool', p.awayTeamsInPool)
	set('away.neutral', awayNeutral)
	set('ships.neutral', shipsNeutral)
	set('loc.secured', securedLocations(state, seat).length)
	set('loc.controlled', controlled)
	set('loc.lead', lead)

	set('cards.hand', hand)
	set('cards.draw', draw)
	set('cards.discard', discard)
	set('cards.log', log)
	set('cards.inPlay', inPlay)
	set('cards.owned', ownedAll)
	set('owned.avgVp', scoring === 0 ? 0 : vpSum / scoring)
	set('owned.skillIcons', skillIcons)
	set('owned.skillIconsBest', skillBest)
	set('owned.incidents', incidents)

	const completed = p.missions.filter((m) => m.completed).length
	set('missions.completed', completed)
	set(
		'missions.completable',
		state.result === null ? completableMissions(state, seat).length : 0,
	)
	set('missions.remaining', p.missions.length - completed)
	set('officers.duty', duty)
	set('fleet.ships', ships)
	set(
		'actions.available',
		state.activeSeat === seat ? Math.max(0, p.actions.available) : 0,
	)

	set('turn.number', state.turnNumber)
	set('turn.phase', PHASE_INDEX[state.phase.k])
	set('turn.isActive', state.activeSeat === seat ? 1 : 0)
	set('game.resolution', state.resolutionTriggered ? 1 : 0)
	set('game.stardatesLeft', state.stardates.pile.length)
	set('game.incidentDeck', state.zones['INCIDENT_DECK']?.length ?? 0)
	let handValue = 0
	for (const iid of state.zones[`HAND:${seat}`] ?? [])
		handValue += cardValuePrior(state, iid, seat)
	set('hand.value', handValue)
	return f
}

/** The final result from `seat`'s point of view, or null mid-game:
 *  `win` / `loss` / `tie` and the final VP margin. */
export function terminalOutcome(
	state: GameState,
	seat: Seat,
): { outcome: 'win' | 'loss' | 'tie'; margin: number } | null {
	if (state.result === null) return null
	const done = state.result.kind === 'COMPLETE' ? state : finalizeGame(state)
	if (done.result === null || done.result.kind !== 'COMPLETE') return null
	const board = done.result.scoreboard
	const mine = board.breakdown[seat].total
	const margin =
		state.mode === 'CADET'
			? mine
			: mine - board.breakdown[otherSeat(seat)].total
	if (board.cadetLoss) return { outcome: 'loss', margin }
	const won = board.winners.includes(seat)
	const theyWon = board.winners.includes(otherSeat(seat))
	if (won && theyWon) return { outcome: 'tie', margin }
	return { outcome: won ? 'win' : 'loss', margin }
}

/** The weighted, non-score part of the evaluation for one seat. */
function weighted(f: ArrayLike<number>, w: readonly number[]): number {
	let v = 0
	for (let i = 0; i < f.length; i++) v += w[i]! * f[i]!
	return v
}

/**
 * VP-equivalent margin of `state` for `seat`: the real score difference plus
 * EVAL_WEIGHTS · (features(seat) − features(opponent)) (or `weights`, a
 * vector aligned with FEATURE_NAMES). A finished game is
 * worth ±WIN_VALUE + the final margin (0 + margin for a tie). In Cadet
 * Training the opponent is virtual, so only `seat`'s own terms count.
 */
export function evaluate(
	state: GameState,
	seat: Seat,
	weights: readonly number[] = WEIGHT_VECTOR,
): number {
	const end = terminalOutcome(state, seat)
	if (end !== null) {
		const base =
			end.outcome === 'win'
				? WIN_VALUE
				: end.outcome === 'loss'
					? -WIN_VALUE
					: 0
		return base + end.margin
	}
	const mine = features(state, seat)
	if (state.mode === 'CADET')
		return mine[FEATURE_INDEX['score.total']]! + weighted(mine, weights)
	return evaluateFeatures(mine, features(state, otherSeat(seat)), weights)
}

/** `evaluate` of a non-terminal two-player state from its two feature
 *  vectors (`seat`'s and the opponent's). The learned value's trainer uses it
 *  to score recorded positions with the hand-tuned evaluation (its baseline). */
export function evaluateFeatures(
	mine: ArrayLike<number>,
	theirs: ArrayLike<number>,
	weights: readonly number[] = WEIGHT_VECTOR,
): number {
	const total = FEATURE_INDEX['score.total']
	return (
		mine[total]! +
		weighted(mine, weights) -
		theirs[total]! -
		weighted(theirs, weights)
	)
}

/** `evaluate` squashed into [−1, 1]: tanh(margin / EVAL_SCALE). */
export function evaluateNormalized(state: GameState, seat: Seat): number {
	return Math.tanh(evaluate(state, seat) / EVAL_SCALE)
}
