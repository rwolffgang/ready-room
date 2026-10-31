// todo/08 — Market acquisition, Locations, Ships & Away Teams. Implements the
// todo's Definition of Done against the engine primitives (rules/05 §5.4,
// rules/03 §3.4, rules/06, rules/12 §12.15–12.20 & §12.30).
//
// NOTE on events: `run`/`runCollecting` drain `state.eventQueue` into a
// collected array at every primitive boundary (todo/06 intents surface these;
// todo/09 wires them to REACTION/PASSIVE collection). So assertions on events
// always read the `events` list from `drive`/`driveNode`, never
// `state.eventQueue` on a state that has been through the stack.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	pushAndRun,
	setResources,
} from './resolver/testUtils'
import { run, runCollecting } from './resolver/stack'
import { moveCard } from './state'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { assertSerialisable } from './invariants'
import { zoneKey, type GameState, type GameEvent, type Frame } from './state'
import { refillNeutralZone } from './market'
import type { CardInstanceId } from './ids'
import type { Effect } from './resolver/nodes'
import type { Seat } from './resolver/queries'

const mk = (
	id: string,
	suit: Parameters<typeof makeDef>[0]['suit'],
	ops: Parameters<typeof makeDef>[0]['operations'] = [],
	traits: string[] = [],
): ReturnType<typeof makeDef> =>
	makeDef({
		id,
		suit,
		traits: traits as Parameters<typeof makeDef>[0]['traits'],
		operations: ops,
	})

const gain = (res: 'DIL' | 'LAT' | 'GLO', amount: number): Effect => ({
	k: 'GAIN_RESOURCE',
	res,
	amount,
})

/** Drive any stack/choice state to a halt, answering every pending choice with
 *  `pick` and collecting every drained event (todo/08: events live in the
 *  collected list, not state.eventQueue, once the stack has run). */
function drive(
	state: GameState,
	pick: (c: PendingChoice) => unknown,
): { state: GameState; events: GameEvent[] } {
	let s = state
	const events: GameEvent[] = []
	let guard = 0
	while (
		s.result === null &&
		(s.pendingChoice !== null || s.stack.length > 0)
	) {
		if (s.pendingChoice !== null) {
			const c = s.pendingChoice
			s = applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: pick(c),
			})
		}
		const r = runCollecting(s)
		s = r.state
		events.push(...r.events)
		if (++guard > 150) throw new Error('drive: too many iterations')
	}
	return { state: s, events }
}

/** Push an EFFECT frame and drive it to a halt, collecting drained events. */
function driveNode(
	state: GameState,
	node: Effect,
	source: CardInstanceId,
	actor: Seat,
): { state: GameState; events: GameEvent[] } {
	const frame: Frame = {
		k: 'EFFECT',
		node,
		ctx: { actor, source, bindings: {} },
		ip: 0,
	}
	return drive({ ...state, stack: [...state.stack, frame] }, firstPick)
}

/** Drive a state to a halt, answering every pending choice with `pick`
 *  (state-only view; events are discarded). */
function resolveAll(
	state: GameState,
	pick: (c: PendingChoice) => unknown,
): GameState {
	return drive(state, pick).state
}

const firstPick = (c: PendingChoice): unknown => {
	switch (c.k) {
		case 'CHOOSE_CARDS':
			return [c.candidates[0]!]
		case 'CHOOSE_LOCATION':
			return c.candidates[0]!
		case 'CHOOSE_SUIT':
			return c.suits[0]!
		case 'CHOOSE_TRAIT':
			return c.traits[0]!
		case 'CHOOSE_DESTINATION':
			return c.options[0]!
		case 'ORDER_CARDS':
			return c.cards
		case 'CONFIRM':
			return true
		default:
			throw new Error(`unexpected choice ${c.k}`)
	}
}

const offers = (
	s: GameState,
	suit: 'PERSON' | 'CARGO' | 'SHIP' | 'ALLY',
): CardInstanceId[] => s.zones[zoneKey({ k: 'MARKET_OFFER', suit })] ?? []

