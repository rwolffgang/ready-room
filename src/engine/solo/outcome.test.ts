// "You choose the outcome" (rules/13 §13.12.2) with the solo rulebook's own
// two examples, on the real cards (by id): a "you may discard an ATTACK from
// their hand to gain 1 {GLO}" just gains the Glory (Example 1); a forced
// "log a PERSON from hand or Discard — if they do they draw, if they cannot
// they take an INCIDENT" lets you pick either branch (Example 2).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, type CardDef } from '../../data/schema'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setActions,
	setSpecialty,
} from '../resolver/testUtils'
import { run } from '../resolver/stack'
import { applyChoice } from '../resolver/choices'
import { firstLegalSelection } from '../intents'
import { soloChoice } from './policy'
import type { GameState } from '../state'
import type { CardInstanceId } from '../ids'

const real = new Map<string, CardDef>()
for (const f of ['common/cargo', 'common/person']) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../../data/cards/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) real.set(def.cardId, def)
}
register([
	...real.values(),
	makeDef({ id: 'oPerson', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'oIncident', suit: 'INCIDENT', operations: [] }),
])
const def = (cardId: string) => real.get(cardId)!.id

function solo(): GameState {
	return {
		// 3 actions and the Influence 3 the forced-log card requires
		...setSpecialty(setActions(fresh(), 0, 3), 0, 'INFLUENCE', 3),
		mode: 'SOLO',
		solo: { bot: 1, crew: 'KOL', level: 'ENSIGN', conspiringAdmirals: false, marketOwned: [] },
	}
}

/** Play YOUR card's first PLAY operation; you accept every "may", answer the
 *  outcome question with `outcome`; the Bot answers its own choices. */
function playYours(
	state: GameState,
	card: CardInstanceId,
	outcome: 'YES' | 'NO',
): { state: GameState; asked: number } {
	let s: GameState = {
		...state,
		stack: [
			...state.stack,
			{
				k: 'OPERATION',
				card,
				opIndex: 0,
				ctx: { actor: 0, source: card, bindings: {} },
				phase: 0,
			},
		],
	}
	s = run(s)
	let asked = 0
	for (let guard = 0; s.pendingChoice !== null && guard < 30; guard++) {
		const c = s.pendingChoice
		let selection: unknown
		if (c.seat === 1) selection = soloChoice(s, c)
		else if (c.k === 'CONFIRM') selection = true
		else if (c.k === 'CHOOSE_OPTION' && c.options.some((o) => o.key === 'YES')) {
			asked++
			selection = { key: outcome }
		} else selection = firstLegalSelection(s)
		s = run(applyChoice(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection }))
	}
	return { state: s, asked }
}

describe('your hand attacks on the Bot (rules/13 §13.12.2)', () => {
	it('Example 1: "discard an ATTACK from their hand to gain 1 {GLO}" just gains it', () => {
		let s = place(solo(), def('1CAR09/16'), ID('mine'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'oPerson', ID('h'), { k: 'HAND', seat: 0 }, 0) // for its own cost
		const r = playYours(s, ID('mine'), 'YES')
		expect(r.state.players[0].resources.GLO).toBe(1)
		expect(r.asked).toBe(0) // accepting the "may" was the choice
	})

	it('Example 2: you choose — the Bot "draws" (mills) or takes an INCIDENT', () => {
		const board = () => {
			let s = place(solo(), def('1PER08/25'), ID('mine'), { k: 'STAGING', seat: 0 }, 0)
			s = place(s, 'oPerson', ID('p'), { k: 'DISCARD', seat: 1 }, 1)
			s = place(s, 'oPerson', ID('top'), { k: 'DRAW', seat: 1 }, 1)
			return place(s, 'oIncident', ID('inc'), { k: 'INCIDENT_DECK' })
		}
		const yes = playYours(board(), ID('mine'), 'YES')
		expect(yes.asked).toBe(1)
		expect(yes.state.zones['LOG:1'] ?? []).toEqual([]) // the log itself has no effect
		expect(yes.state.zones['DISCARD:1']).toContain('top') // its "draw" mills
		expect(yes.state.zones['DRAW:1'] ?? []).toEqual([])
		const no = playYours(board(), ID('mine'), 'NO')
		expect(no.state.zones['DRAW:1']?.[0]).toBe('inc') // took the INCIDENT
	})
})
