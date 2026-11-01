// The fan-made SHP crew deck (src/data/cards/crew/shp.json, names and text in
// src/data/custom/atlantis.json). Pins its setup and the engine paths no
// earlier card exercises: the one ZPM (deployed, fed at Resupply, dismissed
// by id as a cost, found and drawn back from the Discard pile), the shield's
// "dismiss a ZPM" attack window, the Puddle Jumper's gene gate on cards beamed
// to it, and Sheppard's warp reaction and SHIP count.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { CardArraySchema, type CardDef } from '../data/schema'
import {
	fresh,
	register,
	makeDef,
	op,
	place,
	ID,
	setActions,
	setResources,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { dutyOfficerSlots } from './dutyOfficers'
import { score } from './scoring'
import { setup } from './setup'
import { zoneKey, type GameState } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const byCardId = new Map<string, CardDef>()
const raw: unknown = JSON.parse(
	readFileSync(join(__dirname, '../data/cards/crew/shp.json'), 'utf8'),
)
for (const def of CardArraySchema.parse(raw))
	if (def.cardId !== null) byCardId.set(def.cardId, def)
register([...byCardId.values()])
const real = (n: number): string =>
	byCardId.get(`1SHP${String(n).padStart(2, '0')}/25`)!.id

register([
	makeDef({ id: 'sxPerson', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'sxIncident', suit: 'INCIDENT', vp: -2, operations: [] }),
	makeDef({ id: 'sxLoc', suit: 'LOCATION', operations: [] }),
	// an ATTACK: "Force your opponent to discard 2 cards."
	makeDef({
		id: 'sxAttackDiscard',
		suit: 'CARGO',
		operations: [
			op(
				'PLAY',
				{ k: 'FORCE', body: { k: 'DISCARD', count: 2, from: 'HAND' } },
				{ isAttack: true },
			),
		],
	}),
])

type Answer = (c: PendingChoice) => unknown
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
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		default:
			throw new Error(`test driver: unhandled choice ${c.k}`)
	}
}

function drive(state: GameState, answer: Answer = auto): GameState {
	let s = run(state)
	for (let guard = 0; s.pendingChoice !== null; guard++) {
		if (guard > 100) throw new Error('drive: too many choices')
		const c = s.pendingChoice
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: (answer(c) ?? auto(c)) as never,
			}),
		)
	}
	return s
}

function resolveOp(
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	answer?: Answer,
	actor: Seat = 0,
): GameState {
	return drive(
		{
			...state,
			stack: [
				...state.stack,
				{
					k: 'OPERATION',
					card,
					opIndex,
					ctx: { actor, source: card, bindings: {} },
					phase: 0,
				},
			],
		},
		answer,
	)
}

const zone = (s: GameState, k: string, seat: Seat): CardInstanceId[] =>
	s.zones[zoneKey({ k, seat } as never)] ?? []

/** A deployed Puddle Jumper (token on its card) and a Neutral Zone LOCATION. */
function withJumper(): GameState {
	let s = place(fresh(), real(21), ID('jumper'), { k: 'FLEET', seat: 0 }, 0, {
		shipTokenAt: null,
	})
	s = place(s, 'sxLoc', ID('loc'), { k: 'NEUTRAL_ZONE', slot: 0 })
	return s
}

/** Two INCIDENTs in the deck, so taking one never triggers the Burn. */
function withIncidentDeck(s: GameState): GameState {
	s = place(s, 'sxIncident', ID('deck1'), { k: 'INCIDENT_DECK' })
	return place(s, 'sxIncident', ID('deck2'), { k: 'INCIDENT_DECK' })
}

describe('SHP setup', () => {
	it('sorts the 25 cards by position indicator', async () => {
		const catalog = await loadCatalog()
		const s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'SHP', boardSide: 'ADVANCED' },
					{ deck: 'MAL', boardSide: 'BASIC' },
				],
				seed: 7,
			},
			catalog,
		)
		const count = (k: string) => zone(s, k, 0).length
		expect(count('FLEET')).toBe(1)
		expect(count('DEVELOPMENT')).toBe(8)
		expect(count('RESERVE')).toBe(5)
		expect(count('HAND') + count('DRAW')).toBe(10)
		expect(s.players[0].missions).toHaveLength(3)
	})
})

