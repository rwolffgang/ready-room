// determinize / seedFromView (house AI, todo/15 §4): the resampled world keeps
// everything the seat can see, keeps the hidden multiset and zone sizes,
// stays a valid engine state, and — the no-cheat property — does not depend
// on the hidden arrangement at all.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import { zoneKey } from '../engine/state'
import { legalIntents } from '../engine/intents'
import { hiddenCards } from '../engine/projection'
import { assertInvariants, assertSerialisable } from '../engine/invariants'
import type { Seat } from '../engine/resolver/queries'
import type { CardInstanceId } from '../engine/ids'
import { autoPlay } from './autoPlay'
import {
	determinize,
	determinizeWith,
	hiddenPools,
	seedFromSeatView,
	seedFromView,
} from './determinize'
import { makeHeuristicBot } from './heuristic'

let catalog: CardCatalog

beforeAll(async () => {
	catalog = await loadCatalog()
})

/** A real mid-game state: first-legal play from a seeded setup until the
 *  `n`-th top-level Action Step decision of `seat`. */
function midGame(seat: Seat, n: number, seed = 3): GameState {
	const start = setup(
		{
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'PIC', boardSide: 'ADVANCED' },
				{ deck: 'SHR', boardSide: 'ADVANCED' },
			],
			seed,
		},
		catalog,
	)
	let found: GameState | undefined
	let seen = 0
	autoPlay(start, undefined, 2000, (s) => {
		if (
			found === undefined &&
			s.result === null &&
			s.pendingChoice === null &&
			s.phase.k === 'ACTION' &&
			s.activeSeat === seat &&
			++seen === n
		)
			found = s
	})
	if (found === undefined) throw new Error('no such mid-game state')
	return found
}

/** The same state with the hidden arrangement changed: the opponent's hand +
 *  Draw deck cards reversed across both zones (sizes kept), and `seat`'s own
 *  Draw deck reversed. Nothing `seat` can see differs. */
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

