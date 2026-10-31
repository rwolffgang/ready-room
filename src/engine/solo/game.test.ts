// Whole solo games against the official Bot (rules/13), driven to the end by
// autoPlay — the human by the first-legal policy, the Bot by BOT_STEPs and its
// own choice policy — with every invariant checked after every intent. One
// game per Bot crew and difficulty level (a human crew the Bot doesn't play);
// FUZZ_SEEDS widens it to more seeds.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { setup, type CardCatalog, type SetupConfig } from '../setup'
import { autoPlay } from '../../bot/autoPlay'
import { assertInvariants } from '../invariants'
import { SOLO_LEVELS, zonesOf, type GameState, type SoloLevel } from '../state'
import type { DeckId } from '../../data/ids'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

const BOTS: DeckId[] = ['PIC', 'SHR', 'KOL', 'SEL', 'SIS', 'BUR']
/** The human's crew opposite each Bot (any other crew would do). */
const HUMAN: Record<string, DeckId> = {
	PIC: 'SHR',
	SHR: 'KOL',
	KOL: 'SIS',
	SEL: 'PIC',
	SIS: 'SEL',
	BUR: 'MAL',
}

export function soloConfig(
	bot: DeckId,
	level: SoloLevel,
	seed: number,
	human: DeckId = HUMAN[bot]!,
): SetupConfig {
	return {
		mode: 'SOLO',
		players: [
			{ deck: human, boardSide: 'BASIC' },
			{ deck: bot, boardSide: 'BASIC' },
		],
		seed,
		solo: { level },
	}
}

function seeds(): number[] {
	const n = Number(process.env['FUZZ_SEEDS'] ?? 1)
	return Array.from({ length: n }, (_, i) => i + 1)
}

describe('solo setup (rules/13 §13.2)', () => {
	it('builds the Bot board: Supplement, Bot deck, no hand or resources, the level’s Stardates', () => {
		const s = setup(soloConfig('KOL', 'COMMANDER', 3), catalog)
		const bot = s.players[1]
		expect(s.mode).toBe('SOLO')
		expect(s.solo).toMatchObject({ bot: 1, crew: 'KOL', level: 'COMMANDER' })
		expect(s.startingSeat).toBe(0)
		expect(zonesOf(s, { k: 'HAND', seat: 1 })).toEqual([])
		expect(bot.resources).toEqual({ DIL: 0, LAT: 0, GLO: 0 })
		expect(bot.actions.available).toBe(0)
		expect(bot.missions).toEqual([])
		expect(zonesOf(s, { k: 'SUPPLEMENT', seat: 1 }).length).toBeGreaterThan(0)
		expect(zonesOf(s, { k: 'DRAW', seat: 1 }).length).toBeGreaterThan(0)
		expect(zonesOf(s, { k: 'RESERVE', seat: 1 })).toEqual([])
		expect(zonesOf(s, { k: 'DEVELOPMENT', seat: 1 })).toEqual([])
		// Commander: 2,3,3,3,4 Bot actions
		expect(s.stardates.botActions).toEqual([2, 3, 3, 3, 4])
		expect(s.stardates.pile).toHaveLength(5)
		// the human's own setup is untouched
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toHaveLength(5)
	})

	it('rejects the same crew on both sides and a crew without a Bot', () => {
		expect(() =>
			setup(soloConfig('PIC', 'ENSIGN', 1, 'PIC'), catalog),
		).toThrow(/same crew/)
		expect(() =>
			setup(soloConfig('MAL', 'ENSIGN', 1, 'PIC'), catalog),
		).toThrow(/Automated Command/)
	})
})

describe('whole solo games', () => {
	const grid: [DeckId, SoloLevel][] = []
	for (const bot of BOTS)
		for (const level of SOLO_LEVELS) grid.push([bot, level])

	it.each(grid)(
		'%s Bot at %s: reaches the end, invariants after every intent',
		(bot, level) => {
			for (const seed of seeds()) {
				let before: GameState | undefined
				const r = autoPlay(
					setup(soloConfig(bot, level, seed), catalog),
					undefined,
					undefined,
					(s) => {
						assertInvariants(s, { since: before })
						before = s
					},
				)
				expect(r.stopped, `${bot} ${level} seed ${seed}`).toBe('GAME_OVER')
				const end = r.state
				// the game always ends with a Bot turn (rules/13 §13.13.1)
				expect(end.turnsTaken[1]).toBe(end.turnsTaken[0])
				expect(end.result?.kind).toBe('COMPLETE')
			}
		},
	)
})
