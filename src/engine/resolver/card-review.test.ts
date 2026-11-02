// Engine gaps closed during the sprite-vs-data card review (cards/records/
// REVIEW.md "Sprite review log"). Each `it` names the card that needed it:
//   - FIND bind + COST_DISCARD exceptBound + FREE_PLAY bound (1PIC07: the
//     found PERSON is free played by discarding some other card)
//   - FREE_PLAY moves the card into Staging like a normal play
//   - Trigger CARD_GAINED seat scoping (1PIC09 "after gaining", 1SIS06
//     "after your opponent gains")
//   - Query bound / withShip / withAwayTeam, ZoneSpec BEAMED_ANY (1PIC13,
//     1PIC14, 1PIC23)
//   - Amount SKILL_ICONS 'CHOSEN' (1PIC19), Query bound lists (1SHR03),
//     SPECIAL "when you log this card" trigger (1SHR06)
//   - Query atThisShip (1SHR07), COST_REMOVE_AWAY_TEAM distinct +
//     COST_LOG bind (1SHR16), triggered PASSIVE (1SHR10)
//   - DEPLOY moves an ONGOING card to the Fleet + REMOVE_AWAY_TEAM bind (1SHR24
//     1SHR24), DISCARD DECK_TOP whose OPPONENT + bind (1SHR21)
//   - Predicate COMPARE (1KOL06 picks the lower specialty), COST_REQUIRE
//     (1KOL05/07/08 dev cost "and have 10+ GLO"), trigger SPECIALTY_ADVANCED
//     (1KOL07 / 1KOL08 "after gaining at least 1 INFLUENCE"), DRAW
//     fromBottom (1KOL05), Query secured (1KOL08)
//   - ZoneSpec BEAMED_TO_SHIP (1KOL17 "a PERSON beamed to a SHIP"),
//     MODIFIER_ATTACH stack + untilEndOfTurn layers (1KOL22: +1 hand size
//     per unspent action, this turn only)
//   - ALT_PLAY static PASSIVE + PLAY_CARD `via` (1PIC08: an INCIDENT may be
//     played with a substitute operation — pay a discard to send it back,
//     then draw 2)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, CardDefSchema, type CardDef } from '../../data/schema'
import type { Effect } from './nodes'
import type { EffectCtx, GameState } from '../state'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	pushAndRun,
	setResources,
	setSpecialty,
	type ZoneRef,
} from './testUtils'
import { canPayAll } from './primitives'
import { run } from './stack'
import { applyChoice } from './choices'
import { matchesTrigger } from './triggers'
import { resolveQuery } from '../queries/resolveQuery'
import { describe as describeEffect } from '../describe'
import { effectiveHandSize, dropTurnModifiers } from '../modifiers'
import { reduce, legalIntents } from '../intents'
import { canPlay, singleLegalAction } from '../queries/legality'
import { zoneKey } from '../state'

const SRC = ID('src')
const ctx0 = (bindings: EffectCtx['bindings'] = {}): EffectCtx => ({
	actor: 0,
	source: SRC,
	bindings,
})

function answer(state: GameState, selection: unknown): GameState {
	const ch = state.pendingChoice
	if (ch === null) throw new Error('expected a pending choice')
	return run(
		applyChoice(state, {
			t: 'RESOLVE_CHOICE',
			choiceId: ch.id,
			selection,
		} as never),
	)
}