describe('GAIN_CARD (todo/08 §2, rules/05 §5.4.1)', () => {
	it('gain with an empty offer slot AND an empty deck is a no-op with a SKIPPED log', () => {
		register([mk('crew', 'PERSON')])
		const out = pushAndRun(
			fresh(),
			{ k: 'GAIN_CARD', suits: ['PERSON'] },
			ID('e'),
			0,
		)
		expect(out.pendingChoice).toBeNull()
		expect(Object.keys(out.cards)).toHaveLength(0) // nothing moved
		expect(
			out.log.some(
				(l) => l.kind === 'SKIPPED' && l.message.includes('GAIN_CARD'),
			),
		).toBe(true)
	})

	it('gain of a faceup card carrying 3 Glory transfers all 3 to the pool and refills', () => {
		register([mk('crew', 'PERSON')])
		let s = fresh()
		s = place(
			s,
			'crew',
			ID('c1'),
			{ k: 'MARKET_OFFER', suit: 'PERSON' },
			null,
			{ resourceTokens: { GLO: 3 } },
		)
		const { state: out, events } = driveNode(
			s,
			{ k: 'GAIN_CARD', suits: ['PERSON'] },
			ID('e'),
			0,
		)
		expect(out.players[0]!.resources.GLO).toBe(3) // all three tokens moved to the pool
		expect(out.cards[ID('c1')]!.owner).toBe(0)
		expect(out.cards[ID('c1')]!.zone).toEqual({ k: 'DRAW', seat: 0 }) // DECK_TOP
		expect(offers(out, 'PERSON')).not.toContain(ID('c1')) // slot emptied
		expect(
			events.some((ev) => ev.k === 'CARD_GAINED' && ev.iid === ID('c1')),
		).toBe(true)
	})

	it('gain offers both the faceup card and the unseen deck top', () => {
		register([mk('cargo', 'CARGO')])
		let s = fresh()
		s = place(s, 'cargo', ID('off'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('top'), { k: 'MARKET_DECK', suit: 'CARGO' })
		const halted = pushAndRun(
			s,
			{ k: 'GAIN_CARD', suits: ['CARGO'] },
			ID('e'),
			0,
		)
		const ch = halted.pendingChoice
		expect(ch?.k).toBe('CHOOSE_CARDS')
		if (ch === null || ch.k !== 'CHOOSE_CARDS') return
		expect(ch.candidates).toEqual(
			expect.arrayContaining([ID('off'), ID('top')]),
		)
		expect(ch.hidden).toContain(ID('top')) // deck top is surface face-down
	})

	it('a face-up gain is marked seen, a blind deck-top gain is not', () => {
		register([mk('cargo', 'CARGO')])
		const gainEvent = (pick: 'off' | 'top') => {
			let s = fresh()
			s = place(s, 'cargo', ID('off'), { k: 'MARKET_OFFER', suit: 'CARGO' })
			s = place(s, 'cargo', ID('top'), { k: 'MARKET_DECK', suit: 'CARGO' })
			const frame: Frame = {
				k: 'EFFECT',
				node: { k: 'GAIN_CARD', suits: ['CARGO'] },
				ctx: { actor: 0, source: ID('e'), bindings: {} },
				ip: 0,
			}
			const { events } = drive({ ...s, stack: [frame] }, (c) =>
				c.k === 'CHOOSE_CARDS' ? [ID(pick)] : firstPick(c),
			)
			return events.find((e) => e.k === 'CARD_GAINED')
		}
		expect(gainEvent('off')).toMatchObject({ dest: 'DECK_TOP', seen: true })
		expect(gainEvent('top')).toMatchObject({ dest: 'DECK_TOP', seen: false })
	})

	it('paying a cost then gaining moves the card to the buyer, deducts the cost, and refills deterministically', () => {
		register([mk('cargo', 'CARGO')])
		let s = fresh()
		s = setResources(s, 0, 'DIL', 3)
		s = place(s, 'cargo', ID('off'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('top'), { k: 'MARKET_DECK', suit: 'CARGO' })
		const { state: out, events } = driveNode(
			s,
			{
				k: 'SEQ',
				steps: [
					{ k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
					{ k: 'GAIN_CARD', suits: ['CARGO'] },
				],
			},
			ID('e'),
			0,
		)
		expect(out.players[0]!.resources.DIL).toBe(1) // 3 - 2
		expect(out.cards[ID('off')]!.owner).toBe(0)
		expect(out.cards[ID('off')]!.zone).toEqual({ k: 'DRAW', seat: 0 })
		expect(offers(out, 'CARGO')).toEqual([ID('top')]) // refilled with the deck top (no rng)
		expect(
			events.some(
				(e) => e.k === 'RESOURCE_SPENT' && e.res === 'DIL' && e.amount === 2,
			),
		).toBe(true)
		expect(
			events.some((e) => e.k === 'CARD_GAINED' && e.iid === ID('off')),
		).toBe(true)
	})

	it('an empty deck leaves the offer slot empty permanently — later gains tolerate it', () => {
		register([mk('cargo', 'CARGO')])
		let s = fresh()
		s = place(s, 'cargo', ID('off'), { k: 'MARKET_OFFER', suit: 'CARGO' }) // no deck behind it
		const out = resolveAll(
			pushAndRun(s, { k: 'GAIN_CARD', suits: ['CARGO'] }, ID('e'), 0),
			firstPick,
		)
		expect(offers(out, 'CARGO')).toEqual([]) // the slot stays empty — legal, permanent
		const out2 = pushAndRun(
			out,
			{ k: 'GAIN_CARD', suits: ['CARGO'] },
			ID('e'),
			0,
		)
		expect(out2.pendingChoice).toBeNull() // no-op, never throws
		expect(out2.log.some((l) => l.kind === 'SKIPPED')).toBe(true)
	})
})

describe('SCAN_N (todo/08 §3, rules/05 §5.4.2)', () => {
	it('scan 2 of CARGO with 1 deck card looks at 1 and still offers the faceup card', () => {
		register([mk('cargo', 'CARGO')])
		let s = fresh()
		s = place(s, 'cargo', ID('off'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('d1'), { k: 'MARKET_DECK', suit: 'CARGO' })
		const halted = pushAndRun(
			s,
			{ k: 'SCAN_N', suits: ['CARGO'], n: 2 },
			ID('e'),
			0,
		)
		expect(halted.pendingChoice?.k).toBe('CHOOSE_CARDS')
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_CARDS') return
		// revealed (min(2, deck.length)=1) ∪ faceup offer — neither is hidden
		expect(ch.candidates).toHaveLength(2)
		expect(ch.candidates).toContain(ID('d1'))
		expect(ch.candidates).toContain(ID('off'))
	})

	it('scan places the picked card and sends the leftover revealed card to the deck bottom', () => {
		register([mk('cargo', 'CARGO')])
		let s = fresh()
		s = place(s, 'cargo', ID('d1'), { k: 'MARKET_DECK', suit: 'CARGO' })
		s = place(s, 'cargo', ID('d2'), { k: 'MARKET_DECK', suit: 'CARGO' })
		const out = resolveAll(
			pushAndRun(s, { k: 'SCAN_N', suits: ['CARGO'], n: 2 }, ID('e'), 0),
			firstPick,
		)
		// gained d1 (auto-selected), d2 sent to the bottom of the deck
		expect(out.cards[ID('d1')]!.zone).toEqual({ k: 'DRAW', seat: 0 })
		expect(out.zones[zoneKey({ k: 'MARKET_DECK', suit: 'CARGO' })]).toEqual([
			ID('d2'),
		])
	})
})

describe('SCAN_FOR_TRAIT (todo/08 §4, rules/05 §5.4.3)', () => {
	it('scan for KLINGON with no KLINGON anywhere grants exactly 2 Glory (and gains nothing)', () => {
		register([
			mk('person', 'PERSON'),
			mk('cargo', 'CARGO'),
			mk('ship', 'SHIP'),
			mk('ally', 'ALLY'),
			mk('klingon', 'PERSON', [], ['KLINGON']),
		])
		let s = fresh()
		// no KLINGON anywhere: faceup offers and decks are all plain
		for (const [suit, id] of [
			['PERSON', 'p0'],
			['CARGO', 'c0'],
			['SHIP', 's0'],
			['ALLY', 'a0'],
		] as const) {
			s = place(
				s,
				suit === 'PERSON'
					? 'person'
					: suit === 'CARGO'
						? 'cargo'
						: suit === 'SHIP'
							? 'ship'
							: 'ally',
				ID(id),
				{ k: 'MARKET_OFFER', suit },
			)
		}
		const { state: out, events } = driveNode(
			s,
			{ k: 'SCAN_FOR_TRAIT', traits: ['KLINGON'] },
			ID('e'),
			0,
		)
		expect(out.players[0]!.resources.GLO).toBe(2) // consolation, nothing gained
		expect(events.some((e) => e.k === 'CARD_GAINED')).toBe(false)
		// all four offers untouched — they were never candidates
		for (const [suit, id] of [
			['PERSON', 'p0'],
			['CARGO', 'c0'],
			['SHIP', 's0'],
			['ALLY', 'a0'],
		] as const) {
			expect(
				offers(out, suit as 'PERSON' | 'CARGO' | 'SHIP' | 'ALLY'),
			).toContain(ID(id))
		}
	})

	it('after choosing the SHIP deck the PERSON faceup card is NOT a candidate', () => {
		register([mk('person', 'PERSON'), mk('ship', 'SHIP', [], ['KLINGON'])])
		let s = fresh()
		s = place(s, 'person', ID('perOff'), { k: 'MARKET_OFFER', suit: 'PERSON' }) // no KLINGON → step 1 skips it
		s = place(s, 'ship', ID('kShip'), { k: 'MARKET_DECK', suit: 'SHIP' }) // + KLINGON
		const halted = pushAndRun(
			s,
			{ k: 'SCAN_FOR_TRAIT', traits: ['KLINGON'] },
			ID('e'),
			0,
		)
		expect(halted.pendingChoice?.k).toBe('CHOOSE_SUIT')
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_SUIT') return
		// pick the SHIP deck explicitly — the PERSON faceup never becomes a candidate
		const s2 = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: 'SHIP',
			}),
		)
		// the found card is shown in the deck-top-or-Discard choice (rules/05 §5.4.3)
		const dest = s2.pendingChoice
		expect(dest).toMatchObject({
			k: 'CHOOSE_DESTINATION',
			card: ID('kShip'),
			options: ['DECK_TOP', 'DISCARD'],
		})
		const s3 = run(
			applyChoice(s2, {
				t: 'RESOLVE_CHOICE',
				choiceId: dest!.id,
				selection: 'DECK_TOP',
			}),
		)
		expect(s3.pendingChoice).toBeNull()
		expect(s3.cards[ID('kShip')]!.zone.k).toBe('DRAW') // the ship gained
		expect(offers(s3, 'PERSON')).toContain(ID('perOff')) // PERSON offer untouched
	})

	it('a faceup match is offered for the Discard pile too', () => {
		register([mk('ship', 'SHIP', [], ['KLINGON'])])
		let s = fresh()
		s = place(s, 'ship', ID('kOff'), { k: 'MARKET_OFFER', suit: 'SHIP' })
		const halted = pushAndRun(
			s,
			{ k: 'SCAN_FOR_TRAIT', traits: ['KLINGON'] },
			ID('e'),
			0,
		)
		const dest = halted.pendingChoice
		expect(dest).toMatchObject({ k: 'CHOOSE_DESTINATION', card: ID('kOff') })
		const out = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: dest!.id,
				selection: 'DISCARD',
			}),
		)
		expect(out.cards[ID('kOff')]!.zone.k).toBe('DISCARD')
	})
})

