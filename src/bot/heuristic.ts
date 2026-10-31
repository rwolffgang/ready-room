// The heuristic house AI (todo/15 §4): a one-decision lookahead over sampled
// worlds. This is a HOUSE AI, not the game's official solo Bot (that needs the
// separate solo rulebook, docs/open-questions.md Blocker B2).
//
// For a decision of `seat`:
//   1. `candidates()` lists the options (src/bot/candidates.ts).
//   2. `samples` worlds are drawn with `determinize`, seeded from
//      `seedFromView` (the no-cheat contract in src/bot/types.ts).
//   3. In every world each candidate is applied with `reduce`, then `settle`d
//      to a common horizon: this seat's own pending choices are answered by
//      the cheap `priorSelection` (no recursion), the opponent's interrupts by
//      `firstLegalPolicy`, and the rest of the turn is ended at once (END_TURN
//      through Clean-up) until the opponent's turn begins. So every candidate
//      is scored as "do this, then end the turn", and END_TURN itself is
//      compared fairly against playing more: all of them after Clean-up, with
//      the same refilled hand and no leftover actions. (`horizon: 'round'`
//      also plays the opponent's whole turn, first-legal, before scoring.)
//   4. The world score is `evaluate()` minus a Glory-spending penalty; the
//      candidate score is the mean over worlds plus the rule-prior bonuses.
//   5. Argmax (ties: the earlier candidate; candidates() lists the
//      turn-ending intents last), or with `noise > 0` a softmax draw from the
//      seeded sampler (the Easy level).
// A completable mission is completed at once, before any search (todo/15 §4).
//
// Deterministic and pure: the only randomness is the view-seeded sampler.

