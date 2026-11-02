// Events, trigger seat scoping and temporary trait grants (box-1 audit):
//   - CARD_DEPLOYED event/trigger: DEPLOY (Staging → Fleet) emits it
//     (1KOL03, 1CAR03 "after deploying a SHIP")
//   - every event trigger defaults to the card owner's OWN events; `seat`
//     OPPONENT / ANY widens it (1SEL16, 1SIS06)
//   - MODIFIER_ATTACH { target } + TEMP_CLOAK: the deployed SHIP counts
//     as CLOAK until the turn ends — every trait check
//     sees it, the Clean-up REFRESH substep drops it
//   - INCIDENT_TAKEN orReturned (1PER22), AWAY_TEAM_SENT neutral
//     (1PER18), CARD_GAINED dest (1SHI06)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, type CardDef } from '../../data/schema'
import type { Effect, TriggerSpec } from './nodes'
import type { GameEvent, GameState } from '../state'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	pushAndRun,
	setResources,
} from './testUtils'
import { run } from './stack'
import { applyChoice } from './choices'
import { matchesTrigger } from './triggers'
import { matchTrait, cardTraits } from '../queries/traits'
import { evalPredicate, resolveQuery } from '../queries/resolveQuery'
import { dropTurnModifiers } from '../modifiers'
import { describeTrigger } from '../describe'
import type { CardInstanceId } from '../ids'

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

const PROTO = real('crew/kol', '1KOL03/24')
const CLOAKDEV = real('common/cargo', '1CAR03/16')
const TRUL = real('crew/sel', '1SEL16/24')
const SUKAL = real('common/person', '1PER22/25')
const per18 = real('common/person', '1PER18/25')
const MINES = real('crew/sis', '1SIS06/25')
const KAZON = real('common/ship', '1SHI06/13')

register([
	PROTO,
	CLOAKDEV,
	TRUL,
	SUKAL,
	per18,
	MINES,
	KAZON,
	makeDef({ id: 'plain-ship', suit: 'SHIP', traits: [], operations: [] }),
	makeDef({
		id: 'cloak-ship',
		suit: 'SHIP',
		traits: ['CLOAK'],
		operations: [],
	}),
	makeDef({
		id: 'cloak-cargo',
		suit: 'CARGO',
		traits: ['CLOAK'],
		operations: [],
	}),
	makeDef({ id: 'neutral-loc', suit: 'LOCATION', operations: [] }),
])

const SRC = ID('src')
const SHIP = ID('ship')

/** Queue `event` and drain it through a NOOP run (seat 0 resolving). */
function drainWith(state: GameState, event: GameEvent): GameState {
	return pushAndRun({ ...state, eventQueue: [event] }, { k: 'NOOP' }, SRC, 0)
}

/** Take every offered reaction of the open window; answer MAY prompts no. */
function takeAll(state: GameState): GameState {
	let s = state
	for (let guard = 0; guard < 10 && s.pendingChoice !== null; guard++) {
		const ch = s.pendingChoice
		if (ch.k === 'OPTIONAL_TRIGGERS')
			s = run(
				applyChoice(s, {
					t: 'RESOLVE_CHOICE',
					choiceId: ch.id,
					selection: ch.offered,
				}),
			)
		else if (ch.k === 'CONFIRM')
			s = run(
				applyChoice(s, {
					t: 'RESOLVE_CHOICE',
					choiceId: ch.id,
					selection: false,
				}),
			)
		else throw new Error(`unexpected choice ${ch.k}`)
	}
	return s
}

const deployShip: Effect = {
	k: 'DEPLOY',
	target: { zones: [{ k: 'STAGING', seat: 0 }], filter: { suits: ['SHIP'] } },
}

