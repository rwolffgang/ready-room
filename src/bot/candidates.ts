// Decision options for search bots (house AI, todo/15 §4).
//
// `candidates(state, seat, legal)` lists the intents a bot should consider:
//
//   * no pending choice → the legal intents, deduplicated structurally, with
//     PASS / END_TURN moved last. In the Action Step PASS is dropped when
//     END_TURN is offered (both run the same ACTION → CLEAN-UP boundary);
//   * a pending choice → RESOLVE_CHOICE intents generated from the choice's
//     own data (every option, small card subsets, a few amounts and orders),
//     each filtered through the engine's `checkSelection` gate. The
//     first-legal selection is always included, as the fallback.
//
// Only information the deciding seat may see is used: the choice is its own,
// and a candidate the choice flags `hidden` (a blind deck-top pick) gets a
// neutral prior instead of its face's value.

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { firstLegalSelection } from '../engine/intents'
import type { PendingChoice } from '../engine/resolver/choices'
import { checkSelection } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import type { CardInstanceId } from '../engine/ids'
import { firstLegalPolicy } from './autoPlay'
import { cardValuePrior } from './evaluate'

export { cardValuePrior }

/** Upper bound on generated candidates per choice. */
export const MAX_CANDIDATES = 24

/** How many orderings ORDER_* choices get. */
const MAX_ORDERS = 8

/** Structural key of an intent (choice ids normalised away). */
export function intentKey(intent: Intent): string {
	if (intent.t !== 'RESOLVE_CHOICE') return JSON.stringify(intent)
	return `RESOLVE_CHOICE:${JSON.stringify(intent.selection)}`
}

function dedupe(intents: Intent[]): Intent[] {
	const seen = new Set<string>()
	const out: Intent[] = []
	for (const i of intents) {
		const k = intentKey(i)
		if (seen.has(k)) continue
		seen.add(k)
		out.push(i)
	}
	return out
}

/** The decision options of `seat` in `state` (see the header). Never empty
 *  while `legal` is non-empty. */
export function candidates(
	state: GameState,
	seat: Seat,
	legal: Intent[],
): Intent[] {
	const choice = state.pendingChoice
	if (choice === null) {
		let top = dedupe(legal)
		if (
			state.phase.k === 'ACTION' &&
			top.some((i) => i.t === 'END_TURN') &&
			top.some((i) => i.t === 'PASS')
		) {
			top = top.filter((i) => i.t !== 'PASS')
		}
		// the turn-ending intents go last, so a tie favours doing something
		// (as the first-legal driver does)
		const ends = (i: Intent): boolean => i.t === 'PASS' || i.t === 'END_TURN'
		return [...top.filter((i) => !ends(i)), ...top.filter(ends)]
	}
	const selections: unknown[] = []
	// the fallbacks first: the first-legal policy, then the engine's probe
	selections.push(firstLegalPolicy(state, choice))
	const offered = legal.find((i) => i.t === 'RESOLVE_CHOICE')
	selections.push(
		offered !== undefined && offered.t === 'RESOLVE_CHOICE'
			? offered.selection
			: firstLegalSelection(state),
	)
	selections.push(...choiceSelections(state, seat, choice))
	const out: Intent[] = []
	const seen = new Set<string>()
	for (const selection of selections) {
		if (out.length >= MAX_CANDIDATES) break
		if (selection === undefined || !checkSelection(choice, selection).ok)
			continue
		const key = JSON.stringify(normaliseSelection(choice, selection))
		if (seen.has(key)) continue
		seen.add(key)
		out.push({ t: 'RESOLVE_CHOICE', choiceId: choice.id, selection })
	}
	if (out.length === 0 && offered !== undefined) out.push(offered)
	return out
}

/** Card-subset selections are sets: normalise their order for dedupe. */
function normaliseSelection(
	choice: PendingChoice,
	selection: unknown,
): unknown {
	if (choice.k !== 'CHOOSE_CARDS' || !Array.isArray(selection)) return selection
	return [...(selection as string[])].sort()
}

/** Raw selections generated from a choice's own data, roughly best-guess
 *  first. Unfiltered: `candidates` checks each one. */
