// The solo Bot's effect nodes and pure helpers (rules/13): card value and its
// tie-breaks, the Bot deck reshuffle, Market preferences, Location picks,
// deploy/promote, and TRY + ATTACK against a cancelled attack. States are
// hand-built (solo setup is tested in setup.test.ts); seat 1 is the Bot.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema } from '../../data/schema'
import {
	fresh,
	register,
	makeDef,
	op,
	place,
	ID,
	pushAndRun,
	setSpecialty,
	setTracks,
	TEST_TRACKS_BASIC,
} from '../resolver/testUtils'
import { run } from '../resolver/stack'
import { applyChoice, type PendingChoice } from '../resolver/choices'
import { firstLegalSelection } from '../intents'
import type { Effect } from '../resolver/nodes'
import type { GameState } from '../state'
import { cardValue, pickByValue } from './value'
import { botDeckTop } from './deck'
import { sendTarget, warpTarget } from './rank'

const BOT = 1 as const

register([
	makeDef({ id: 'pPlain', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'pKlingon', suit: 'PERSON', traits: ['KLINGON'], operations: [] }),
	makeDef({ id: 'sPlain', suit: 'SHIP', operations: [] }),
	makeDef({ id: 'sVp2', suit: 'SHIP', vp: 2, operations: [] }),
	makeDef({ id: 'cVp1', suit: 'CARGO', vp: 1, operations: [] }),
	makeDef({ id: 'cVp3', suit: 'CARGO', vp: 3, operations: [] }),
	makeDef({ id: 'aPlain', suit: 'ALLY', operations: [] }),
	makeDef({ id: 'inc', suit: 'INCIDENT', operations: [] }),
	makeDef({ id: 'loc', suit: 'LOCATION', operations: [] }),
	makeDef({
		id: 'locStarbase',
		suit: 'LOCATION',
		traits: ['STARBASE'],
		operations: [],
	}),
	makeDef({
		id: 'locEndgame',
		suit: 'LOCATION',
		vp: 1,
		operations: [op('ENDGAME', { k: 'SCORE_VP', amount: 1 })],
	}),
	{ ...makeDef({ id: 'aFocus', suit: 'ALLY', operations: [] }), focus: 'FOCUS_INFLUENCE' },
])

/** Run `node` as the Bot, answering every choice with its first legal pick
 *  and accepting every REACTION offered to the human. */
function bot(state: GameState, node: Effect, source = ID('src')): GameState {
	let s = pushAndRun(state, node, source, BOT)
	let guard = 0
	while (s.pendingChoice !== null && ++guard < 50) {
		const c: PendingChoice = s.pendingChoice
		const selection =
			c.k === 'OPTIONAL_TRIGGERS' ? c.offered : firstLegalSelection(s)
		s = run(applyChoice(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection }))
	}
	return s
}

const zone = (s: GameState, key: string) => s.zones[key] ?? []

