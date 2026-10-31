// Which Automated Command row resolves a card (rules/13 §13.6.1), against the
// real Bot data: the first TRAITS row naming one of its traits wins, a
// WILDCARD card takes the first row, otherwise the SUITS row on the side the
// Duty Officer decides; a SURPRISE card runs its own operation.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { registerBots } from './acRegistry'
import { classify } from './classify'
import { fresh, register, makeDef, op, place, ID } from '../resolver/testUtils'
import type { GameState } from '../state'

beforeAll(async () => {
	registerBots((await loadCatalog()).bots ?? [])
	register([
		// the rulebook's own example traits (solo p.5): ATTACK + KLINGON + …
		makeDef({
			id: 'person4',
			suit: 'PERSON',
			traits: ['ATTACK', 'KLINGON', 'SECURITY', 'STARFLEET'],
			operations: [],
		}),
		makeDef({
			id: 'ship3',
			suit: 'SHIP',
			traits: ['ANOMALY', 'STARFLEET', 'TIME_TRAVEL'],
			operations: [],
		}),
		makeDef({ id: 'wild', suit: 'CARGO', traits: ['WILDCARD'], operations: [] }),
		makeDef({
			id: 'surprise',
			suit: 'DIRECTIVE',
			traits: ['SURPRISE'],
			operations: [op('SURPRISE', { k: 'NOOP' })],
		}),
	])
})

/** A solo state whose Bot (seat 1) plays `crew`. */
function solo(crew: 'PIC' | 'KOL'): GameState {
	return {
		...fresh(),
		mode: 'SOLO',
		solo: { bot: 1, crew, level: 'COMMANDER', conspiringAdmirals: false, marketOwned: [] },
	}
}

describe('classify (rules/13 §13.6.1)', () => {
	it('takes the first TRAITS row naming one of the traits (KLINGON over ATTACK)', () => {
		const s = place(solo('PIC'), 'person4', ID('p'), { k: 'STAGING', seat: 1 }, 1)
		expect(classify(s, ID('p'), 1)).toEqual({ deck: 'PIC', trait: 1 })
	})

	it('falls back to the SUITS row, on the Duty Officer side', () => {
		let s = place(solo('PIC'), 'ship3', ID('s'), { k: 'STAGING', seat: 1 }, 1)
		expect(classify(s, ID('s'), 1)).toEqual({ deck: 'PIC', suit: 'SHIP', do: false })
		s = place(s, 'person4', ID('do'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		expect(classify(s, ID('s'), 1)).toEqual({ deck: 'PIC', suit: 'SHIP', do: true })
	})

	it('a WILDCARD card takes the first TRAITS row; a SURPRISE card its own operation', () => {
		let s = place(solo('KOL'), 'wild', ID('w'), { k: 'STAGING', seat: 1 }, 1)
		expect(classify(s, ID('w'), 1)).toEqual({ deck: 'KOL', trait: 0 })
		s = place(s, 'surprise', ID('x'), { k: 'STAGING', seat: 1 }, 1)
		expect(classify(s, ID('x'), 1)).toEqual({ deck: 'KOL', surprise: true })
	})
})
