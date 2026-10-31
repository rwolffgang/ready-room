// A Five-Year Mission game (rules/14): the campaign's Reinforcement pile and
// its Directive, the boosts that resolve as the game starts, the challenges,
// and the Market cards a solo game remembers for the next upgrade — all
// replayed from the setup config.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { setup, type CardCatalog, type SetupConfig } from '../setup'
import { reduce, legalIntents, firstLegalSelection } from '../intents'
import { autoPlay } from '../../bot/autoPlay'
import { assertInvariants } from '../invariants'
import { checkEndgame } from '../endgame'
import { finalizeGame } from '../scoring'
import { gainMarketCard } from '../resolver/runtime'
import { moveCard, zonesOf, type CampaignSetup, type GameState } from '../state'
import { cardDef } from '../cards'
import type { CardInstanceId } from '../ids'
import { CAMPAIGN_DIRECTIVE } from './campaign'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

function config(campaign: Partial<CampaignSetup>, seed = 4): SetupConfig {
	return {
		mode: 'SOLO',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'KOL', boardSide: 'BASIC' },
		],
		seed,
		solo: {
			level: 'LIEUTENANT',
			campaign: { reinforcement: [], boosts: [], ...campaign },
		},
	}
}

const defsIn = (s: GameState, zone: Parameters<typeof zonesOf>[1]) =>
	zonesOf(s, zone).map((i) => s.cards[i]!.def)

/** Answer every pending choice with its first legal selection. */
function settle(s: GameState): GameState {
	let state = s
	for (let i = 0; i < 20 && state.pendingChoice !== null; i++)
		state = reduce(state, {
			t: 'RESOLVE_CHOICE',
			choiceId: state.pendingChoice.id,
			selection: firstLegalSelection(state),
		}).state
	return state
}

describe('the Reinforcement pile and the campaign Directive (rules/14 §14.3–14.4)', () => {
	it('takes a crew card from your deck and a Market card from the Market', () => {
		const crew = catalog.defs.find(
			(d) => d.deck === 'PIC' && d.startPosition === 'RESERVE',
		)!
		const market = catalog.defs.find(
			(d) => d.deck === 'COMMON' && d.suit === 'CARGO',
		)!
		const s = setup(config({ reinforcement: [crew.id, market.id] }), catalog)
		expect(defsIn(s, { k: 'REINFORCEMENT', seat: 0 })).toEqual([
			crew.id,
			market.id,
		])
		const pile = zonesOf(s, { k: 'REINFORCEMENT', seat: 0 })
		expect(pile.every((i) => s.cards[i]!.owner === 0)).toBe(true)
		// the crew card left your Reserve deck, the Market card its suit
		const mine = (def: string) =>
			Object.values(s.cards).filter((c) => c.def === def)
		expect(mine(crew.id).filter((c) => c.zone.k === 'RESERVE')).toHaveLength(
			mine(crew.id).length - 1,
		)
		// the campaign Directive is in your starting deck, not in the box
		const directive = Object.values(s.cards).find(
			(c) => c.def === CAMPAIGN_DIRECTIVE,
		)!
		expect(directive.owner).toBe(0)
		expect(['DRAW', 'HAND']).toContain(directive.zone.k)
	})

	it('without a Reinforcement pile the Directive stays in the box', () => {
		const s = setup(config({}), catalog)
		const directive = Object.values(s.cards).find(
			(c) => c.def === CAMPAIGN_DIRECTIVE,
		)!
		expect(directive.zone.k).toBe('BOX')
	})

	it('goes into your Reserve deck instead under the challenge', () => {
		const crew = catalog.defs.find(
			(d) => d.deck === 'PIC' && d.startPosition === 'AVAILABLE',
		)!
		const s = setup(
			config({ reinforcement: [crew.id], directiveToReserve: true }),
			catalog,
		)
		expect(defsIn(s, { k: 'RESERVE', seat: 0 })).toContain(CAMPAIGN_DIRECTIVE)
	})

	it('its first Play takes a card of your choice; its second draws and logs it once the pile is empty', () => {
		const crew = catalog.defs.find(
			(d) => d.deck === 'PIC' && d.startPosition === 'RESERVE',
		)!
		let s = setup(config({ reinforcement: [crew.id] }), catalog)
		s = reduce(s, { t: 'START' }).state
		s = settle(s)
		// put the Directive in hand and play its first operation
		const dir = (Object.keys(s.cards) as CardInstanceId[]).find(
			(i) => s.cards[i]!.def === CAMPAIGN_DIRECTIVE,
		)!
		s = moveCard(s, dir, { k: 'HAND', seat: 0 })
		while (s.phase.k !== 'ACTION') s = settle(reduce(s, { t: 'PASS' }).state)
		const play = legalIntents(s).find(
			(i) => i.t === 'PLAY_CARD' && i.iid === dir && i.operationIndex === 0,
		)
		expect(play).toBeDefined()
		s = settle(reduce(s, play!).state)
		expect(zonesOf(s, { k: 'REINFORCEMENT', seat: 0 })).toEqual([])
		expect(defsIn(s, { k: 'HAND', seat: 0 })).toContain(crew.id)
		// the pile is empty: the second operation draws a card and logs it
		s = moveCard(s, dir, { k: 'HAND', seat: 0 })
		const hand = zonesOf(s, { k: 'HAND', seat: 0 }).length
		const second = legalIntents(s).find(
			(i) => i.t === 'PLAY_CARD' && i.iid === dir && i.operationIndex === 1,
		)
		expect(second).toBeDefined()
		s = settle(reduce(s, second!).state)
		expect(s.cards[dir]!.zone.k).toBe('LOG')
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toHaveLength(hand) // −1 played, +1 drawn
	})
})