describe('JUNK & WIPE_MARKET (todo/08 §5, rules/12 §12.19)', () => {
	it('junk surfaces token-bearing offers greyed; WIPE_MARKET junks them anyway and returns tokens', () => {
		register([mk('cargo', 'CARGO')])
		let s = fresh()
		s = place(s, 'cargo', ID('t'), { k: 'MARKET_OFFER', suit: 'CARGO' }, null, {
			resourceTokens: { GLO: 2 },
		})
		s = place(s, 'cargo', ID('c1'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('c2'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		// two legal (non-tainted) candidates → a real CHOOSE_CARDS, with `t` greyed
		const halted = pushAndRun(
			s,
			{ k: 'JUNK', target: { zones: [{ k: 'MARKET_OFFER', suit: 'CARGO' }] } },
			ID('e'),
			0,
		)
		const ch = halted.pendingChoice
		expect(ch?.k).toBe('CHOOSE_CARDS')
		if (ch === null || ch.k !== 'CHOOSE_CARDS') return
		expect(ch.disabled?.map((d) => d.iid)).toContain(ID('t'))
		expect(ch.candidates).toContain(ID('t')) // present but disabled
		const picked = ch.candidates.find((iid) => iid !== ID('t'))!
		const afterJunk = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [picked],
			}),
		)
		// the tainted card is still there with its tokens
		expect(offers(afterJunk, 'CARGO')).toContain(ID('t'))
		expect(afterJunk.cards[ID('t')]!.resourceTokens.GLO).toBe(2)
		// WIPE_MARKET ignores the token restriction (rules/12 §12.19)
		const out = pushAndRun(afterJunk, { k: 'WIPE_MARKET' }, ID('e'), 0)
		expect(out.zones['JUNK']).toContain(ID('t'))
		expect(out.cards[ID('t')]!.resourceTokens).toEqual({}) // tokens returned to supply
		expect(offers(out, 'CARGO')).not.toContain(ID('t'))
	})

	it('WIPE_MARKET junks all four offers, returns their tokens, and refills each suit', () => {
		register([mk('person', 'PERSON'), mk('cargo', 'CARGO')])
		let s = fresh()
		s = place(
			s,
			'person',
			ID('p0'),
			{ k: 'MARKET_OFFER', suit: 'PERSON' },
			null,
			{ resourceTokens: { GLO: 2 } },
		)
		s = place(s, 'cargo', ID('c0'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('s0'), { k: 'MARKET_OFFER', suit: 'SHIP' })
		s = place(s, 'cargo', ID('a0'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		// one refill card per suit
		for (const [defId, suit, id] of [
			['person', 'PERSON', 'p1'],
			['cargo', 'CARGO', 'c1'],
			['cargo', 'SHIP', 's1'],
			['cargo', 'ALLY', 'a1'],
		] as const) {
			s = place(s, defId, ID(id), { k: 'MARKET_DECK', suit })
		}
		const out = pushAndRun(s, { k: 'WIPE_MARKET' }, ID('e'), 0)
		expect(out.zones['JUNK']).toEqual(
			expect.arrayContaining([ID('p0'), ID('c0'), ID('s0'), ID('a0')]),
		)
		expect(out.cards[ID('p0')]!.resourceTokens).toEqual({}) // tokens back to the supply
		// every suit refilled from its deck
		expect(offers(out, 'PERSON')).toEqual([ID('p1')])
		expect(offers(out, 'CARGO')).toEqual([ID('c1')])
		expect(offers(out, 'SHIP')).toEqual([ID('s1')])
		expect(offers(out, 'ALLY')).toEqual([ID('a1')])
		assertSerialisable(out)
	})
})

describe('TAKE_CONTROL (todo/08 §6, rules/03 §3.4.2, rules/08 → take control)', () => {
	it('opponent gains 1 Glory per of their tokens (2 away + 1 ship = 3); the actor gains 0', () => {
		register([mk('loc', 'LOCATION'), mk('ship', 'SHIP')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = { ...s, awayTeamsAt: { L: [1, 2] } } // actor 1, opponent 2 away teams
		s = place(s, 'ship', ID('s0'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L'),
		})
		s = place(s, 'ship', ID('s1'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('L'),
		})
		s = place(s, 'loc', ID('R'), { k: 'LOCATION_DECK' })
		s = place(s, 'ship', ID('sdet'), { k: 'FLEET', seat: 0 }, 0) // unrelated ship, token on card
		const { state: out, events } = driveNode(
			s,
			{
				k: 'TAKE_CONTROL',
				target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
			},
			ID('e'),
			0,
		)
		assertSerialisable(out)
		expect(out.players[1]!.resources.GLO).toBe(3) // 2 away + 1 ship → exactly 3
		expect(out.players[0]!.resources.GLO).toBe(0) // the actor gains nothing
		// both ships at L dismissed to their owners' Discards, tokens to the supply
		expect(out.zones['DISCARD:0']).toContain(ID('s0'))
		expect(out.zones['DISCARD:1']).toContain(ID('s1'))
		expect(out.cards[ID('s0')]!.shipTokenAt).toBe('SUPPLY')
		expect(out.cards[ID('s1')]!.shipTokenAt).toBe('SUPPLY')
		// away teams returned to their owners' pools
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
		expect(out.awayTeamsAt[ID('L')]).toBeUndefined()
		expect(out.players[0]!.awayTeamsInPool).toBe(1)
		expect(out.players[1]!.awayTeamsInPool).toBe(2)
		// the vacated Neutral Zone slot refilled
		expect(out.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 0 })]).toEqual([
			ID('R'),
		])
		// events: PUT_INTO_PLAY before LOCATION_CONTROLLED (rules/08)
		const types = events
			.filter((e) => e.k === 'PUT_INTO_PLAY' || e.k === 'LOCATION_CONTROLLED')
			.map((e) => e.k)
		expect(types.indexOf('PUT_INTO_PLAY')).toBeGreaterThanOrEqual(0)
		expect(types.indexOf('LOCATION_CONTROLLED')).toBeGreaterThan(
			types.indexOf('PUT_INTO_PLAY'),
		)
		expect(out.cards[ID('sdet')]!.shipTokenAt).toBeNull() // unrelated ship untouched
	})

	it('taking control resolves the CONTROL operation (played from a PLAY op)', () => {
		register([
			mk('loc', 'LOCATION', [
				{
					type: 'CONTROL' as const,
					costsAction: false,
					isAttack: false,
					effect: gain('LAT', 2),
					text: 'control',
				},
			]),
		])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'STAGING', seat: 0 }, 0) // hand-played: same code path
		const { state: out, events } = driveNode(
			s,
			{ k: 'TAKE_CONTROL', target: { zones: [{ k: 'STAGING', seat: 0 }] } },
			ID('L'),
			0,
		)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
		expect(out.players[0]!.resources.LAT).toBe(2) // the CONTROL operation resolved
		expect(events.some((e) => e.k === 'LOCATION_CONTROLLED')).toBe(true)
	})

	it("TAKE_CONTROL 'THIS' takes only the played Location, not another staged one", () => {
		register([mk('loc', 'LOCATION'), mk('other', 'LOCATION')])
		let s = fresh()
		s = place(s, 'other', ID('O'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'loc', ID('L'), { k: 'STAGING', seat: 0 }, 0)
		const { state: out } = driveNode(
			s,
			{ k: 'TAKE_CONTROL', target: 'THIS' },
			ID('L'),
			0,
		)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
		expect(out.cards[ID('O')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
		expect(out.pendingChoice).toBeNull() // no Location choice offered
	})

	it('TAKE_CONTROL from the Location deck gains the top Location (rules/06 §6.1.2 route 3)', () => {
		register([
			mk('loc', 'LOCATION', [
				{
					type: 'CONTROL' as const,
					costsAction: false,
					isAttack: false,
					effect: gain('LAT', 1),
					text: 'control',
				},
			]),
		])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'LOCATION_DECK' })
		const out = resolveAll(
			pushAndRun(
				s,
				{ k: 'TAKE_CONTROL', target: 'FROM_LOCATION_DECK' },
				ID('e'),
				0,
			),
			firstPick,
		)
		assertSerialisable(out)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
		expect(out.cards[ID('L')]!.owner).toBe(0)
		expect(out.players[0]!.resources.LAT).toBe(1) // the CONTROL op resolved
	})

	it('requireSecured restricts targets to Locations isSecured for the actor (rules/03 §3.4.1)', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('secured1'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'loc', ID('unsecured'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = place(s, 'loc', ID('secured2'), { k: 'NEUTRAL_ZONE', slot: 2 })
		// actor 3 tokens (≥3, ≥2 ahead) secures both `secured*`; `unsecured` ties 1-1
		s = {
			...s,
			awayTeamsAt: { secured1: [3, 0], unsecured: [1, 1], secured2: [3, 0] },
		}
		const halted = pushAndRun(
			s,
			{
				k: 'TAKE_CONTROL',
				target: {
					zones: [
						{ k: 'NEUTRAL_ZONE', slot: 0 },
						{ k: 'NEUTRAL_ZONE', slot: 1 },
						{ k: 'NEUTRAL_ZONE', slot: 2 },
					],
				},
				requireSecured: true,
			},
			ID('e'),
			0,
		)
		const ch = halted.pendingChoice
		expect(ch?.k).toBe('CHOOSE_LOCATION')
		if (ch === null || ch.k !== 'CHOOSE_LOCATION') return
		expect(ch.candidates).toEqual([ID('secured1'), ID('secured2')])
	})
})

describe('TRIGGER_CONTROL (todo/08 §6, rules/08 → trigger)', () => {
	it('resolves only the CONTROL op — tokens, beamed cards and events untouched', () => {
		register([
			mk('loc', 'LOCATION', [
				{
					type: 'CONTROL' as const,
					costsAction: false,
					isAttack: false,
					effect: gain('LAT', 5),
					text: 'control',
				},
			]),
			mk('ship', 'SHIP'),
		])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = { ...s, awayTeamsAt: { L: [4, 1] } } // tokens stay put
		s = place(s, 'ship', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L'),
		})
		const { state: out, events } = driveNode(
			s,
			{
				k: 'TRIGGER_CONTROL',
				target: { zones: [{ k: 'LOCATION_AREA', seat: 0 }] },
			},
			ID('L'),
			0,
		)
		expect(out.players[0]!.resources.LAT).toBe(5) // the CONTROL op ran
		expect(out.awayTeamsAt[ID('L')]).toEqual([4, 1]) // away teams untouched
		expect(out.cards[ID('S')]!.shipTokenAt).toBe(ID('L')) // ship token untouched
		expect(out.zones[zoneKey({ k: 'LOCATION_AREA', seat: 0 })]).toContain(
			ID('L'),
		) // still controlled
		expect(events.some((e) => e.k === 'LOCATION_CONTROLLED')).toBe(false)
		expect(events.some((e) => e.k === 'PUT_INTO_PLAY')).toBe(false)
	})
})

describe('WIPE_NEUTRAL_ZONE (todo/08 §6, rules/12 §12.20)', () => {
	it('spares a Location holding a single Away Team, junking only bare ones, then refills', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('L1'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'loc', ID('L2'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = { ...s, awayTeamsAt: { L1: [1, 0] } } // L1 holds an Away Team
		s = place(s, 'loc', ID('R'), { k: 'LOCATION_DECK' })
		const out = pushAndRun(s, { k: 'WIPE_NEUTRAL_ZONE' }, ID('e'), 0)
		expect(out.cards[ID('L1')]!.zone.k).toBe('NEUTRAL_ZONE') // spared
		expect(out.zones['JUNK']).toContain(ID('L2')) // bare → junked
		expect(out.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 1 })]).toEqual([
			ID('R'),
		]) // refilled
	})
})

