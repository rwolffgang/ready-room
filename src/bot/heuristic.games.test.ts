// The heuristic house AI over whole games (todo/15 §4): it never returns an
// invalid intent, and it clearly beats the first-legal driver. `npm run
// test:all` runs these (vitest project bot-games); the quick checks are in
// heuristic.test.ts.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import { playBots } from './autoPlay'
import { firstLegalBot, makeBot } from './index'
import type { Bot } from './types'

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

/** A bot wrapper that records every (state, legal, answer). */
function recording(
	bot: Bot,
	log: { state: GameState; legal: Intent[]; out: Intent }[],
): Bot {
	return {
		id: bot.id,
		decide(state, seat, legal) {
			const out = bot.decide(state, seat, legal)
			log.push({ state, legal, out })
			return out
		},
	}
}

describe('heuristic bot over whole games', () => {
	it('never returns an invalid intent across full games (both seats, interrupts included)', () => {
		const games: [Deck, Deck, number][] = [
			['SIS', 'SEL', 21],
			['KOL', 'PIC', 22],
		]
		for (const [a, b, seed] of games) {
			const log: { state: GameState; legal: Intent[]; out: Intent }[] = []
			const easy = recording(makeBot('easy'), log)
			const normal = recording(makeBot('normal'), log)
			const r = playBots(setup(config(a, b, seed), catalog), [normal, easy])
			expect(r.stopped, `${a}/${b}`).toBe('GAME_OVER')
			expect(r.fallbacks, `${a}/${b}`).toBe(0)
			// "complete any completable mission immediately"
			for (const { legal, out } of log) {
				if (legal.some((i) => i.t === 'COMPLETE_MISSION'))
					expect(out.t).toBe('COMPLETE_MISSION')
			}
		}
	}, 60_000)

	it('beats first-legal in at least 8 of 10 seeded games with seat swaps', () => {
		const pairs: [Deck, Deck][] = [
			['PIC', 'SHR'],
			['SHR', 'KOL'],
			['KOL', 'SIS'],
			['SIS', 'SEL'],
			['SEL', 'PIC'],
		]
		const normal = makeBot('normal')
		let wins = 0
		let margin = 0
		for (let g = 0; g < 10; g++) {
			const [a, b] = pairs[Math.floor(g / 2)]!
			const seat = (g % 2) as Seat
			const bots: [Bot, Bot] =
				seat === 0 ? [normal, firstLegalBot] : [firstLegalBot, normal]
			const r = playBots(setup(config(a, b, 100 + g), catalog), bots)
			expect(r.stopped).toBe('GAME_OVER')
			expect(r.fallbacks).toBe(0)
			const res = r.state.result
			if (res?.kind !== 'COMPLETE') continue
			const board = res.scoreboard
			margin +=
				board.breakdown[seat].total - board.breakdown[seat === 0 ? 1 : 0].total
			if (board.winners.length === 1 && board.winners[0] === seat) wins++
		}
		expect(wins).toBeGreaterThanOrEqual(8)
		expect(margin / 10).toBeGreaterThan(0)
	}, 60_000)
})
