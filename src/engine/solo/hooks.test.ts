// Your cards against the official solo Bot (rules/13 §13.12) and its scoring
// (§13.13): every hook where the Bot differs from a player — steal, draw,
// take, recall, logging an INCIDENT, inert cards — and the solo win rules.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	op,
	place,
	ID,
	pushAndRun,
	setResources,
} from '../resolver/testUtils'
import { finalizeGame } from '../scoring'
import type { Effect } from '../resolver/nodes'
import type { GameState } from '../state'

register([
	makeDef({ id: 'hPerson', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'hShip', suit: 'SHIP', operations: [] }),
	makeDef({ id: 'hIncident', suit: 'INCIDENT', vp: -2, operations: [] }),
	makeDef({
		id: 'hEndgame',
		suit: 'ALLY',
		vp: 1,
		operations: [op('ENDGAME', { k: 'SCORE_VP', amount: 3 })],
	}),
	makeDef({
		id: 'hReactor',
		suit: 'PERSON',
		operations: [
			op('PASSIVE', { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 }, {
				trigger: { on: 'SPECIALTY_ADVANCED' },
			}),
		],
	}),
])

/** A minimal solo state: the Bot sits at seat 1. */
function solo(): GameState {
	return {
		...fresh(),
		mode: 'SOLO',
		solo: { bot: 1, crew: 'KOL', level: 'ENSIGN', conspiringAdmirals: false, marketOwned: [] },
	}
}

/** Run `node` as YOU (seat 0); a FORCE/OPPONENT inside acts as the Bot. */
const you = (s: GameState, node: Effect) => pushAndRun(s, node, ID('src'), 0)
const zone = (s: GameState, key: string) => s.zones[key] ?? []

describe('your effects on the Bot (rules/13 §13.12)', () => {
	it('a steal always succeeds in full, from the supply', () => {
		const s = you(solo(), { k: 'STEAL', res: 'GLO', amount: 2 })
		expect(s.players[0].resources.GLO).toBe(2)
		expect(s.players[1].resources.GLO).toBe(0)
	})

	it('"your opponent draws" discards the top of the Bot deck', () => {
		let s = place(solo(), 'hPerson', ID('a'), { k: 'DRAW', seat: 1 }, 1)
		s = place(s, 'hPerson', ID('b'), { k: 'DRAW', seat: 1 }, 1)
		s = you(s, { k: 'OPPONENT', body: { k: 'DRAW', count: 1 } })
		expect(zone(s, 'DISCARD:1')).toEqual(['a'])
		expect(zone(s, 'HAND:1')).toEqual([])
	})

	it('a card it is forced to take goes on top of its deck', () => {
		let s = place(solo(), 'hIncident', ID('inc'), { k: 'INCIDENT_DECK' })
		s = place(s, 'hPerson', ID('d'), { k: 'DRAW', seat: 1 }, 1)
		s = you(s, { k: 'FORCE', body: { k: 'TAKE', deck: 'INCIDENT', count: 1 } })
		expect(zone(s, 'DRAW:1')[0]).toBe('inc')
		expect(s.cards[ID('inc')]!.owner).toBe(1)
	})

	it('a recalled SHIP or Duty Officer is discarded, not taken into a hand', () => {
		let s = place(solo(), 'hShip', ID('ship'), { k: 'FLEET', seat: 1 }, 1)
		s = you(s, {
			k: 'FORCE',
			body: { k: 'RECALL', target: { zones: [{ k: 'FLEET', seat: 0 }] } },
		})
		expect(zone(s, 'DISCARD:1')).toEqual(['ship'])
	})

	it('when the Bot would log an INCIDENT, it returns it instead', () => {
		let s = place(solo(), 'hIncident', ID('inc'), { k: 'DISCARD', seat: 1 }, 1)
		s = pushAndRun(
			s,
			{ k: 'LOG', target: { zones: [{ k: 'DISCARD', seat: 0 }] } },
			ID('src'),
			1,
		)
		expect(zone(s, 'LOG:1')).toEqual([])
		expect(zone(s, 'INCIDENT_DECK')).toEqual(['inc'])
	})

	it('its own cards never trigger: a Bot PASSIVE stays silent', () => {
		const gain: Effect = { k: 'ADVANCE_SPECIALTY', specialty: 'MILITARY', amount: 1 }
		// the same card fires for you …
		let mine = place(solo(), 'hReactor', ID('r'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		mine = you(mine, gain)
		expect(mine.players[0].resources.GLO).toBe(1)
		// … but not for the Bot
		let its = place(solo(), 'hReactor', ID('r'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		its = pushAndRun(its, gain, ID('src'), 1)
		expect(its.players[1].specialties.MILITARY).toBe(1)
		expect(its.players[1].resources.GLO).toBe(0)
	})
})

describe('the Bot’s score and the solo result (rules/13 §13.13)', () => {
	const ended = (s: GameState, kind: 'BURN' | 'FINAL_SCORING') =>
		finalizeGame({ ...s, result: { kind } })

	it('5 VP per ENDGAME it owns, in play or not; resources 1 per 2; no missions', () => {
		let s = place(solo(), 'hEndgame', ID('e1'), { k: 'DISCARD', seat: 1 }, 1)
		s = place(s, 'hEndgame', ID('e2'), { k: 'SUPPLEMENT', seat: 1 }, 1) // never scores
		s = setResources(setResources(s, 1, 'DIL', 3), 1, 'LAT', 2)
		s = ended(s, 'FINAL_SCORING')
		if (s.result?.kind !== 'COMPLETE') throw new Error('not complete')
		const bot = s.result.scoreboard.breakdown[1]
		expect(bot.endgame.map((e) => e.vp)).toEqual([5])
		expect(bot.printedVp.map((p) => p.vp)).toEqual([1])
		expect(bot.resourcesVp).toBe(2)
		expect(bot.total).toBe(8)
	})

	it('you win only with more VP: a tie goes to the Bot', () => {
		let s = setResources(solo(), 0, 'GLO', 3)
		s = setResources(s, 1, 'GLO', 3)
		const tie = ended(s, 'FINAL_SCORING')
		expect(tie.result?.kind === 'COMPLETE' && tie.result.scoreboard.winners).toEqual([1])
		const win = ended(setResources(s, 0, 'GLO', 4), 'FINAL_SCORING')
		expect(win.result?.kind === 'COMPLETE' && win.result.scoreboard.winners).toEqual([0])
	})

	it('the Burn is the Bot’s win, whatever the INCIDENT counts', () => {
		let s = place(solo(), 'hIncident', ID('i'), { k: 'HAND', seat: 1 }, 1)
		s = ended(s, 'BURN')
		expect(s.result?.kind === 'COMPLETE' && s.result.scoreboard.winners).toEqual([1])
	})
})