describe('determinize', () => {
	it('keeps zone sizes, visible zones and the hidden multiset; reseeds the rng', () => {
		const s = midGame(0, 4)
		const w = determinize(s, 0, { seed: 7, counter: 0 })
		assertSerialisable(w)
		const hidden = hiddenCards(s, 0)
		expect(hiddenCards(w, 0)).toEqual(hidden)
		for (const key of Object.keys(s.zones)) {
			expect(w.zones[key]!.length, key).toBe(s.zones[key]!.length)
			const visible = s.zones[key]!.every((iid) => !hidden.has(iid))
			if (visible) expect(w.zones[key], key).toEqual(s.zones[key])
			// every card's zone ref agrees with the zone array it sits in
			for (const iid of w.zones[key]!)
				expect(zoneKey(w.cards[iid]!.zone)).toBe(key)
		}
		for (const [iid, card] of Object.entries(s.cards)) {
			if (!hidden.has(iid as CardInstanceId)) expect(w.cards[iid]).toEqual(card)
		}
		// per pool, the same cards (each with its own owner and face)
		const before = hiddenPools(s, 0)
		const after = hiddenPools(w, 0)
		expect(after.map((p) => [p.key, p.iids])).toEqual(
			before.map((p) => [p.key, p.iids]),
		)
		for (const iid of hidden) {
			expect(w.cards[iid]!.def).toBe(s.cards[iid]!.def)
			expect(w.cards[iid]!.owner).toBe(s.cards[iid]!.owner)
		}
		expect(w.rng.seed).not.toBe(s.rng.seed)
		expect(w.rng.counter).toBe(s.rng.counter)
		// the opponent's hand really is resampled for some seed
		const handOf = (g: GameState) => [...g.zones['HAND:1']!].sort()
		const samples = Array.from({ length: 8 }, (_, i) =>
			JSON.stringify(handOf(determinize(s, 0, { seed: i, counter: 0 }))),
		)
		expect(new Set(samples).size).toBeGreaterThan(1)
	})

	it('pins the cards the stack or the pending choice reference', () => {
		// a state with a pending choice: step until one appears
		const start = midGame(1, 2)
		let withChoice: GameState | undefined
		autoPlay(start, undefined, 400, (s) => {
			if (withChoice === undefined && s.pendingChoice !== null) withChoice = s
		})
		const s = withChoice!
		const w = determinize(s, s.pendingChoice!.seat, { seed: 1, counter: 0 })
		expect(w.pendingChoice).toEqual(s.pendingChoice)
		expect(JSON.stringify(w.stack)).toBe(JSON.stringify(s.stack))
	})

	it('reduce keeps working on the result (autoPlay to the end, invariants hold)', () => {
		for (const seat of [0, 1] as const) {
			const s = midGame(seat, 3)
			const w = determinize(s, seat, { seed: 11, counter: 0 })
			const r = autoPlay(w, undefined, 3000, (st) => assertInvariants(st))
			expect(r.stopped).toBe('GAME_OVER')
		}
	})

	it('does not leak the hidden arrangement (no-cheat invariance)', () => {
		const s = midGame(0, 5)
		const t = rearranged(s, 0)
		expect(JSON.stringify(t.zones)).not.toBe(JSON.stringify(s.zones))
		const rng = { seed: 42, counter: 0 }
		expect(determinize(t, 0, rng)).toEqual(determinize(s, 0, rng))
		expect(determinizeWith(t, 0, rng)[1]).toEqual(determinizeWith(s, 0, rng)[1])
		expect(seedFromView(t, 0)).toBe(seedFromView(s, 0))
		expect(seedFromSeatView(t, 0)).toBe(seedFromSeatView(s, 0))
		// …and so the heuristic bot plays the same intent in both
		const bot = makeHeuristicBot()
		expect(bot.decide(t, 0, legalIntents(t))).toEqual(
			bot.decide(s, 0, legalIntents(s)),
		)
		// while what the seat CAN see does change the seed
		const p0 = s.players[0]
		const u: GameState = {
			...s,
			players: [
				{ ...p0, resources: { ...p0.resources, DIL: p0.resources.DIL + 1 } },
				s.players[1],
			],
		}
		expect(seedFromView(u, 0)).not.toBe(seedFromView(s, 0))
	})

	it('does not leak the official solo Bot’s hidden cards (no-cheat, solo)', () => {
		// your Action step a few turns into a solo game against the Bot
		const start = setup(
			{
				mode: 'SOLO',
				players: [
					{ deck: 'SIS', boardSide: 'ADVANCED' },
					{ deck: 'KOL', boardSide: 'BASIC' },
				],
				seed: 9,
				solo: { level: 'CAPTAIN' },
			},
			catalog,
		)
		let s: GameState | undefined
		let seen = 0
		autoPlay(start, undefined, 2000, (x) => {
			if (
				s === undefined &&
				x.result === null &&
				x.pendingChoice === null &&
				x.phase.k === 'ACTION' &&
				x.activeSeat === 0 &&
				++seen === 4
			)
				s = x
		})
		if (s === undefined) throw new Error('no solo mid-game state')
		// the Bot's deck + Captain's Log and its Supplement, each reversed
		const flip = (st: GameState, keys: string[]): GameState => {
			const zones = { ...st.zones }
			const cards = { ...st.cards }
			const all = keys.flatMap((k) => st.zones[k] ?? []).reverse()
			let i = 0
			for (const key of keys) {
				const size = (st.zones[key] ?? []).length
				const ref = st.cards[(st.zones[key] ?? [])[0]!]?.zone
				if (size === 0) continue // (an absent zone stays absent)
				const ids = all.slice(i, i + size)
				i += size
				zones[key] = ids
				for (const iid of ids) cards[iid] = { ...st.cards[iid]!, zone: { ...ref! } }
			}
			return { ...st, zones, cards }
		}
		const t = flip(flip(s, ['DRAW:1', 'LOG:1']), ['SUPPLEMENT:1'])
		expect(JSON.stringify(t.zones)).not.toBe(JSON.stringify(s.zones))
		const rng = { seed: 7, counter: 0 }
		expect(determinize(t, 0, rng)).toEqual(determinize(s, 0, rng))
		expect(seedFromView(t, 0)).toBe(seedFromView(s, 0))
		const bot = makeHeuristicBot()
		expect(bot.decide(t, 0, legalIntents(t))).toEqual(
			bot.decide(s, 0, legalIntents(s)),
		)
	})
})
