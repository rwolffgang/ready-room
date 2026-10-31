// Arena smoke (src/bot/arena.ts): a match set of normal vs first-legal with
// seat swaps, replayed and summarised. `npm run test:all` runs it (vitest
// project bot-games); stats and schedule are in arena.test.ts.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from '../engine/setup'
import { replay } from '../session/log'
import {
	parsePairings,
	playMatch,
	scheduleGame,
	summarize,
	type MatchResult,
} from './arena'
import { makeBot } from './index'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

describe('arena smoke (normal vs first-legal)', () => {
	it('4 seat-swapped games all finish, normal wins ≥ 3, labels follow the swap', () => {
		const normal = makeBot('normal')
		const first = makeBot('first-legal')
		const pairings = parsePairings('PIC-SHR,KOL-SIS')
		const results: MatchResult[] = []
		for (let i = 0; i < 4; i++) {
			const g = scheduleGame(i, 1, pairings)
			results.push(
				playMatch(catalog, g.pairing, g.seed, normal, first, g.swap, {
					recordEvery: 25,
					session: { now: () => new Date('2026-01-01T00:00:00Z') },
				}),
			)
		}
		for (const r of results) {
			expect(r.stopped, r.game).toBe('GAME_OVER')
			expect(r.aSeat).toBe(r.swap ? 1 : 0)
			expect(r.fallbacks).toEqual({ A: 0, B: 0 })
			// the session replays to the same final score, seat for seat
			const s = r.session!
			expect(s.log).toHaveLength(r.intents)
			const end = replay(s, catalog)
			expect(end.result?.kind).toBe('COMPLETE')
			if (end.result?.kind !== 'COMPLETE') continue
			const board = end.result.scoreboard
			expect(board.breakdown[r.aSeat].total).toBe(r.vp.A)
			expect(board.breakdown[1 - r.aSeat]!.total).toBe(r.vp.B)
			const aWon = board.winners.length === 1 && board.winners[0] === r.aSeat
			expect(r.winner === 'A').toBe(aWon)
			expect(r.margin).toBe(r.vp.A - r.vp.B)
			// records: outcome and margin from the deciding seat's side
			expect(r.records!.length).toBeGreaterThan(0)
			for (const rec of r.records!) {
				const mine = rec.seat === r.aSeat ? 'A' : 'B'
				expect(rec.outcome).toBe(
					r.winner === 'draw' ? 0 : r.winner === mine ? 1 : -1,
				)
				expect(rec.margin).toBe(mine === 'A' ? r.margin : -r.margin)
				expect(rec.features).toHaveLength(rec.opp.length)
			}
			// normal's decisions are timed under A, first-legal's under B
			expect(r.decisionMs.A.length).toBeGreaterThan(0)
			expect(r.decisionMs.B.length).toBeGreaterThan(0)
		}
		const s = summarize('normal', 'first-legal', results)
		expect(s.total.aWins).toBeGreaterThanOrEqual(3)
		expect(s.abnormal).toEqual([])
		expect(s.timing.A.fallbacks + s.timing.B.fallbacks).toBe(0)
		expect(Object.keys(s.byPairing)).toEqual(['PIC-SHR', 'KOL-SIS'])
		// the swapped twin replays the same setup with the bots exchanged
		expect(results[1]!.session!.setup).toEqual(results[0]!.session!.setup)
	}, 60_000)
})