import type { GameState, GameEvent } from '../engine/state'
import { forkState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { reduce, legalIntents, firstLegalSelection } from '../engine/intents'
import type { PendingChoice } from '../engine/resolver/choices'
import { checkSelection, SKIP_LOCATION } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import type { CardInstanceId } from '../engine/ids'
import { cardDef, hasCardDef } from '../engine/cards'
import { next, type Rng } from '../engine/rng'
import type { Bot, BotId } from './types'
import {
	NOTE_EASY,
	NOTE_FORCED,
	NOTE_MISSION,
	ruleInfo,
	topOptions,
	type DecisionInfo,
	type DecisionOption,
} from './explain'
import { candidates } from './candidates'
import { determinizeWith, seedFromView } from './determinize'
import {
	bestTrack,
	cardValuePrior,
	evaluate,
	weightVector,
	WEIGHT_VECTOR,
	type FeatureName,
} from './evaluate'
import { firstLegalPolicy, nextAutoIntent } from './autoPlay'

export interface HeuristicOptions {
	/** Determinized worlds per decision (default 2). */
	samples?: number | undefined
	/** Softmax temperature in VP; 0 = argmax (default 0). */
	noise?: number | undefined
	/** The id the bot reports (default 'normal'). */
	id?: BotId | undefined
	/** Where a simulation stops: 'turn' (default) = when the opponent's turn
	 *  begins; 'round' = at the start of this seat's next turn. */
	horizon?: 'turn' | 'round' | undefined
	/** Work cap: candidate × world simulations per decision (default 40).
	 *  Over the cap the bot first drops to one world, then keeps only the
	 *  candidates the priors rank highest. */
	maxSims?: number | undefined
	/** Engine steps one settle may take before it is scored as is (default 60). */
	maxSettleSteps?: number | undefined
	/** Complete a completable mission at once, without searching (todo/15
	 *  §4 "complete any completable mission immediately"; default true). */
	missionsFirst?: boolean | undefined
	/** Evaluation weight overrides (default EVAL_WEIGHTS). */
	weights?: Partial<Record<FeatureName, number>> | undefined
}

/** Rule-prior bonuses (todo/15 §4), in VP, added to a candidate's score. */
export const PRIORS = {
	/** completing a mission is never wrong (and unlocks Focus scoring) */
	completeMission: 2,
	/** the Control Step: take a secured Location rather than skip */
	takeControl: 1.5,
	/** extra cost per Glory spent, on top of its 1 VP in the score: pay with
	 *  anything else when another payment exists */
	glorySpent: 0.5,
	/** per Skill icon of a gained card matching the seat's best track */
	gainSkillMatch: 0.3,
	/** per earlier resolution of the same operation this turn: a repeatable
	 *  activation whose net value is ~0 (a zero-cost "warp, then refresh")
	 *  must not ping-pong forever (tools/arena.ts found the BUR loop) */
	repeatActivation: 1,
} as const

/** Salt mixed into the view seed so the sampler differs from other users of
 *  `seedFromView`. */
const SAMPLER_SALT = 0x5eed_b075

/** The cheap, recursion-free answer `seat` gives its own sub-choices inside a
 *  simulation: accept "may"s and reactions, gain the best card, pay costs
 *  with the worst cards, keep the hand at Clean-up, take control, take the
 *  largest "up to" amount; anything else as the first-legal policy. */
export function priorSelection(
	state: GameState,
	choice: PendingChoice,
): unknown {
	const seat = choice.seat
	switch (choice.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_AMOUNT':
			return choice.max
		case 'OPTIONAL_TRIGGERS':
			return [...choice.offered]
		case 'CHOOSE_LOCATION': {
			if (state.phase.k === 'CONTROL') {
				const take = choice.candidates.find((c) => c !== SKIP_LOCATION)
				if (take !== undefined) return take
			}
			return choice.candidates[0]
		}
		case 'CHOOSE_CARDS': {
			const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
			const legal = choice.candidates.filter((iid) => !disabled.has(iid))
			if (
				state.phase.k === 'CLEANUP' &&
				state.phase.sub === 'DISCARD' &&
				choice.min === 0
			)
				return []
			const hidden = new Set<string>(choice.hidden ?? [])
			const ranked = [...legal].sort(
				(a, b) =>
					cardValuePrior(state, b, seat, hidden) -
						cardValuePrior(state, a, seat, hidden) ||
					legal.indexOf(a) - legal.indexOf(b),
			)
			if (choice.from.startsWith('MARKET:'))
				return ranked.slice(0, Math.max(choice.min, Math.min(1, choice.max)))
			if (
				choice.from === 'MARKET' &&
				askingNode(state) === 'PLACE_RESOURCE_ON_MARKET'
			)
				return ranked.reverse().slice(0, choice.min)
			if (choice.from.startsWith('HAND'))
				return ranked.reverse().slice(0, choice.min)
			return firstLegalPolicy(state, choice)
		}
		default:
			return firstLegalPolicy(state, choice)
	}
}

/** The DSL node kind that published the pending choice (the frame holding the
 *  choice id in its bindings), or null for a phase-level / unknown asker. */
export function askingNode(state: GameState): string | null {
	const choice = state.pendingChoice
	if (choice === null) return null
	for (let i = state.stack.length - 1; i >= 0; i--) {
		const f = state.stack[i]!
		if (f.k !== 'EFFECT') continue
		if (Object.values(f.ctx.bindings).includes(choice.id)) return f.node.k
	}
	return null
}

function glorySpentBy(events: readonly GameEvent[], seat: Seat): number {
	let n = 0
	for (const e of events)
		if (e.k === 'RESOURCE_SPENT' && e.res === 'GLO' && e.seat === seat)
			n += e.amount
	return n
}

export interface SettleResult {
	state: GameState
	/** Glory `seat` spent during the settle */
	glorySpent: number
	steps: number
}

/**
 * Run `state` forward to the simulation horizon of `seat` with the cheap
 * policies (see the header): `seat`'s own choices by `priorSelection`, the
 * opponent's by `firstLegalPolicy`; on `seat`'s turn the boundary intents
 * (START / PASS / END_TURN) end the turn. Stops when the opponent's turn
 * begins (`'turn'`), at the start of `seat`'s next turn (`'round'`), at game
 * over, or after `maxSteps` engine intents. Mutates nothing: the caller passes
 * a state it owns (a fork).
 */
export function settle(
	state: GameState,
	seat: Seat,
	horizon: 'turn' | 'round' = 'turn',
	maxSteps = 60,
): SettleResult {
	let s = state
	let glory = 0
	let leftTurn = s.activeSeat !== seat
	// Cadet Training never hands the turn over (the virtual opponent takes no
	// turns), so a finished own turn is also detected by the turn counter
	const taken = s.turnsTaken[seat]
	let steps = 0
	const apply = (intent: Intent): boolean => {
		try {
			const r = reduce(s, intent)
			glory += glorySpentBy(r.events, seat)
			s = r.state
			steps++
			return true
		} catch {
			return false
		}
	}
	while (steps < maxSteps && s.result === null) {
		const choice = s.pendingChoice
		if (choice !== null) {
			let selection =
				choice.seat === seat
					? priorSelection(s, choice)
					: firstLegalPolicy(s, choice)
			if (!checkSelection(choice, selection).ok) {
				selection = firstLegalSelection(s)
				if (selection === null) break
			}
			if (!apply({ t: 'RESOLVE_CHOICE', choiceId: choice.id, selection })) break
			continue
		}
		if (s.activeSeat !== seat) {
			leftTurn = true
			if (horizon === 'turn') break
			const intent = nextAutoIntent(s, legalIntents(s))
			if (intent === undefined || !apply(intent)) break
			continue
		}
		// back at the start of seat's next turn ('round'), or Cadet's next turn
		if (leftTurn || s.turnsTaken[seat] > taken) break
		let intent: Intent | undefined
		switch (s.phase.k) {
			case 'SETUP':
				intent = { t: 'START' }
				break
			case 'RESUPPLY':
			case 'CONTROL':
				intent = { t: 'PASS' }
				break
			case 'ACTION':
				intent = { t: 'END_TURN' }
				break
			default:
				intent = legalIntents(s)[0]
		}
		if (intent === undefined || !apply(intent)) break
	}
	return { state: s, glorySpent: glory, steps }
}

/** The rule-prior bonus of one candidate (todo/15 §4), in VP. */
export function priorBonus(
	state: GameState,
	seat: Seat,
	intent: Intent,
): number {
	if (intent.t === 'COMPLETE_MISSION') return PRIORS.completeMission
	if (intent.t === 'ACTIVATE') {
		const done = state.resolvedOps
		if (done === undefined || done.turn !== state.turnNumber) return 0
		let n = 0
		for (const ref of done.refs)
			if (ref.card === intent.iid && ref.opIndex === intent.operationIndex) n++
		return -PRIORS.repeatActivation * n
	}
	if (intent.t !== 'RESOLVE_CHOICE') return 0
	const choice = state.pendingChoice
	if (choice === null) return 0
	if (
		choice.k === 'CHOOSE_LOCATION' &&
		state.phase.k === 'CONTROL' &&
		choice.candidates.includes(SKIP_LOCATION)
	)
		return intent.selection === SKIP_LOCATION ? 0 : PRIORS.takeControl
	if (choice.k === 'CHOOSE_CARDS' && choice.from.startsWith('MARKET:')) {
		const hidden = new Set<string>(choice.hidden ?? [])
		const best = bestTrack(state, seat)
		let icons = 0
		for (const iid of intent.selection as CardInstanceId[]) {
			if (hidden.has(iid)) continue
			const def = state.cards[iid]?.def
			if (def === undefined || !hasCardDef(def)) continue
			for (const icon of cardDef(def).skills)
				if (icon === `SKILL_${best}` || icon === 'SKILL_ANY') icons++
		}
		return icons * PRIORS.gainSkillMatch
	}
	return 0
}

/** Score of one candidate in one world: apply, settle, evaluate. */
export function simulate(
	world: GameState,
	seat: Seat,
	intent: Intent,
	horizon: 'turn' | 'round' = 'turn',
	maxSettleSteps = 60,
	weights: readonly number[] = WEIGHT_VECTOR,
): number {
	let s: GameState
	let glory = 0
	try {
		const r = reduce(forkState(world), intent)
		s = r.state
		glory = glorySpentBy(r.events, seat)
	} catch {
		return Number.NEGATIVE_INFINITY
	}
	const settled = settle(s, seat, horizon, maxSettleSteps)
	glory += settled.glorySpent
	return evaluate(settled.state, seat, weights) - PRIORS.glorySpent * glory
}

/** Index of the argmax (first on ties). */
function argmax(values: readonly number[]): number {
	let best = 0
	for (let i = 1; i < values.length; i++)
		if (values[i]! > values[best]!) best = i
	return best
}

/** A softmax draw over `values` at temperature `t`. */
function softmaxPick(values: readonly number[], t: number, rng: Rng): number {
	const finite = values.map((v) => (Number.isFinite(v) ? v : -1e9))
	const top = Math.max(...finite)
	const weights = finite.map((v) => Math.exp((v - top) / t))
	const total = weights.reduce((a, b) => a + b, 0)
	const [u] = next(rng)
	let acc = 0
	for (let i = 0; i < weights.length; i++) {
		acc += weights[i]! / total
		if (u < acc) return i
	}
	return weights.length - 1
}

/** The heuristic bot (see the header). `normal`: samples 2, no noise. */
export function makeHeuristicBot(opts: HeuristicOptions = {}): Bot {
	const samples = Math.max(1, opts.samples ?? 2)
	const noise = Math.max(0, opts.noise ?? 0)
	const horizon = opts.horizon ?? 'turn'
	const maxSims = Math.max(1, opts.maxSims ?? 40)
	const maxSettle = opts.maxSettleSteps ?? 60
	const missionsFirst = opts.missionsFirst ?? true
	const weights =
		opts.weights === undefined ? WEIGHT_VECTOR : weightVector(opts.weights)
	const id = opts.id ?? 'normal'
	/** The decision; with `explain` also its DecisionInfo (built from the
	 *  scores already computed — the chosen intent never depends on it). */
	const choose = (
		state: GameState,
		seat: Seat,
		legal: Intent[],
		explain: boolean,
	): { intent: Intent; info: DecisionInfo | null } => {
		const cands = candidates(state, seat, legal)
		const forced = (intent: Intent) => ({
			intent,
			info: explain ? ruleInfo(id, 'forced', NOTE_FORCED) : null,
		})
		if (cands.length === 0) return forced(legal[0]!)
		if (cands.length === 1) return forced(cands[0]!)
		if (missionsFirst) {
			const mission = cands.find((c) => c.t === 'COMPLETE_MISSION')
			if (mission !== undefined)
				return {
					intent: mission,
					info: explain ? ruleInfo(id, 'rule', NOTE_MISSION) : null,
				}
		}
		let rng: Rng = {
			seed: (seedFromView(state, seat) ^ SAMPLER_SALT) >>> 0,
			counter: 0,
		}
		const bonus = cands.map((c) => priorBonus(state, seat, c))
		// the work cap: fewer worlds first, then only the top-prior candidates
		const worldsN = cands.length * samples <= maxSims ? samples : 1
		let pool = cands.map((_, i) => i)
		if (pool.length > maxSims) {
			pool = pool
				.sort((a, b) => bonus[b]! - bonus[a]! || a - b)
				.slice(0, maxSims)
				.sort((a, b) => a - b)
		}
		const worlds: GameState[] = []
		for (let k = 0; k < worldsN; k++) {
			const [w, r] = determinizeWith(state, seat, rng)
			worlds.push(w)
			rng = r
		}
		const scores = pool.map((i) => {
			let total = 0
			for (const w of worlds)
				total += simulate(w, seat, cands[i]!, horizon, maxSettle, weights)
			return total / worlds.length + bonus[i]!
		})
		const pick = noise > 0 ? softmaxPick(scores, noise, rng) : argmax(scores)
		const intent = cands[pool[pick]!]!
		if (!explain) return { intent, info: null }
		const rows: DecisionOption[] = pool.map((ci, k) => ({
			intent: cands[ci]!,
			score: Number.isFinite(scores[k]!) ? scores[k]! : -1e3,
			chosen: k === pick,
		}))
		return {
			intent,
			info: {
				botId: id,
				kind: 'heuristic',
				options: topOptions(rows, (o) => o.score),
				note: noise > 0 ? NOTE_EASY : undefined,
			},
		}
	}
	return {
		id,
		decide(state, seat, legal) {
			return choose(state, seat, legal, false).intent
		},
		decideExplained(state, seat, legal) {
			const r = choose(state, seat, legal, true)
			return { intent: r.intent, info: r.info! }
		},
	}
}