export function choiceSelections(
	state: GameState,
	seat: Seat,
	choice: PendingChoice,
): unknown[] {
	switch (choice.k) {
		case 'CONFIRM':
			return [true, false]
		case 'CHOOSE_OPTION':
			return choice.options
				.filter((o) => o.enabled)
				.map((o) => ({ key: o.key }))
		case 'CHOOSE_CARDS': {
			const subsets = cardSubsets(state, seat, choice)
			// an optional pick below its min: the empty selection declines
			return choice.optional === true && choice.min > 0
				? [...subsets, []]
				: subsets
		}
		case 'CHOOSE_LOCATION':
			return [...choice.candidates]
		case 'CHOOSE_SUIT':
			return [...choice.suits]
		case 'CHOOSE_TRAIT':
			return [...choice.traits]
		case 'CHOOSE_SPECIALTY':
			return [...choice.specialties]
		case 'CHOOSE_DESTINATION':
			return [...choice.options]
		case 'CHOOSE_AMOUNT': {
			const { min, max } = choice
			const span = max - min
			const out = [max, min]
			for (const q of [0.25, 0.5, 0.75]) out.push(min + Math.round(span * q))
			return out
		}
		case 'ORDER_OPERATIONS':
			return orderings(choice.pending)
		case 'OPTIONAL_TRIGGERS': {
			const offered = choice.offered
			const out: unknown[] = [[], [...offered]]
			for (const ref of offered) out.push([ref])
			return out.slice(0, MAX_ORDERS + 2)
		}
		case 'CHOOSE_WITNESS':
			return choice.sets.map((s) => [...s])
		case 'CHOOSE_WILDCARD_AS':
			return [...choice.traits]
		case 'ORDER_CARDS':
			return orderings(choice.cards)
	}
}

/** The given order, its reverse, and each element moved to the front. */
function orderings<T>(items: readonly T[]): T[][] {
	const out: T[][] = [[...items], [...items].reverse()]
	for (let i = 1; i < items.length && out.length < MAX_ORDERS; i++) {
		out.push([items[i]!, ...items.slice(0, i), ...items.slice(i + 1)])
	}
	return out
}

function binom(n: number, k: number): number {
	if (k < 0 || k > n) return 0
	let r = 1
	for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
	return Math.round(r)
}

/** CHOOSE_CARDS subsets: all of them when Σ C(n, k) over min..max is at most
 *  MAX_CANDIDATES; otherwise the best-first and worst-first prefixes of every
 *  allowed size (by `cardValuePrior`) plus the singletons, capped. */
function cardSubsets(
	state: GameState,
	seat: Seat,
	choice: Extract<PendingChoice, { k: 'CHOOSE_CARDS' }>,
): CardInstanceId[][] {
	const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
	const legal = choice.candidates.filter((iid) => !disabled.has(iid))
	const n = legal.length
	const min = Math.max(0, choice.min)
	const max = Math.min(choice.max, n)
	if (min > max) return []
	let total = 0
	for (let k = min; k <= max; k++) total += binom(n, k)
	if (total <= MAX_CANDIDATES) {
		const out: CardInstanceId[][] = []
		const pick = (start: number, acc: CardInstanceId[]): void => {
			if (acc.length >= min && acc.length <= max) out.push([...acc])
			if (acc.length === max) return
			for (let i = start; i < n; i++) {
				acc.push(legal[i]!)
				pick(i + 1, acc)
				acc.pop()
			}
		}
		pick(0, [])
		return out
	}
	const hidden = new Set<string>(choice.hidden ?? [])
	const value = new Map(
		legal.map((iid) => [iid, cardValuePrior(state, iid, seat, hidden)]),
	)
	const bestFirst = [...legal].sort(
		(a, b) =>
			value.get(b)! - value.get(a)! || legal.indexOf(a) - legal.indexOf(b),
	)
	const worstFirst = [...bestFirst].reverse()
	const out: CardInstanceId[][] = []
	for (let k = min; k <= max; k++) {
		out.push(bestFirst.slice(0, k))
		out.push(worstFirst.slice(0, k))
	}
	if (min <= 1 && max >= 1) for (const iid of bestFirst) out.push([iid])
	return out.slice(0, MAX_CANDIDATES * 2)
}
