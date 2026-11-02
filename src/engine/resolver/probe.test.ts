// §11 Probe mode (docs/state-machine.md §5, todo/04 §11):
//   - probe(state, node, ctx) runs against a structuredClone'd state;
//   - the real state is never mutated (byte-compared before/after);
//   - PendingChoice resolves to "is there at least one legal selection?" via
//     probeFirstChoice (auto-picks the first option);
//   - a cost that cannot be paid reports false (FAILED log under probe);
//   - no events/reactions fire out of the probe.

import { describe, expect, it } from 'vitest'
import type { Effect } from './nodes'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setResources,
	setSpecialty,
} from './testUtils'
import { probe } from './probe'
import { probeFirstChoice } from './choices'
import { pushAndRun } from './testUtils'

const CTX = { actor: 0 as 0 | 1, source: ID('src'), bindings: {} }

describe('probe: side-effect free', () => {
	it('never mutates the caller state (byte-identical)', () => {
		let s = setResources(fresh(), 0, 'DIL', 0)
		s = place(s, 'gainme', ID('x'), { k: 'HAND', seat: 0 }, 0)
		const before = JSON.stringify(s)
		const ok = probe(s, { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 }, CTX)
		expect(ok).toBe(true)
		expect(JSON.stringify(s)).toBe(before)
	})

	it('works even when the node would need several choices', () => {
		register([
			makeDef({ id: 'cargo', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'handcard', suit: 'PERSON', operations: [] }),
			makeDef({
				id: 'recruiter',
				suit: 'PERSON',
				operations: [
					{
						type: 'PLAY',
						costsAction: false,
						isAttack: false,
						text: 't',
						effect: {
							k: 'SEQ',
							steps: [
								{ k: 'GAIN_CARD', suits: ['CARGO'] }, // 2 offers → choice (auto-picked)
								{ k: 'DISCARD', from: 'HAND', count: 1 }, // 2 cards → choice (auto-picked)
								{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
							],
						},
					},
				],
			}),
		])
		let s = fresh()
		s = place(s, 'cargo', ID('c1'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('c2'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'handcard', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'handcard', ID('h2'), { k: 'HAND', seat: 0 }, 0)
		const before = JSON.stringify(s)
		const ok = probe(
			s,
			{
				k: 'SEQ',
				steps: [
					{ k: 'GAIN_CARD', suits: ['CARGO'] },
					{ k: 'DISCARD', from: 'HAND', count: 1 },
					{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
				],
			},
			CTX,
		)
		expect(ok).toBe(true)
		expect(JSON.stringify(s)).toBe(before)
	})

	it('a payable cost probes true with no mutation leakage', () => {
		const s = setResources(fresh(), 0, 'DIL', 5)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
			body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
		}
		expect(probe(s, node, CTX)).toBe(true)
		expect(s.players[0]!.resources.DIL).toBe(5) // NOT spent
	})
})

describe('probe: resolvability signals', () => {
	it('an unpayable cost probes false', () => {
		const s = setResources(fresh(), 0, 'DIL', 1)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
			body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
		}
		expect(probe(s, node, CTX)).toBe(false)
	})

	it('a CHOOSE_ONE with zero resolvable options skips but stays playable (probe true)', () => {
		// §6: no resolvable option -> the benefit is skipped, not a failure. Probe
		// answers "can this be resolved" — a never-failing skip is still legal, so
		// probe returns true and logs SKIPPED (the canPlay surface can report why).
		const node: Effect = {
			k: 'CHOOSE_ONE',
			options: [
				{ label: 'a', body: { k: 'GAIN_CARD', suits: ['CARGO'] } }, // empty offer
				{ label: 'b', body: { k: 'GAIN_CARD', suits: ['CARGO'] } }, // empty offer
			],
		}
		expect(probe(fresh(), node, CTX)).toBe(true)
	})

	it('probe auto-picks the first legal selection for a choice-bearing benefit', () => {
		register([makeDef({ id: 'cargo', suit: 'CARGO', operations: [] })])
		let s = fresh()
		s = place(s, 'cargo', ID('c1'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('c2'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		// GAIN_CARD with 2 offers would suspend a real run; probe auto-picks the
		// first candidate and completes without touching the caller's state.
		const before = JSON.stringify(s)
		expect(probe(s, { k: 'GAIN_CARD', suits: ['CARGO'] }, CTX)).toBe(true)
		expect(JSON.stringify(s)).toBe(before)
	})
})

describe('probe: first LEGAL selection per choice kind (todo/07)', () => {
	it('CHOOSE_CARDS picks the first legal candidate, never a disabled one, without mutating the real state', () => {
		register([makeDef({ id: 'warship', suit: 'SHIP', operations: [] })])
		let s = fresh()
		s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'warship', ID('w1'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'warship', ID('w2'), { k: 'FLEET', seat: 0 }, 0)
		// a choice over the three ships where w2 is deliberately NOT a legal target
		const choice = {
			k: 'CHOOSE_CARDS' as const,
			id: 'c1',
			seat: 0 as const,
			prompt: 'p',
			sourceCard: ID('src'),
			candidates: [ID('w0'), ID('w1'), ID('w2')],
			disabled: [{ iid: ID('w2'), reason: 'not a legal dismissal target' }],
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		}
		s = {
			...s,
			pendingChoice: choice,
			stack: [{ k: 'EFFECT', node: { k: 'NOOP' }, ctx: CTX, ip: 0 }],
		}
		const before = JSON.stringify(s)
		const probeState = structuredClone(s) as typeof s
		const resolved = probeFirstChoice(probeState)
		const top = resolved.stack[resolved.stack.length - 1]
		if (top === undefined || top.k !== 'EFFECT')
			throw new Error('expected a resume frame')
		expect(top.ctx.bindings['c1']).toEqual([ID('w0')]) // first legal, disabled w2 skipped
		expect(JSON.stringify(s)).toBe(before) // real state untouched
	})

	it('CHOOSE_OPTION hard-filters disabled options: picks the first enabled one', () => {
		register([
			makeDef({ id: 'cargo', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'ally', suit: 'ALLY', operations: [] }),
		])
		let s = fresh()
		s = place(s, 'ally', ID('a'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		const node: Effect = {
			k: 'CHOOSE_ONE',
			options: [
				{ label: 'gain a CARGO', body: { k: 'GAIN_CARD', suits: ['CARGO'] } }, // disabled
				{ label: 'gain an ALLY', body: { k: 'GAIN_CARD', suits: ['ALLY'] } }, // enabled
			],
		}
		const halted = pushAndRun(s, node, ID('src'), 0)
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_OPTION')
			throw new Error('expected CHOOSE_OPTION')
		if (ch.options[0]!.enabled !== false || ch.options[1]!.enabled !== true) {
			throw new Error(
				'test setup: expected option 0 disabled, option 1 enabled',
			)
		}
		const before = JSON.stringify(halted)
		const probeState = structuredClone(halted) as typeof halted
		const resolved = probeFirstChoice(probeState)
		const top = resolved.stack[resolved.stack.length - 1]
		if (top === undefined || top.k !== 'EFFECT')
			throw new Error('expected a resume frame')
		expect(top.ctx.bindings[ch.id]).toEqual({ key: '1' }) // the enabled option, not '0'
		expect(JSON.stringify(halted)).toBe(before)
	})

	it('CHOOSE_WILDCARD_AS picks the first offered trait (owner opt-in)', () => {
		register([
			makeDef({
				id: 'wild',
				suit: 'PERSON',
				traits: ['WILDCARD'],
				operations: [],
			}),
		])
		let s = fresh()
		s = place(s, 'wild', ID('w'), { k: 'FLEET', seat: 0 }, 0)
		const choice = {
			k: 'CHOOSE_WILDCARD_AS' as const,
			id: 'c1',
			seat: 0 as const,
			prompt: 'p',
			sourceCard: ID('w'),
			card: ID('w'),
			traits: ['VULCAN' as const, 'KLINGON' as const],
		}
		s = {
			...s,
			pendingChoice: choice,
			stack: [{ k: 'EFFECT', node: { k: 'NOOP' }, ctx: CTX, ip: 0 }],
		}
		const before = JSON.stringify(s)
		const resolved = probeFirstChoice(structuredClone(s) as typeof s)
		const top = resolved.stack[resolved.stack.length - 1]
		if (top === undefined || top.k !== 'EFFECT')
			throw new Error('expected a resume frame')
		expect(top.ctx.bindings['c1']).toBe('VULCAN')
		// probe also records the declared substitution on the cloned card only
		expect(resolved.cards[ID('w')]!.wildcardAs).toBe('VULCAN')
		expect(JSON.stringify(s)).toBe(before)
	})

	it('CHOOSE_SPECIALTY picks the first offered track — a LOWEST tie without RESEARCH (1SIS22)', () => {
		// R1 I0 M0: "advance your lowest specialty" offers only INFLUENCE and
		// MILITARY, so a fixed RESEARCH answer would make the play look illegal
		const s = setSpecialty(fresh(), 0, 'RESEARCH', 1)
		const node: Effect = {
			k: 'ADVANCE_SPECIALTY',
			specialty: 'LOWEST',
			amount: 1,
		}
		expect(probe(s, node, CTX)).toBe(true)
		const halted = pushAndRun(s, node, ID('src'), 0)
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_SPECIALTY')
			throw new Error('expected CHOOSE_SPECIALTY')
		expect(ch.specialties).toEqual(['INFLUENCE', 'MILITARY'])
		const resolved = probeFirstChoice(structuredClone(halted) as typeof halted)
		const top = resolved.stack[resolved.stack.length - 1]
		if (top === undefined || top.k !== 'EFFECT')
			throw new Error('expected a resume frame')
		expect(top.ctx.bindings[ch.id]).toBe('INFLUENCE')
	})

	it('probe auto-resolve emits no events and opens no reaction windows (eventQueue untouched)', () => {
		const s = fresh()
		const node: Effect = { k: 'GAIN_CARD', suits: ['CARGO'] }
		register([makeDef({ id: 'cargo', suit: 'CARGO', operations: [] })])
		const seeded = place(s, 'cargo', ID('c1'), {
			k: 'MARKET_OFFER',
			suit: 'CARGO',
		})
		const before = JSON.stringify(seeded)
		probe(seeded, node, CTX)
		expect(JSON.stringify(seeded)).toBe(before)
	})
})