describe('boosts at START (rules/14 §14.3 Option B)', () => {
	it('an after-hand boost resolves before your first turn', () => {
		const plain = setup(config({}), catalog)
		let s = setup(
			config({ boosts: [{ deck: 'KOL', side: 'win', index: 1 }] }),
			catalog,
		)
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toHaveLength(5)
		s = settle(reduce(s, { t: 'START' }).state)
		expect(s.players[0].resources.GLO).toBe(plain.players[0].resources.GLO + 2)
		expect(s.solo?.start).toBeUndefined()
	})

	it('a before-hand boost holds your opening hand until it has resolved', () => {
		let s = setup(
			config({ boosts: [{ deck: 'PIC', side: 'win', index: 1 }] }),
			catalog,
		)
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toEqual([])
		s = reduce(s, { t: 'START' }).state
		// find two cards, one choice at a time, then the hand is drawn
		expect(s.pendingChoice?.seat).toBe(0)
		s = settle(s)
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toHaveLength(7)
		expect(s.phase.k).not.toBe('SETUP')
	})

	it('replays from its config: same seed, same game', () => {
		const c = config({
			reinforcement: [
				catalog.defs.find((d) => d.deck === 'COMMON' && d.suit === 'SHIP')!.id,
			],
			boosts: [
				{ deck: 'PIC', side: 'loss', index: 1 },
				{ deck: 'SEL', side: 'win', index: 1 },
			],
		})
		const a = autoPlay(setup(c, catalog))
		const b = autoPlay(setup(c, catalog))
		expect(a.stopped).toBe('GAME_OVER')
		expect(b.intents).toEqual(a.intents)
		expect(b.state.result).toEqual(a.state.result)
	})
})

