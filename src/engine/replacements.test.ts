// Box-1 engine gaps around attacks, replacements and restrictions (docs/effect-
// dsl.md §6 "would" windows and the nodes added with them). Each test loads
// the REAL card definition and resolves it through the stack.

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
	setSpecialty,
	pushAndRun,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { probe } from './resolver/probe'
import { zoneKey, type GameState, type EffectCtx } from './state'
import { evalAmount, matchFilter } from './queries/resolveQuery'
import { countSkillIcons } from './queries/counting'
import { handOffTurn } from './phases'
import { discountCost } from './resolver/primitives/enlistDevelopment'
import type { Effect } from './resolver/nodes'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const FILES = [
	'common/cargo',
	'common/person',
	'common/ship',
	'common/location',
	'common/encounter',
	'crew/sis',
	'crew/bur',
]
const byCardId = new Map<string, CardDef>()
for (const f of FILES) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) byCardId.set(def.cardId, def)
}
register([...byCardId.values()])
const real = (cardId: string): string => byCardId.get(cardId)!.id

const person = (id: string, traits: string[] = [], extra = {}) =>
	makeDef({
		id,
		suit: 'PERSON',
		traits: traits as Parameters<typeof makeDef>[0]['traits'],
		operations: [],
		...extra,
	})
