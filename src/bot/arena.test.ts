// Arena core (src/bot/arena.ts): stats helpers and the schedule. The smoke
// match set of normal vs first-legal is in arena.games.test.ts.

import { describe, expect, it } from 'vitest'

import {
	allPairings,
	deriveSeed,
	mean,
	parsePairings,
	pairingKey,
	quantile,
	scheduleGame,
	stdErr,
	tally,
	wilson,
	type MatchResult,
} from './arena'
import { botFromSpec, parseBotSpec, BOT_FACTORIES } from './registry'

describe('arena stats', () => {
	it('wilson matches the textbook interval', () => {
		// 8/10 at 95 %: [0.4902, 0.9433]
		const w = wilson(8, 10)
		expect(w.p).toBeCloseTo(0.8, 10)
		expect(w.lo).toBeCloseTo(0.4902, 3)
		expect(w.hi).toBeCloseTo(0.9433, 3)
		// 0/20 and 20/20 stay inside [0, 1] and are not degenerate
		expect(wilson(0, 20).lo).toBe(0)
		expect(wilson(0, 20).hi).toBeCloseTo(0.1611, 3)
		expect(wilson(20, 20).hi).toBe(1)
		expect(wilson(20, 20).lo).toBeCloseTo(0.8389, 3)
		// 50/100
		expect(wilson(50, 100).lo).toBeCloseTo(0.4038, 3)
		expect(wilson(50, 100).hi).toBeCloseTo(0.5962, 3)
		expect(wilson(0, 0)).toEqual({ p: NaN, lo: 0, hi: 1 })
	})

	it('mean, standard error and quantiles', () => {
		expect(mean([1, 2, 3, 4])).toBe(2.5)
		expect(Number.isNaN(mean([]))).toBe(true)
		// sd of [2,4,4,4,5,5,7,9] (sample) = 2.138; se = sd/√8
		expect(stdErr([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(
			2.138 / Math.sqrt(8),
			3,
		)
		expect(Number.isNaN(stdErr([1]))).toBe(true)
		expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 10)
		expect(quantile([5], 0.9)).toBe(5)
		expect(quantile([3, 1, 2], 0)).toBe(1)
		expect(quantile([3, 1, 2], 1)).toBe(3)
	})

	it('tally counts a draw as half a win', () => {
		const r = (winner: MatchResult['winner'], margin: number) =>
			({ winner, margin, intents: 100, burn: false }) as MatchResult
		const t = tally([r('A', 5), r('B', -3), r('draw', 0), r(null, 0)])
		expect(t.games).toBe(4)
		expect(t.finished).toBe(3)
		expect([t.aWins, t.bWins, t.draws]).toEqual([1, 1, 1])
		expect(t.aRate.p).toBeCloseTo(0.5, 10)
		expect(t.marginMean).toBeCloseTo(2 / 3, 10)
	})
})

describe('arena schedule', () => {
	it('covers the 56 ordered fuzz pairings and parses lists', () => {
		const all = allPairings()
		expect(all).toHaveLength(56)
		expect(new Set(all.map(pairingKey)).size).toBe(56)
		expect(parsePairings('nobur')).toHaveLength(42)
		const [p] = parsePairings('PIC.B-SHR')
		expect(p).toEqual({ decks: ['PIC', 'SHR'], sides: ['BASIC', 'ADVANCED'] })
		expect(pairingKey(p!)).toBe('PIC.B-SHR')
		expect(() => parsePairings('PIC-PIC')).toThrow()
		expect(() => parsePairings('PIC-XYZ')).toThrow()
	})

	it('pairs a game with its seat-swapped twin on the same setup', () => {
		const ps = allPairings()
		const g0 = scheduleGame(0, 7, ps)
		const g1 = scheduleGame(1, 7, ps)
		const g2 = scheduleGame(2, 7, ps)
		expect(g0.swap).toBe(false)
		expect(g1.swap).toBe(true)
		expect(g1.seed).toBe(g0.seed)
		expect(g1.pairing).toBe(g0.pairing)
		expect(g2.pairing).toBe(ps[1])
		expect(g2.seed).not.toBe(g0.seed)
		expect(deriveSeed(1, 0)).not.toBe(deriveSeed(2, 0))
		expect(deriveSeed(1, 0)).toBe(deriveSeed(1, 0))
	})
})

describe('bot registry', () => {
	it('parses specs and builds bots', () => {
		expect(parseBotSpec('heuristic:samples=4,noise=0.5')).toEqual({
			name: 'heuristic',
			params: { samples: '4', noise: '0.5' },
		})
		expect(botFromSpec('normal').id).toBe('normal')
		expect(botFromSpec('heuristic:samples=1,w.loc.secured=2').id).toBe('normal')
		expect(() => botFromSpec('nope')).toThrow(/unknown bot/)
		expect(() => botFromSpec('heuristic:samples=x')).toThrow()
		expect(() => botFromSpec('heuristic:w.nope=1')).toThrow()
		expect(Object.keys(BOT_FACTORIES)).toEqual(
			expect.arrayContaining(['first-legal', 'easy', 'normal', 'hard']),
		)
	})
})
