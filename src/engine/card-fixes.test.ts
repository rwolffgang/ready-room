// Regression tests for the card-tree fixes after the STCC re-translation
// (commit 731e0a2): each test loads the REAL card definition from
// src/data/cards and resolves its operation through the stack, asserting the
// behaviour the STCC text describes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, type CardDef } from '../data/schema'
import {
	fresh,
	register,
	makeDef,
	op,
	place,
	ID,
	setResources,
	setActions,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { zoneKey, type GameState } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const FILES = [
	'common/cargo',
	'common/person',
	'common/ship',
	'crew/pic',
	'crew/sel',
	'crew/sis',
]
const byCardId = new Map<string, CardDef>()
for (const f of FILES) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw)) {
		if (def.cardId !== null) byCardId.set(def.cardId, def)
	}
}
register([...byCardId.values()])
const real = (cardId: string): string => byCardId.get(cardId)!.id

const person = (id: string, traits: string[] = []) =>
	makeDef({
		id,
		suit: 'PERSON',
		traits: traits as Parameters<typeof makeDef>[0]['traits'],
		operations: [],
	})
register([
	person('fxKlingon', ['KLINGON']),
	person('fxStarfleet', ['STARFLEET']),
	person('fxPlain'),
	makeDef({
		id: 'fxCloak',
		suit: 'SHIP',
		traits: ['CLOAK'],
		operations: [],
	}),
	makeDef({
		id: 'fxWeapon',
		suit: 'CARGO',
		traits: ['WEAPON'],
		operations: [],
	}),
	makeDef({ id: 'fxPerson', suit: 'PERSON', operations: [] }),
	makeDef({
		id: 'fxResupply',
		suit: 'PERSON',
		operations: [op('RESUPPLY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 })],
	}),
	makeDef({
		id: 'fxLatOp',
		suit: 'PERSON',
		operations: [
			op('PLAY', {
				k: 'PAY_THEN',
				cost: { k: 'COST_RESOURCE', res: 'LAT', amount: 1 },
				body: { k: 'DRAW', count: 1 },
			}),
			op('PLAY', {
				k: 'PAY_THEN',
				cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 1 },
				body: { k: 'DRAW', count: 1 },
			}),
		],
	}),
])

type Answer = (c: PendingChoice) => unknown

/** Default answers: accept every MAY, take the first option/candidate, gain
 *  to the Discard pile, take every offered reaction. */
const auto: Answer = (c) => {
	switch (c.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_OPTION':
			return { key: c.options.find((o) => o.enabled)!.key }
		case 'CHOOSE_CARDS':
			return c.candidates.slice(0, Math.max(c.min, 1))
		case 'CHOOSE_LOCATION':
			return c.candidates[0]
		case 'CHOOSE_DESTINATION':
			return 'DISCARD'
		case 'CHOOSE_SUIT':
			return c.suits[0]
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		case 'ORDER_OPERATIONS':
			return c.pending
		default:
			throw new Error(`test driver: unhandled choice ${c.k}`)
	}
}

function drive(state: GameState, answer: Answer = auto): GameState {
	let s = run(state)
	let guard = 0
	while (s.pendingChoice !== null) {
		const c = s.pendingChoice
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: answer(c) ?? auto(c),
			}),
		)
		if (++guard > 100) throw new Error('drive: too many choices')
	}
	return s
}

function resolveOp(
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	answer?: Answer,
): GameState {
	const s: GameState = {
		...state,
		stack: [
			...state.stack,
			{
				k: 'OPERATION',
				card,
				opIndex,
				ctx: { actor: 0, source: card, bindings: {} },
				phase: 0,
			},
		],
	}
	return drive(s, answer)
}

const zone = (s: GameState, k: string, seat: Seat): CardInstanceId[] =>
	s.zones[zoneKey({ k, seat } as Parameters<typeof zoneKey>[0])] ?? []

const withHand = (s: GameState, seat: Seat, n: number, prefix: string) => {
	for (let i = 0; i < n; i++)
		s = place(s, 'fxPlain', ID(`${prefix}${i}`), { k: 'HAND', seat }, seat)
	return s
}

