// The Five-Year Mission campaign record (rules/14): ranks and the mode table,
// opponents, the logbook, upgrades (Option A / B and the Market-only
// challenge), the challenges a next game is set up with, the end and the
// performance review, and storage.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from '../engine/setup'
import type { BotCard, CardDef } from '../data/schema'
import type { DeckId } from '../data/ids'
import {
	applyUpgrade,
	campaignSetup,
	currentGame,
	isOver,
	listCampaigns,
	loadCampaign,
	newCampaign,
	nextGameConfig,
	nextLevel,
	nextStep,
	opponents,
	performanceReview,
	rankOf,
	recordResult,
	saveCampaign,
	startGame,
	upgradeOptions,
	type Campaign,
	type Challenge,
} from './campaign'
import { InMemoryStorage } from './persistence'

let catalog: CardCatalog
let defs: Map<string, CardDef>
const bot = (d: DeckId): BotCard => catalog.bots!.find((b) => b.deck === d)!
beforeAll(async () => {
	catalog = await loadCatalog()
	defs = new Map(catalog.defs.map((d) => [d.id, d]))
})

const NOW = '2026-10-31T12:00:00.000Z'
const BOTS: DeckId[] = ['PIC', 'SHR', 'KOL', 'SEL', 'SIS', 'BUR']

function campaign(
	challenges: Challenge[] = [],
	mode: Campaign['mode'] = 'NORMAL',
) {
	return newCampaign({
		id: 'c1',
		crew: 'PIC',
		side: 'BASIC',
		mode,
		challenges,
		now: NOW,
	})
}

/** Play one game against `vs` to its end, then skip its upgrade. */
function play(
	c: Campaign,
	vs: DeckId,
	won: boolean,
	marketOwned: string[] = [],
): Campaign {
	const id = `g${c.games.length}`
	c = startGame(c, nextGameConfig(c, vs, c.games.length + 1), id, NOW)
	return recordResult(
		c,
		{ sessionId: id, score: won ? [50, 40] : [40, 50], won, marketOwned },
		NOW,
	)
}

function skipUpgrade(c: Campaign): Campaign {
	const o = upgradeOptions(c, bot(c.games[c.games.length - 1]!.bot), defs)!
	if (o.cards.length > 0)
		return applyUpgrade(c, o, { k: 'CARD', def: o.cards[0]! }, NOW)
	const b = o.bonuses[0]
	if (b !== undefined)
		return applyUpgrade(c, o, { k: 'BONUS', ref: b.ref, def: b.cards[0] }, NOW)
	return applyUpgrade(c, o, { k: 'NONE' }, NOW)
}

describe('ranks, the mode table and opponents (rules/14 §14.1–14.2)', () => {
	it('promotes one rank per win and sets the Bot by rank and mode', () => {
		let c = campaign([], 'NORMAL')
		expect(rankOf(c)).toBe('ENSIGN')
		expect(nextLevel(c)).toBe('LIEUTENANT')
		c = skipUpgrade(play(c, 'KOL', true))
		expect(rankOf(c)).toBe('LIEUTENANT')
		expect(nextLevel(c)).toBe('COMMANDER')
		c = skipUpgrade(play(c, 'SEL', false))
		expect(rankOf(c)).toBe('LIEUTENANT')
		expect(nextLevel({ ...c, mode: 'BRUTAL' })).toBe('ADMIRAL')
		expect(nextLevel({ ...c, mode: 'EASY' })).toBe('LIEUTENANT')
	})

	it('never offers your own crew or a crew you have beaten', () => {
		let c = skipUpgrade(play(campaign(), 'KOL', true))
		c = skipUpgrade(play(c, 'SEL', false))
		expect(opponents(c, BOTS)).toEqual(['SHR', 'SEL', 'SIS', 'BUR'])
	})

	it('ends at Admiral, or after ten games', () => {
		let c = campaign()
		for (const d of ['SHR', 'KOL', 'SEL', 'SIS', 'BUR'] as DeckId[]) {
			expect(nextStep(c)).toBe('NEXT_GAME')
			c = play(c, d, true)
			if (!isOver(c)) c = skipUpgrade(c)
		}
		expect(rankOf(c)).toBe('ADMIRAL')
		expect(isOver(c)).toBe(true)
		expect(nextStep(c)).toBe('OVER')
		expect(performanceReview(c).title).toBe('Admiral')

		let d = campaign()
		for (let i = 0; i < 10; i++) {
			d = play(d, 'KOL', false)
			if (!isOver(d)) d = skipUpgrade(d)
		}
		expect(isOver(d)).toBe(true)
		expect(rankOf(d)).toBe('ENSIGN')
	})
})

describe('the logbook', () => {
	it('logs a game in progress, then its result', () => {
		let c = campaign()
		c = startGame(c, nextGameConfig(c, 'SHR', 7), 's1', NOW)
		expect(currentGame(c)).toMatchObject({
			bot: 'SHR',
			level: 'LIEUTENANT',
			sessionId: 's1',
		})
		expect(nextStep(c)).toBe('PLAY')
		expect(() => startGame(c, nextGameConfig(c, 'KOL', 8), 's2', NOW)).toThrow()
		// another save's result is ignored
		expect(
			recordResult(
				c,
				{ sessionId: 'x', score: [1, 2], won: false, marketOwned: [] },
				NOW,
			),
		).toBe(c)
		c = recordResult(
			c,
			{ sessionId: 's1', score: [61, 55], won: true, marketOwned: [] },
			NOW,
		)
		expect(c.games[0]).toMatchObject({ score: [61, 55], won: true })
		expect(nextStep(c)).toBe('UPGRADE')
	})
})

