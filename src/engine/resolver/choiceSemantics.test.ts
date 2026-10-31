// Choice & conditional semantics (docs/effect-dsl.md §2 "Choices and
// conditions"):
//   - choice-key scoping: sibling nodes of the same kind ask afresh
//   - "if you do": primitive `bind` written only on success + Predicate DID
//   - optional effects: a MAY whose cost cannot be paid is not offered; an
//     accepted one whose cost became unpayable is skipped, not fatal
//   - "up to N": REPEAT UP_TO asks round by round; WARP count picks
//     different ships; same-Location removals via bind + bound
//   - "you may warp": no CONFIRM, the ship/destination pick can decline
//   - TAKE look → the taker chooses; TAKE `to` + `bind`
//   - FREE_PLAY lets the player pick the PLAY operation; `from` lists
//   - CHOOSE_ONE count: N different options
//   - DISMISS 'THIS' (a Location dismissing itself)
//   - GAIN_CARD onlyJunk / `to`

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, type CardDef } from '../../data/schema'
import type { Effect } from './nodes'
import type { GameState } from '../state'
import { zonesOf } from '../state'
import {
	fresh as baseFresh,
	register,
	makeDef,
	place,
	ID,
	op,
	play,
	pushAndRun,
	setResources,
	setActions,
} from './testUtils'
import { run } from './stack'
import {
	applyChoice,
	checkSelection,
	declineSelection,
	DECLINE_OPTION,
	SKIP_LOCATION,
	type PendingChoice,
} from './choices'
import { evalPredicate } from '../queries/resolveQuery'
import { cadetChoice } from '../../bot/cadet'
import { firstLegalPolicy } from '../../bot/autoPlay'

const SRC = ID('src')
/** a fresh state in the ACTION step with 3 actions (PLAY ops cost one) */
const fresh = (): GameState => setActions(baseFresh(), 0, 3)

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

function pending<K extends PendingChoice['k']>(
	state: GameState,
	k: K,
): Extract<PendingChoice, { k: K }> {
	const ch = state.pendingChoice
	if (ch === null || ch.k !== k)
		throw new Error(`expected ${k}, got ${ch?.k ?? 'none'}`)
	return ch as Extract<PendingChoice, { k: K }>
}

const defsOf = (file: string): CardDef[] =>
	CardArraySchema.parse(
		JSON.parse(
			readFileSync(join(__dirname, `../../data/cards/${file}.json`), 'utf8'),
		),
	)
const real = (file: string, cardId: string): CardDef => {
	const d = defsOf(file).find((c) => c.cardId === cardId)
	if (d === undefined) throw new Error(`no ${cardId} in ${file}`)
	return d
}

const res = (s: GameState, r: 'DIL' | 'LAT' | 'GLO', seat: 0 | 1 = 0) =>
	s.players[seat]!.resources[r]

register([
	makeDef({ id: 'cs-person', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'cs-cargo', suit: 'CARGO', operations: [] }),
	makeDef({ id: 'cs-ship', suit: 'SHIP', operations: [] }),
	makeDef({ id: 'cs-loc', suit: 'LOCATION', operations: [] }),
	makeDef({ id: 'cs-enc', suit: 'ENCOUNTER', operations: [] }),
	makeDef({ id: 'cs-inc', suit: 'INCIDENT', operations: [] }),
])

// ---------------------------------------------------------------------------

describe('choice-key scoping', () => {
	it('two MAYs in one SEQ each ask (the second does not replay the first answer)', () => {
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'MAY', body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 } },
				{ k: 'MAY', body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 } },
			],
		}
		let s = pushAndRun(fresh(), node, SRC, 0)
		s = answer(s, true)
		// the second MAY is a NEW question
		pending(s, 'CONFIRM')
		s = answer(s, false)
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'DIL')).toBe(1)
		expect(res(s, 'LAT')).toBe(0)
	})

	it('two DISCARD picks in one SEQ each ask', () => {
		let s = fresh()
		for (const i of ['a', 'b', 'c'])
			s = place(s, 'cs-person', ID(i), { k: 'HAND', seat: 0 }, 0)
		const discard: Effect = { k: 'DISCARD', count: 1, from: 'HAND' }
		s = pushAndRun(s, { k: 'SEQ', steps: [discard, discard] }, SRC, 0)
		s = answer(s, [ID('a')])
		const second = pending(s, 'CHOOSE_CARDS')
		expect(second.candidates).toEqual([ID('b'), ID('c')])
		s = answer(s, [ID('c')])
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toEqual([ID('b')])
	})
})

// ---------------------------------------------------------------------------