describe('the challenges (rules/14 §14.5)', () => {
	it('start without Dilithium, with a random Reserve deck and an INCIDENT in your deck', () => {
		const plain = setup(config({}), catalog)
		const s = setup(
			config({
				withoutResources: ['DIL'],
				shuffleReserve: true,
				incidentInDeck: true,
			}),
			catalog,
		)
		expect(s.players[0].resources.DIL).toBe(0)
		expect(s.players[0].resources.LAT).toBe(plain.players[0].resources.LAT)
		expect(zonesOf(s, { k: 'RESERVE', seat: 0 })).toHaveLength(
			zonesOf(plain, { k: 'RESERVE', seat: 0 }).length,
		)
		const incidents = [
			...zonesOf(s, { k: 'DRAW', seat: 0 }),
			...zonesOf(s, { k: 'HAND', seat: 0 }),
		].filter(
			(i) =>
				cardDef(s.cards[i]!.def).suit === 'INCIDENT' &&
				cardDef(s.cards[i]!.def).deck === 'COMMON',
		)
		expect(incidents).toHaveLength(1)
		expect(s.cards[incidents[0]!]!.owner).toBe(0)
	})

	it('set-aside Away Teams come back when your Reserve deck empties', () => {
		const plain = setup(config({}), catalog)
		let s = setup(config({ awayTeamsAside: 2 }), catalog)
		expect(s.players[0].awayTeamsInPool).toBe(
			plain.players[0].awayTeamsInPool - 2,
		)
		expect(s.solo?.campaign?.awayTeamsAside).toBe(2)
		for (const iid of zonesOf(s, { k: 'RESERVE', seat: 0 }))
			s = moveCard(s, iid, { k: 'DRAW', seat: 0 })
		s = checkEndgame(s)
		expect(s.players[0].awayTeamsInPool).toBe(plain.players[0].awayTeamsInPool)
		expect(s.solo?.campaign?.awayTeamsAside).toBe(0)
	})

	it('losing your starting SHIP loses the game, whatever the score', () => {
		let s = setup(config({ startingShip: true }), catalog)
		const ship = s.solo?.campaign?.startingShip
		expect(ship).toBeDefined()
		s = moveCard(s, ship!, { k: 'DISCARD', seat: 0 })
		s = checkEndgame(s)
		expect(s.solo?.lost).toBe('STARTING_SHIP')
		expect(s.result).toEqual({ kind: 'FINAL_SCORING' })
		s = {
			...s,
			players: [
				{ ...s.players[0], resources: { ...s.players[0].resources, GLO: 99 } },
				s.players[1],
			],
		}
		const end = finalizeGame(s)
		expect(
			end.result?.kind === 'COMPLETE' && end.result.scoreboard.winners,
		).toEqual([1])
	})
})

describe('the Market cards you owned (Option A)', () => {
	it('are remembered as they become yours', () => {
		let s = setup(config({}), catalog)
		const offer = zonesOf(s, { k: 'MARKET_OFFER', suit: 'PERSON' })[0]!
		s = gainMarketCard(s, offer, 0)
		expect(s.solo?.marketOwned).toEqual([s.cards[offer]!.def])
	})
})

describe('whole campaign games', () => {
	it('every challenge and boost at once still reaches the end, invariants after every intent', () => {
		const c = config(
			{
				reinforcement: [
					catalog.defs.find(
						(d) => d.deck === 'PIC' && d.startPosition === 'RESERVE',
					)!.id,
					catalog.defs.find((d) => d.deck === 'COMMON' && d.suit === 'ALLY')!
						.id,
				],
				boosts: [
					{ deck: 'SHR', side: 'win', index: 0 },
					{ deck: 'SEL', side: 'win', index: 0 },
					{ deck: 'BUR', side: 'win', index: 0 },
					{ deck: 'SIS', side: 'win', index: 0 },
				],
				directiveToReserve: true,
				withoutResources: ['DIL', 'LAT'],
				shuffleReserve: true,
				incidentInDeck: true,
				startingShip: true,
				awayTeamsAside: 2,
			},
			9,
		)
		let before: GameState | undefined
		const r = autoPlay(setup(c, catalog), undefined, undefined, (s) => {
			assertInvariants(s, { since: before })
			before = s
		})
		expect(r.stopped).toBe('GAME_OVER')
		expect(r.state.result?.kind).toBe('COMPLETE')
	})
})
