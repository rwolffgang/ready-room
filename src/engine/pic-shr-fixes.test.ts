// Regression tests for the PIC/SHR re-verification pass: the "this card"
// cost/query form, reaction payability, the Captain dismissal guard, and the
// 1PIC23 / 1PIC18 / 1PIC01 tree fixes. Real card definitions are loaded from
// src/data/cards.

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
	setActions,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { collectReactionGroups, drainEvents } from './resolver/triggers'
import { zoneKey, type GameState } from './state'
import { HIDDEN_DEF, project } from './projection'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const byCardId = new Map<string, CardDef>()
for (const f of ['crew/pic', 'crew/shr', 'crew/sel', 'crew/sis']) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) byCardId.set(def.cardId, def)
}
register([...byCardId.values()])
const real = (cardId: string): string => byCardId.get(cardId)!.id

register([
	makeDef({ id: 'pxPlain', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'pxAlly', suit: 'ALLY', operations: [] }),
	makeDef({ id: 'pxShip', suit: 'SHIP', operations: [] }),
	makeDef({ id: 'pxEnc', suit: 'ENCOUNTER', operations: [] }),
	makeDef({ id: 'pxLoc', suit: 'LOCATION', operations: [] }),
	makeDef({
		id: 'pxVulcan',
		suit: 'PERSON',
		traits: ['VULCAN'],
		operations: [],
	}),
	// "Dismiss this card to gain 1 {GLO}" — two copies in play
	makeDef({
		id: 'pxSelfDismiss',
		suit: 'SHIP',
		operations: [
			op('ACTIVATION', {
				k: 'PAY_THEN',
				cost: { k: 'COST_DISMISS', target: 'THIS', count: 1 },
				body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
			}),
		],
	}),
	// "Exhaust this card to draw a card"
	makeDef({
		id: 'pxSelfExhaust',
		suit: 'SHIP',
		operations: [
			op('ACTIVATION', {
				k: 'PAY_THEN',
				cost: { k: 'COST_EXHAUST', target: 'THIS' },
				body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
			}),
		],
	}),
	// two reactions on the same event, each paying with a discard
	makeDef({
		id: 'pxDiscardReact',
		suit: 'SHIP',
		operations: [
			op(
				'REACTION',
				{
					k: 'PAY_THEN',
					cost: { k: 'COST_DISCARD', count: 1 },
					body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
				},
				{ trigger: { on: 'RESOURCE_GAINED', res: 'DIL' } },
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
	s.zones[zoneKey({ k, seat } as Parameters<typeof zoneKey>[0])] ?? []

describe('cost nodes: target THIS', () => {
	it('COST_DISMISS THIS dismisses the resolving copy, never another one', () => {
		let s = place(fresh(), 'pxSelfDismiss', ID('a'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'pxSelfDismiss', ID('b'), { k: 'FLEET', seat: 0 }, 0)
		const asked: string[] = []
		s = resolveOp(s, ID('b'), 0, (c) => {
			asked.push(c.k)
			return undefined
		})
		expect(asked).toEqual([]) // only one candidate: no prompt
		expect(zone(s, 'FLEET', 0)).toEqual([ID('a')])
		expect(zone(s, 'DISCARD', 0)).toEqual([ID('b')])
		expect(s.players[0].resources.GLO).toBe(1)
	})

	it('COST_EXHAUST THIS is unpayable once the card is exhausted', () => {
		let s = place(fresh(), 'pxSelfExhaust', ID('a'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'pxSelfExhaust', ID('b'), { k: 'FLEET', seat: 0 }, 0, {
			exhausted: true,
		})
		const t = resolveOp(s, ID('b'), 0)
		expect(t.players[0].resources.DIL).toBe(0)
		expect(t.cards['a']!.exhausted).toBe(false)
		const u = resolveOp(s, ID('a'), 0)
		expect(u.players[0].resources.DIL).toBe(1)
		expect(u.cards['a']!.exhausted).toBe(true)
	})

	it('1SIS10 uses target THIS for its dismissal cost', () => {
		const sis10 = byCardId.get('1SIS10/25')!
		expect(JSON.stringify(sis10.operations)).toContain('"target":"THIS"')
		expect(JSON.stringify(sis10.operations)).not.toContain('"ids"')
	})
})

describe('reaction windows only offer reactions whose cost can be paid', () => {
	const gained = (s: GameState): GameState => ({
		...s,
		eventQueue: [{ k: 'CARD_GAINED', iid: ID('ally'), seat: 0 }],
	})
	const pic = (hand: number): GameState => {
		let s = place(
			fresh(),
			real('1PIC01/24'),
			ID('pic'),
			{ k: 'CAPTAIN', seat: 0 },
			0,
		)
		s = place(s, 'pxAlly', ID('ally'), { k: 'DISCARD', seat: 0 }, 0)
		for (let i = 0; i < hand; i++)
			s = place(s, 'pxPlain', ID(`h${i}`), { k: 'HAND', seat: 0 }, 0)
		return gained(s)
	}

	it('1PIC01 PIC: no window with an empty hand, offered with a card', () => {
		const ev = { k: 'CARD_GAINED' as const, iid: ID('ally'), seat: 0 as Seat }
		expect(collectReactionGroups(pic(0), ev)).toEqual([])
		expect(collectReactionGroups(pic(1), ev)).toHaveLength(1)
	})

	it('1PIC01 PIC: discard → 1 GLO, and the gained ALLY may be beamed', () => {
		let s = pic(1)
		s = place(s, 'pxShip', ID('ship'), { k: 'FLEET', seat: 0 }, 0)
		s = drive(drainEvents(s).state)
		expect(s.players[0].resources.GLO).toBe(1)
		expect(s.cards['ally']!.zone).toEqual({ k: 'BEAMED', host: 'ship' })
	})

	// The discard names the operation that asks for it, so the UI can show
	// the reaction's wording: why the discard, and what it pays for.
	it('1PIC01 PIC: the discard choice names the reaction it pays for', () => {
		const asked: PendingChoice[] = []
		drive(drainEvents(pic(2)).state, (c) => {
			asked.push(c)
			return undefined
		})
		const window = asked.find((c) => c.k === 'OPTIONAL_TRIGGERS')
		expect(window?.sourceOp).toBeUndefined()
		const discard = asked.find((c) => c.k === 'CHOOSE_CARDS')
		expect(discard?.sourceCard).toBe(ID('pic'))
		expect(discard?.sourceOp).toBe(0)
	})

	// The "you may beam" is asked as the beam's own pick, even with one card
	// and one ship, so the player sees what would go — even when the gained
	// card lies on the deck top.
	it('1PIC01 PIC: the "you may beam" pick shows the gained card', () => {
		let s = pic(1)
		s = place(s, 'pxAlly', ID('ally'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'pxShip', ID('ship'), { k: 'FLEET', seat: 0 }, 0)
		// answer the window and the discard, stop at the beam
		let t = run(drainEvents(s).state)
		while (
			t.pendingChoice !== null &&
			!(
				t.pendingChoice.mayDecline === true &&
				/beam/i.test(t.pendingChoice.prompt)
			)
		) {
			t = run(
				applyChoice(t, {
					t: 'RESOLVE_CHOICE',
					choiceId: t.pendingChoice.id,
					selection: auto(t.pendingChoice) as never,
				}),
			)
		}
		const choice = t.pendingChoice
		expect(choice?.k).toBe('CHOOSE_CARDS')
		expect(choice?.k === 'CHOOSE_CARDS' && choice.candidates).toEqual([
			ID('ally'),
		])
		expect(project(t, 0).cards['ally']!.def).toBe('pxAlly')
		expect(project(t, 1).cards['ally']!.def).toBe(HIDDEN_DEF)
	})

	// The window names its card only when both players know it: a face-up
	// Market pick put onto the deck top is public, a blind deck-top gain not.
	it('the window names an ALLY gained face up onto the deck top', () => {
		const onTop = (seen: boolean | undefined): GameState => {
			let s = pic(1)
			s = place(s, 'pxAlly', ID('ally'), { k: 'DRAW', seat: 0 }, 0)
			return {
				...s,
				eventQueue: [{ k: 'CARD_GAINED', iid: ID('ally'), seat: 0, seen }],
			}
		}
		const seen = run(drainEvents(onTop(true)).state).pendingChoice
		expect(seen?.k).toBe('OPTIONAL_TRIGGERS')
		expect(seen?.sourceCard).toBe(ID('ally'))
		expect(seen?.sourceDef).toBe('pxAlly')
		const blind = run(drainEvents(onTop(undefined)).state).pendingChoice
		expect(blind?.k).toBe('OPTIONAL_TRIGGERS')
		expect(blind?.sourceDef).toBeUndefined()
	})

	it('a second reaction is not re-offered once the first spent the last card', () => {
		let s = place(
			fresh(),
			'pxDiscardReact',
			ID('r1'),
			{ k: 'FLEET', seat: 0 },
			0,
		)
		s = place(s, 'pxDiscardReact', ID('r2'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'pxPlain', ID('h0'), { k: 'HAND', seat: 0 }, 0)
		s = {
			...s,
			eventQueue: [{ k: 'RESOURCE_GAINED', seat: 0, res: 'DIL', amount: 1 }],
		}
		const offers: number[] = []
		s = drive(drainEvents(s).state, (c) => {
			if (c.k !== 'OPTIONAL_TRIGGERS') return undefined
			offers.push(c.offered.length)
			return [c.offered[0]]
		})
		expect(offers).toEqual([2]) // after r1 paid, r2 is no longer offered
		expect(s.players[0].resources.GLO).toBe(1)
	})
})

describe('1SHR20: a Captain is never dismissed', () => {
	const shr20 = (withVulcan: boolean) => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1SHR20/24'), ID('1SHR20'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, real('1SEL01/24'), ID('sel'), { k: 'CAPTAIN', seat: 1 }, 1)
		if (withVulcan)
			s = place(s, 'pxVulcan', ID('vul'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		return resolveOp(s, ID('1SHR20'), 0)
	}

	it('the ROMULAN Captain SEL is not a legal target', () => {
		const s = shr20(false)
		expect(zone(s, 'CAPTAIN', 1)).toEqual([ID('sel')])
	})

	it('a VULCAN Duty Officer is dismissed instead', () => {
		const s = shr20(true)
		expect(zone(s, 'CAPTAIN', 1)).toEqual([ID('sel')])
		expect(zone(s, 'DUTY_OFFICER', 1)).toEqual([])
		expect(zone(s, 'DISCARD', 1)).toContain(ID('vul'))
	})
})

describe('1PIC23: glory only if an opponent Away Team was removed', () => {
	const pic23 = (theirTeams: number) => {
		let s = place(
			fresh(),
			real('1PIC23/24'),
			ID('1PIC23'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = place(s, 'pxLoc', ID('loc'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'pxPlain', ID('h0'), { k: 'HAND', seat: 0 }, 0)
		s = { ...s, awayTeamsAt: { loc: [1, theirTeams] } }
		return resolveOp(s, ID('1PIC23'), 1)
	}

	it('removes one of theirs and gains 1 GLO', () => {
		const s = pic23(1)
		expect(s.awayTeamsAt['loc']?.[1] ?? 0).toBe(0)
		expect(s.players[0].resources.GLO).toBe(1)
	})

	it('nothing to remove → no glory', () => {
		const s = pic23(0)
		expect(s.players[0].resources.GLO).toBe(0)
	})
})

describe('1PIC18: a SHIP beamed to the Location counts (FAQ)', () => {
	it('takes one of the top 2 Encounters with a beamed SHIP and an Away Team there', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1PIC18/24'), ID('snw'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'pxLoc', ID('loc'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'pxShip', ID('bship'), { k: 'BEAMED', host: 'loc' }, 0)
		s = place(s, 'pxEnc', ID('e1'), { k: 'ENCOUNTER_DECK' })
		s = place(s, 'pxEnc', ID('e2'), { k: 'ENCOUNTER_DECK' })
		s = { ...s, awayTeamsAt: { loc: [1, 0] } }
		s = resolveOp(s, ID('snw'), 0)
		const taken = [ID('e1'), ID('e2')].filter((e) => s.cards[e]!.owner === 0)
		expect(taken).toHaveLength(1)
		expect(zone(s, 'LOG', 0)).toContain(ID('loc'))
		expect(s.players[0].specialties.RESEARCH).toBeGreaterThanOrEqual(1)
	})
})