describe('Neutral Zone fills (todo/08 §6, rules/06 §6.1.1)', () => {
	it('refillNeutralZone reveals Location-deck cards into every empty slot', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('L1'), { k: 'LOCATION_DECK' })
		s = place(s, 'loc', ID('L2'), { k: 'LOCATION_DECK' })
		s = place(s, 'loc', ID('L3'), { k: 'LOCATION_DECK' })
		const out = refillNeutralZone(s)
		expect(out.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 0 })]).toEqual([
			ID('L1'),
		])
		expect(out.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 1 })]).toEqual([
			ID('L2'),
		])
		expect(out.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 2 })]).toEqual([
			ID('L3'),
		])
		// a second call is a no-op — the zone is already full
		const out2 = refillNeutralZone(out)
		expect(out2.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 0 })]).toEqual([
			ID('L1'),
		])
	})

	it('control is lost when a Location leaves play: Ships dismissed, Away Teams returned (cascade)', () => {
		register([mk('loc', 'LOCATION'), mk('ship', 'SHIP')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'ship', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L'),
		})
		s = { ...s, awayTeamsAt: { L: [2, 1] } }
		const out = moveCard(s, ID('L'), { k: 'LOG', seat: 0 })
		assertSerialisable(out)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOG', seat: 0 }) // control lost
		expect(out.cards[ID('S')]!.zone).toEqual({ k: 'DISCARD', seat: 0 }) // ship dismissed
		expect(out.cards[ID('S')]!.shipTokenAt).toBe('SUPPLY') // token to the supply
		expect(out.awayTeamsAt[ID('L')]).toBeUndefined()
		expect(out.players[0]!.awayTeamsInPool).toBe(2) // returned to their pools
		expect(out.players[1]!.awayTeamsInPool).toBe(1)
		expect(
			out.eventQueue.some((e) => e.k === 'CARD_DISMISSED' && e.iid === ID('S')),
		).toBe(true)
	})
})