register([
	person('rpPlain'),
	person('rpBajoran', ['BAJORAN']),
	person('rpPer19Twin', ['ROMULAN', 'TELEPATH', 'SHADY']),
	makeDef({ id: 'rpShip', suit: 'SHIP', operations: [] }),
	makeDef({ id: 'rpLoc', suit: 'LOCATION', operations: [] }),
	makeDef({ id: 'rpEnc', suit: 'ENCOUNTER', operations: [] }),
	makeDef({ id: 'rpMarketPerson', suit: 'PERSON', operations: [] }),
	// an ATTACK: "Force your opponent to discard a card. Gain 1 {DIL}. Force
	// your opponent to discard a card."
	makeDef({
		id: 'rpAttackDiscard',
		suit: 'CARGO',
		operations: [
			op(
				'PLAY',
				{
					k: 'SEQ',
					steps: [
						{ k: 'FORCE', body: { k: 'DISCARD', count: 1, from: 'HAND' } },
						{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
						{ k: 'FORCE', body: { k: 'DISCARD', count: 1, from: 'HAND' } },
					],
				},
				{ isAttack: true },
			),
		],
	}),
	// "Force your opponent to dismiss their Duty Officer."
	makeDef({
		id: 'rpAttackDO',
		suit: 'CARGO',
		operations: [
			op(
				'PLAY',
				{
					k: 'FORCE',
					body: {
						k: 'DISMISS',
						target: { zones: [{ k: 'DUTY_OFFICER', seat: 0 }] },
					},
				},
				{ isAttack: true },
			),
		],
	}),
	// "Remove an opponent AWAY TEAM from a LOCATION. Gain 1 {DIL}."
	makeDef({
		id: 'rpAttackAway',
		suit: 'CARGO',
		operations: [
			op(
				'PLAY',
				{
					k: 'SEQ',
					steps: [
						{
							k: 'REMOVE_AWAY_TEAM',
							count: 1,
							whose: 'OPPONENT',
							target: { zones: ['LOCATIONS'], seat: 'ANY' },
						},
						{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
					],
				},
				{ isAttack: true },
			),
		],
	}),
	makeDef({
		id: 'rpGainPerson',
		suit: 'CARGO',
		operations: [op('PLAY', { k: 'GAIN_CARD', suits: ['PERSON'] })],
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
		case 'CHOOSE_DESTINATION':
			return 'DISCARD'
		case 'CHOOSE_SUIT':
			return c.suits[0]
		case 'CHOOSE_SPECIALTY':
			return c.specialties[0]
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		case 'ORDER_CARDS':
			return c.cards
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

const zone = (s: GameState, k: string, seat?: Seat): CardInstanceId[] =>
	s.zones[
		zoneKey(
			(seat === undefined ? { k } : { k, seat }) as Parameters<
				typeof zoneKey
			>[0],
		)
	] ?? []

const withHand = (s: GameState, seat: Seat, n: number, prefix: string) => {
	for (let i = 0; i < n; i++)
		s = place(s, 'rpPlain', ID(`${prefix}${i}`), { k: 'HAND', seat }, seat)
	return s
}

/** Record every choice kind the victim saw (the attacker auto-answers). */
function recording(seen: PendingChoice[], decline = false): Answer {
	return (c) => {
		seen.push(c)
		if (c.k === 'OPTIONAL_TRIGGERS' && decline) return []
		return auto(c)
	}
}

describe('"When you would be attacked" windows', () => {
	it('1SIS10: dismiss him to ignore the whole attack; the attacker keeps its benefits', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(
			s,
			real('1SIS10/25'),
			ID('1PIC23'),
			{ k: 'DUTY_OFFICER', seat: 1 },
			1,
		)
		s = withHand(s, 1, 3, 'v')
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, recording(seen))
		const window = seen.find((c) => c.k === 'OPTIONAL_TRIGGERS')
		expect(window?.seat).toBe(1)
		expect(s.cards[ID('1PIC23')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
		expect(zone(s, 'HAND', 1)).toHaveLength(3) // both discards ignored
		expect(s.players[0].resources.DIL).toBe(1) // the attacker's own gain stands
		expect(s.pending ?? {}).toEqual({}) // the record is closed
	})

	it('1SIS10: declining lets every negative effect through (asked once per attack)', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(
			s,
			real('1SIS10/25'),
			ID('1PIC23'),
			{ k: 'DUTY_OFFICER', seat: 1 },
			1,
		)
		s = withHand(s, 1, 3, 'v')
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, recording(seen, true))
		expect(seen.filter((c) => c.k === 'OPTIONAL_TRIGGERS')).toHaveLength(1)
		expect(s.cards[ID('1PIC23')]!.zone.k).toBe('DUTY_OFFICER')
		expect(zone(s, 'HAND', 1)).toHaveLength(1)
	})

	it('no window when the negative effect could not apply (empty hand)', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(
			s,
			real('1SIS10/25'),
			ID('1PIC23'),
			{ k: 'DUTY_OFFICER', seat: 1 },
			1,
		)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, recording(seen))
		expect(seen.filter((c) => c.k === 'OPTIONAL_TRIGGERS')).toHaveLength(0)
		expect(s.cards[ID('1PIC23')]!.zone.k).toBe('DUTY_OFFICER')
	})

	it('1SIS06: the passive ignores the attack and logs itself', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real('1SIS06/25'), ID('mines'), { k: 'FLEET', seat: 1 }, 1)
		s = withHand(s, 1, 2, 'v')
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, recording(seen))
		expect(seen.filter((c) => c.seat === 1)).toHaveLength(0) // mandatory
		expect(s.cards[ID('mines')]!.zone).toEqual({ k: 'LOG', seat: 1 })
		expect(zone(s, 'HAND', 1)).toHaveLength(2)
	})

	it('1PER19: discard a card to ignore it, 1 {GLO} per trait shared with 1PER19', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(
			s,
			real('1PER19/25'),
			ID('1PER19'),
			{ k: 'DUTY_OFFICER', seat: 1 },
			1,
		)
		s = place(s, 'rpPer19Twin', ID('twin'), { k: 'HAND', seat: 1 }, 1)
		s = withHand(s, 1, 1, 'v')
		const shared = byCardId
			.get('1PER19/25')!
			.traits.filter((t) => ['ROMULAN', 'TELEPATH', 'SHADY'].includes(t)).length
		expect(shared).toBeGreaterThan(0)
		s = resolveOp(s, ID('atk'), 0, (c) =>
			c.k === 'CHOOSE_CARDS' && c.seat === 1 ? [ID('twin')] : auto(c),
		)
		expect(s.cards[ID('twin')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
		expect(zone(s, 'HAND', 1)).toEqual([ID('v0')]) // the attack's discards ignored
		expect(s.players[1].resources.GLO).toBe(shared)
	})

	it('1BUR15: when the attack would dismiss the Duty Officer, dismiss a card beamed here instead', () => {
		let s = place(
			fresh(),
			'rpAttackDO',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real('1BUR15/26'), ID('book'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'rpPlain', ID('beamed'), { k: 'BEAMED', host: 'book' }, 1)
		s = place(s, 'rpPlain', ID('do'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = resolveOp(s, ID('atk'), 0)
		expect(s.cards[ID('do')]!.zone.k).toBe('DUTY_OFFICER')
		expect(s.cards[ID('beamed')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
	})

	it('1BUR15: not offered with nothing beamed to it (the cost is unpayable)', () => {
		let s = place(
			fresh(),
			'rpAttackDO',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real('1BUR15/26'), ID('book'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'rpPlain', ID('do'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, recording(seen))
		expect(seen.filter((c) => c.k === 'OPTIONAL_TRIGGERS')).toHaveLength(0)
		expect(s.cards[ID('do')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
	})

	it('1BUR15: not offered for an attack that dismisses no Duty Officer', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real('1BUR15/26'), ID('book'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'rpPlain', ID('beamed'), { k: 'BEAMED', host: 'book' }, 1)
		s = withHand(s, 1, 2, 'v')
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('atk'), 0, recording(seen))
		expect(seen.filter((c) => c.k === 'OPTIONAL_TRIGGERS')).toHaveLength(0)
		expect(zone(s, 'HAND', 1)).toHaveLength(0)
	})

	it('1CAR11: dismiss it to keep the Away Team an attack would remove', () => {
		let s = place(
			fresh(),
			'rpAttackAway',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, real('1CAR11/16'), ID('1CAR11'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'rpLoc', ID('nz'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = { ...s, awayTeamsAt: { nz: [0, 1] } }
		s = resolveOp(s, ID('atk'), 0)
		expect(s.awayTeamsAt['nz']).toEqual([0, 1])
		expect(s.cards[ID('1CAR11')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
		expect(s.players[0].resources.DIL).toBe(1)
	})

	it('probe mode never opens a window (legality stays a dry run)', () => {
		let s = place(
			fresh(),
			'rpAttackDiscard',
			ID('atk'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(
			s,
			real('1SIS10/25'),
			ID('1PIC23'),
			{ k: 'DUTY_OFFICER', seat: 1 },
			1,
		)
		s = withHand(s, 1, 2, 'v')
		expect(
			probe(
				s,
				{ k: 'FORCE', body: { k: 'DISCARD', count: 1, from: 'HAND' } },
				{
					actor: 0,
					source: ID('atk'),
					bindings: {},
				},
			),
		).toBe(true)
	})
})

describe('gain replacement: scan 2 cards of the gained suit instead (1SIS22)', () => {
	const market = (s: GameState): GameState => {
		for (let i = 0; i < 3; i++)
			s = place(s, 'rpMarketPerson', ID(`mdeck${i}`), {
				k: 'MARKET_DECK',
				suit: 'PERSON',
			})
		return place(s, 'rpMarketPerson', ID('offer'), {
			k: 'MARKET_OFFER',
			suit: 'PERSON',
		})
	}

	it('1SIS22: the gain becomes a scan of 2 PERSON (the revealed cards are offered)', () => {
		let s = market(fresh())
		s = place(s, 'rpGainPerson', ID('g'), { k: 'STAGING', seat: 0 }, 0)
		s = place(
			s,
			real('1SIS22/25'),
			ID('sis22'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('g'), 0, (c) => {
			seen.push(c)
			if (c.k === 'CHOOSE_CARDS' && c.candidates.includes(ID('mdeck1')))
				return [ID('mdeck1')] // only a scan reveals the 2nd deck card
			return auto(c)
		})
		expect(seen.some((c) => c.k === 'OPTIONAL_TRIGGERS')).toBe(true)
		expect(s.cards[ID('mdeck1')]!.owner).toBe(0)
		expect(s.cards[ID('mdeck1')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
	})

	it('1BUR06: scan instead and gain 1 {GLO}; declining gains normally', () => {
		let s = market(fresh())
		s = place(s, 'rpGainPerson', ID('g'), { k: 'STAGING', seat: 0 }, 0)
		s = place(
			s,
			real('1BUR06/26'),
			ID('bur06'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		const took = resolveOp(s, ID('g'), 0)
		expect(took.players[0].resources.GLO).toBe(1)
		const declined = resolveOp(s, ID('g'), 0, (c) =>
			c.k === 'OPTIONAL_TRIGGERS' ? [] : auto(c),
		)
		expect(declined.players[0].resources.GLO).toBe(0)
		expect(
			Object.values(declined.cards).filter(
				(c) => c.owner === 0 && c.zone.k === 'DISCARD',
			),
		).toHaveLength(1)
	})
})

describe('restrictions', () => {
	it('1SIS03: "this ship cannot be warped"', () => {
		let s = place(
			fresh(),
			real('1SIS03/25'),
			ID('ds9'),
			{ k: 'FLEET', seat: 0 },
			0,
		)
		s = place(s, 'rpLoc', ID('nz'), { k: 'NEUTRAL_ZONE', slot: 0 })
		const warp: Effect = {
			k: 'WARP',
			ship: { zones: [{ k: 'FLEET', seat: 0 }], filter: { suits: ['SHIP'] } },
			to: { zones: ['LOCATIONS'] },
		}
		expect(probe(s, warp, { actor: 0, source: ID('x'), bindings: {} })).toBe(
			true,
		)
		const after = pushAndRun(s, warp, ID('x'), 0)
		expect(after.cards[ID('ds9')]!.shipTokenAt).toBe(null)
		// another SHIP still warps
		s = place(s, 'rpShip', ID('other'), { k: 'FLEET', seat: 0 }, 0)
		const other = pushAndRun(s, warp, ID('x'), 0)
		expect(other.cards[ID('other')]!.shipTokenAt).toBe(ID('nz'))
	})

	it('1BUR03: "your {DIL} cannot be stolen"', () => {
		let s = setResources(fresh(), 1, 'DIL', 3)
		s = setResources(s, 1, 'LAT', 2)
		s = place(s, real('1BUR03/26'), ID('disco'), { k: 'FLEET', seat: 1 }, 1)
		s = pushAndRun(s, { k: 'STEAL', res: 'DIL', amount: 2 }, ID('x'), 0)
		expect(s.players[1].resources.DIL).toBe(3)
		expect(s.players[0].resources.DIL).toBe(0)
		s = pushAndRun(s, { k: 'STEAL', res: 'LAT', amount: 1 }, ID('x'), 0)
		expect(s.players[0].resources.LAT).toBe(1)
	})
})

describe('1SIS04', () => {
	it('"Refresh a BAJORAN to draw a card": refreshing is the cost', () => {
		let s = place(
			fresh(),
			real('1SIS04/25'),
			ID('orb'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, 'rpPlain', ID('d0'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'rpBajoran', ID('baj'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		const ctx: EffectCtx = { actor: 0, source: ID('orb'), bindings: {} }
		const op0 = byCardId.get('1SIS04/25')!.operations[0]!.effect
		expect(probe(s, op0, ctx)).toBe(false) // nothing exhausted
		s = {
			...s,
			cards: { ...s.cards, baj: { ...s.cards['baj']!, exhausted: true } },
		}
		expect(probe(s, op0, ctx)).toBe(true)
		s = resolveOp(s, ID('orb'), 0)
		expect(s.cards[ID('baj')]!.exhausted).toBe(false)
		expect(zone(s, 'HAND', 0)).toEqual([ID('d0')])
	})

	it('enlists a Development 1 {DIL} and 1 {LAT} cheaper', () => {
		register([
			person('rpDev', [], {
				developmentCost: {
					k: 'SEQ',
					steps: [
						{ k: 'COST_RESOURCE', res: 'DIL', amount: 3 },
						{ k: 'COST_RESOURCE', res: 'LAT', amount: 2 },
					],
				},
			}),
		])
		let s = setActions(fresh(), 0, 1)
		s = setResources(setResources(s, 0, 'DIL', 2), 0, 'LAT', 1)
		s = place(s, real('1SIS04/25'), ID('orb'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'rpBajoran', ID('p'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'rpDev', ID('dev'), { k: 'DEVELOPMENT', seat: 0 }, 0)
		s = resolveOp(s, ID('orb'), 2)
		expect(s.cards[ID('dev')]!.zone).toEqual({ k: 'DRAW', seat: 0 })
		expect(s.players[0].resources).toMatchObject({ DIL: 0, LAT: 0 })
		expect(s.cards[ID('orb')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(s.players[0].actions.available).toBe(0) // [action]
	})

	it('discountCost threads a SEQ and gives each alternative the full discount', () => {
		const ctx: EffectCtx = { actor: 0, source: ID('x'), bindings: {} }
		const cost: Effect = {
			k: 'IF',
			cond: { k: 'HAS_TRAIT_IN_PLAY', trait: 'BAJORAN' },
			then: { k: 'NOOP' },
			else: {
				k: 'SEQ',
				steps: [
					{ k: 'COST_RESOURCE', res: 'DIL', amount: 1 },
					{ k: 'COST_RESOURCE', res: 'DIL', amount: 5 },
				],
			},
		}
		const out = discountCost(fresh(), cost, { DIL: 2 }, ctx).node
		expect(out).toMatchObject({
			else: {
				steps: [
					{ k: 'COST_RESOURCE', amount: 0 },
					{ k: 'COST_RESOURCE', amount: 4 },
				],
			},
		})
	})
})

describe('new amounts, filters and queries', () => {
	it('1SIS22: the lowest track, asking only in a tie', () => {
		let s = setSpecialty(
			setSpecialty(fresh(), 0, 'RESEARCH', 2),
			0,
			'INFLUENCE',
			1,
		)
		s = setSpecialty(s, 0, 'MILITARY', 1)
		s = pushAndRun(
			s,
			{ k: 'ADVANCE_SPECIALTY', specialty: 'LOWEST', amount: 1 },
			ID('x'),
			0,
		)
		expect(s.pendingChoice).toMatchObject({
			k: 'CHOOSE_SPECIALTY',
			specialties: ['INFLUENCE', 'MILITARY'],
		})
		let t = setSpecialty(fresh(), 0, 'INFLUENCE', 3)
		t = setSpecialty(t, 0, 'MILITARY', 2)
		t = pushAndRun(
			t,
			{ k: 'ADVANCE_SPECIALTY', specialty: 'LOWEST', amount: 1 },
			ID('x'),
			0,
		)
		expect(t.pendingChoice).toBe(null)
		expect(t.players[0].specialties.RESEARCH).toBe(1)
	})

	it('TRAIT_COUNT / SHARED_TRAITS count distinct traits of a bound card', () => {
		let s = place(fresh(), 'rpPer19Twin', ID('b'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'rpBajoran', ID('p'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		const ctx: EffectCtx = { actor: 0, source: ID('x'), bindings: { b: 'b' } }
		expect(evalAmount(s, { k: 'TRAIT_COUNT', bind: 'b' }, ctx)).toBe(3)
		expect(
			evalAmount(
				s,
				{
					k: 'SHARED_TRAITS',
					bind: 'b',
					with: { zones: [{ k: 'DUTY_OFFICER', seat: 0 }] },
				},
				ctx,
			),
		).toBe(0)
	})

	it('1BUR04: CardFilter.focus matches Focus icons only', () => {
		register([
			{ ...person('rpInfFocus'), focus: 'FOCUS_INFLUENCE' },
			person('rpInfSkill', [], { skills: ['SKILL_INFLUENCE'] }),
		])
		let s = place(fresh(), 'rpInfFocus', ID('f'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'rpInfSkill', ID('k'), { k: 'HAND', seat: 0 }, 0)
		const opts = { allowWildcard: false, actorMayOptIn: false }
		const filter = { focus: ['INFLUENCE' as const, 'MILITARY' as const] }
		expect(matchFilter(s, s.cards['f']!, filter, opts)).toBe(true)
		expect(matchFilter(s, s.cards['k']!, filter, opts)).toBe(false)
	})

	it('1BUR12: 1 Skill per VULCAN / AMBASSADOR / ROMULAN in play, its own traits included', () => {
		let s = place(
			fresh(),
			real('1BUR12/26'),
			ID('nivar'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = place(s, 'rpPer19Twin', ID('1PER20'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		expect(countSkillIcons(s, 0, 'RESEARCH')).toBe(1) // 1BUR12 is VULCAN
		expect(countSkillIcons(s, 0, 'MILITARY')).toBe(2) // 1BUR12 + the ROMULAN
		expect(countSkillIcons(s, 0, 'INFLUENCE')).toBe(0)
	})

	it('1SIS15: forces the discard only with an opponent SHIP at its LOCATION', () => {
		let s = setActions(fresh(), 0, 1)
		s = place(s, real('1SIS15/25'), ID('def'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'rpLoc', ID('nz0'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'rpLoc', ID('nz1'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = place(s, 'rpShip', ID('theirs'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('nz0'),
		})
		s = withHand(s, 1, 3, 'v')
		const to =
			(loc: string): Answer =>
			(c) =>
				c.k === 'CHOOSE_LOCATION' ? ID(loc) : auto(c)
		expect(zone(resolveOp(s, ID('def'), 0, to('nz1')), 'HAND', 1)).toHaveLength(
			3,
		)
		expect(zone(resolveOp(s, ID('def'), 0, to('nz0')), 'HAND', 1)).toHaveLength(
			1,
		)
	})

	it('1BUR21: exhaust a SHIP to refresh ITS LOCATION (atBound)', () => {
		let s = place(
			fresh(),
			real('1BUR21/26'),
			ID('bur21'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = place(s, 'rpLoc', ID('here'), { k: 'LOCATION_AREA', seat: 0 }, 0, {
			exhausted: true,
		})
		s = place(s, 'rpLoc', ID('there'), { k: 'LOCATION_AREA', seat: 0 }, 0, {
			exhausted: true,
		})
		s = place(s, 'rpShip', ID('ship'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('here'),
		})
		s = resolveOp(s, ID('bur21'), 2)
		expect(s.cards[ID('ship')]!.exhausted).toBe(true)
		expect(s.cards[ID('here')]!.exhausted).toBe(false)
		expect(s.cards[ID('there')]!.exhausted).toBe(true)
	})
})

describe('decks, the Stardate card and scoring hooks', () => {
	it('1SIS21: peek at 3 LOCATION and re-stack them top/bottom in any order', () => {
		let s = fresh()
		for (const id of ['l0', 'l1', 'l2', 'l3'])
			s = place(s, 'rpLoc', ID(id), { k: 'LOCATION_DECK' })
		const node = byCardId.get('1SIS21/25')!.operations[1]!.effect
		s = drive(pushAndRun(s, node, ID('x'), 0), (c) => {
			if (c.k === 'CHOOSE_CARDS') return [ID('l0')] // l0 → bottom
			if (c.k === 'ORDER_CARDS') return [ID('l2'), ID('l1')]
			return auto(c)
		})
		expect(zone(s, 'LOCATION_DECK')).toEqual(['l2', 'l1', 'l3', 'l0'])
	})

	it('1CAR16: two ops — look at 2 LOCATION or 2 ENCOUNTER + draw; [action] INF6 take control', () => {
		const def = byCardId.get('1CAR16/16')!
		expect(def.operations.map((o) => [o.costsAction, o.requires?.min])).toEqual(
			[
				[false, undefined],
				[true, 6],
			],
		)
		let s = fresh()
		for (const id of ['e0', 'e1'])
			s = place(s, 'rpEnc', ID(id), { k: 'ENCOUNTER_DECK' })
		s = place(s, 'rpLoc', ID('l0'), { k: 'LOCATION_DECK' })
		s = place(s, 'rpPlain', ID('d0'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, def.id, ID('uw'), { k: 'STAGING', seat: 0 }, 0)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('uw'), 0, (c) => {
			seen.push(c)
			if (c.k === 'CHOOSE_OPTION') return { key: 'ENCOUNTER' }
			if (c.k === 'CHOOSE_CARDS') return [ID('e0')]
			return auto(c)
		})
		expect(seen[0]).toMatchObject({ k: 'CHOOSE_OPTION' })
		expect(zone(s, 'ENCOUNTER_DECK')).toEqual(['e1', 'e0'])
		expect(zone(s, 'HAND', 0)).toEqual([ID('d0')])
	})

	it('1BUR12: removes 1 {GLO} from the Stardate card; emptying it hands it over', () => {
		let s = fresh()
		s = place(s, 'rpPlain', ID('sd0'), { k: 'STARDATE_PILE' })
		s = place(s, 'rpPlain', ID('sd1'), { k: 'STARDATE_PILE' })
		s = {
			...s,
			stardates: {
				pile: [ID('sd0'), ID('sd1')],
				gloryOnTop: 2,
				glories: [2, 4],
			},
		}
		const node: Effect = { k: 'REMOVE_STARDATE_GLORY', amount: 1 }
		s = pushAndRun(s, node, ID('x'), 0)
		expect(s.stardates.gloryOnTop).toBe(1)
		s = pushAndRun(s, node, ID('x'), 0)
		expect(s.stardates.pile).toEqual([ID('sd1')])
		expect(s.stardates.gloryOnTop).toBe(4)
		expect(s.players[1].heldStardate).toBe(ID('sd0'))
		expect(s.players[0].resources.GLO).toBe(0)
	})

	it('1PER22: its pre-scoring INCIDENT find-and-return runs before FINAL_SCORING', () => {
		register([makeDef({ id: 'rpIncident', suit: 'INCIDENT', operations: [] })])
		let s = place(
			fresh(),
			real('1PER22/25'),
			ID('sukal'),
			{ k: 'DISCARD', seat: 0 },
			0,
		)
		for (const id of ['i0', 'i1', 'i2'])
			s = place(s, 'rpIncident', ID(id), { k: 'HAND', seat: 0 }, 0)
		s = { ...s, resolutionTriggered: true, turnsAfterResolution: 1 }
		s = handOffTurn(s, 0)
		expect(s.result).toBe(null)
		s = drive(s)
		expect(s.result).toEqual({ kind: 'FINAL_SCORING' })
		expect(zone(s, 'HAND', 0)).toHaveLength(1)
		expect(zone(s, 'INCIDENT_DECK')).toHaveLength(2)
	})
})

describe('DUPLICATE, COST_PUT and 1ENC07', () => {
	it('1SHI04: duplicate a deployed SHIP of either player, never a TIME TRAVEL one', () => {
		register([
			makeDef({
				id: 'rpShipDil',
				suit: 'SHIP',
				operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 })],
			}),
			makeDef({
				id: 'rpShipTT',
				suit: 'SHIP',
				traits: ['TIME_TRAVEL'],
				operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'LAT', amount: 2 })],
			}),
		])
		let s = setSpecialty(fresh(), 0, 'RESEARCH', 7)
		s = place(s, real('1SHI04/13'), ID('holo'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'rpShipDil', ID('theirs'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'rpShipTT', ID('tt'), { k: 'FLEET', seat: 0 }, 0)
		const seen: PendingChoice[] = []
		s = resolveOp(s, ID('holo'), 0, recording(seen))
		const pick = seen.find((c) => c.k === 'CHOOSE_CARDS')
		expect(pick).toBeUndefined() // a single legal source: auto-picked
		expect(s.players[0].resources).toMatchObject({ DIL: 2, LAT: 0 })
	})

	it("1LOC20: after playing UTILIZE, duplicate Utilize's OTHER play operation", () => {
		const util = [...byCardId.values()].find((d) => d.id === '1SIS17-25')!
		let s = place(
			fresh(),
			real('1LOC20/20'),
			ID('1LOC20'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = place(s, util.id, ID('util'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'rpPlain', ID('p'), { k: 'HAND', seat: 0 }, 0)
		s = {
			...s,
			resolvedOps: {
				turn: s.turnNumber,
				refs: [{ card: ID('util'), opIndex: 0, seat: 0 }],
			},
		}
		const seen: PendingChoice[] = []
		s = drive(
			{
				...s,
				eventQueue: [{ k: 'CARD_PLAYED', iid: ID('util'), seat: 0 }],
				stack: [
					{
						k: 'EFFECT',
						node: { k: 'NOOP' },
						ctx: { actor: 0, source: ID('x'), bindings: {} },
						ip: 0,
					},
				],
			},
			recording(seen),
		)
		// no CHOOSE_OPTION: op #0 (gain {DIL}) was already resolved, so the
		// OTHER op (advance a chosen specialty) is duplicated at once; the "you
		// may put a PERSON" is asked as the put's own pick
		expect(seen.map((c) => c.k)).toEqual([
			'OPTIONAL_TRIGGERS',
			'CHOOSE_CARDS',
			'CHOOSE_SPECIALTY',
		])
		expect(s.players[0].resources.DIL).toBe(0)
		// the PERSON went on top of the deck (the cost), and only op #1 was duplicable
		expect(zone(s, 'DRAW', 0)[0]).toBe(ID('p'))
		const played = util.operations.filter((o) => o.type === 'PLAY')
		expect(played.length).toBeGreaterThan(1)
	})

	it('1CAR02: put a PERSON from the Discard pile on top of your deck', () => {
		let s = setActions(setSpecialty(fresh(), 0, 'RESEARCH', 4), 0, 1)
		s = place(s, real('1CAR02/16'), ID('bst'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'rpPlain', ID('top'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'rpPlain', ID('dp'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'rpLoc', ID('nz'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = {
			...s,
			players: [{ ...s.players[0], awayTeamsInPool: 1 }, s.players[1]],
		}
		let rounds = 0
		s = resolveOp(s, ID('bst'), 0, (c) => {
			if (c.k === 'CONFIRM') return rounds++ === 0
			if (c.k === 'CHOOSE_OPTION') return { key: c.options[1]!.key }
			return auto(c)
		})
		expect(zone(s, 'DRAW', 0)).toEqual([ID('dp'), ID('top')])
		expect(s.awayTeamsAt['nz']).toEqual([1, 0])
		expect(s.players[0].actions.available).toBe(0)
	})

	it('1ENC07: deploying it takes control of a LOCATION', () => {
		let s = setActions(fresh(), 0, 1)
		s = place(s, real('1ENC07/8'), ID('skr'), { k: 'STAGING', seat: 0 }, 0)
		// 1SIS01 SIS: "Reaction: After taking control of a LOCATION, gain 2 {DIL}"
		s = place(s, real('1SIS01/25'), ID('sis'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = resolveOp(s, ID('skr'), 0, (c) => (c.k === 'CONFIRM' ? false : auto(c)))
		expect(s.cards[ID('skr')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
		expect(s.players[0].resources.DIL).toBe(2)
		const opts = { allowWildcard: true, actorMayOptIn: true }
		expect(matchFilter(s, s.cards['skr']!, { suits: ['LOCATION'] }, opts)).toBe(
			true,
		)
		expect(
			s.log.some((e) => e.kind === 'SKIPPED' && e.message.includes('DEPLOY')),
		).toBe(false)
	})
})