describe('optional effects with an unpayable cost', () => {
	it('1PIC04: only the discards the hand can pay are offered, and the card still logs itself', () => {
		const tam = real('crew/pic', '1PIC04/24')
		register([tam])
		let s = fresh()
		s = place(s, tam.id, ID('tam'), { k: 'STAGING', seat: 0 }, 0)
		// the 3 cards drawn: a PERSON, a CARGO, a PERSON — no SHIP/ALLY/…
		for (const [i, d] of [
			['d1', 'cs-person'],
			['d2', 'cs-cargo'],
			['d3', 'cs-person'],
		] as const)
			s = place(s, d, ID(i), { k: 'DRAW', seat: 0 }, 0)
		s = play(s, ID('tam'))
		// "you may discard a PERSON" is its own pick → one of the two
		expect(pending(s, 'CHOOSE_CARDS').prompt).toMatch(/PERSON/)
		s = answer(s, [ID('d1')])
		// "you may discard a CARGO" → declined (the empty pick)
		expect(pending(s, 'CHOOSE_CARDS').prompt).toMatch(/CARGO/)
		s = answer(s, [])
		// SHIP / ALLY / ENCOUNTER / INCIDENT are not held: not offered at all
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'GLO')).toBe(1)
		expect(s.cards[ID('tam')]!.zone).toEqual({ k: 'LOG', seat: 0 })
	})

	it('an accepted MAY whose PAY_THEN became unpayable is skipped; the operation continues', () => {
		register([
			makeDef({
				id: 'cs-optional',
				suit: 'ALLY',
				operations: [
					op('PLAY', {
						k: 'SEQ',
						steps: [
							{
								k: 'MAY',
								body: {
									k: 'SEQ',
									steps: [
										{ k: 'DISCARD', count: 1, from: 'HAND' },
										{
											k: 'PAY_THEN',
											cost: { k: 'COST_DISCARD', count: 1 },
											body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 5 },
										},
									],
								},
							},
							{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
						],
					}),
				],
			}),
		])
		let s = fresh()
		s = place(s, 'cs-optional', ID('opt'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cs-person', ID('only'), { k: 'HAND', seat: 0 }, 0)
		s = play(s, ID('opt'))
		// the "you may" is the discard's own pick, which empties the hand …
		s = answer(s, [ID('only')])
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'GLO')).toBe(0) // … so the optional PAY_THEN is skipped
		expect(res(s, 'LAT')).toBe(1) // and the operation went on
	})

	it('a mandatory PAY_THEN that cannot be paid still fails the operation', () => {
		register([
			makeDef({
				id: 'cs-mandatory',
				suit: 'ALLY',
				operations: [
					op('PLAY', {
						k: 'SEQ',
						steps: [
							{
								k: 'PAY_THEN',
								cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 3 },
								body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
							},
							{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
						],
					}),
				],
			}),
		])
		let s = place(
			fresh(),
			'cs-mandatory',
			ID('m'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = play(s, ID('m'))
		expect(res(s, 'LAT')).toBe(0)
		expect(s.stack).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------

describe('"if you do" — bind on success + DID', () => {
	it('DID is true only when every named binding is set', () => {
		const ctx = { actor: 0 as const, source: SRC, bindings: { a: 'x', e: [] } }
		const s = fresh()
		expect(evalPredicate(s, { k: 'DID', bind: 'a' }, ctx)).toBe(true)
		expect(evalPredicate(s, { k: 'DID', bind: ['a', 'b'] }, ctx)).toBe(false)
		expect(evalPredicate(s, { k: 'DID', bind: 'e' }, ctx)).toBe(false)
	})

	const bur13 = real('crew/bur', '1BUR13-26'.replace('-', '/'))
	const incident = makeDef({
		id: 'cs-free-inc',
		suit: 'INCIDENT',
		operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 })],
	})
	register([bur13, incident])

	it('1BUR13: no INCIDENT to free play → the optional effect is not offered, no Glory', () => {
		let s = fresh()
		s = place(s, bur13.id, ID('cul'), { k: 'STAGING', seat: 0 }, 0)
		s = play(s, ID('cul'))
		// "may find a PERSON/INCIDENT" has nothing to find either
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'GLO')).toBe(0)
	})

	it('1BUR13: free playing an INCIDENT gains the Glory', () => {
		let s = fresh()
		s = place(s, bur13.id, ID('cul'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cs-free-inc', ID('inc'), { k: 'HAND', seat: 0 }, 0)
		s = play(s, ID('cul'))
		s = answer(s, false) // don't find
		s = answer(s, [ID('inc')]) // free play the INCIDENT (the may's own pick)
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'DIL')).toBe(1) // the INCIDENT's play op ran
		expect(res(s, 'GLO')).toBe(1)
	})

	it('1SHR13 shape: a free-played card that logs itself still counts as "you did"', () => {
		register([
			makeDef({
				id: 'cs-self-log',
				suit: 'ALLY',
				operations: [op('PLAY', { k: 'LOG', target: 'THIS' })],
			}),
			makeDef({ id: 'cs-ue', suit: 'ALLY', operations: [] }),
		])
		let s = fresh()
		s = place(s, 'cs-ue', SRC, { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cs-self-log', ID('ally'), { k: 'DRAW', seat: 0 }, 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'DRAW', count: 1, bind: '$g' },
				{
					k: 'MAY',
					body: {
						k: 'FREE_PLAY',
						filter: { suits: ['ALLY'] },
						bound: '$g',
						bind: '$played',
					},
				},
				{
					k: 'IF',
					cond: { k: 'DID', bind: '$played' },
					then: { k: 'LOG', target: 'THIS' },
				},
			],
		}
		s = pushAndRun(s, node, SRC, 0)
		s = answer(s, [ID('ally')]) // the "you may" is the free play's pick
		expect(s.cards[ID('ally')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(s.cards[SRC]!.zone).toEqual({ k: 'LOG', seat: 0 })
	})

	it('1BUR21: "if you do both" needs the send AND the beam', () => {
		const bur21 = real('crew/bur', '1BUR21/26')
		register([
			bur21,
			makeDef({ id: '1BUR03-26', suit: 'SHIP', operations: [] }),
		])
		const base = () => {
			let s = fresh()
			s = place(s, bur21.id, ID('jo'), { k: 'STAGING', seat: 0 }, 0)
			s = place(s, 'cs-loc', ID('loc'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
			s = place(s, '1BUR03-26', ID('disco'), { k: 'FLEET', seat: 0 }, 0, {
				shipTokenAt: ID('loc'),
			})
			s = place(s, 'cs-cargo', ID('h'), { k: 'HAND', seat: 0 }, 0)
			return {
				...s,
				players: [
					{ ...s.players[0], awayTeamsInPool: 2, awayTeamsTotal: 2 },
					s.players[1],
				] as GameState['players'],
			}
		}
		// both → Glory
		let s = play(base(), ID('jo'))
		s = answer(s, ID('loc')) // send (the may asks the Location, with a Skip)
		s = answer(s, [ID('h')]) // beam
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('h')]!.zone).toEqual({ k: 'BEAMED', host: ID('disco') })
		expect(res(s, 'GLO')).toBe(1)
		// only the beam → no Glory
		s = play(base(), ID('jo'))
		s = answer(s, SKIP_LOCATION)
		s = answer(s, [ID('h')])
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'GLO')).toBe(0)
	})

	it('1SEL07: deploys only if it found+destroyed a ROMULAN AND beamed a card to 1SEL19', () => {
		const scim = real('crew/sel', '1SEL07/24')
		register([
			scim,
			makeDef({ id: '1SEL19-24', suit: 'LOCATION', operations: [] }),
			makeDef({
				id: 'cs-romulan',
				suit: 'PERSON',
				traits: ['ROMULAN'],
				operations: [],
			}),
		])
		const base = (withSel19: boolean) => {
			let s = fresh()
			s = place(s, scim.id, ID('scim'), { k: 'STAGING', seat: 0 }, 0)
			s = place(s, 'cs-romulan', ID('romulan'), { k: 'DRAW', seat: 0 }, 0)
			s = place(s, 'cs-cargo', ID('h'), { k: 'HAND', seat: 0 }, 0)
			if (withSel19)
				s = place(
					s,
					'1SEL19-24',
					ID('1SEL19'),
					{ k: 'LOCATION_AREA', seat: 0 },
					0,
				)
			return s
		}
		let s = play(base(true), ID('scim'))
		// the found card is destroyed; a hand card is beamed to 1SEL19
		expect(s.cards[ID('romulan')]!.zone).toEqual({ k: 'BOX' })
		expect(s.cards[ID('h')]!.zone).toEqual({ k: 'BEAMED', host: ID('1SEL19') })
		expect(s.cards[ID('scim')]!.zone).toEqual({ k: 'FLEET', seat: 0 })
		// no 1SEL19 → no beam → no deploy (it stays in Staging)
		s = play(base(false), ID('scim'))
		expect(s.cards[ID('romulan')]!.zone).toEqual({ k: 'BOX' })
		expect(s.cards[ID('scim')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
	})

	it('1CAR08: the opponent may draw only if a Duty Officer was dismissed', () => {
		const car08 = real('common/cargo', '1CAR08/16')
		register([car08])
		let s = fresh()
		s = place(s, car08.id, ID('1CAR08'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cs-person', ID('deck1'), { k: 'DRAW', seat: 1 }, 1)
		// no opponent Duty Officer: no draw offered; our "put a card" MAY has
		// no card in hand either
		s = play(s, ID('1CAR08'))
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('deck1')]!.zone).toEqual({ k: 'DRAW', seat: 1 })

		let t = fresh()
		t = place(t, car08.id, ID('1CAR08'), { k: 'STAGING', seat: 0 }, 0)
		t = place(t, 'cs-person', ID('do'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		t = place(t, 'cs-person', ID('deck1'), { k: 'DRAW', seat: 1 }, 1)
		t = play(t, ID('1CAR08'))
		const may = pending(t, 'CONFIRM')
		expect(may.seat).toBe(1) // THEY may draw
		t = answer(t, true)
		expect(t.cards[ID('do')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
		expect(t.cards[ID('deck1')]!.zone).toEqual({ k: 'HAND', seat: 1 })
	})
})

// ---------------------------------------------------------------------------

describe('"up to N"', () => {
	const upTo: Effect = {
		k: 'REPEAT',
		times: { k: 'UP_TO', max: 3 },
		body: {
			k: 'PAY_THEN',
			cost: { k: 'COST_DISCARD', count: 1 },
			body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
		},
	}

	it('REPEAT UP_TO asks each round and stops when the player declines', () => {
		let s = fresh()
		for (const i of ['a', 'b', 'c'])
			s = place(s, 'cs-person', ID(i), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(s, upTo, SRC, 0)
		// no CONFIRM: each round is asked as its discard, the empty pick stops
		const first = pending(s, 'CHOOSE_CARDS')
		expect(first.prompt).toMatch(/up to 3 times/)
		expect(first.mayDecline).toBe(true)
		s = answer(s, [ID('a')])
		expect(pending(s, 'CHOOSE_CARDS').prompt).toMatch(/again/)
		s = answer(s, [])
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'GLO')).toBe(1)
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toHaveLength(2)
	})

	it('REPEAT UP_TO stops without asking once a round could do nothing', () => {
		let s = place(fresh(), 'cs-person', ID('a'), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(s, upTo, SRC, 0)
		s = answer(s, [ID('a')]) // the only card, still asked: the round's prompt
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'GLO')).toBe(1)
		// declining the first round is "zero times"
		let t = place(fresh(), 'cs-person', ID('a'), { k: 'HAND', seat: 0 }, 0)
		t = pushAndRun(t, upTo, SRC, 0)
		t = answer(t, [])
		expect(res(t, 'GLO')).toBe(0)
	})

	it('WARP count: "warp up to 2 of your SHIPs" warps DIFFERENT ships', () => {
		let s = fresh()
		s = place(s, 'cs-loc', ID('l0'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'cs-loc', ID('l1'), { k: 'NEUTRAL_ZONE', slot: 1 }, null)
		for (const i of ['s1', 's2', 's3'])
			s = place(s, 'cs-ship', ID(i), { k: 'FLEET', seat: 0 }, 0, {
				shipTokenAt: ID('l0'),
			})
		const node: Effect = {
			k: 'WARP',
			ship: { zones: [{ k: 'FLEET', seat: 0 }], filter: { suits: ['SHIP'] } },
			to: { zones: ['LOCATIONS'], filter: { suits: ['LOCATION'] } },
			count: { k: 'UP_TO', max: 2 },
		}
		s = pushAndRun(s, node, SRC, 0)
		const pick = pending(s, 'CHOOSE_CARDS')
		expect([pick.min, pick.max]).toEqual([0, 2])
		s = answer(s, [ID('s1'), ID('s3')])
		// each chosen ship has exactly one other Location: auto-warped
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('s1')]!.shipTokenAt).toBe(ID('l1'))
		expect(s.cards[ID('s2')]!.shipTokenAt).toBe(ID('l0'))
		expect(s.cards[ID('s3')]!.shipTokenAt).toBe(ID('l1'))
		// "up to": choosing none warps nothing
		let t = place(
			fresh(),
			'cs-loc',
			ID('l0'),
			{ k: 'NEUTRAL_ZONE', slot: 0 },
			null,
		)
		t = place(t, 'cs-loc', ID('l1'), { k: 'NEUTRAL_ZONE', slot: 1 }, null)
		t = place(t, 'cs-ship', ID('s1'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('l0'),
		})
		t = pushAndRun(t, node, SRC, 0)
		t = answer(t, [])
		expect(t.cards[ID('s1')]!.shipTokenAt).toBe(ID('l0'))
	})

	it('1PER07: removes up to 2 opponent AWAY TEAM, all from one LOCATION', () => {
		const per07 = real('common/person', '1PER07/25')
		register([per07])
		let s = fresh()
		s = place(s, per07.id, ID('per07'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'cs-loc', ID('l0'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'cs-loc', ID('l1'), { k: 'NEUTRAL_ZONE', slot: 1 }, null)
		s = {
			...s,
			awayTeamsAt: { [ID('l0')]: [0, 2], [ID('l1')]: [0, 1] },
			players: [
				s.players[0],
				{ ...s.players[1], awayTeamsInPool: 0 },
			] as GameState['players'],
		}
		s = play(s, ID('per07'), { opIndex: 2 })
		const where = pending(s, 'CHOOSE_LOCATION')
		expect(where.candidates).toEqual([ID('l0'), ID('l1')])
		s = answer(s, ID('l0'))
		// the second removal may only come from the SAME Location (auto-picked)
		s = answer(s, true)
		expect(s.pendingChoice).toBeNull()
		expect(s.awayTeamsAt[ID('l0')]).toEqual([0, 0])
		expect(s.awayTeamsAt[ID('l1')]).toEqual([0, 1])
		expect(res(s, 'GLO')).toBe(2)
	})

	it('1PER07: one team at the chosen Location → no second removal offered', () => {
		const per07 = real('common/person', '1PER07/25')
		let s = fresh()
		s = place(s, per07.id, ID('per07'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'cs-loc', ID('l0'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'cs-loc', ID('l1'), { k: 'NEUTRAL_ZONE', slot: 1 }, null)
		s = { ...s, awayTeamsAt: { [ID('l0')]: [0, 1], [ID('l1')]: [0, 1] } }
		s = play(s, ID('per07'), { opIndex: 2 })
		s = answer(s, ID('l1'))
		expect(s.pendingChoice).toBeNull()
		expect(s.awayTeamsAt[ID('l0')]).toEqual([0, 1])
		expect(res(s, 'GLO')).toBe(1)
	})
})

// ---------------------------------------------------------------------------

describe('"you may warp": the pick carries the decline (no CONFIRM)', () => {
	const warpNode: Effect = {
		k: 'WARP',
		ship: { zones: [{ k: 'FLEET', seat: 0 }], filter: { suits: ['SHIP'] } },
		to: { zones: ['LOCATIONS'], filter: { suits: ['LOCATION'] } },
	}
	const mayWarp: Effect = { k: 'MAY', body: warpNode }
	/** `locs` Locations in the Neutral Zone, the ships' tokens on the first */
	const table = (locs: 2 | 3, ships: string[]): GameState => {
		let s = fresh()
		for (const slot of ([0, 1, 2] as const).slice(0, locs))
			s = place(s, 'cs-loc', ID(`l${slot}`), { k: 'NEUTRAL_ZONE', slot }, null)
		for (const iid of ships)
			s = place(s, 'cs-ship', ID(iid), { k: 'FLEET', seat: 0 }, 0, {
				shipTokenAt: ID('l0'),
			})
		return s
	}

	it('one ship: the destination choice is the only prompt, with a Skip', () => {
		const s = pushAndRun(table(3, ['s1']), mayWarp, SRC, 0)
		const loc = pending(s, 'CHOOSE_LOCATION')
		expect(loc.candidates).toEqual([ID('l1'), ID('l2'), SKIP_LOCATION])
		expect(loc.prompt).toContain('[[card:cs-ship]]')
		const skipped = answer(s, SKIP_LOCATION)
		expect(skipped.pendingChoice).toBeNull()
		expect(skipped.cards[ID('s1')]!.shipTokenAt).toBe(ID('l0'))
		const warped = answer(s, ID('l2'))
		expect(warped.pendingChoice).toBeNull()
		expect(warped.cards[ID('s1')]!.shipTokenAt).toBe(ID('l2'))
	})

	it('one ship, one other Location: still asked (not warped unasked)', () => {
		const s = pushAndRun(table(2, ['s1']), mayWarp, SRC, 0)
		expect(pending(s, 'CHOOSE_LOCATION').candidates).toEqual([
			ID('l1'),
			SKIP_LOCATION,
		])
		// a "warp a ship" that must happen moves it without asking
		const must = pushAndRun(table(2, ['s1']), warpNode, SRC, 0)
		expect(must.pendingChoice).toBeNull()
		expect(must.cards[ID('s1')]!.shipTokenAt).toBe(ID('l1'))
	})

	it('several ships: the ship choice may be left empty', () => {
		const s = pushAndRun(table(3, ['s1', 's2']), mayWarp, SRC, 0)
		const pick = pending(s, 'CHOOSE_CARDS')
		// one ship, or none: `optional` admits the empty pick below `min`
		expect([pick.min, pick.max, pick.optional]).toEqual([1, 1, true])
		const none = answer(s, [])
		expect(none.pendingChoice).toBeNull()
		expect(none.cards[ID('s1')]!.shipTokenAt).toBe(ID('l0'))
		expect(none.cards[ID('s2')]!.shipTokenAt).toBe(ID('l0'))
		let t = answer(s, [ID('s2')])
		expect(pending(t, 'CHOOSE_LOCATION').candidates).toContain(SKIP_LOCATION)
		t = answer(t, ID('l1'))
		expect(t.cards[ID('s2')]!.shipTokenAt).toBe(ID('l1'))
	})

	it('a skipped warp does not answer the next one in the same SEQ', () => {
		const node: Effect = { k: 'SEQ', steps: [mayWarp, mayWarp] }
		let s = pushAndRun(table(3, ['s1']), node, SRC, 0)
		s = answer(s, SKIP_LOCATION)
		pending(s, 'CHOOSE_LOCATION')
		s = answer(s, ID('l1'))
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('s1')]!.shipTokenAt).toBe(ID('l1'))
	})
})

// ---------------------------------------------------------------------------

describe('TAKE: choice, destination, bind', () => {
	it('1PIC23: the INCIDENT goes straight to the Discard pile (still a take)', () => {
		const pic23 = real('crew/pic', '1PIC23/24')
		register([pic23])
		let s = fresh()
		s = place(s, pic23.id, ID('1PIC23'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cs-inc', ID('inc'), { k: 'INCIDENT_DECK' }, null)
		s = place(s, 'cs-inc', ID('mine'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'cs-loc', ID('l0'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = play(s, ID('1PIC23'))
		expect(s.cards[ID('inc')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('inc')]!.owner).toBe(0)
		// the INCIDENT already in hand is untouched
		expect(s.cards[ID('mine')]!.zone).toEqual({ k: 'HAND', seat: 0 })
	})

	it('1LOC17: take an INCIDENT onto the bottom of your Draw deck', () => {
		let s = fresh()
		s = place(s, 'cs-inc', ID('inc'), { k: 'INCIDENT_DECK' }, null)
		s = place(s, 'cs-person', ID('top'), { k: 'DRAW', seat: 0 }, 0)
		s = pushAndRun(
			s,
			{ k: 'TAKE', deck: 'INCIDENT', count: 1, to: 'DECK_BOTTOM', bind: '$t' },
			SRC,
			0,
		)
		expect(zonesOf(s, { k: 'DRAW', seat: 0 })).toEqual([ID('top'), ID('inc')])
	})

	it('TAKE to DECK_TOP', () => {
		let s = fresh()
		s = place(s, 'cs-enc', ID('enc'), { k: 'ENCOUNTER_DECK' }, null)
		s = place(s, 'cs-person', ID('top'), { k: 'DRAW', seat: 0 }, 0)
		s = pushAndRun(
			s,
			{ k: 'TAKE', deck: 'ENCOUNTER', count: 1, to: 'DECK_TOP' },
			SRC,
			0,
		)
		expect(zonesOf(s, { k: 'DRAW', seat: 0 })).toEqual([ID('enc'), ID('top')])
	})
})

// ---------------------------------------------------------------------------

describe('FREE_PLAY: which PLAY operation', () => {
	register([
		makeDef({
			id: 'cs-two-ops',
			suit: 'SHIP',
			operations: [
				op(
					'PLAY',
					{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
					{ costsAction: true },
				),
				op(
					'PLAY',
					{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 2 },
					{ costsAction: true },
				),
			],
		}),
		makeDef({
			id: 'cs-gated-op',
			suit: 'SHIP',
			operations: [
				op('PLAY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 }),
				op('PLAY', {
					k: 'PAY_THEN',
					cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 5 },
					body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 5 },
				}),
			],
		}),
	])
	const fp: Effect = { k: 'FREE_PLAY', filter: { suits: ['SHIP'] } }

	it('asks which PLAY operation when several can resolve, and resolves the chosen one', () => {
		let s = place(fresh(), 'cs-two-ops', ID('two'), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(s, fp, SRC, 0)
		const ch = pending(s, 'CHOOSE_OPTION')
		expect(ch.options.map((o) => o.key)).toEqual(['0', '1'])
		// each option names its operation, so the UI can show the card
		expect(ch.options.map((o) => o.op)).toEqual([
			{ card: ID('two'), opIndex: 0 },
			{ card: ID('two'), opIndex: 1 },
		])
		s = answer(s, { key: '1' })
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'LAT')).toBe(2)
		expect(res(s, 'DIL')).toBe(0)
		expect(s.cards[ID('two')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
		// the action cost is waived
		expect(s.players[0]!.actions.available).toBe(
			fresh().players[0]!.actions.available,
		)
	})

	it('offers only the PLAY operations that can resolve (no prompt for one)', () => {
		let s = place(fresh(), 'cs-gated-op', ID('g'), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(s, fp, SRC, 0)
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'DIL')).toBe(1)
	})

	it('1SIS08: free play an INCIDENT from hand or Discard pile; research only if you did', () => {
		const sis08 = real('crew/sis', '1SIS08/25')
		register([
			sis08,
			makeDef({
				id: 'cs-free-inc2',
				suit: 'INCIDENT',
				operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 })],
			}),
		])
		let s = fresh()
		s = place(s, sis08.id, ID('b'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cs-free-inc2', ID('inc'), { k: 'DISCARD', seat: 0 }, 0)
		s = play(s, ID('b'))
		expect(s.pendingChoice).toBeNull()
		expect(res(s, 'DIL')).toBe(1)
		expect(s.players[0]!.specialties.RESEARCH).toBe(1)
		// nothing to free play → no research
		let t = place(fresh(), sis08.id, ID('b'), { k: 'STAGING', seat: 0 }, 0)
		t = play(t, ID('b'))
		expect(t.players[0]!.specialties.RESEARCH).toBe(0)
	})
})

// ---------------------------------------------------------------------------

describe('CHOOSE_ONE count: "choose 2 of the following" = two DIFFERENT options', () => {
	const node: Effect = {
		k: 'CHOOSE_ONE',
		count: 2,
		options: [
			{ label: 'DIL', body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 } },
			{ label: 'LAT', body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 } },
			{
				label: 'spend',
				body: {
					k: 'PAY_THEN',
					cost: { k: 'COST_RESOURCE', res: 'GLO', amount: 1 },
					body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 3 },
				},
			},
		],
	}

	it('the second pick cannot repeat the first', () => {
		let s = pushAndRun(fresh(), node, SRC, 0)
		const first = pending(s, 'CHOOSE_OPTION')
		expect(first.options.map((o) => o.enabled)).toEqual([true, true, false])
		s = answer(s, { key: '0' })
		const second = pending(s, 'CHOOSE_OPTION')
		expect(second.options.map((o) => o.enabled)).toEqual([false, true, false])
		expect(second.options[0]!.reason).toBe('already chosen')
		s = answer(s, { key: '1' })
		expect(s.pendingChoice).toBeNull()
		expect([res(s, 'DIL'), res(s, 'LAT')]).toEqual([1, 1])
	})

	it('an option paid for in round 1 makes round 2 re-check resolvability', () => {
		let s = setResources(fresh(), 0, 'GLO', 1)
		s = pushAndRun(s, node, SRC, 0)
		s = answer(s, { key: '2' }) // spend the only GLO
		s = answer(s, { key: '1' })
		expect([res(s, 'DIL'), res(s, 'LAT'), res(s, 'GLO')]).toEqual([3, 1, 0])
	})
})

// ---------------------------------------------------------------------------

describe('DISMISS a Location only by itself', () => {
	it('1SHR12 Clean-up: with no AWAY TEAM here it dismisses itself', () => {
		const wey = real('crew/shr', '1SHR12/24')
		register([wey])
		let s = fresh()
		s = place(s, wey.id, ID('wey'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'cs-ship', ID('ship'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('wey'),
		})
		s = play(s, ID('wey'), { opIndex: 2 })
		expect(s.cards[ID('wey')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		// the Ship present is dismissed with it (rules/08 → a Location leaving play)
		expect(s.cards[ID('ship')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
		// with an Away Team there it stays
		let t = place(
			fresh(),
			wey.id,
			ID('wey'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		t = { ...t, awayTeamsAt: { [ID('wey')]: [1, 0] } }
		t = play(t, ID('wey'), { opIndex: 2 })
		expect(t.cards[ID('wey')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
	})

	it('a DISMISS query never offers a Location', () => {
		let s = place(
			fresh(),
			'cs-loc',
			ID('l'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = pushAndRun(
			s,
			{ k: 'DISMISS', target: { zones: ['IN_PLAY'], filter: {} } },
			SRC,
			0,
		)
		expect(s.cards[ID('l')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
	})
})

// ---------------------------------------------------------------------------

describe('GAIN_CARD: from the Junk only / fixed destination', () => {
	function market(): GameState {
		let s = fresh()
		s = place(
			s,
			'cs-cargo',
			ID('offer'),
			{ k: 'MARKET_OFFER', suit: 'CARGO' },
			null,
		)
		s = place(
			s,
			'cs-cargo',
			ID('decktop'),
			{ k: 'MARKET_DECK', suit: 'CARGO' },
			null,
		)
		s = place(s, 'cs-cargo', ID('junk1'), { k: 'JUNK' }, null)
		s = place(s, 'cs-ship', ID('junk2'), { k: 'JUNK' }, null)
		return s
	}

	it('onlyJunk: the Market offer and deck are not candidates', () => {
		let s = pushAndRun(
			market(),
			{ k: 'GAIN_CARD', suits: ['CARGO'], onlyJunk: true },
			SRC,
			0,
		)
		// the single Junk CARGO is auto-picked; only the placement is asked
		expect(pending(s, 'CHOOSE_DESTINATION').card).toBe(ID('junk1'))
		s = answer(s, 'DISCARD')
		expect(s.cards[ID('junk1')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('offer')]!.zone).toEqual({
			k: 'MARKET_OFFER',
			suit: 'CARGO',
		})
	})

	it('onlyJunk with no matching Junk card is skipped', () => {
		const s = pushAndRun(
			market(),
			{ k: 'GAIN_CARD', suits: ['PERSON'], onlyJunk: true },
			SRC,
			0,
		)
		expect(s.pendingChoice).toBeNull()
	})

	it('1BUR07: "gain a CARGO/SHIP to your Discard pile" asks no destination', () => {
		let s = pushAndRun(
			market(),
			{ k: 'GAIN_CARD', suits: ['CARGO'], to: ['DISCARD'], bind: '$g' },
			SRC,
			0,
		)
		const pick = pending(s, 'CHOOSE_CARDS')
		expect(pick.candidates).toEqual([ID('offer'), ID('decktop')])
		s = answer(s, [ID('offer')])
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('offer')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
	})
})

// ---------------------------------------------------------------------------

describe('"you may": the first prompt carries the decline (no CONFIRM)', () => {
	const discard: Effect = { k: 'DISCARD', count: 1, from: 'HAND' }
	const hand = (...iids: string[]): GameState => {
		let s = fresh()
		for (const i of iids)
			s = place(s, 'cs-person', ID(i), { k: 'HAND', seat: 0 }, 0)
		return s
	}

	it('a single candidate is still asked, with the card wording and a Decline', () => {
		const s = pushAndRun(hand('a'), { k: 'MAY', body: discard }, SRC, 0)
		const pick = pending(s, 'CHOOSE_CARDS')
		expect(pick.candidates).toEqual([ID('a')])
		expect([pick.min, pick.optional, pick.mayDecline]).toEqual([1, true, true])
		expect(pick.prompt).toMatch(/^You may discard/)
		const declined = answer(s, [])
		expect(declined.pendingChoice).toBeNull()
		expect(zonesOf(declined, { k: 'HAND', seat: 0 })).toEqual([ID('a')])
		const done = answer(s, [ID('a')])
		expect(done.cards[ID('a')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
	})

	it('declining the first step drops the rest of the body, not what follows', () => {
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{
					k: 'MAY',
					body: {
						k: 'SEQ',
						steps: [discard, { k: 'GAIN_RESOURCE', res: 'LAT', amount: 2 }],
					},
				},
				{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
			],
		}
		const s = pushAndRun(hand('a'), node, SRC, 0)
		const declined = answer(s, [])
		expect([res(declined, 'LAT'), res(declined, 'DIL')]).toEqual([0, 1])
		const accepted = answer(s, [ID('a')])
		expect([res(accepted, 'LAT'), res(accepted, 'DIL')]).toEqual([2, 1])
	})

	it('only the first prompt carries it', () => {
		const node: Effect = {
			k: 'MAY',
			body: { k: 'SEQ', steps: [discard, discard] },
		}
		let s = pushAndRun(hand('a', 'b', 'c'), node, SRC, 0)
		expect(pending(s, 'CHOOSE_CARDS').mayDecline).toBe(true)
		s = answer(s, [ID('a')])
		const second = pending(s, 'CHOOSE_CARDS')
		expect([second.mayDecline, second.optional]).toEqual([undefined, undefined])
		expect(checkSelection(second, []).ok).toBe(false)
	})

	it("a cost's pick declines: nothing paid, nothing gained, the operation goes on", () => {
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{
					k: 'MAY',
					body: {
						k: 'PAY_THEN',
						cost: { k: 'COST_DISCARD', count: 1 },
						body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 2 },
					},
				},
				{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
			],
		}
		const s = pushAndRun(hand('a'), node, SRC, 0)
		expect(pending(s, 'CHOOSE_CARDS').mayDecline).toBe(true)
		const declined = answer(s, [])
		expect([res(declined, 'GLO'), res(declined, 'DIL')]).toEqual([0, 1])
		expect(zonesOf(declined, { k: 'HAND', seat: 0 })).toEqual([ID('a')])
		const paid = answer(s, [ID('a')])
		expect([res(paid, 'GLO'), res(paid, 'DIL')]).toEqual([2, 1])
	})

	it('a "you may choose one" gets a Decline row', () => {
		const node: Effect = {
			k: 'MAY',
			body: {
				k: 'CHOOSE_ONE',
				options: [
					{ label: 'lat', body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 } },
					{ label: 'dil', body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 } },
				],
			},
		}
		const s = pushAndRun(fresh(), node, SRC, 0)
		const opt = pending(s, 'CHOOSE_OPTION')
		expect(opt.mayDecline).toBe(true)
		expect(opt.options.map((o) => o.key)).toEqual(['0', '1', DECLINE_OPTION])
		const declined = answer(s, { key: DECLINE_OPTION })
		expect(declined.pendingChoice).toBeNull()
		expect([res(declined, 'LAT'), res(declined, 'DIL')]).toEqual([0, 0])
		const chose = answer(s, { key: '1' })
		expect([res(chose, 'LAT'), res(chose, 'DIL')]).toEqual([0, 1])
	})

	it('keeps the CONFIRM when the first step would be skipped unasked', () => {
		// an empty hand: the discard cannot resolve, the gain still could — the
		// "you may" must still be asked before the gain
		const node: Effect = {
			k: 'MAY',
			body: {
				k: 'SEQ',
				steps: [discard, { k: 'GAIN_RESOURCE', res: 'LAT', amount: 2 }],
			},
		}
		const s = pushAndRun(fresh(), node, SRC, 0)
		pending(s, 'CONFIRM')
		expect(res(answer(s, false), 'LAT')).toBe(0)
	})

	it('a declined pick leaves no answer for the next one in the same SEQ', () => {
		const may: Effect = { k: 'MAY', body: discard }
		let s = pushAndRun(hand('a', 'b'), { k: 'SEQ', steps: [may, may] }, SRC, 0)
		s = answer(s, [])
		const second = pending(s, 'CHOOSE_CARDS')
		expect(second.candidates).toEqual([ID('a'), ID('b')])
		s = answer(s, [ID('b')])
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toEqual([ID('a')])
	})

	it('keeps the CONFIRM when the cost would be paid in Glory', () => {
		const node: Effect = {
			k: 'MAY',
			body: {
				k: 'PAY_THEN',
				cost: {
					k: 'SEQ',
					steps: [
						{ k: 'COST_DISCARD', count: 1 },
						{ k: 'COST_RESOURCE', res: 'LAT', amount: 1 },
					],
				},
				body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
			},
		}
		let s = setResources(hand('a'), 0, 'LAT', 0)
		s = setResources(s, 0, 'GLO', 2)
		s = pushAndRun(s, node, SRC, 0)
		expect(pending(s, 'CONFIRM').prompt).toMatch(/Paid with 1 \{GLO\}/)
	})

	it('keeps the CONFIRM before a search of a face-down deck', () => {
		let s = fresh()
		s = place(s, 'cs-person', ID('d'), { k: 'DRAW', seat: 0 }, 0)
		const node: Effect = {
			k: 'MAY',
			body: {
				k: 'FIND',
				filter: { suits: ['PERSON'] },
				zones: [{ k: 'DRAW', seat: 0 }],
			},
		}
		pending(pushAndRun(s, node, SRC, 0), 'CONFIRM')
	})

	it('declineSelection names the decline of each kind, and only when flagged', () => {
		const s = pushAndRun(hand('a'), { k: 'MAY', body: discard }, SRC, 0)
		const pick = pending(s, 'CHOOSE_CARDS')
		expect(declineSelection(pick)).toEqual([])
		expect(declineSelection({ ...pick, mayDecline: undefined })).toBeUndefined()
		expect(
			declineSelection({
				...pick,
				k: 'CHOOSE_LOCATION',
				candidates: [SKIP_LOCATION],
			} as PendingChoice),
		).toBe(SKIP_LOCATION)
	})

	it('the "decline everything optional" policies decline it, like the CONFIRM', () => {
		const s = pushAndRun(hand('a'), { k: 'MAY', body: discard }, SRC, 0)
		const pick = pending(s, 'CHOOSE_CARDS')
		expect(cadetChoice(pick)).toEqual([])
		expect(firstLegalPolicy(s, pick)).toEqual([])
	})

	it('an optional pick of two accepts none or two, never one', () => {
		const pick = pending(
			pushAndRun(
				hand('a', 'b', 'c'),
				{ k: 'MAY', body: { ...discard, count: 2 } },
				SRC,
				0,
			),
			'CHOOSE_CARDS',
		)
		expect(checkSelection(pick, []).ok).toBe(true)
		expect(checkSelection(pick, [ID('a')]).ok).toBe(false)
		expect(checkSelection(pick, [ID('a'), ID('b')]).ok).toBe(true)
	})
})