describe('CARD_DEPLOYED — 1KOL03 / 1CAR03', () => {
	function setup(def: CardDef, holder: 0 | 1, shipDef = 'plain-ship') {
		let s = fresh()
		s = place(s, def.id, ID('cloak'), { k: 'FLEET', seat: holder }, holder)
		s = place(s, shipDef, SHIP, { k: 'STAGING', seat: 0 }, 0)
		return s
	}

	for (const def of [PROTO, CLOAKDEV]) {
		it(`${def.cardId}: deploying a SHIP without CLOAK offers the reaction; the SHIP is CLOAK until end of turn`, () => {
			const s = pushAndRun(setup(def, 0), deployShip, SRC, 0)
			expect(s.cards[SHIP]!.zone).toEqual({ k: 'FLEET', seat: 0 })
			const ch = s.pendingChoice
			if (ch === null || ch.k !== 'OPTIONAL_TRIGGERS')
				throw new Error('expected OPTIONAL_TRIGGERS window')
			expect(ch.seat).toBe(0)
			expect(ch.offered).toEqual([{ card: ID('cloak'), opIndex: 1, seat: 0 }])
			expect(
				matchTrait(s, SHIP, 'CLOAK', {
					allowWildcard: false,
					actorMayOptIn: false,
				}),
			).toBe(false)

			const fin = takeAll(s)
			expect(fin.stack).toEqual([])
			const strict = { allowWildcard: false, actorMayOptIn: false }
			// every trait check sees the grant
			expect(matchTrait(fin, SHIP, 'CLOAK', strict)).toBe(true)
			expect(cardTraits(fin, SHIP)).toContain('CLOAK')
			expect(
				resolveQuery(
					fin,
					{ zones: [{ k: 'FLEET', seat: 0 }], filter: { traits: ['CLOAK'] } },
					{ actor: 0, source: SRC, bindings: {} },
				),
			).toContain(SHIP)
			expect(
				evalPredicate(
					fin,
					{ k: 'HAS_TRAIT_IN_PLAY', trait: 'CLOAK', count: 2 },
					{ actor: 0, source: SRC, bindings: {} },
				),
			).toBe(true) // the cargo itself + the ship
			expect(
				resolveQuery(
					fin,
					{
						zones: [{ k: 'FLEET', seat: 0 }],
						filter: { allTraits: ['CLOAK'], suits: ['SHIP'] },
					},
					{ actor: 0, source: SRC, bindings: {} },
				),
			).toEqual([SHIP])
			// the layer is the acting player's, sourced from the SHIP
			expect(fin.players[0]!.modifiers).toContainEqual({
				id: 'TEMP_CLOAK',
				source: SHIP,
			})
			// "for the remainder of your turn" — the Clean-up REFRESH substep drops it
			const next = dropTurnModifiers(fin, 0)
			expect(matchTrait(next, SHIP, 'CLOAK', strict)).toBe(false)
		})
	}

	it("does not fire on the opponent's deploy (seat SELF default)", () => {
		const s = pushAndRun(setup(PROTO, 1), deployShip, SRC, 0)
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[SHIP]!.zone).toEqual({ k: 'FLEET', seat: 0 })
	})

	it('does not fire for a SHIP that already has CLOAK', () => {
		const s = pushAndRun(setup(PROTO, 0, 'cloak-ship'), deployShip, SRC, 0)
		expect(s.pendingChoice).toBeNull()
	})

	it('no longer fires on putting a SHIP into play (a play is not a deploy)', () => {
		let s = fresh()
		s = place(s, PROTO.id, ID('cloak'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'plain-ship', SHIP, { k: 'STAGING', seat: 0 }, 0)
		expect(
			drainWith(s, { k: 'PUT_INTO_PLAY', iid: SHIP, seat: 0 }).pendingChoice,
		).toBeNull()
	})

	it('the grant drops with the SHIP when it leaves play', () => {
		const fin = takeAll(pushAndRun(setup(PROTO, 0), deployShip, SRC, 0))
		expect(fin.players[0]!.modifiers.some((m) => m.source === SHIP)).toBe(true)
		const gone = pushAndRun(
			fin,
			{
				k: 'DISMISS',
				target: {
					zones: [{ k: 'FLEET', seat: 0 }],
					filter: { ids: ['plain-ship'] },
				},
			},
			SRC,
			0,
		)
		expect(gone.cards[SHIP]!.zone.k).toBe('DISCARD')
		expect(gone.players[0]!.modifiers.some((m) => m.source === SHIP)).toBe(
			false,
		)
	})

	it('describe() renders the deploy trigger', () => {
		expect(describeTrigger(PROTO.operations[1]!.trigger!)).toBe(
			'After deploying a non-CLOAK SHIP',
		)
	})
})