describe('1PIC07 — free play THE found card', () => {
	register([
		makeDef({
			id: 'sb-person',
			suit: 'PERSON',
			operations: [
				{
					type: 'PLAY',
					costsAction: true,
					isAttack: false,
					effect: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 },
					text: 'gain 2 DIL',
				},
			],
		}),
		makeDef({
			id: 'sb-other',
			suit: 'PERSON',
			operations: [
				{
					type: 'PLAY',
					costsAction: true,
					isAttack: false,
					effect: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
					text: 'gain 1 LAT',
				},
			],
		}),
	])
	const node: Effect = {
		k: 'SEQ',
		steps: [
			{
				k: 'FIND',
				filter: { suits: ['PERSON'] },
				zones: [{ k: 'DRAW', seat: 0 }],
				bind: 'found',
			},
			{
				k: 'MAY',
				body: {
					k: 'PAY_THEN',
					cost: { k: 'COST_DISCARD', count: 1, exceptBound: 'found' },
					body: {
						k: 'FREE_PLAY',
						filter: { suits: ['PERSON'] },
						bound: 'found',
					},
				},
			},
		],
	}

	it('discards a different card, then free plays exactly the found card via Staging', () => {
		let s = fresh()
		s = place(s, 'sb-person', ID('found'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'sb-other', ID('other'), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(s, node, SRC, 0)
		// FIND auto-picks the single candidate; the MAY is asked as the discard:
		// the only legal one is the OTHER card (the found one is excluded); the
		// free play plays the found card, not the other PERSON.
		s = answer(s, [ID('other')])
		expect(s.cards[ID('other')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('found')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
		expect(s.players[0]!.resources.DIL).toBe(2)
		expect(s.players[0]!.resources.LAT).toBe(0)
	})

	it('with only the found card in hand, the "different card" cost is unpayable', () => {
		let s = fresh()
		s = place(s, 'sb-person', ID('found'), { k: 'DRAW', seat: 0 }, 0)
		s = pushAndRun(s, node, SRC, 0)
		if (s.pendingChoice !== null) s = answer(s, true)
		expect(s.cards[ID('found')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.players[0]!.resources.DIL).toBe(0)
	})
})

describe('CARD_GAINED seat scoping', () => {
	it('defaults to the owner\'s own gains (1PIC09 "after gaining a SHIP")', () => {
		register([makeDef({ id: 'cg-ship', suit: 'SHIP', operations: [] })])
		const s = place(fresh(), 'cg-ship', ID('cg'), { k: 'DISCARD', seat: 0 }, 0)
		const ev = { k: 'CARD_GAINED', iid: ID('cg'), seat: 0 } as const
		expect(
			matchesTrigger(
				s,
				ev,
				{ on: 'CARD_GAINED', filter: { suits: ['SHIP'] } },
				0,
			),
		).toBe(true)
		expect(
			matchesTrigger(
				s,
				ev,
				{ on: 'CARD_GAINED', filter: { suits: ['SHIP'] } },
				1,
			),
		).toBe(false)
	})

	it("seat OPPONENT matches only the other player's gains (1SIS06)", () => {
		const s = place(fresh(), 'cg-ship', ID('cg'), { k: 'DISCARD', seat: 0 }, 0)
		const ev = { k: 'CARD_GAINED', iid: ID('cg'), seat: 0 } as const
		expect(
			matchesTrigger(s, ev, { on: 'CARD_GAINED', seat: 'OPPONENT' }, 1),
		).toBe(true)
		expect(
			matchesTrigger(s, ev, { on: 'CARD_GAINED', seat: 'OPPONENT' }, 0),
		).toBe(false)
	})
})

describe('Query bound / withShip / withAwayTeam / BEAMED_ANY', () => {
	register([
		makeDef({ id: 'q-loc', suit: 'LOCATION', operations: [] }),
		makeDef({ id: 'q-ship', suit: 'SHIP', operations: [] }),
		makeDef({ id: 'q-cargo', suit: 'CARGO', operations: [] }),
		makeDef({ id: 'q-inc', suit: 'INCIDENT', operations: [] }),
	])
	const NZ: ZoneRef[] = [0, 1, 2].map((slot) => ({
		k: 'NEUTRAL_ZONE',
		slot: slot as 0 | 1 | 2,
	}))

	it('bound restricts to the bound card (1PIC13 "return THE INCIDENT")', () => {
		let s = fresh()
		s = place(s, 'q-inc', ID('i1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'q-inc', ID('i2'), { k: 'HAND', seat: 0 }, 0)
		const q = { zones: [{ k: 'HAND', seat: 0 }] as const, bound: '$event.card' }
		expect(
			resolveQuery(
				s,
				{ ...q, zones: [...q.zones] },
				ctx0({ '$event.card': 'i2' }),
			),
		).toEqual([ID('i2')])
		expect(resolveQuery(s, { ...q, zones: [...q.zones] }, ctx0())).toEqual([])
	})

	it('withShip keeps only Locations where the actor has a SHIP token (1PIC14)', () => {
		let s = fresh()
		s = place(s, 'q-loc', ID('l0'), NZ[0]!)
		s = place(s, 'q-loc', ID('l1'), NZ[1]!)
		s = place(s, 'q-ship', ID('mine'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('l1'),
		})
		s = place(s, 'q-ship', ID('theirs'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('l0'),
		})
		expect(resolveQuery(s, { zones: [...NZ], withShip: true }, ctx0())).toEqual(
			[ID('l1')],
		)
	})

	it('withAwayTeam keeps only Locations where the actor has an Away Team (1PIC23)', () => {
		let s = fresh()
		s = place(s, 'q-loc', ID('l0'), NZ[0]!)
		s = place(s, 'q-loc', ID('l1'), NZ[1]!)
		s = {
			...s,
			awayTeamsAt: {
				l0: [0, 1],
				l1: [1, 1],
			} as unknown as GameState['awayTeamsAt'],
		}
		expect(
			resolveQuery(s, { zones: [...NZ], withAwayTeam: true }, ctx0()),
		).toEqual([ID('l1')])
	})

	it('BEAMED_ANY lists every card beamed to the actor\'s cards (1PIC14 "recall a card beamed to a SHIP")', () => {
		let s = fresh()
		s = place(s, 'q-ship', ID('sh'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'q-cargo', ID('b1'), { k: 'BEAMED', host: 'sh' }, 0)
		s = place(s, 'q-cargo', ID('loose'), { k: 'STAGING', seat: 0 }, 0)
		expect(
			resolveQuery(s, { zones: ['BEAMED_ANY'], seat: 'SELF' }, ctx0()),
		).toEqual([ID('b1')])
	})
})

// ---------------------------------------------------------------------------
// Run 2 (1PIC01/04/06/08/11/15–18/24): DRAW bind + DISCARD/COST_DISCARD
// onlyBound, BEAM bound, SEND_AWAY_TEAM bind, SELECT
// ---------------------------------------------------------------------------

describe('1PIC08 — "draw a card, then discard IT"', () => {
	register([makeDef({ id: 'tr-a', suit: 'CARGO', operations: [] })])
	const node: Effect = {
		k: 'SEQ',
		steps: [
			{ k: 'DRAW', count: 1, bind: 'drawn' },
			{
				k: 'PAY_THEN',
				cost: { k: 'COST_DISCARD', count: 1, onlyBound: ['drawn'] },
				body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
			},
		],
	}

	it('discards exactly the drawn card, never another card in hand', () => {
		let s = fresh()
		s = place(s, 'tr-a', ID('old'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'tr-a', ID('top'), { k: 'DRAW', seat: 0 }, 0)
		s = pushAndRun(s, node, SRC, 0)
		expect(s.cards[ID('top')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('old')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.players[0]!.resources.GLO).toBe(1)
	})
})

describe('1PIC16 — "draw 2 cards and discard one of THEM"', () => {
	register([makeDef({ id: 'dp-a', suit: 'CARGO', operations: [] })])
	it('offers only the two drawn cards', () => {
		let s = fresh()
		s = place(s, 'dp-a', ID('old'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'dp-a', ID('d2'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'dp-a', ID('d1'), { k: 'DRAW', seat: 0 }, 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'DRAW', count: 2, bind: ['a', 'b'] },
				{ k: 'DISCARD', count: 1, from: 'HAND', onlyBound: ['a', 'b'] },
			],
		}
		s = pushAndRun(s, node, SRC, 0)
		const ch = s.pendingChoice as unknown as { candidates: string[] } | null
		expect(ch).not.toBeNull()
		expect([...ch!.candidates].sort()).toEqual([ID('d1'), ID('d2')].sort())
		// discard one drawn card; the other drawn card and the old hand card stay
		s = answer(s, [ID('d1')])
		expect(s.cards[ID('d1')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('d2')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.cards[ID('old')]!.zone).toEqual({ k: 'HAND', seat: 0 })
	})

	it('describes the discard as one of the drawn cards', () => {
		expect(
			describeEffect({
				k: 'SEQ',
				steps: [
					{ k: 'DRAW', count: 2, bind: ['a', 'b'] },
					{ k: 'DISCARD', count: 1, from: 'HAND', onlyBound: ['a', 'b'] },
				],
			}),
		).toBe('Draw 2 cards. Discard one of them.')
	})
})

describe('1PIC01 — "beam THE gained card"', () => {
	register([
		makeDef({ id: 'bm-ally', suit: 'ALLY', operations: [] }),
		makeDef({ id: 'bm-ship', suit: 'SHIP', operations: [] }),
	])
	it('BEAM bound moves only the bound card', () => {
		let s = fresh()
		s = place(s, 'bm-ship', ID('sh'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'bm-ally', ID('other'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'bm-ally', ID('gained'), { k: 'DISCARD', seat: 0 }, 0)
		const node: Effect = {
			k: 'BEAM',
			count: 1,
			from: [{ k: 'DISCARD', seat: 0 }],
			bound: '$event.card',
			to: { zones: [{ k: 'FLEET', seat: 0 }], filter: { suits: ['SHIP'] } },
		}
		s = run({
			...s,
			stack: [
				...s.stack,
				{
					k: 'EFFECT',
					node,
					ctx: ctx0({ '$event.card': ID('gained') }),
					ip: 0,
				},
			],
		})
		expect(s.cards[ID('gained')]!.zone).toEqual({ k: 'BEAMED', host: ID('sh') })
		expect(s.cards[ID('other')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
	})
})

describe('1PIC24 / 1PIC18 — bound Locations', () => {
	register([makeDef({ id: 'rl-loc', suit: 'LOCATION', operations: [] })])
	const LA = { k: 'LOCATION_AREA', seat: 0 } as const

	it('SEND_AWAY_TEAM bind names the targeted Location', () => {
		let s = fresh()
		s = place(s, 'rl-loc', ID('mine'), LA, 0)
		s = {
			...s,
			players: s.players.map((p) => ({
				...p,
				awayTeamsInPool: 3,
			})) as unknown as GameState['players'],
		}
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'SEND_AWAY_TEAM', count: 1, target: { zones: [LA] }, bind: 'loc' },
				{
					k: 'IF',
					cond: {
						k: 'COUNT_AT_LEAST',
						query: { zones: [LA], bound: 'loc' },
						value: 1,
					},
					then: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
				},
			],
		}
		s = pushAndRun(s, node, SRC, 0)
		expect(s.awayTeamsAt[ID('mine')]?.[0]).toBe(1)
		expect(s.players[0]!.resources.DIL).toBe(1)
	})

	it('SELECT binds the chosen Location without moving it; a later LOG uses it', () => {
		let s = fresh()
		s = place(s, 'rl-loc', ID('l1'), LA, 0)
		s = place(s, 'rl-loc', ID('l2'), LA, 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'SELECT', target: { zones: [LA] }, bind: 'sel' },
				{ k: 'LOG', target: { zones: [LA], bound: 'sel' } },
			],
		}
		s = pushAndRun(s, node, SRC, 0)
		s = answer(s, [ID('l2')])
		expect(s.cards[ID('l2')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(s.cards[ID('l1')]!.zone).toEqual(LA)
	})
})

describe('1PIC19 — "for each matching Skill icon (excluding beamed cards)"', () => {
	register([
		makeDef({
			id: 'ut-mil',
			suit: 'PERSON',
			skills: ['SKILL_MILITARY', 'SKILL_MILITARY'],
			operations: [],
		}),
		makeDef({
			id: 'ut-res',
			suit: 'PERSON',
			skills: ['SKILL_RESEARCH'],
			operations: [],
		}),
		makeDef({
			id: 'ut-any',
			suit: 'SHIP',
			skills: ['SKILL_ANY'],
			operations: [],
		}),
	])
	const node: Effect = {
		k: 'ADVANCE_SPECIALTY',
		specialty: 'CHOICE',
		amount: { k: 'SKILL_ICONS', specialty: 'CHOSEN' },
	}

	it("counts only the chosen track's icons (SKILL_ANY included), never beamed cards", () => {
		let s = fresh()
		s = place(s, 'ut-mil', ID('m'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'ut-res', ID('r'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'ut-any', ID('sh'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'ut-mil', ID('beamed'), { k: 'BEAMED', host: ID('sh') }, 0)
		s = pushAndRun(s, node, SRC, 0)
		s = answer(s, 'MILITARY')
		expect(s.players[0]!.specialties.MILITARY).toBe(3) // 2 printed + SKILL_ANY; the beamed card's 2 excluded
		expect(s.players[0]!.specialties.RESEARCH).toBe(0)
	})
})

describe('1SHR03 — "log one of THE drawn cards"', () => {
	register([makeDef({ id: 'ae-a', suit: 'CARGO', operations: [] })])
	it('a Query bound list matches any of the bound cards', () => {
		let s = fresh()
		s = place(s, 'ae-a', ID('old'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ae-a', ID('x'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ae-a', ID('y'), { k: 'HAND', seat: 0 }, 0)
		const q = {
			zones: [{ k: 'HAND' as const, seat: 0 as const }],
			bound: ['a', 'b', 'c'],
		}
		expect([...resolveQuery(s, q, ctx0({ a: 'x', b: 'y' }))].sort()).toEqual(
			[ID('x'), ID('y')].sort(),
		)
		expect(resolveQuery(s, q, ctx0())).toEqual([])
	})
})

describe('1SHR06 — "SPECIAL: When you log this card, gain 3 GLO"', () => {
	register([
		makeDef({
			id: 'ta-cargo',
			suit: 'CARGO',
			operations: [
				{
					type: 'SPECIAL',
					costsAction: false,
					isAttack: false,
					trigger: { on: 'CARD_LOGGED' },
					effect: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 3 },
					text: 'gain 3 GLO when logged',
				},
			],
		}),
	])
	it('fires for the player who logs it, from wherever it was logged', () => {
		let s = fresh()
		s = place(s, 'ta-cargo', ID('ta'), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(
			s,
			{ k: 'LOG', target: { zones: [{ k: 'HAND', seat: 0 }] } },
			SRC,
			0,
		)
		expect(s.cards[ID('ta')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(s.players[0]!.resources.GLO).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// Run 4 (1SHR07–1SHR16): Query atThisShip, COST_REMOVE_AWAY_TEAM distinct,
// COST_LOG bind, triggered PASSIVE
// ---------------------------------------------------------------------------

describe('1SHR07 — "send an AWAY TEAM to this ship\'s LOCATION"', () => {
	register([
		makeDef({ id: 'ac-loc', suit: 'LOCATION', operations: [] }),
		makeDef({ id: 'ac-ship', suit: 'SHIP', operations: [] }),
	])
	const NZ: ZoneRef[] = [0, 1, 2].map((slot) => ({
		k: 'NEUTRAL_ZONE',
		slot: slot as 0 | 1 | 2,
	}))
	it("atThisShip keeps only the Location holding the resolving ship's token", () => {
		let s = fresh()
		s = place(s, 'ac-loc', ID('l0'), NZ[0]!)
		s = place(s, 'ac-loc', ID('l1'), NZ[1]!)
		s = place(s, 'ac-ship', ID('cruiser'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('l1'),
		})
		s = place(s, 'ac-ship', ID('other'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('l0'),
		})
		const ctx: EffectCtx = { actor: 0, source: ID('cruiser'), bindings: {} }
		expect(resolveQuery(s, { zones: [...NZ], atThisShip: true }, ctx)).toEqual([
			ID('l1'),
		])
		// a ship not yet warped anywhere has no Location
		s = {
			...s,
			cards: {
				...s.cards,
				[ID('cruiser')]: { ...s.cards[ID('cruiser')]!, shipTokenAt: null },
			},
		}
		expect(resolveQuery(s, { zones: [...NZ], atThisShip: true }, ctx)).toEqual(
			[],
		)
	})
})

describe('1SHR16 — "remove an AWAY TEAM from 3 different controlled LOCATIONs"', () => {
	register([makeDef({ id: 'ip-loc', suit: 'LOCATION', operations: [] })])
	const LA: ZoneRef = { k: 'LOCATION_AREA', seat: 0 }
	const node: Effect = {
		k: 'PAY_THEN',
		cost: {
			k: 'COST_REMOVE_AWAY_TEAM',
			count: 3,
			from: { zones: [LA] },
			distinct: true,
		},
		body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
	}
	const withTeams = (counts: Record<string, [number, number]>): GameState => {
		let s = fresh()
		for (const id of Object.keys(counts)) s = place(s, 'ip-loc', ID(id), LA, 0)
		return { ...s, awayTeamsAt: counts as unknown as GameState['awayTeamsAt'] }
	}

	it('takes one token from each of three different Locations', () => {
		let s = withTeams({ a: [2, 0], b: [1, 0], c: [1, 0] })
		s = pushAndRun(s, node, SRC, 0)
		expect(s.pendingChoice?.k).toBe('CHOOSE_LOCATION')
		s = answer(s, ID('a'))
		// 'a' is no longer offered even though it still holds a token
		expect(s.pendingChoice?.k).toBe('CHOOSE_LOCATION')
		expect(
			(
				s.pendingChoice as unknown as { candidates: string[] }
			).candidates.sort(),
		).toEqual(['b', 'c'])
		s = answer(s, ID('b'))
		// the last Location is auto-picked
		expect(s.pendingChoice).toBeNull()
		expect(s.awayTeamsAt[ID('a')]).toEqual([1, 0])
		expect(s.awayTeamsAt[ID('b')]).toEqual([0, 0])
		expect(s.awayTeamsAt[ID('c')]).toEqual([0, 0])
		expect(s.players[0]!.resources.DIL).toBe(1)
	})

	it('is unpayable with Away Teams at only two Locations, however many tokens', () => {
		let s = withTeams({ a: [3, 0], b: [2, 0] })
		s = pushAndRun(s, node, SRC, 0)
		expect(s.awayTeamsAt[ID('a')]).toEqual([3, 0])
		expect(s.players[0]!.resources.DIL).toBe(0)
	})

	it('COST_LOG bind names the logged Location for a trait-share test against the CAPTAIN', () => {
		register([
			makeDef({
				id: 'ip-cap',
				suit: 'CAPTAIN',
				traits: ['ANDORIAN'],
				operations: [],
			}),
			makeDef({
				id: 'ip-and',
				suit: 'LOCATION',
				traits: ['ANDORIAN'],
				operations: [],
			}),
			makeDef({
				id: 'ip-vul',
				suit: 'LOCATION',
				traits: ['VULCAN'],
				operations: [],
			}),
		])
		const logNode = (): Effect => ({
			k: 'PAY_THEN',
			cost: {
				k: 'COST_LOG',
				filter: { suits: ['LOCATION'] },
				from: LA,
				bind: 'logged',
			},
			body: {
				k: 'IF',
				cond: {
					k: 'NOT',
					term: {
						k: 'BOUND_SHARES_TRAIT',
						bind: 'logged',
						with: { zones: [{ k: 'CAPTAIN', seat: 0 }] },
					},
				},
				then: { k: 'ADVANCE_SPECIALTY', specialty: 'INFLUENCE', amount: 1 },
			},
		})
		for (const [def, gain] of [
			['ip-and', 0],
			['ip-vul', 1],
		] as const) {
			let s = fresh()
			s = place(s, 'ip-cap', ID('cap'), { k: 'CAPTAIN', seat: 0 }, 0)
			s = place(s, def, ID('loc'), LA, 0)
			const before = s.players[0]!.specialties.INFLUENCE
			s = pushAndRun(s, logNode(), SRC, 0)
			expect(s.cards[ID('loc')]!.zone).toEqual({ k: 'LOG', seat: 0 })
			expect(s.players[0]!.specialties.INFLUENCE - before).toBe(gain)
		}
	})
})

describe('1SHR10 — "PASSIVE: After taking an INCIDENT, you may …"', () => {
	register([
		makeDef({
			id: 'jh-person',
			suit: 'PERSON',
			operations: [
				{
					type: 'PASSIVE',
					costsAction: false,
					isAttack: false,
					trigger: { on: 'INCIDENT_TAKEN' },
					effect: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
					text: 'after taking an INCIDENT, gain 1 LAT',
				},
			],
		}),
		makeDef({ id: 'jh-inc', suit: 'INCIDENT', operations: [] }),
	])
	it('fires for its owner when they take an INCIDENT, not for the opponent', () => {
		let s = fresh()
		s = place(s, 'jh-person', ID('jh'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'jh-inc', ID('i1'), { k: 'INCIDENT_DECK' })
		s = place(s, 'jh-inc', ID('i2'), { k: 'INCIDENT_DECK' })
		s = pushAndRun(s, { k: 'TAKE', deck: 'INCIDENT', count: 1 }, SRC, 0)
		expect(s.players[0]!.resources.LAT).toBe(1)
		s = pushAndRun(s, { k: 'TAKE', deck: 'INCIDENT', count: 1 }, SRC, 1)
		expect(s.players[0]!.resources.LAT).toBe(1)
	})
})

describe('1SHR24 — ONGOING deploy, "if removed from a LOCATION controlled by your opponent"', () => {
	register([
		makeDef({
			id: 'pr-rifles',
			suit: 'CARGO',
			traits: ['ONGOING', 'WEAPON'],
			operations: [],
		}),
		makeDef({ id: 'pr-loc', suit: 'LOCATION', operations: [] }),
		makeDef({ id: 'pr-inc', suit: 'INCIDENT', operations: [] }),
	])
	it('DEPLOY moves an ONGOING card from Staging to the Fleet (so Clean-up keeps it)', () => {
		let s = fresh()
		s = place(s, 'pr-rifles', ID('rifles'), { k: 'STAGING', seat: 0 }, 0)
		s = pushAndRun(
			s,
			{ k: 'DEPLOY', target: { zones: [{ k: 'STAGING', seat: 0 }] } },
			ID('rifles'),
			0,
		)
		expect(s.cards[ID('rifles')]!.zone).toEqual({ k: 'FLEET', seat: 0 })
	})

	const node: Effect = {
		k: 'SEQ',
		steps: [
			{
				k: 'REMOVE_AWAY_TEAM',
				count: 1,
				whose: 'OPPONENT',
				target: {
					zones: [
						{ k: 'LOCATION_AREA', seat: 0 },
						{ k: 'LOCATION_AREA', seat: 1 },
						{ k: 'NEUTRAL_ZONE', slot: 0 },
					],
				},
				bind: 'loc',
			},
			{
				k: 'IF',
				cond: {
					k: 'COUNT_AT_LEAST',
					query: { zones: [{ k: 'LOCATION_AREA', seat: 1 }], bound: 'loc' },
					value: 1,
				},
				then: {
					k: 'OPPONENT',
					body: { k: 'TAKE', deck: 'INCIDENT', count: 1 },
				},
			},
		],
	}
	for (const [where, zone, takes] of [
		['opponent-controlled', { k: 'LOCATION_AREA', seat: 1 }, 1],
		['Neutral Zone', { k: 'NEUTRAL_ZONE', slot: 0 }, 0],
	] as const) {
		it(`binds the Location the token came off — ${where} → opponent takes ${takes} INCIDENT`, () => {
			let s = fresh()
			s = place(
				s,
				'pr-loc',
				ID('loc'),
				zone as ZoneRef,
				zone.k === 'LOCATION_AREA' ? 1 : undefined,
			)
			s = place(s, 'pr-inc', ID('i1'), { k: 'INCIDENT_DECK' })
			s = {
				...s,
				awayTeamsAt: {
					[ID('loc')]: [0, 2],
				} as unknown as GameState['awayTeamsAt'],
			}
			s = pushAndRun(s, node, SRC, 0)
			expect(s.awayTeamsAt[ID('loc')]).toEqual([0, 1])
			expect((s.zones['HAND:1'] ?? []).length).toBe(takes)
		})
	}
})

describe('1SHR21 — opponent discards their deck top; a PERSON means both players take an INCIDENT', () => {
	register([
		makeDef({ id: 'ta-person', suit: 'PERSON', operations: [] }),
		makeDef({ id: 'ta-ship', suit: 'SHIP', operations: [] }),
		makeDef({ id: 'ta-inc', suit: 'INCIDENT', operations: [] }),
	])
	const node: Effect = {
		k: 'SEQ',
		steps: [
			{
				k: 'DISCARD',
				from: 'DECK_TOP',
				count: 1,
				whose: 'OPPONENT',
				bind: 'top',
			},
			{
				k: 'IF',
				cond: { k: 'BOUND_IS', bind: 'top', filter: { suits: ['PERSON'] } },
				then: {
					k: 'SEQ',
					steps: [
						{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
						{ k: 'OPPONENT', body: { k: 'TAKE', deck: 'INCIDENT', count: 1 } },
					],
				},
			},
		],
	}
	for (const [def, takes] of [
		['ta-person', 1],
		['ta-ship', 0],
	] as const) {
		it(`top card ${def} → each player takes ${takes}`, () => {
			let s = fresh()
			s = place(s, def, ID('top'), { k: 'DRAW', seat: 1 }, 1)
			s = place(s, 'ta-inc', ID('i1'), { k: 'INCIDENT_DECK' })
			s = place(s, 'ta-inc', ID('i2'), { k: 'INCIDENT_DECK' })
			s = pushAndRun(s, node, SRC, 0)
			expect(s.cards[ID('top')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
			expect((s.zones['HAND:0'] ?? []).length).toBe(takes)
			expect((s.zones['HAND:1'] ?? []).length).toBe(takes)
		})
	}
})

// ---------------------------------------------------------------------------
// Run 6 (1KOL03–1KOL12): COMPARE, COST_REQUIRE, SPECIALTY_ADVANCED trigger,
// DRAW fromBottom, Query secured
// ---------------------------------------------------------------------------

describe('1KOL06 — gain 1 of INFLUENCE/MILITARY, the lower one (tie: player picks)', () => {
	const INF = { k: 'SPECIALTY', specialty: 'INFLUENCE' } as const
	const MIL = { k: 'SPECIALTY', specialty: 'MILITARY' } as const
	const node: Effect = {
		k: 'IF',
		cond: { k: 'COMPARE', a: INF, op: 'LT', b: MIL },
		then: { k: 'ADVANCE_SPECIALTY', specialty: 'INFLUENCE', amount: 1 },
		else: {
			k: 'IF',
			cond: { k: 'COMPARE', a: MIL, op: 'LT', b: INF },
			then: { k: 'ADVANCE_SPECIALTY', specialty: 'MILITARY', amount: 1 },
			else: {
				k: 'CHOOSE_ONE',
				options: [
					{
						label: 'INFLUENCE',
						body: { k: 'ADVANCE_SPECIALTY', specialty: 'INFLUENCE', amount: 1 },
					},
					{
						label: 'MILITARY',
						body: { k: 'ADVANCE_SPECIALTY', specialty: 'MILITARY', amount: 1 },
					},
				],
			},
		},
	}
	it('advances the lower track without asking', () => {
		let s = setSpecialty(
			setSpecialty(fresh(), 0, 'INFLUENCE', 4),
			0,
			'MILITARY',
			2,
		)
		s = pushAndRun(s, node, SRC, 0)
		expect(s.pendingChoice).toBeNull()
		expect(s.players[0]!.specialties.MILITARY).toBe(3)
		expect(s.players[0]!.specialties.INFLUENCE).toBe(4)
	})
	it('asks on a tie', () => {
		let s = setSpecialty(
			setSpecialty(fresh(), 0, 'INFLUENCE', 2),
			0,
			'MILITARY',
			2,
		)
		s = pushAndRun(s, node, SRC, 0)
		expect(s.pendingChoice).not.toBeNull()
	})
})

describe('1KOL05 — dev cost "{DIL} x6, and have 10+ {GLO}"', () => {
	const cost: Effect = {
		k: 'SEQ',
		steps: [
			{ k: 'COST_RESOURCE', res: 'DIL', amount: 1 },
			{
				k: 'COST_REQUIRE',
				cond: {
					k: 'COMPARE',
					a: { k: 'RESOURCE', res: 'GLO' },
					op: 'GE',
					b: 3,
				},
			},
		],
	}
	it('is payable only while the Glory threshold holds, and spends no Glory', () => {
		let s = setResources(fresh(), 0, 'DIL', 1)
		s = setResources(s, 0, 'GLO', 2)
		expect(canPayAll(s, cost, ctx0())).toBe(false)
		s = setResources(s, 0, 'GLO', 3)
		expect(canPayAll(s, cost, ctx0())).toBe(true)
		s = pushAndRun(
			s,
			{
				k: 'PAY_THEN',
				cost,
				body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
			},
			SRC,
			0,
		)
		expect(s.players[0]!.resources).toMatchObject({ DIL: 0, GLO: 3, LAT: 1 })
	})
})

describe('1KOL05 — "draw the bottom card of your deck"', () => {
	register([makeDef({ id: 'bo-card', suit: 'CARGO', operations: [] })])
	it('DRAW fromBottom takes the last card of the Draw deck', () => {
		let s = fresh()
		s = place(s, 'bo-card', ID('top'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'bo-card', ID('bottom'), { k: 'DRAW', seat: 0 }, 0)
		expect(s.zones['DRAW:0']).toEqual([ID('top'), ID('bottom')])
		s = pushAndRun(s, { k: 'DRAW', count: 1, fromBottom: true }, SRC, 0)
		expect(s.cards[ID('bottom')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.cards[ID('top')]!.zone).toEqual({ k: 'DRAW', seat: 0 })
	})
})

describe('1KOL07 / 1KOL08 — "After gaining at least 1 INFLUENCE"', () => {
	const trig = { on: 'SPECIALTY_ADVANCED', specialty: 'INFLUENCE' } as const
	const ev = (
		seat: 0 | 1,
		specialty: 'INFLUENCE' | 'MILITARY',
		amount: number,
	) => ({ k: 'SPECIALTY_ADVANCED', seat, specialty, amount }) as const
	it("matches the owner's own INFLUENCE gain of at least 1 only", () => {
		const s = fresh()
		expect(matchesTrigger(s, ev(0, 'INFLUENCE', 1), trig, 0)).toBe(true)
		expect(matchesTrigger(s, ev(0, 'INFLUENCE', 0), trig, 0)).toBe(false) // capped at 15
		expect(matchesTrigger(s, ev(1, 'INFLUENCE', 1), trig, 0)).toBe(false)
		expect(matchesTrigger(s, ev(0, 'MILITARY', 1), trig, 0)).toBe(false)
	})
})

describe('1KOL08 — "If that LOCATION is now secured"', () => {
	register([makeDef({ id: 'kol08-loc', suit: 'LOCATION', operations: [] })])
	const NZ0 = { k: 'NEUTRAL_ZONE', slot: 0 } as const
	it('Query secured keeps a neutral Location only once the actor holds 3+ tokens and a 2-token lead', () => {
		let s = place(fresh(), 'kol08-loc', ID('nz'), NZ0)
		const q = { zones: [NZ0], secured: true }
		s = { ...s, awayTeamsAt: { [ID('nz')]: { 0: 2, 1: 0 } } } as GameState
		expect(resolveQuery(s, q, ctx0())).toEqual([])
		s = { ...s, awayTeamsAt: { [ID('nz')]: { 0: 3, 1: 0 } } } as GameState
		expect(resolveQuery(s, q, ctx0())).toEqual([ID('nz')])
	})
})

describe('1KOL17 — "log a PERSON beamed to a SHIP"', () => {
	register([
		makeDef({ id: 'gd-ship', suit: 'SHIP', operations: [] }),
		makeDef({ id: 'gd-loc', suit: 'LOCATION', operations: [] }),
		makeDef({ id: 'gd-person', suit: 'PERSON', operations: [] }),
	])
	it('BEAMED_TO_SHIP skips cards beamed to a LOCATION', () => {
		let s = fresh()
		s = place(s, 'gd-ship', ID('sh'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'gd-loc', ID('loc'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'gd-person', ID('onShip'), { k: 'BEAMED', host: 'sh' }, 0)
		s = place(s, 'gd-person', ID('onLoc'), { k: 'BEAMED', host: 'loc' }, 0)
		expect(resolveQuery(s, { zones: ['BEAMED_ANY'] }, ctx0()).sort()).toEqual([
			ID('onLoc'),
			ID('onShip'),
		])
		expect(resolveQuery(s, { zones: ['BEAMED_TO_SHIP'] }, ctx0())).toEqual([
			ID('onShip'),
		])
	})
})

describe('1KOL22 — +1 hand size per unspent action, until the turn ends', () => {
	const node: Effect = {
		k: 'REPEAT',
		times: { k: 'UNUSED_ACTIONS' },
		body: {
			k: 'SEQ',
			steps: [
				{ k: 'MODIFIER_ATTACH', id: 'TEMP_HAND_PLUS_1', stack: true },
				{ k: 'MAY', body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 } },
			],
		},
	}
	it('stacks one +1 layer per unspent action and drops them at turn end', () => {
		let s = fresh()
		s = {
			...s,
			players: s.players.map((p) =>
				p.seat === 0 ? { ...p, actions: { available: 2, spent: 1 } } : p,
			) as GameState['players'],
		}
		const base = effectiveHandSize(s, 0)
		s = pushAndRun(s, node, SRC, 0)
		s = answer(s, true)
		s = answer(s, false)
		expect(s.pendingChoice).toBeNull()
		expect(s.players[0]!.resources.GLO).toBe(1)
		expect(effectiveHandSize(s, 0)).toBe(base + 2)
		s = dropTurnModifiers(s, 0)
		expect(effectiveHandSize(s, 0)).toBe(base)
	})
})

describe('1PIC08 — INCIDENTs gain a substitute PLAY operation (discard to send back, draw 2)', () => {
	const defsOf = (file: string): CardDef[] =>
		CardArraySchema.parse(
			JSON.parse(
				readFileSync(join(__dirname, `../../data/cards/${file}.json`), 'utf8'),
			),
		)
	const pic08 = defsOf('crew/pic').find((d) => d.cardId === '1PIC08/24')!
	// ENERGY DRAIN: "[action] Play: Spend 2 {DIL} to return this card …"
	const drain = defsOf('common/incident').find((d) => d.cardId === '1INC01/6')!
	register([
		pic08,
		drain,
		makeDef({ id: 'pic08-filler', suit: 'CARGO', operations: [] }),
	])
	const PIC08 = ID('pic08')
	const INC = ID('inc')

	function setup(pic08Zone: ZoneRef = { k: 'DUTY_OFFICER', seat: 0 }) {
		let s = fresh()
		s = place(s, pic08.id, PIC08, pic08Zone, 0)
		s = place(s, drain.id, INC, { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'pic08-filler', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'pic08-filler', ID('d1'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'pic08-filler', ID('d2'), { k: 'DRAW', seat: 0 }, 0)
		return setResources(s, 0, 'DIL', 0) // the printed ENERGY DRAIN op is unpayable
	}

	it("grants the alternate play only to its owner's INCIDENTs while on the table", () => {
		const s = setup()
		const check = canPlay(s, 0, INC)
		expect(check.operations).toEqual([]) // printed op: no DIL
		expect(check.altPlays).toEqual([{ source: PIC08, opIndex: 1 }])
		expect(check.ok).toBe(true)
		expect(canPlay(s, 0, ID('h1')).altPlays).toEqual([]) // not an INCIDENT
		expect(legalIntents(s)).toContainEqual({
			t: 'PLAY_CARD',
			iid: INC,
			operationIndex: 0,
			via: { source: PIC08, opIndex: 1 },
		})
		// a second way to play it — the double-click fast path must not pick
		expect(singleLegalAction(s, 0, INC)).toBeNull()
		// 1PIC08 just played (Staging) has no table operations yet
		const staged = setup({ k: 'STAGING', seat: 0 })
		expect(canPlay(staged, 0, INC).altPlays).toEqual([])
	})

	it('resolves the granted text: discard a card, return the INCIDENT, draw 2 — no action spent', () => {
		let s = setup()
		const actions = s.players[0].actions.available
		let r = reduce(s, {
			t: 'PLAY_CARD',
			iid: INC,
			operationIndex: 0,
			via: { source: PIC08, opIndex: 1 },
		})
		s = r.state
		if (s.pendingChoice !== null) {
			r = reduce(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: s.pendingChoice.id,
				selection: [ID('h1')],
			})
			s = r.state
		}
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[INC]!.zone.k).toBe('INCIDENT_DECK')
		const incDeck = s.zones[zoneKey({ k: 'INCIDENT_DECK' })]!
		expect(incDeck[incDeck.length - 1]).toBe(INC) // bottom of the deck
		expect(s.cards[ID('h1')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('d1')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.cards[ID('d2')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.players[0].actions.available).toBe(actions)
		expect(r.events).toContainEqual({ k: 'CARD_PLAYED', iid: INC, seat: 0 })
	})

	it('is not offered with no other card to discard; a non-grant `via` is rejected', () => {
		let s = setup()
		s = { ...s, cards: { ...s.cards } }
		s.cards[ID('h1')] = { ...s.cards[ID('h1')]!, zone: { k: 'DRAW', seat: 0 } }
		s.zones = { ...s.zones }
		s.zones[zoneKey({ k: 'HAND', seat: 0 })] = [INC]
		s.zones[zoneKey({ k: 'DRAW', seat: 0 })] = [
			...s.zones[zoneKey({ k: 'DRAW', seat: 0 })]!,
			ID('h1'),
		]
		expect(canPlay(s, 0, INC).altPlays).toEqual([])
		expect(() =>
			reduce(setup(), {
				t: 'PLAY_CARD',
				iid: INC,
				operationIndex: 0,
				via: { source: PIC08, opIndex: 0 }, // 1PIC08's PLAY op, not an ALT_PLAY
			}),
		).toThrow(/not playable/)
	})

	it('describes as the card text, and the schema keeps ALT_PLAY a static PASSIVE', () => {
		expect(describeEffect(pic08.operations[1]!.effect)).toBe(
			'You may play any INCIDENT with "Play: Discard a card from your hand to return this card to the bottom of the Incident deck and draw 2 cards" in place of its own play operation.',
		)
		const nested = {
			...pic08,
			operations: [
				{
					type: 'PLAY',
					costsAction: false,
					isAttack: false,
					effect: pic08.operations[1]!.effect,
				},
			],
		}
		expect(CardDefSchema.safeParse(nested).success).toBe(false)
	})
})
