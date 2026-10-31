// The ISMCTS house AI over whole games (todo/15 §4): legal at every decision
// of a game, and stronger than first-legal. `npm run test:all` runs these
// (vitest project bot-games); the quick checks are in ismcts.test.ts.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { legalIntents } from '../engine/intents'
import { validateChoice } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import { autoPlay, playBots } from './autoPlay'
import { firstLegalBot } from './index'
import { makeIsmctsBot } from './ismcts'
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

/** States along a first-legal game. */
function statesOf(a: Deck, b: Deck, seed: number, cap = 400): GameState[] {
	const out: GameState[] = []
	autoPlay(setup(config(a, b, seed), catalog), undefined, cap, (s) => {
		out.push(s)
	})
	return out
}

function accepted(state: GameState, legal: Intent[], out: Intent): boolean {
	if (out.t === 'RESOLVE_CHOICE')
		return validateChoice(state, out.choiceId, out.selection).ok
	return legal.some((l) => JSON.stringify(l) === JSON.stringify(out))
}

describe('ISMCTS bot over whole games', () => {
	it('always returns a legal intent (choices of both seats included)', () => {
		const bot = makeIsmctsBot({ iterations: 24 })
		let checked = 0
		const states = statesOf('SIS', 'SEL', 21, 600)
		for (let i = 0; i < states.length; i += 7) {
			const s = states[i]!
			if (s.result !== null) continue
			const seat: Seat = s.pendingChoice?.seat ?? s.activeSeat
			const legal = legalIntents(s)
			if (legal.length === 0) continue
			const out = bot.decide(s, seat, legal)
			expect(accepted(s, legal, out), JSON.stringify(out)).toBe(true)
			checked++
		}
		expect(checked).toBeGreaterThan(20)
	}, 30_000)

	it('beats first-legal in a seat-swapped pair of games', () => {
		const hard = makeIsmctsBot({ iterations: 16 })
		let wins = 0
		for (const seat of [0, 1] as const) {
			const bots: [Bot, Bot] =
				seat === 0 ? [hard, firstLegalBot] : [firstLegalBot, hard]
			const r = playBots(setup(config('KOL', 'SIS', 101), catalog), bots)
			expect(r.stopped).toBe('GAME_OVER')
			expect(r.fallbacks).toBe(0)
			const res = r.state.result
			if (res?.kind !== 'COMPLETE') continue
			if (
				res.scoreboard.winners.length === 1 &&
				res.scoreboard.winners[0] === seat
			)
				wins++
		}
		expect(wins).toBe(2)
	}, 60_000)
})