describe('the ZPM', () => {
	it('deploys for 2 {DIL} and feeds 1 {DIL} and 1 {GLO} at Resupply', () => {
		let s = place(fresh(), real(14), ID('zpm'), { k: 'STAGING', seat: 0 }, 0)
		s = setResources(s, 0, 'DIL', 0)
		s = setResources(s, 0, 'GLO', 0)
		s = setActions(s, 0, 3)
		s = resolveOp(s, ID('zpm'), 0)
		expect(s.cards['zpm']!.zone).toEqual({ k: 'FLEET', seat: 0 })
		expect(s.players[0].resources.DIL).toBe(2)
		s = resolveOp(s, ID('zpm'), 1)
		expect(s.players[0].resources.DIL).toBe(3)
		expect(s.players[0].resources.GLO).toBe(1)
	})

	it('Atlantis dismisses it to ignore an attack', () => {
		let s = place(
			fresh(),
			'sxAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real(2), ID('atlantis'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: null,
		})
		s = place(s, real(14), ID('zpm'), { k: 'FLEET', seat: 1 }, 1)
		for (const p of ['h1', 'h2', 'h3'])
			s = place(s, 'sxPerson', ID(p), { k: 'HAND', seat: 1 }, 1)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, (c) => {
			seen.push(c)
			return auto(c)
		})
		expect(seen.find((c) => c.k === 'OPTIONAL_TRIGGERS')?.seat).toBe(1)
		expect(s.cards['zpm']!.zone).toEqual({ k: 'DISCARD', seat: 1 })
		expect(zone(s, 'HAND', 1)).toHaveLength(3)
	})

	it('Atlantis offers no shield without a ZPM in play', () => {
		let s = place(
			fresh(),
			'sxAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real(2), ID('atlantis'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: null,
		})
		s = place(s, real(14), ID('zpm'), { k: 'DISCARD', seat: 1 }, 1)
		for (const p of ['h1', 'h2', 'h3'])
			s = place(s, 'sxPerson', ID(p), { k: 'HAND', seat: 1 }, 1)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, (c) => {
			seen.push(c)
			return auto(c)
		})
		expect(seen.filter((c) => c.k === 'OPTIONAL_TRIGGERS')).toHaveLength(0)
		expect(zone(s, 'HAND', 1)).toHaveLength(1)
	})

	it('the Hive Ship goes back for the ZPM', () => {
		let s = place(fresh(), real(15), ID('hive'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, real(14), ID('zpm'), { k: 'FLEET', seat: 0 }, 0)
		s = setActions(s, 0, 3)
		s = resolveOp(s, ID('hive'), 0)
		expect(s.cards['zpm']!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards['hive']!.zone).toEqual({ k: 'INCIDENT_DECK' })
	})

	it('Zelenka draws it back from the Discard pile for 1 {DIL}', () => {
		let s = place(
			fresh(),
			real(25),
			ID('zelenka'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = place(s, real(14), ID('zpm'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'sxPerson', ID('other'), { k: 'DISCARD', seat: 0 }, 0)
		s = setResources(s, 0, 'DIL', 1)
		s = resolveOp(s, ID('zelenka'), 1)
		expect(s.cards['zpm']!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.cards['other']!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.players[0].resources.DIL).toBe(0)
	})

	it('Asuras: take an INCIDENT to find it and play it for free', () => {
		let s = place(
			fresh(),
			real(9),
			ID('asuras'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = place(s, real(14), ID('zpm'), { k: 'RESERVE', seat: 0 }, 0)
		s = withIncidentDeck(s)
		s = setResources(s, 0, 'DIL', 0)
		s = resolveOp(s, ID('asuras'), 1)
		expect(s.cards['zpm']!.zone).toEqual({ k: 'FLEET', seat: 0 })
		expect(s.players[0].resources.DIL).toBe(2)
		expect(
			['deck1', 'deck2'].filter((i) => s.cards[i]!.owner === 0),
		).toHaveLength(1)
	})

	it('McKay gains 1 more RESEARCH with a ZPM in play', () => {
		for (const [zpmZone, gained] of [
			['FLEET', 2],
			['DISCARD', 1],
		] as const) {
			let s = place(
				fresh(),
				real(22),
				ID('mckay'),
				{ k: 'DUTY_OFFICER', seat: 0 },
				0,
			)
			s = place(s, real(14), ID('zpm'), { k: zpmZone, seat: 0 }, 0)
			s = setResources(s, 0, 'DIL', 2)
			s = resolveOp(s, ID('mckay'), 1)
			expect(s.players[0].specialties.RESEARCH).toBe(gained)
			expect(s.players[0].resources.DIL).toBe(0)
		}
	})
})

describe('the Puddle Jumper and Sheppard', () => {
	it('warps for free with an AUGMENT beamed to it', () => {
		let s = place(
			withJumper(),
			real(22),
			ID('mckay'),
			{ k: 'BEAMED', host: ID('jumper') },
			0,
		)
		s = setResources(s, 0, 'DIL', 0)
		s = resolveOp(s, ID('jumper'), 1)
		expect(s.cards['jumper']!.shipTokenAt).toBe('loc')
	})

	it('spends 1 {DIL} to warp without one', () => {
		let s = place(
			withJumper(),
			real(25),
			ID('zelenka'),
			{ k: 'BEAMED', host: ID('jumper') },
			0,
		)
		s = setResources(s, 0, 'DIL', 1)
		s = resolveOp(s, ID('jumper'), 1)
		expect(s.cards['jumper']!.shipTokenAt).toBe('loc')
		expect(s.players[0].resources.DIL).toBe(0)
	})

	it('Sheppard sends an Away Team after one of your SHIPs warps', () => {
		let s = place(
			withJumper(),
			real(1),
			ID('shep'),
			{ k: 'CAPTAIN', seat: 0 },
			0,
		)
		s = {
			...s,
			players: [{ ...s.players[0], awayTeamsInPool: 5 }, s.players[1]],
		}
		s = setResources(s, 0, 'DIL', 1)
		s = resolveOp(s, ID('jumper'), 1)
		expect(s.cards['jumper']!.shipTokenAt).toBe('loc')
		expect(s.awayTeamsAt['loc']?.[0]).toBe(1)
		expect(s.cards['shep']!.exhausted).toBe(true)
	})

	it('Sheppard scores 1 VP per SHIP you have in play', () => {
		let s = place(
			withJumper(),
			real(1),
			ID('shep'),
			{ k: 'CAPTAIN', seat: 0 },
			0,
		)
		s = place(s, real(2), ID('atlantis'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: null,
		})
		s = place(s, real(13), ID('daedalus'), { k: 'HAND', seat: 0 }, 0)
		expect(score(s, 0).endgame.find((e) => e.card === 'shep')?.vp).toBe(2)
	})
})

describe('the Wraith', () => {
	it('Culling: remove one of your Away Teams to return it', () => {
		let s = place(fresh(), real(19), ID('cull'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'sxLoc', ID('loc'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, loc: [1, 0] } }
		s = setActions(s, 0, 3)
		s = resolveOp(s, ID('cull'), 0)
		expect(s.awayTeamsAt['loc']?.[0] ?? 0).toBe(0)
		expect(s.cards['cull']!.zone).toEqual({ k: 'INCIDENT_DECK' })
	})

	it('Todd returns your INCIDENT, hands your opponent one, and logs himself', () => {
		let s = place(fresh(), real(6), ID('todd'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'sxIncident', ID('mine'), { k: 'HAND', seat: 0 }, 0)
		s = withIncidentDeck(s)
		s = setActions(s, 0, 3)
		s = resolveOp(s, ID('todd'), 0)
		expect(s.cards['mine']!.zone).toEqual({ k: 'INCIDENT_DECK' })
		expect(
			['mine', 'deck1', 'deck2'].filter((i) => s.cards[i]!.owner === 1),
		).toHaveLength(1)
		expect(s.cards['todd']!.zone).toEqual({ k: 'LOG', seat: 0 })
	})
})

describe('Weir', () => {
	it('adds a Duty Officer slot while she is on duty', () => {
		const base = dutyOfficerSlots(fresh(), 0).length
		const s = place(
			fresh(),
			real(3),
			ID('weir'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		expect(dutyOfficerSlots(s, 0)).toHaveLength(base + 1)
	})
})