describe('upgrades (rules/14 §14.3)', () => {
	const ship = () =>
		catalog.defs.find((d) => d.deck === 'COMMON' && d.suit === 'SHIP')!.id
	const cargo = () =>
		catalog.defs.find((d) => d.deck === 'COMMON' && d.suit === 'CARGO')!.id

	it('Option A: a Market card you owned that matches the Bot’s list', () => {
		// beating KOL: any SHIP
		const c = play(campaign(), 'KOL', true, [cargo(), ship()])
		const o = upgradeOptions(c, bot('KOL'), defs)!
		expect(o.cards).toEqual([ship()])
		// Option B stays open beside it
		expect(o.bonuses.map((b) => b.k)).toEqual(['BOOST', 'BOOST'])
		const after = applyUpgrade(c, o, { k: 'CARD', def: ship() }, NOW)
		expect(after.reinforcement).toEqual([ship()])
		expect(campaignSetup(after).reinforcement).toEqual([ship()])
		expect(() => applyUpgrade(c, o, { k: 'CARD', def: cargo() }, NOW)).toThrow()
	})

	it('Option B: a BOOST, or a REINFORCE that moves one of your crew cards', () => {
		const won = play(campaign(), 'KOL', true, [cargo()])
		const o = upgradeOptions(won, bot('KOL'), defs)!
		expect(o.cards).toEqual([])
		expect(o.bonuses.map((b) => b.k)).toEqual(['BOOST', 'BOOST'])
		const boosted = applyUpgrade(
			won,
			o,
			{ k: 'BONUS', ref: o.bonuses[1]!.ref },
			NOW,
		)
		expect(boosted.boosts).toEqual([{ deck: 'KOL', side: 'win', index: 1 }])

		const lost = play(campaign(), 'KOL', false)
		const l = upgradeOptions(lost, bot('KOL'), defs)!
		expect(l.bonuses.map((b) => b.k)).toEqual([
			'TO_REINFORCEMENT',
			'TO_REINFORCEMENT',
		])
		const reserve = l.bonuses[0]!
		expect(
			reserve.cards.every((id) => defs.get(id)!.startPosition === 'RESERVE'),
		).toBe(true)
		expect(reserve.cards.some((id) => defs.get(id)!.suit === 'INCIDENT')).toBe(
			false,
		)
		const moved = applyUpgrade(
			lost,
			l,
			{ k: 'BONUS', ref: reserve.ref, def: reserve.cards[0] },
			NOW,
		)
		expect(moved.reinforcement).toEqual([reserve.cards[0]])
		expect(() =>
			applyUpgrade(lost, l, { k: 'BONUS', ref: reserve.ref }, NOW),
		).toThrow()
	})

	it('the Market-only challenge closes Option B after a win', () => {
		const c = play(campaign(['MARKET_ONLY']), 'KOL', true, [cargo()])
		const o = upgradeOptions(c, bot('KOL'), defs)!
		expect(o).toMatchObject({ cards: [], bonuses: [], marketOnly: true })
		expect(applyUpgrade(c, o, { k: 'NONE' }, NOW).games[0]!.upgrade).toEqual({
			k: 'NONE',
		})
	})
})

describe('what the challenges set up (rules/14 §14.5)', () => {
	it('follow your rank and your winning streak', () => {
		const all: Challenge[] = [
			'LEAN_START',
			'SHUFFLED_RESERVE',
			'DIRECTIVE_IN_RESERVE',
			'INCIDENT_STREAK',
			'ONE_SHIP',
			'LATE_TEAMS',
		]
		let c = campaign(all)
		expect(campaignSetup(c)).toEqual({
			reinforcement: [],
			boosts: [],
			startingShip: true,
			awayTeamsAside: 1,
		})
		c = skipUpgrade(play(c, 'KOL', true))
		expect(campaignSetup(c, 'LAT')).toMatchObject({
			directiveToReserve: true,
			withoutResources: ['LAT'],
			shuffleReserve: true,
			awayTeamsAside: 2,
		})
		expect(campaignSetup(c).incidentInDeck).toBeUndefined()
		c = skipUpgrade(play(c, 'SEL', true))
		expect(campaignSetup(c)).toMatchObject({
			withoutResources: ['DIL', 'LAT'],
			incidentInDeck: true,
		})
		c = skipUpgrade(play(c, 'SIS', false))
		const after = campaignSetup(c)
		expect(after.withoutResources).toBeUndefined()
		expect(after.incidentInDeck).toBeUndefined()
		expect(after.awayTeamsAside).toBe(1)
		expect(after.shuffleReserve).toBe(true) // still above Ensign
	})
})

describe('storage', () => {
	it('saves, lists and loads campaigns beside the saves', async () => {
		const storage = new InMemoryStorage()
		const c = play(campaign(), 'KOL', false)
		await saveCampaign(storage, c)
		await storage.set('ready-room:session:v1:x', { not: 'a campaign' })
		expect((await listCampaigns(storage)).map((x) => x.id)).toEqual(['c1'])
		expect(await loadCampaign(storage, 'c1')).toEqual(c)
		expect(await loadCampaign(storage, 'nope')).toBeNull()
	})
})