describe('Duty-Officer attacks dismiss the OPPONENT’s officers', () => {
	it('1CAR14: dismisses their KLINGON Duty Officer, not mine; they discard', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1CAR14/16'), ID('trib'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'fxKlingon', ID('myK'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'fxKlingon', ID('theirK'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = withHand(s, 0, 2, 'h0_')
		s = withHand(s, 1, 2, 'h1_')
		s = resolveOp(s, ID('trib'), 0)
		expect(zone(s, 'DUTY_OFFICER', 0)).toContain(ID('myK'))
		expect(zone(s, 'DUTY_OFFICER', 1)).not.toContain(ID('theirK'))
		expect(zone(s, 'HAND', 0)).toHaveLength(2)
		expect(zone(s, 'HAND', 1)).toHaveLength(1)
	})

	it('1CAR14: no KLINGON dismissed → no discard', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1CAR14/16'), ID('trib'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'fxPlain', ID('theirP'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = withHand(s, 1, 2, 'h1_')
		s = resolveOp(s, ID('trib'), 0)
		expect(zone(s, 'DUTY_OFFICER', 1)).toContain(ID('theirP'))
		expect(zone(s, 'HAND', 1)).toHaveLength(2)
	})

	it('1SEL14: dismisses all their STARFLEET Duty Officers, then they discard', () => {
		let s = setActions(setResources(fresh(), 0, 'DIL', 2), 0, 3)
		s = place(s, real('1SEL14/24'), ID('tom'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'fxStarfleet', ID('sf1'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = place(s, 'fxStarfleet', ID('sf2'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = withHand(s, 1, 2, 'h1_')
		s = resolveOp(s, ID('tom'), 0)
		expect(zone(s, 'DUTY_OFFICER', 1)).toHaveLength(0)
		expect(zone(s, 'HAND', 1)).toHaveLength(1)
	})
})

describe('"Force your opponent to discard" — the opponent chooses', () => {
	for (const [cardId, opIndex] of [
		['1SHI06/13', 0],
		['1SHI08/13', 1],
	] as const) {
		it(`${cardId}: the discard choice belongs to seat 1`, () => {
			let s = setActions(fresh(), 0, 3)
			s = setResources(s, 1, 'DIL', 5)
			s = {
				...s,
				players: s.players.map((p) => ({
					...p,
					specialties: { ...p.specialties, MILITARY: 9 },
				})) as GameState['players'],
			}
			s = place(s, real(cardId), ID('ship'), { k: 'STAGING', seat: 0 }, 0)
			s = withHand(s, 1, 2, 'h1_')
			const seen: Seat[] = []
			s = resolveOp(s, ID('ship'), opIndex, (c) => {
				if (c.k === 'CHOOSE_CARDS' && c.from === 'HAND:1') seen.push(c.seat)
				return undefined
			})
			expect(seen).toEqual([1])
			expect(zone(s, 'HAND', 1)).toHaveLength(1)
		})
	}
})

describe('the gained card is found where it was gained to', () => {
	it('1SHI13 XINDI-REPTILIAN: a gained WEAPON is beamed to the ship (+1 GLO)', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1SHI13/13'), ID('xin'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'fxWeapon', ID('wpn'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = resolveOp(s, ID('xin'), 0)
		expect(s.cards['wpn']!.beamedTo).toBe(ID('xin'))
		expect(s.players[0].resources.GLO).toBe(1)
	})

	it('1PER24: may beam the scanned PERSON to a ship for 1 LAT', () => {
		let s = setActions(setResources(fresh(), 0, 'DIL', 2), 0, 3)
		s = place(s, real('1PER24/25'), ID('tev'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, real('1SHI13/13'), ID('ship'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'fxPerson', ID('p1'), { k: 'MARKET_DECK', suit: 'PERSON' })
		s = resolveOp(s, ID('tev'), 0)
		expect(s.cards['p1']!.owner).toBe(0)
		expect(s.cards['p1']!.beamedTo).toBe(ID('ship'))
		expect(s.players[0].resources.LAT).toBe(1)
	})

	it('1SHI02: the gained PERSON is logged', () => {
		let s = setActions(setResources(fresh(), 0, 'DIL', 1), 0, 3)
		s = place(s, real('1SHI02/13'), ID('probe'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'fxPerson', ID('p1'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = resolveOp(s, ID('probe'), 0)
		expect(zone(s, 'LOG', 0)).toContain(ID('p1'))
	})
})

describe('1CAR13', () => {
	it('gains 1 GLO only if the opponent logged a CLOAK', () => {
		// decline the optional "dismiss a deployed SHIP" (no ship to dismiss)
		const noDismiss: Answer = (c) => (c.k === 'CONFIRM' ? false : undefined)
		let s = place(
			fresh(),
			real('1CAR13/16'),
			ID('tdg'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = resolveOp(s, ID('tdg'), 0, noDismiss)
		expect(s.players[0].resources.GLO).toBe(0)

		let t = place(
			fresh(),
			real('1CAR13/16'),
			ID('tdg'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		t = place(t, 'fxCloak', ID('cl'), { k: 'FLEET', seat: 1 }, 1)
		t = resolveOp(t, ID('tdg'), 0, noDismiss)
		expect(zone(t, 'LOG', 1)).toContain(ID('cl'))
		expect(t.players[0].resources.GLO).toBe(1)
	})
})

describe('1SIS02', () => {
	it('draws twice with an Away Team here and 3+ Away Teams in total', () => {
		let s = place(
			fresh(),
			real('1SIS02/25'),
			ID('1SIS02'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = withHand(s, 0, 0, '')
		for (let i = 0; i < 4; i++)
			s = place(s, 'fxPlain', ID(`d${i}`), { k: 'DRAW', seat: 0 }, 0)
		s = { ...s, awayTeamsAt: { '1SIS02': [3, 0] } }
		s = resolveOp(s, ID('1SIS02'), 0)
		expect(zone(s, 'HAND', 0)).toHaveLength(2)
	})
})

describe('1PER11: duplicate a Resupply already resolved this turn', () => {
	it('offers only operations resolved this turn, and re-runs the chosen one', () => {
		let s = place(
			fresh(),
			real('1PER11/25'),
			ID('1PER11'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = place(s, 'fxResupply', ID('rs'), { k: 'STAGING', seat: 0 }, 0)
		// nothing resolved yet → the duplicate has no source (skipped)
		let t = resolveOp(s, ID('1PER11'), 2)
		expect(t.players[0].resources.DIL).toBe(0)

		s = resolveOp(s, ID('rs'), 0) // +2 DIL, recorded as resolved
		expect(s.players[0].resources.DIL).toBe(2)
		t = resolveOp(s, ID('1PER11'), 2)
		expect(t.players[0].resources.DIL).toBe(4)

		// a Resupply resolved on an earlier turn does not count
		const later = { ...s, turnNumber: s.turnNumber + 1 }
		t = resolveOp(later, ID('1PER11'), 2)
		expect(t.players[0].resources.DIL).toBe(2)
	})
})

describe('1SIS24: after resolving an operation with a LAT cost, gain 1 GLO', () => {
	it('fires after a LAT-cost operation, not after a DIL-cost one', () => {
		let s = setResources(setResources(fresh(), 0, 'LAT', 1), 0, 'DIL', 1)
		s = place(
			s,
			real('1SIS24/25'),
			ID('1SIS24'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = place(s, 'fxLatOp', ID('lat'), { k: 'STAGING', seat: 0 }, 0)
		for (let i = 0; i < 3; i++)
			s = place(s, 'fxPlain', ID(`d${i}`), { k: 'DRAW', seat: 0 }, 0)

		const afterDil = resolveOp(s, ID('lat'), 1)
		expect(afterDil.players[0].resources.GLO).toBe(0)

		const afterLat = resolveOp(s, ID('lat'), 0)
		expect(afterLat.players[0].resources.LAT).toBe(0)
		expect(afterLat.players[0].resources.GLO).toBe(1)
	})
})

describe('1PIC20: may promote a PERSON from the Staging Area', () => {
	const redAlert = (staged: boolean) => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1PIC20/24'), ID('ra'), { k: 'STAGING', seat: 0 }, 0)
		if (staged) s = place(s, 'fxPerson', ID('sp'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'fxPlain', ID('hp'), { k: 'HAND', seat: 0 }, 0) // hand PERSON: not promotable
		s = place(s, 'fxWeapon', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		const asked: string[] = []
		s = resolveOp(s, ID('ra'), 0, (c) => {
			asked.push(c.k)
			return c.k === 'CHOOSE_CARDS' && c.prompt === 'Put a card'
				? [ID('h1')]
				: undefined
		})
		return { s, asked }
	}

	it('promotes the staged PERSON, never a hand card', () => {
		const { s, asked } = redAlert(true)
		// the "may promote" is asked as its pick (with a Decline), not a CONFIRM
		expect(asked).toEqual(['CHOOSE_CARDS', 'CHOOSE_CARDS'])
		expect(zone(s, 'DUTY_OFFICER', 0)).toEqual([ID('sp')])
		expect(zone(s, 'HAND', 0)).toEqual([ID('hp')])
		expect(zone(s, 'DRAW', 0)).toEqual([ID('h1')])
		expect(s.zones['INCIDENT_DECK']).toContain(ID('ra'))
	})

	it('no PERSON staged: the may-promote is skipped without a prompt', () => {
		const { s, asked } = redAlert(false)
		expect(asked).toEqual(['CHOOSE_CARDS'])
		expect(zone(s, 'DUTY_OFFICER', 0)).toEqual([])
		expect(zone(s, 'HAND', 0)).toEqual([ID('hp')])
	})
})
