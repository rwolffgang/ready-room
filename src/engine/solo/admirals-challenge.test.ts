// The Conspiring Admirals challenge (rules/13 §13.14): the SURPRISE solo
// Directive (1DIR01/2) joins the Bot deck; when the Bot flips it, its
// SURPRISE operation makes YOU choose — take an INCIDENT and the card itself
// into your deck, or let the Bot gain 2 {GLO} and lose its top Supplement
// card — and before scoring it is destroyed if the Bot owns it or it is logged.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { setup, type CardCatalog } from '../setup'
import { reduce } from '../intents'
import { cardDef } from '../cards'
import { moveCard } from '../resolver/runtime'
import { finalizeGame } from '../scoring'
import { handOffTurn } from '../phases'
import { run } from '../resolver/stack'
import type { GameState } from '../state'
import type { CardInstanceId } from '../ids'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

const CHALLENGE = '1DIR01/2'

function iid(s: GameState, cardId: string): CardInstanceId {
	return Object.values(s.cards).find((c) => cardDef(c.def).cardId === cardId)!
		.iid
}

/** A Captain-level game with the challenge, the challenge card on top of the
 *  Bot deck, at the start of the Bot's turn. */
function board(conspiringAdmirals = true): GameState {
	let s = setup(
		{
			mode: 'SOLO',
			players: [
				{ deck: 'SHR', boardSide: 'BASIC' },
				{ deck: 'SEL', boardSide: 'BASIC' },
			],
			seed: 5,
			solo: { level: 'CAPTAIN', conspiringAdmirals },
		},
		catalog,
	)
	if (!conspiringAdmirals) return s
	s = moveCard(s, iid(s, CHALLENGE), { k: 'DRAW', seat: 1 }, { toTop: true })
	return { ...s, phase: { k: 'BOT', beat: 'CONTROL' }, activeSeat: 1 }
}

/** Draw the row, flip the challenge card, answer its choice with option `n`. */
function surprise(n: number): GameState {
	let s = board()
	s = reduce(s, { t: 'BOT_STEP' }).state // draw the row
	s = reduce(s, { t: 'BOT_STEP' }).state // flip: its SURPRISE asks you
	const c = s.pendingChoice
	if (c?.k !== 'CHOOSE_OPTION') throw new Error(`expected your choice, got ${c?.k}`)
	expect(c.seat).toBe(0)
	const key = c.options.filter((o) => o.enabled)[n]!.key
	return reduce(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection: { key } }).state
}

describe('the Conspiring Admirals challenge (rules/13 §13.14)', () => {
	it('is in the Bot deck only with the challenge on', () => {
		expect(board(false).cards[iid(board(false), CHALLENGE)]!.zone).toEqual({ k: 'BOX' })
		const s = setup(
			{
				mode: 'SOLO',
				players: [
					{ deck: 'SHR', boardSide: 'BASIC' },
					{ deck: 'SEL', boardSide: 'BASIC' },
				],
				seed: 5,
				solo: { level: 'CAPTAIN', conspiringAdmirals: true },
			},
			catalog,
		)
		expect(s.cards[iid(s, CHALLENGE)]!.zone).toEqual({ k: 'DRAW', seat: 1 })
	})

	it('your first option: an INCIDENT and the card itself go under your deck', () => {
		const s = surprise(0)
		const card = s.cards[iid(s, CHALLENGE)]!
		expect(card.owner).toBe(0)
		expect(s.zones['DRAW:0']?.at(-1)).toBe(card.iid)
		const second = s.zones['DRAW:0']?.at(-2)
		expect(cardDef(s.cards[second!]!.def).suit).toBe('INCIDENT')
	})

	it('your second option: the Bot gains 2 {GLO} and discards its top Supplement card', () => {
		const before = board()
		const supp = before.zones['SUPPLEMENT:1']![0]!
		const s = surprise(1)
		expect(s.players[1].resources.GLO).toBe(2)
		expect(s.zones['DISCARD:1']).toContain(supp)
	})

	it('is destroyed before scoring when the Bot owns it — never when it is yours', () => {
		/** End the game the real way: the last turn hands off, the "before
		 *  scoring" SPECIALs run, then final scoring. */
		const finish = (s: GameState) => {
			let t: GameState = {
				...s,
				stack: [],
				pendingChoice: null,
				resolutionTriggered: true,
				turnsAfterResolution: 1,
			}
			t = run(handOffTurn(t, 1))
			return finalizeGame(t)
		}
		const vpOf = (s: GameState, seat: 0 | 1) =>
			s.result?.kind === 'COMPLETE'
				? s.result.scoreboard.breakdown[seat].printedVp
				: []
		// still the Bot's: destroyed, so it never costs the Bot its 4 VP
		const bots = finish(board())
		expect(bots.cards[iid(bots, CHALLENGE)]!.zone).toEqual({ k: 'BOX' })
		expect(vpOf(bots, 1).some((p) => p.card === iid(bots, CHALLENGE))).toBe(false)
		// yours (taken with the INCIDENT, never logged): it stays, −4 for you
		const yours = finish(surprise(0))
		expect(vpOf(yours, 0)).toContainEqual({ card: iid(yours, CHALLENGE), vp: -4 })
	})
})