describe('WARP & DEPLOY (todo/08 §7, rules/12 §12.16)', () => {
	it('a warped token never returns to the card except via dismiss → replay → deploy', () => {
		register([mk('ship', 'SHIP'), mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'ship', ID('S'), { k: 'FLEET', seat: 0 }, 0) // deployed, token on card (null)
		// warp S to L
		const { state: warped, events } = driveNode(
			s,
			{
				k: 'WARP',
				ship: { zones: [{ k: 'FLEET', seat: 0 }] },
				to: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
			},
			ID('e'),
			0,
		)
		expect(warped.cards[ID('S')]!.shipTokenAt).toBe(ID('L'))
		expect(events.some((e) => e.k === 'SHIP_WARPED')).toBe(true)
		assertSerialisable(warped)
		// dismiss → token to the supply, NOT the card
		const dismissed = moveCard(warped, ID('S'), { k: 'DISCARD', seat: 0 })
		expect(dismissed.cards[ID('S')]!.shipTokenAt).toBe('SUPPLY')
		// recall (return to hand) also cannot put the token back on the card
		const recalled = moveCard(dismissed, ID('S'), { k: 'HAND', seat: 0 })
		expect(recalled.cards[ID('S')]!.shipTokenAt).toBe('SUPPLY')
		// only a fresh DEPLOY takes the token from the supply onto the card
		const deployed = pushAndRun(
			recalled,
			{ k: 'DEPLOY', target: { zones: [{ k: 'HAND', seat: 0 }] } },
			ID('e'),
			0,
		)
		expect(deployed.cards[ID('S')]!.zone).toEqual({ k: 'FLEET', seat: 0 })
		expect(deployed.cards[ID('S')]!.shipTokenAt).toBeNull()
		assertSerialisable(deployed)
	})

	it('staying in place is not warping — the current Location is excluded', () => {
		register([
			mk('ship', 'SHIP'),
			mk('loc', 'LOCATION'),
			mk('loc2', 'LOCATION'),
		])
		let s = fresh()
		s = place(s, 'loc', ID('L1'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'loc2', ID('L2'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = place(s, 'ship', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L1'),
		})
		const { state: out } = driveNode(
			s,
			{
				k: 'WARP',
				ship: { zones: [{ k: 'FLEET', seat: 0 }] },
				to: {
					zones: [
						{ k: 'NEUTRAL_ZONE', slot: 0 },
						{ k: 'NEUTRAL_ZONE', slot: 1 },
					],
				},
			},
			ID('e'),
			0,
		)
		// L1 (where the ship sits) is excluded — L2 is the only legal destination,
		// so the warp auto-resolves (no "stay in place" candidate exists)
		expect(out.cards[ID('S')]!.shipTokenAt).toBe(ID('L2'))
	})
})

describe('SEND_AWAY_TEAM (todo/08 §8, rules/12 §12.15)', () => {
	it('sending with an empty pool freely pulls tokens from another Location', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('target'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'loc', ID('src'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = { ...s, awayTeamsAt: { src: [2, 0], target: [0, 0] } } // pool empty
		expect(s.players[0]!.awayTeamsInPool).toBe(0)
		const { state: out, events } = driveNode(
			s,
			{
				k: 'SEND_AWAY_TEAM',
				count: 2,
				target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
			},
			ID('e'),
			0,
		)
		expect(out.awayTeamsAt[ID('target')]).toEqual([2, 0]) // the full placement completed
		expect(out.awayTeamsAt[ID('src')]).toEqual([0, 0])
		expect(out.players[0]!.awayTeamsInPool).toBe(0)
		expect(events.some((e) => e.k === 'AWAY_TEAM_SENT')).toBe(true)
		assertSerialisable(out)
	})

	it('a single legal destination still completes a pull that has to ask for its source', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('target'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'loc', ID('srcA'), { k: 'NEUTRAL_ZONE', slot: 1 })
		s = place(s, 'loc', ID('srcB'), { k: 'NEUTRAL_ZONE', slot: 2 })
		// pool empty, tokens on two other Locations: the destination is
		// automatic, the source is a choice (found by the ISMCTS arena)
		s = { ...s, awayTeamsAt: { srcA: [1, 0], srcB: [1, 0], target: [0, 0] } }
		const asked: string[] = []
		const frame: Frame = {
			k: 'EFFECT',
			node: {
				k: 'SEND_AWAY_TEAM',
				count: 2,
				target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
			},
			ctx: { actor: 0, source: ID('e'), bindings: {} },
			ip: 0,
		}
		const { state: out } = drive({ ...s, stack: [frame] }, (c) => {
			asked.push(c.prompt)
			return firstPick(c)
		})
		expect(asked).toHaveLength(1) // only the source was asked for
		expect(out.awayTeamsAt[ID('target')]).toEqual([2, 0])
		expect(out.players[0]!.awayTeamsInPool).toBe(0)
		assertSerialisable(out)
	})

	it('blocking: a neutral Location with more opponent ships is refused (rule §12.15)', () => {
		register([mk('loc', 'LOCATION'), mk('ship', 'SHIP')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'ship', ID('opp'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('L'),
		}) // opp 1 ship > actor 0
		s = {
			...s,
			players: [
				{ ...s.players[0]!, awayTeamsInPool: 2 },
				s.players[1]!,
			] as GameState['players'],
		}
		// the only neutral target is blocked → the SEND cannot resolve (skipped)
		const out = pushAndRun(
			s,
			{
				k: 'SEND_AWAY_TEAM',
				count: 1,
				target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
			},
			ID('e'),
			0,
		)
		expect(out.players[0]!.awayTeamsInPool).toBe(2) // nothing moved
		expect(out.awayTeamsAt[ID('L')]).toBeUndefined()
		expect(out.log.some((l) => l.kind === 'SKIPPED')).toBe(true)
		// ignoreBlocking overrides (1ENC04)
		const out2 = resolveAll(
			pushAndRun(
				s,
				{
					k: 'SEND_AWAY_TEAM',
					count: 2,
					target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
					ignoreBlocking: true,
				},
				ID('e'),
				0,
			),
			firstPick,
		)
		expect(out2.awayTeamsAt[ID('L')]).toEqual([2, 0])
	})
})

describe('REMOVE_AWAY_TEAM (todo/08 §8, rules/08 → send/remove)', () => {
	it("removed tokens return to the owning player's Captain pool", () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = { ...s, awayTeamsAt: { L: [0, 3] } } // opponent has 3 there
		const out = pushAndRun(
			s,
			{
				k: 'REMOVE_AWAY_TEAM',
				count: 2,
				target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
				whose: 'OPPONENT',
			},
			ID('e'),
			0,
		)
		expect(out.awayTeamsAt[ID('L')]).toEqual([0, 1])
		expect(out.players[1]!.awayTeamsInPool).toBe(2) // back to the owner's Captain card
		assertSerialisable(out)
	})
})

describe('Locations cannot be dismissed, recalled or beamed (rules/06 §6.1.3)', () => {
	it('BEAM refuses a LOCATION (only candidate) → skipped, card stays', () => {
		register([mk('loc', 'LOCATION'), mk('ship', 'SHIP')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ship', ID('H'), { k: 'FLEET', seat: 0 }, 0)
		const out = pushAndRun(
			s,
			{ k: 'BEAM', to: { zones: [{ k: 'FLEET', seat: 0 }] }, count: 1 },
			ID('e'),
			0,
		)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'HAND', seat: 0 }) // untouched
		expect(out.log.some((l) => l.kind === 'SKIPPED')).toBe(true)
	})

	it('BEAM of a LOCATION is rejected even when other cards are present', () => {
		register([
			mk('loc', 'LOCATION'),
			mk('person', 'PERSON'),
			mk('ship', 'SHIP'),
		])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'person', ID('P1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'person', ID('P2'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ship', ID('H'), { k: 'FLEET', seat: 0 }, 0)
		const halted = pushAndRun(
			s,
			{ k: 'BEAM', to: { zones: [{ k: 'FLEET', seat: 0 }] }, count: 1 },
			ID('e'),
			0,
		)
		const ch = halted.pendingChoice
		expect(ch?.k).toBe('CHOOSE_CARDS')
		if (ch === null || ch.k !== 'CHOOSE_CARDS') return
		expect(ch.candidates).not.toContain(ID('L')) // the LOCATION is never a beam candidate
		expect(ch.candidates).toEqual([ID('P1'), ID('P2')])
	})

	it('DISMISS refuses a LOCATION → skipped, card stays in play', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		const out = pushAndRun(
			s,
			{ k: 'DISMISS', target: { zones: [{ k: 'LOCATION_AREA', seat: 0 }] } },
			ID('e'),
			0,
		)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
	})

	it('RECALL refuses a LOCATION → skipped, card stays in play', () => {
		register([mk('loc', 'LOCATION')])
		let s = fresh()
		s = place(s, 'loc', ID('L'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		const out = pushAndRun(
			s,
			{ k: 'RECALL', target: { zones: [{ k: 'LOCATION_AREA', seat: 0 }] } },
			ID('e'),
			0,
		)
		expect(out.cards[ID('L')]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
	})
})