describe('card value (rules/13 §13.3)', () => {
	it('adds printed VP, Focus × multiplier, 5 per ENDGAME and 1 per Glory token', () => {
		let s = setTracks(fresh(), BOT, TEST_TRACKS_BASIC)
		s = setSpecialty(s, BOT, 'INFLUENCE', 8) // ×3
		s = place(s, 'aFocus', ID('f'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		s = place(s, 'locEndgame', ID('l'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'cVp1', ID('g'), { k: 'MARKET_OFFER', suit: 'CARGO' }, null, {
			resourceTokens: { GLO: 2 },
		})
		expect(cardValue(s, ID('f'), BOT)).toBe(3)
		expect(cardValue(s, ID('f'), 0)).toBe(0) // the human's track has no glyph
		expect(cardValue(s, ID('l'), BOT)).toBe(6)
		expect(cardValue(s, ID('g'), BOT)).toBe(3)
	})

	it('breaks ties by tokens, then leftmost — the other way round for least', () => {
		let s = fresh()
		s = place(s, 'cVp1', ID('cargo'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'sPlain', ID('ship'), { k: 'MARKET_OFFER', suit: 'SHIP' }, null, {
			resourceTokens: { GLO: 1 }, // value 1, like the CARGO, but a token
		})
		s = place(s, 'aPlain', ID('ally'), { k: 'MARKET_OFFER', suit: 'ALLY' }, null, {
			resourceTokens: { DIL: 1 }, // value 0
		})
		s = place(s, 'pPlain', ID('person'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		const all = [ID('ally'), ID('ship'), ID('cargo'), ID('person')]
		expect(pickByValue(s, all, BOT, 'MOST')).toBe('ship')
		// least: value 0 for PERSON and ALLY; PERSON has fewer tokens
		expect(pickByValue(s, all, BOT, 'LEAST')).toBe('person')
		expect(pickByValue(s, [ID('cargo'), ID('person')], BOT, 'LEAST')).toBe(
			'person',
		)
	})
})

describe('the Bot deck reshuffle (rules/13 §13.5)', () => {
	it('shuffles the Discard pile (not Staging) and puts the top Supplement card on top', () => {
		let s = fresh()
		s = place(s, 'pPlain', ID('d1'), { k: 'DISCARD', seat: BOT }, BOT)
		s = place(s, 'pPlain', ID('d2'), { k: 'DISCARD', seat: BOT }, BOT)
		s = place(s, 'pPlain', ID('st'), { k: 'STAGING', seat: BOT }, BOT)
		s = place(s, 'sPlain', ID('sup'), { k: 'SUPPLEMENT', seat: BOT }, BOT)
		const r = botDeckTop(s, BOT)
		expect(r.top).toBe('sup')
		expect([...zone(r.state, 'DRAW:1')].sort()).toEqual(['d1', 'd2', 'sup'])
		expect(zone(r.state, 'STAGING:1')).toEqual(['st'])
		expect(zone(r.state, 'SUPPLEMENT:1')).toEqual([])
	})

	it('BOT_DECK logs through the reshuffle and returns an INCIDENT instead', () => {
		let s = fresh()
		s = place(s, 'inc', ID('i'), { k: 'DRAW', seat: BOT }, BOT)
		s = place(s, 'pPlain', ID('d'), { k: 'DISCARD', seat: BOT }, BOT)
		s = bot(s, { k: 'BOT_DECK', from: 'DECK', op: 'LOG', count: 2 })
		expect(zone(s, 'INCIDENT_DECK')).toEqual(['i'])
		expect(zone(s, 'LOG:1')).toEqual(['d'])
	})
})

describe('Market preferences (rules/13 §13.10)', () => {
	const market = () => {
		let s = fresh()
		s = place(s, 'pKlingon', ID('klingon'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = place(s, 'cVp3', ID('cargo'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'sVp2', ID('ship'), { k: 'MARKET_OFFER', suit: 'SHIP' }, null, {
			resourceTokens: { GLO: 1, DIL: 2 },
		})
		s = place(s, 'aPlain', ID('ally'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		return s
	}

	it('"A > B / C": A when the Market has one, else the best of B and C', () => {
		const gain = (pref: Extract<Effect, { k: 'BOT_ACQUIRE' }>['pref']) =>
			bot(market(), { k: 'BOT_ACQUIRE', mode: 'GAIN', pref })
		// the KLINGON wins although the SHIP is worth more
		let s = gain([[{ traits: ['KLINGON'] }], [{ suits: ['SHIP'] }]])
		expect(zone(s, 'DISCARD:1')).toEqual(['klingon'])
		// no ROMULAN: the best of SHIP (2 + 1 Glory) and CARGO (3) — the tokens tip it
		s = gain([[{ traits: ['ROMULAN'] }], [{ suits: ['SHIP'] }, { suits: ['CARGO'] }]])
		expect(zone(s, 'DISCARD:1')).toEqual(['ship'])
		expect(s.players[BOT].resources.DIL).toBe(2) // its tokens go to the Bot
		expect(s.players[BOT].resources.GLO).toBe(1)
		expect(s.cards[ID('ship')]!.owner).toBe(BOT)
	})

	it('"most {DIL}" needs a card holding one; TAKE goes on top of the Bot deck', () => {
		let s = bot(market(), {
			k: 'BOT_ACQUIRE',
			mode: 'TAKE',
			pref: [[{ most: 'DIL' }], [{ most: 'GLO' }]],
		})
		expect(zone(s, 'DRAW:1')[0]).toBe('ship')
		s = bot(fresh(), {
			k: 'BOT_ACQUIRE',
			mode: 'GAIN',
			pref: [[{ most: 'DIL' }]],
		})
		expect(zone(s, 'DISCARD:1')).toEqual([])
	})

	it('BOT_JUNK junks the token-free card most valuable to the opponent', () => {
		const s = bot(market(), { k: 'BOT_JUNK' })
		expect(zone(s, 'JUNK')).toEqual(['cargo']) // the SHIP is worth more but has tokens
	})
})

describe('Neutral Zone picks (rules/13 §13.11)', () => {
	const board = () => {
		let s = fresh()
		s = place(s, 'loc', ID('l0'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'locStarbase', ID('l1'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = place(s, 'locEndgame', ID('l2'), { k: 'NEUTRAL_ZONE', slot: 2 })
		return s
	}

	it('sends where the Bot has most tokens; a trait preference comes first', () => {
		let s = board()
		s = { ...s, awayTeamsAt: { l0: [0, 1] } }
		expect(sendTarget(s, BOT)).toBe('l0')
		expect(sendTarget(s, BOT, { prefer: ['STARBASE'] })).toBe('l1')
		// no tokens anywhere: the most valuable (ENDGAME location)
		expect(sendTarget(board(), BOT)).toBe('l2')
	})

	it('never adds to an over-secured Location or one the opponent blocks with Ships', () => {
		let s = board()
		s = { ...s, awayTeamsAt: { l2: [0, 4] } } // 4 and 4 more than you
		// l0 and l1 tie (no tokens, no value): the leftmost
		expect(sendTarget(s, BOT)).toBe('l0')
		s = place(s, 'sPlain', ID('yourShip'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('l0'),
		})
		expect(sendTarget(s, BOT)).toBe('l1')
		expect(sendTarget(s, BOT, { ignoreShips: true })).toBe('l0')
	})

	it('pulls an Away Team back from where it has fewest tokens when its Captain has none', () => {
		let s = board()
		s = {
			...s,
			awayTeamsAt: { l0: [0, 3], l1: [0, 1] },
			players: [
				s.players[0],
				{ ...s.players[1], awayTeamsInPool: 0, awayTeamsTotal: 4 },
			],
		}
		s = bot(s, { k: 'BOT_SEND_AWAY_TEAM', count: 1 })
		expect(s.awayTeamsAt['l0']).toEqual([0, 4])
		expect(s.awayTeamsAt['l1']).toEqual([0, 0])
	})

	it('explores to the emptiest Location and engages where you have most', () => {
		let s = board()
		s = { ...s, awayTeamsAt: { l2: [1, 0], l1: [2, 1] } }
		expect(warpTarget(s, BOT, 'EXPLORE')).toBe('l0')
		expect(warpTarget(s, BOT, 'ENGAGE')).toBe('l1')
		s = place(s, 'sPlain', ID('ship'), { k: 'STAGING', seat: BOT }, BOT)
		s = bot(s, { k: 'BOT_DEPLOY', target: 'THIS', then: 'ENGAGE' }, ID('ship'))
		expect(s.cards[ID('ship')]!.zone).toEqual({ k: 'FLEET', seat: BOT })
		expect(s.cards[ID('ship')]!.shipTokenAt).toBe('l1')
	})
})

describe('BOT_PROMOTE and lower/higher specialty picks', () => {
	it('promoting a second PERSON dismisses the first (one slot)', () => {
		let s = fresh()
		s = place(s, 'pPlain', ID('old'), { k: 'DUTY_OFFICER', seat: BOT }, BOT)
		s = place(s, 'pPlain', ID('new'), { k: 'STAGING', seat: BOT }, BOT)
		s = bot(s, { k: 'BOT_PROMOTE', target: 'THIS' }, ID('new'))
		expect(zone(s, 'DUTY_OFFICER:1')).toEqual(['new'])
		expect(zone(s, 'DISCARD:1')).toEqual(['old'])
	})

	it('"whichever is lower" picks the lower track, ties to the first listed', () => {
		let s = setSpecialty(fresh(), BOT, 'RESEARCH', 2)
		const gain: Effect = {
			k: 'ADVANCE_SPECIALTY',
			specialty: { pick: 'LOWER', of: ['RESEARCH', 'INFLUENCE'] },
			amount: 1,
		}
		s = bot(s, gain)
		expect(s.players[BOT].specialties.INFLUENCE).toBe(1)
		s = bot(s, gain) // 2 / 1 → INFLUENCE again; then the tie goes to RESEARCH
		s = bot(s, gain)
		expect(s.players[BOT].specialties).toMatchObject({ RESEARCH: 3, INFLUENCE: 2 })
	})
})

describe('TRY + ATTACK (rules/13 §13.6.2, §13.12.1)', () => {
	// the human's Duty Officer that ignores a whole attack (1SIS10, real data)
	const sis = CardArraySchema.parse(
		JSON.parse(
			readFileSync(join(__dirname, '../../data/cards/crew/sis.json'), 'utf8'),
		),
	)
	register(sis)
	const ignorer = sis.find((d) => d.cardId === '1SIS10/25')!.id
	const row: Effect = {
		k: 'TRY',
		body: {
			k: 'ATTACK',
			body: {
				k: 'FORCE',
				body: {
					k: 'REMOVE_AWAY_TEAM',
					count: 1,
					target: { zones: ['NEUTRAL_LOCATIONS'] },
					whose: 'SELF',
				},
			},
		},
		otherwise: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
	}
	const withYourTeam = (): GameState => {
		const s = place(fresh(), 'loc', ID('l0'), { k: 'NEUTRAL_ZONE', slot: 0 })
		return { ...s, awayTeamsAt: { l0: [1, 0] } }
	}

	it('runs the attack when you have an Away Team, the otherwise branch when not', () => {
		let s = bot(withYourTeam(), row)
		expect(s.awayTeamsAt['l0']?.[0] ?? 0).toBe(0)
		expect(s.players[BOT].resources.GLO).toBe(0)
		s = bot(fresh(), row)
		expect(s.players[BOT].resources.GLO).toBe(1)
	})

	it('a cancelled attack still counts as done: no otherwise, and the record closes', () => {
		let s = withYourTeam()
		s = place(s, ignorer, ID('sis10'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = bot(s, row)
		expect(s.awayTeamsAt['l0']?.[0]).toBe(1) // your Away Team stays
		expect(s.players[BOT].resources.GLO).toBe(0) // and "otherwise" never ran
		expect(s.pending ?? {}).toEqual({})
	})
})
