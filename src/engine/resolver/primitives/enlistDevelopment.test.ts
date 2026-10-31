// ENLIST_DEVELOPMENT (rules/08, rules/04 §4.2): pay the development cost
// unless `free`, then the card becomes the top of the Draw deck. A pick among
// several Developments must pay exactly like a single, auto-picked one.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	setResources,
	ID,
} from '../testUtils'
import { applyChoice } from '../choices'
import { run } from '../stack'
import { assertSerialisable } from '../../invariants'
import type { Effect } from '../nodes'
import type { GameState, JsonValue } from '../../state'

function devState(...iids: string[]): GameState {
	register([
		makeDef({
			id: 'enl-dev',
			suit: 'DIRECTIVE',
			operations: [],
			developmentCost: { k: 'COST_RESOURCE', res: 'LAT', amount: 2 },
		}),
		makeDef({
			id: 'enl-dev2',
			suit: 'DIRECTIVE',
			operations: [],
			developmentCost: {
				k: 'SEQ',
				steps: [
					{ k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
					{ k: 'COST_RESOURCE', res: 'LAT', amount: 2 },
				],
			},
		}),
	])
	let s = setResources(fresh(), 0, 'LAT', 5)
	for (const iid of iids)
		s = place(s, 'enl-dev', ID(iid), { k: 'DEVELOPMENT', seat: 0 }, 0)
	return s
}

function answer(s: GameState, selection: JsonValue): GameState {
	return run(
		applyChoice(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: s.pendingChoice!.id,
			selection,
		}),
	)
}

const lat = (s: GameState) => s.players[0].resources.LAT

describe('ENLIST_DEVELOPMENT', () => {
	it('a single Development is auto-picked and pays its cost', () => {
		const s = devState('dv')
		const out = pushAndRun(s, { k: 'ENLIST_DEVELOPMENT' }, ID('src'), 0)
		expect(out.pendingChoice).toBeNull()
		expect(lat(out)).toBe(3)
		expect(out.zones['DRAW:0']?.[0]).toBe('dv')
		expect(out.stack).toHaveLength(0)
	})

	it('a Development picked from several pays its cost too', () => {
		const s = devState('dv', 'dw')
		const halted = pushAndRun(s, { k: 'ENLIST_DEVELOPMENT' }, ID('src'), 0)
		assertSerialisable(halted)
		expect(halted.pendingChoice?.k).toBe('CHOOSE_CARDS')
		const out = answer(halted, ['dw'])
		expect(out.pendingChoice).toBeNull()
		expect(lat(out)).toBe(3)
		expect(out.zones['DRAW:0']?.[0]).toBe('dw')
		expect(out.zones['DEVELOPMENT:0']).toEqual(['dv'])
		expect(out.stack).toHaveLength(0)
	})

	it('a picked Development pays the discounted cost, with the "or" split offered', () => {
		let s = devState('dv')
		s = place(s, 'enl-dev2', ID('dx'), { k: 'DEVELOPMENT', seat: 0 }, 0)
		s = setResources(setResources(s, 0, 'DIL', 2), 0, 'LAT', 2)
		const node: Effect = {
			k: 'ENLIST_DEVELOPMENT',
			discount: [{ res: ['DIL', 'LAT'], amount: 1 }],
		}
		const halted = pushAndRun(s, node, ID('src'), 0)
		expect(halted.pendingChoice?.k).toBe('CHOOSE_CARDS')
		const split = answer(halted, ['dx'])
		const c = split.pendingChoice
		expect(c?.k).toBe('CHOOSE_OPTION')
		if (c?.k !== 'CHOOSE_OPTION') return
		const out = answer(split, {
			key: c.options.find((o) => /LAT/.test(o.label))!.key,
		})
		expect(out.pendingChoice).toBeNull()
		expect(out.players[0].resources.DIL).toBe(0)
		expect(lat(out)).toBe(1)
		expect(out.zones['DRAW:0']?.[0]).toBe('dx')
	})

	it('a `free` enlist picked from several pays nothing', () => {
		const s = devState('dv', 'dw')
		const halted = pushAndRun(
			s,
			{ k: 'ENLIST_DEVELOPMENT', free: true },
			ID('src'),
			0,
		)
		expect(halted.pendingChoice?.k).toBe('CHOOSE_CARDS')
		const out = answer(halted, ['dw'])
		expect(out.pendingChoice).toBeNull()
		expect(lat(out)).toBe(5)
		expect(out.zones['DRAW:0']?.[0]).toBe('dw')
		expect(out.zones['DEVELOPMENT:0']).toEqual(['dv'])
	})
})