describe('trigger seat scoping — owner-only by default', () => {
	const ev = (
		k: 'PUT_INTO_PLAY' | 'CARD_LOGGED' | 'CARD_PLAYED' | 'CARD_DEPLOYED',
		seat: 0 | 1,
	): GameEvent => ({
		k,
		iid: ID('cc'),
		seat,
	})
	const base = place(
		fresh(),
		'cloak-cargo',
		ID('cc'),
		{ k: 'STAGING', seat: 1 },
		1,
	)

	for (const on of [
		'PUT_INTO_PLAY',
		'CARD_LOGGED',
		'CARD_PLAYED',
		'CARD_DEPLOYED',
	] as const) {
		it(`${on}: SELF by default, OPPONENT / ANY on request`, () => {
			const t = (seat?: 'SELF' | 'OPPONENT' | 'ANY'): TriggerSpec =>
				({ on, ...(seat !== undefined ? { seat } : {}) }) as TriggerSpec
			expect(matchesTrigger(base, ev(on, 0), t(), 0)).toBe(true)
			expect(matchesTrigger(base, ev(on, 1), t(), 0)).toBe(false)
			expect(matchesTrigger(base, ev(on, 1), t('OPPONENT'), 0)).toBe(true)
			expect(matchesTrigger(base, ev(on, 0), t('OPPONENT'), 0)).toBe(false)
			expect(matchesTrigger(base, ev(on, 1), t('ANY'), 0)).toBe(true)
		})
	}

	it("1SEL16: only the owner's CLOAK put into play pays 1 LAT", () => {
		let s = fresh()
		s = place(s, TRUL.id, ID('trul'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'cloak-cargo', ID('cc'), { k: 'STAGING', seat: 1 }, 1)
		expect(
			drainWith(s, { k: 'PUT_INTO_PLAY', iid: ID('cc'), seat: 1 })
				.pendingChoice,
		).toBeNull()
		const mine = place(
			s,
			'cloak-cargo',
			ID('cc0'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		const fin = takeAll(
			drainWith(mine, { k: 'PUT_INTO_PLAY', iid: ID('cc0'), seat: 0 }),
		)
		expect(fin.players[0]!.resources.LAT).toBe(1)
	})
})

describe('1SIS06 — recalls itself when the opponent gains INFLUENCE/MILITARY', () => {
	const t = MINES.operations[2]!.trigger!
	const adv = (
		seat: 0 | 1,
		specialty: 'RESEARCH' | 'INFLUENCE' | 'MILITARY',
		amount = 1,
	): GameEvent => ({ k: 'SPECIALTY_ADVANCED', seat, specialty, amount })

	it('matches only the opponent, only INFLUENCE/MILITARY, only a real gain', () => {
		const s = fresh()
		expect(matchesTrigger(s, adv(1, 'INFLUENCE'), t, 0)).toBe(true)
		expect(matchesTrigger(s, adv(1, 'MILITARY'), t, 0)).toBe(true)
		expect(matchesTrigger(s, adv(1, 'RESEARCH'), t, 0)).toBe(false)
		expect(matchesTrigger(s, adv(0, 'INFLUENCE'), t, 0)).toBe(false)
		expect(matchesTrigger(s, adv(1, 'INFLUENCE', 0), t, 0)).toBe(false)
		expect(describeTrigger(t)).toBe(
			'After your opponent gains INFLUENCE/MILITARY',
		)
	})

	it('taking the reaction recalls the deployed Mines to hand', () => {
		let s = fresh()
		s = place(s, MINES.id, ID('mines'), { k: 'FLEET', seat: 0 }, 0)
		const fin = takeAll(drainWith(s, adv(1, 'MILITARY')))
		expect(fin.cards[ID('mines')]!.zone).toEqual({ k: 'HAND', seat: 0 })
	})
})

describe('1PER22 — 1 DIL each time you take or return an INCIDENT', () => {
	it('fires on the owner taking AND returning an Incident, never the opponent', () => {
		let s = fresh()
		s = place(s, SUKAL.id, ID('sukal'), { k: 'FLEET', seat: 0 }, 0)
		s = setResources(s, 0, 'DIL', 0)
		const inc = ID('inc') as CardInstanceId
		let out = drainWith(s, { k: 'INCIDENT_TAKEN', iid: inc, seat: 0 })
		expect(out.players[0]!.resources.DIL).toBe(1)
		out = drainWith(out, { k: 'CARD_RETURNED_INCIDENT', iid: inc, seat: 0 })
		expect(out.players[0]!.resources.DIL).toBe(2)
		out = drainWith(out, { k: 'CARD_RETURNED_INCIDENT', iid: inc, seat: 1 })
		expect(out.players[0]!.resources.DIL).toBe(2)
		// a plain INCIDENT_TAKEN trigger ignores returns; INCIDENT_RETURNED matches them
		const ret: GameEvent = { k: 'CARD_RETURNED_INCIDENT', iid: inc, seat: 0 }
		expect(matchesTrigger(s, ret, { on: 'INCIDENT_TAKEN' }, 0)).toBe(false)
		expect(matchesTrigger(s, ret, { on: 'INCIDENT_RETURNED' }, 0)).toBe(true)
	})
})

describe('1PER18 — trigger on a send to a neutral LOCATION', () => {
	it('matches only a send to a Neutral Zone Location', () => {
		let s = fresh()
		s = place(s, 'neutral-loc', ID('nz'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'neutral-loc', ID('mine'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		const t = per18.operations[2]!.trigger!
		const sent = (loc: string): GameEvent => ({
			k: 'AWAY_TEAM_SENT',
			seat: 0,
			location: loc,
			count: 1,
		})
		expect(matchesTrigger(s, sent('nz'), t, 0)).toBe(true)
		expect(matchesTrigger(s, sent('mine'), t, 0)).toBe(false)
		expect(matchesTrigger(s, { ...sent('nz'), seat: 1 }, t, 0)).toBe(false)
		expect(matchesTrigger(s, sent('mine'), { on: 'AWAY_TEAM_SENT' }, 0)).toBe(
			true,
		)
	})
})

describe('1SHI06 — trigger on a gain that lands on the deck top', () => {
	it('matches only a deck-top gain; GAIN_CARD stamps the destination', () => {
		const s = fresh()
		const t = KAZON.operations[3]!.trigger!
		const gained = (dest?: 'DECK_TOP' | 'DISCARD'): GameEvent => ({
			k: 'CARD_GAINED',
			iid: ID('g'),
			seat: 0,
			...(dest !== undefined ? { dest } : {}),
		})
		expect(matchesTrigger(s, gained('DECK_TOP'), t, 0)).toBe(true)
		expect(matchesTrigger(s, gained('DISCARD'), t, 0)).toBe(false)
		expect(matchesTrigger(s, gained(), t, 0)).toBe(false)
		expect(matchesTrigger(s, { ...gained('DECK_TOP'), seat: 1 }, t, 0)).toBe(
			false,
		)
		expect(describeTrigger(t)).toBe('After gaining a card onto your deck top')
	})
})
