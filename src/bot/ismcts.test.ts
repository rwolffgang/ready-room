// The ISMCTS house AI (todo/15 §4): deterministic for an iteration budget,
// instant on forced decisions, blind to the hidden arrangement and
// availability-counted. The whole-game checks (always legal, stronger than
// first-legal) are in ismcts.games.test.ts.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { legalIntents } from '../engine/intents'
import { validateChoice } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import { autoPlay } from './autoPlay'
import { candidates } from './candidates'
import { makeBot } from './index'
import { makeIsmctsBot, search } from './ismcts'
import { botFromSpec } from './registry'

let catalog: CardCatalog

beforeAll(async () => {
	catalog = await loadCatalog()
})

type Deck = 'PIC' | 'SHR' | 'KOL' | 'SIS' | 'SEL'

function config(a: Deck, b: Deck, seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: a, boardSide: 'ADVANCED' },
			{ deck: b, boardSide: 'ADVANCED' },
		],
		seed,
	}
}

/** States along a first-legal game. */
function statesOf(a: Deck, b: Deck, seed: number, cap = 400): GameState[] {
	const out: GameState[] = []
	autoPlay(setup(config(a, b, seed), catalog), undefined, cap, (s) => {
		out.push(s)
	})
	return out
}

/** The `n`-th top-level Action Step decision of `seat` with at least
 *  `minCands` candidates, along a first-legal game. */
function actionState(seat: Seat, n: number, minCands = 3): GameState {
	let seen = 0
	for (const s of statesOf('PIC', 'SHR', 3, 2000)) {
		if (
			s.result === null &&
			s.pendingChoice === null &&
			s.phase.k === 'ACTION' &&
			s.activeSeat === seat &&
			candidates(s, seat, legalIntents(s)).length >= minCands &&
			++seen === n
		)
			return s
	}
	throw new Error('no such state')
}

/** The same state with the hidden arrangement changed (as in
 *  determinize.test.ts): the opponent's hand + Draw deck reversed across both
 *  zones, `seat`'s own Draw deck reversed. */
function rearranged(state: GameState, seat: Seat): GameState {
	const opp: Seat = seat === 0 ? 1 : 0
	const zones = { ...state.zones }
	const cards = { ...state.cards }
	const move = (keys: string[]): void => {
		const all = keys.flatMap((k) => state.zones[k] ?? [])
		const flipped = [...all].reverse()
		let i = 0
		for (const key of keys) {
			const size = (state.zones[key] ?? []).length
			const ref = state.cards[(state.zones[key] ?? [])[0]!]?.zone
			const ids = flipped.slice(i, i + size)
			i += size
			zones[key] = ids
			for (const iid of ids)
				cards[iid] = { ...state.cards[iid]!, zone: { ...ref! } }
		}
	}
	move([`HAND:${opp}`, `DRAW:${opp}`])
	move([`DRAW:${seat}`])
	return { ...state, zones, cards }
}

function accepted(state: GameState, legal: Intent[], out: Intent): boolean {
	if (out.t === 'RESOLVE_CHOICE')
		return validateChoice(state, out.choiceId, out.selection).ok
	return legal.some((l) => JSON.stringify(l) === JSON.stringify(out))
}

describe('ISMCTS bot', () => {
	it('is deterministic for an iteration budget and does not mutate', () => {
		const s = actionState(0, 3)
		const legal = legalIntents(s)
		const before = JSON.stringify(s)
		const a = makeIsmctsBot({ iterations: 60 }).decide(s, 0, legal)
		expect(JSON.stringify(s)).toBe(before)
		expect(makeIsmctsBot({ iterations: 60 }).decide(s, 0, legal)).toEqual(a)
		expect(botFromSpec('ismcts:iters=60').decide(s, 0, legal)).toEqual(a)
	})

	it('takes a forced decision (and a completable mission) without searching', () => {
		// an unbounded budget would never return if it searched
		const bot = makeIsmctsBot({ iterations: Number.MAX_SAFE_INTEGER })
		const s = setup(config('PIC', 'SHR', 1), catalog)
		const legal = legalIntents(s)
		expect(candidates(s, s.activeSeat, legal)).toHaveLength(1)
		expect(bot.decide(s, s.activeSeat, legal)).toEqual(legal[0])
		const withMission = statesOf('KOL', 'PIC', 22, 2000).find(
			(x) =>
				x.pendingChoice === null &&
				legalIntents(x).some((i) => i.t === 'COMPLETE_MISSION'),
		)
		if (withMission !== undefined) {
			const ml = legalIntents(withMission)
			expect(bot.decide(withMission, withMission.activeSeat, ml).t).toBe(
				'COMPLETE_MISSION',
			)
		}
	})

	it('does not leak the hidden arrangement (no-cheat invariance)', () => {
		for (const seat of [0, 1] as const) {
			const s = actionState(seat, 2)
			const t = rearranged(s, seat)
			expect(JSON.stringify(t.zones)).not.toBe(JSON.stringify(s.zones))
			const bot = makeIsmctsBot({ iterations: 48 })
			const ls = legalIntents(s)
			const lt = legalIntents(t)
			expect(bot.decide(t, seat, lt)).toEqual(bot.decide(s, seat, ls))
			// the whole root statistics agree, not just the argmax
			const rs = search(s, seat, candidates(s, seat, ls), { iterations: 48 })
			const rt = search(t, seat, candidates(t, seat, lt), { iterations: 48 })
			expect(rt.stats).toEqual(rs.stats)
		}
	})

	it('counts availability: root edges are available every iteration, visits sum up', () => {
		const s = actionState(1, 2, 4)
		const cands = candidates(s, 1, legalIntents(s))
		const iterations = 40
		// no widening: every root candidate is eligible in every world
		const { stats } = search(s, 1, cands, { iterations, widen: 0 })
		expect(stats.iterations).toBe(iterations)
		expect(stats.root).toHaveLength(cands.length)
		for (const r of stats.root) {
			expect(r.avail).toBe(iterations)
			expect(r.n).toBeLessThanOrEqual(r.avail)
		}
		expect(stats.root.reduce((a, r) => a + r.n, 0)).toBe(iterations)
		// with widening, only the top-prior edges are eligible early on
		const wide = search(s, 1, cands, { iterations, widen: 0.5, widenK: 1 })
		const avails = wide.stats.root.map((r) => r.avail)
		expect(Math.min(...avails)).toBeLessThan(iterations)
		expect(Math.max(...avails)).toBe(iterations)
		for (const r of wide.stats.root) expect(r.n).toBeLessThanOrEqual(r.avail)
	})

	it('stops at a time budget through the injected clock', () => {
		const s = actionState(0, 3)
		let now = 0
		const clock = (): number => (now += 10)
		const { stats } = search(s, 0, candidates(s, 0, legalIntents(s)), {
			timeMs: 100,
			clock,
		})
		expect(stats.iterations).toBeGreaterThan(0)
		expect(stats.iterations).toBeLessThan(12)
	})

	it("makeBot('hard') is the ISMCTS search, time-boxed by an injected clock", () => {
		const s = actionState(0, 3)
		const legal = legalIntents(s)
		let now = 0
		let calls = 0
		const clock = (): number => {
			calls++
			return (now += 1000)
		}
		const hard = makeBot('hard', { clock })
		expect(hard.id).toBe('hard')
		const out = hard.decide(s, 0, legal)
		expect(accepted(s, legal, out)).toBe(true)
		// HARD_TIME_MS = 1500 at 1000 ms per clock read: a couple of iterations
		expect(calls).toBeGreaterThan(0)
		expect(calls).toBeLessThan(5)
	})
})
