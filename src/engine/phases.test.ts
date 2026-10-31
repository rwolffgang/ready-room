// todo/06 §2–§3 — the 4-phase turn loop (rules/03) and turn bookkeeping
// (docs/state-machine.md §6 Resolution budget), driven through the phase
// machine's own PHASE_STEP frames on the same stack the resolver uses.
// The intent layer (which wraps these for the UI) is exercised in
// intents.test.ts — this file tests the phases themselves.

import { describe, expect, it, beforeAll } from 'vitest'
import { beginTurnStep, advancePhaseStep, handOffTurn } from './phases'
import { SKIP_LOCATION } from './resolver/choices'
import type { GameState } from './state'
import { newGameState, addCard, zoneKey, player } from './state'
import { registerCards } from './cards'
import { run } from './resolver/stack'
import { applyChoice } from './resolver/choices'
import { assertSerialisable } from './invariants'
import { setup } from './setup'
import { picShrCatalog, picShrConfig, mk, op, gain } from './todo06Fixture'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const ID = (s: string): CardInstanceId => s as CardInstanceId

/** Drive a state that is mid-phase-boundary (phase === `from`) forward to a
 *  halt, running the automatic parts; returns the halted state. */
const advance = (s: GameState): GameState => run(advancePhaseStep(s))

describe('RESUPPLY (rules/03 §3.3)', () => {
	it('fires every in-play RESUPPLY operation; pure gains auto-resolve without an order choice', () => {
		registerCards([
			mk({
				id: 'r-d',
				suit: 'SHIP',
				operations: [op('RESUPPLY', gain('DIL'))],
			}),
			mk({
				id: 'r-l',
				suit: 'ALLY',
				operations: [op('RESUPPLY', gain('LAT'))],
			}),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('ship1'), 'r-d', 0, { k: 'FLEET', seat: 0 })
		s = addCard(s, ID('ally1'), 'r-l', 0, { k: 'LOCATION_AREA', seat: 0 })
		s = { ...s, activeSeat: 0 }
		const out = run(beginTurnStep(s))
		expect(player(out, 0).resources).toEqual({ DIL: 1, LAT: 1, GLO: 0 })
		expect(out.pendingChoice).toBeNull()
		expect(out.phase.k).toBe('ACTION') // auto through CONTROL too (no secured)
		expect(out.stack).toHaveLength(0)
		assertSerialisable(out)
	})

	it('a single non-pure RESUPPLY operation resolves without an order choice', () => {
		registerCards([
			mk({
				id: 'r-spec',
				suit: 'ALLY',
				operations: [
					op('RESUPPLY', {
						k: 'ADVANCE_SPECIALTY',
						specialty: 'RESEARCH',
						amount: 1,
					}),
				],
			}),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('a1'), 'r-spec', 0, { k: 'LOCATION_AREA', seat: 0 })
		s = { ...s, activeSeat: 0 }
		const out = run(beginTurnStep(s))
		expect(player(out, 0).specialties.RESEARCH).toBe(1)
		expect(out.pendingChoice).toBeNull()
	})

	it('two non-pure RESUPPLY operations emit ORDER_OPERATIONS; the chosen order is honoured', () => {
		registerCards([
			mk({
				id: 'o-a',
				suit: 'ALLY',
				operations: [
					op('RESUPPLY', {
						k: 'ADVANCE_SPECIALTY',
						specialty: 'RESEARCH',
						amount: 1,
					}),
				],
			}),
			mk({
				id: 'o-b',
				suit: 'ALLY',
				operations: [
					op('RESUPPLY', {
						k: 'ADVANCE_SPECIALTY',
						specialty: 'MILITARY',
						amount: 1,
					}),
				],
			}),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('a1'), 'o-a', 0, { k: 'LOCATION_AREA', seat: 0 })
		s = addCard(s, ID('a2'), 'o-b', 0, { k: 'LOCATION_AREA', seat: 0 })
		s = { ...s, activeSeat: 0 }
		const halted = run(beginTurnStep(s))
		expect(halted.phase.k).toBe('RESUPPLY')
		expect(halted.pendingChoice?.k).toBe('ORDER_OPERATIONS')
		const order =
			halted.pendingChoice!.k === 'ORDER_OPERATIONS'
				? halted.pendingChoice!.pending
				: []
		const resumed = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: halted.pendingChoice!.id,
				selection: order,
			}),
		)
		expect(player(resumed, 0).specialties.RESEARCH).toBe(1)
		expect(player(resumed, 0).specialties.MILITARY).toBe(1)
		expect(resumed.phase.k).toBe('ACTION')
		assertSerialisable(resumed)
	})
})

describe('CONTROL (rules/03 §3.4)', () => {
	beforeAll(() => {
		registerCards([
			mk({
				id: 'nz-loc',
				suit: 'LOCATION',
				locationTier: 'STARTING',
				operations: [op('RESUPPLY', gain('LAT'))],
			}),
			mk({ id: 'refill-loc', suit: 'LOCATION', locationTier: 'ADVANCED' }),
		])
	})

	function controlState(): GameState {
		let s: GameState = newGameState(1)
		s = addCard(s, ID('loc1'), 'nz-loc', null, { k: 'NEUTRAL_ZONE', slot: 0 })
		s = addCard(s, ID('ref1'), 'refill-loc', null, { k: 'LOCATION_DECK' })
		// a 3-token / 0-token split makes the Location secured for seat 0
		s = { ...s, awayTeamsAt: { loc1: [3, 0] }, activeSeat: 0 }
		return s
	}

	it('no secured Location → Control auto-advances without a prompt', () => {
		let s: GameState = newGameState(1)
		s = addCard(s, ID('loc1'), 'nz-loc', null, { k: 'NEUTRAL_ZONE', slot: 0 })
		s = { ...s, awayTeamsAt: { loc1: [2, 0] }, activeSeat: 0 } // 2 tokens: under the 3 threshold
		const out = run(beginTurnStep(s)) // RESUPPLY (empty) -> CONTROL -> (nothing secured) -> ACTION
		expect(out.phase.k).toBe('ACTION')
		expect(out.pendingChoice).toBeNull()
		expect(out.cards['loc1']!.zone.k).toBe('NEUTRAL_ZONE') // untouched
	})

	it('a secured Location offers CHOOSE_LOCATION with a Skip; taking control refills the Neutral Zone', () => {
		const s = controlState() // 3 vs 0 -> secured for seat 0
		const halted = run(beginTurnStep(s))
		expect(halted.phase.k).toBe('CONTROL')
		expect(halted.pendingChoice?.k).toBe('CHOOSE_LOCATION')
		const ch = halted.pendingChoice!
		const candidates = ch.k === 'CHOOSE_LOCATION' ? ch.candidates : []
		expect(candidates).toContain(ID('loc1'))
		expect(candidates).toContain(SKIP_LOCATION)
		const resumed = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: ID('loc1'),
			}),
		)
		expect(resumed.phase.k).toBe('ACTION')
		expect(resumed.cards['loc1']!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
		expect(
			(resumed.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 0 })] ?? []).length,
		).toBe(1)
		expect(resumed.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot: 0 })]?.[0]).toBe(
			ID('ref1'),
		)
		// REGRESSION (todo/06 DoD, rules/12 §12.18): the Location's RESUPPLY op must
		// NOT fire this turn — Resupply already passed before the Control Step.
		expect(player(resumed, 0).resources.LAT).toBe(0)
		assertSerialisable(resumed)
	})

	it('Skip leaves the Location in place and advances to ACTION', () => {
		const s = controlState()
		const halted = run(beginTurnStep(s))
		const ch = halted.pendingChoice!
		const resumed = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: SKIP_LOCATION,
			}),
		)
		expect(resumed.phase.k).toBe('ACTION')
		expect(resumed.cards['loc1']!.zone).toEqual({ k: 'NEUTRAL_ZONE', slot: 0 })
		expect(resumed.cards['loc1']!.owner).toBeNull()
	})
})

describe('CLEAN-UP (rules/03 §3.6)', () => {
	it('Staging-Area cards fire their CLEAN-UP operations (rules/12 §12.3)', () => {
		registerCards([
			mk({
				id: 'stage-int',
				suit: 'PERSON',
				operations: [op('CLEANUP', gain('DIL'))],
			}),
			mk({ id: 'desk-fill', suit: 'PERSON' }),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('st1'), 'stage-int', 0, { k: 'STAGING', seat: 0 }) // in the Staging Area
		s = addCard(s, ID('h1'), 'desk-fill', 0, { k: 'HAND', seat: 0 })
		s = { ...s, phase: { k: 'ACTION' }, activeSeat: 0 }
		const halted = advance(s) // ACTION -> CLEANUP OPERATIONS -> ... -> DISCARD choice
		expect(halted.phase.k).toBe('CLEANUP')
		expect(player(halted, 0).resources.DIL).toBe(1)
		expect(halted.cards['st1']!.zone).toEqual({ k: 'DISCARD', seat: 0 }) // staged card moved out by DISCARD
		expect(halted.zones[zoneKey({ k: 'STAGING', seat: 0 })] ?? []).toHaveLength(
			0,
		)
		expect(halted.pendingChoice?.k).toBe('CHOOSE_CARDS') // the voluntary hand discard
	})

	it('7 cards in hand with hand size 5 → draw 0, discard 0 (unless chosen), end with 7', () => {
		registerCards([mk({ id: 'filler', suit: 'PERSON' })])
		let s: GameState = newGameState(1)
		for (const i of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']) {
			s = addCard(s, ID(i), 'filler', 0, { k: 'HAND', seat: 0 })
		}
		s = { ...s, phase: { k: 'ACTION' }, activeSeat: 0 }
		const halted = advance(s)
		expect(halted.phase.k).toBe('CLEANUP')
		const ch = halted.pendingChoice
		expect(ch?.k).toBe('CHOOSE_CARDS') // voluntary hand discard (min 0)
		const resumed = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch!.id,
				selection: [],
			}),
		)
		expect((resumed.zones['HAND:0'] ?? []).length).toBe(7) // no discard, no draw
		expect(resumed.phase.k).toBe('ACTION') // opponent's automatic RESUPPLY/CONTROL done
		expect(resumed.activeSeat).toBe(1)
		assertSerialisable(resumed)
	})

	it('draws to hand size through a deck-cycling refill (discard reshuffled, Reserve enlisted)', () => {
		registerCards([
			mk({ id: 'cyc', suit: 'PERSON' }),
			mk({ id: 'res', suit: 'CARGO' }),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('hand1'), 'cyc', 0, { k: 'HAND', seat: 0 })
		s = addCard(s, ID('hand2'), 'cyc', 0, { k: 'HAND', seat: 0 })
		s = addCard(s, ID('d1'), 'cyc', 0, { k: 'DISCARD', seat: 0 })
		s = addCard(s, ID('d2'), 'cyc', 0, { k: 'DISCARD', seat: 0 })
		s = addCard(s, ID('r1'), 'res', 0, { k: 'RESERVE', seat: 0 }) // empty DRAW + 2 DISCARD + 1 RESERVE
		s = { ...s, phase: { k: 'ACTION' }, activeSeat: 0 }
		const halted = advance(s)
		const ch = halted.pendingChoice! // the DISCARD choice (2 hand cards, min 0)
		const resumed = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [],
			}),
		)
		expect((resumed.zones['HAND:0'] ?? []).length).toBe(5)
		expect(resumed.zones['HAND:0']).toContain(ID('r1')) // enlisted Reserve is the first card drawn
		expect(resumed.zones['DRAW:0'] ?? []).toHaveLength(0)
	})

	it('REFRESH un-exhausts in-play cards, clears action tokens and resets the budget to 3', () => {
		registerCards([mk({ id: 'capx', suit: 'CAPTAIN', awayTeams: 2 })])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('cap1'), 'capx', 0, { k: 'CAPTAIN', seat: 0 })
		s = {
			...s,
			cards: {
				...s.cards,
				[ID('cap1')]: {
					...s.cards[ID('cap1')]!,
					exhausted: true,
					actionTokens: 1,
				},
			},
		}
		s = {
			...s,
			phase: { k: 'ACTION' },
			activeSeat: 0,
			players: [
				{ ...s.players[0], actions: { available: 5, spent: 0 } },
				s.players[1],
			] as GameState['players'],
		}
		const out = advance(s) // no market / hand / decks -> runs straight through to the handoff
		const cap = out.cards['cap1']!
		expect(cap.exhausted).toBe(false)
		expect(cap.actionTokens).toBe(0)
		expect(player(out, 0).actions).toEqual({ available: 3, spent: 0 })
		expect(out.activeSeat).toBe(1)
		expect(out.phase.k).toBe('ACTION')
		assertSerialisable(out)
	})

	it("REFRESH also ends the OTHER seat's temporary layers attached during this turn", () => {
		// a REACTION on seat 0's turn gave seat 1's SHIP "CLOAK for the remainder
		// of the turn": that turn ends at seat 0's Clean-up, not seat 1's
		registerCards([
			mk({ id: 'capx', suit: 'CAPTAIN', awayTeams: 2 }),
			mk({ id: 'tmp-ship', suit: 'SHIP' }),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, ID('cap1'), 'capx', 0, { k: 'CAPTAIN', seat: 0 })
		s = addCard(s, ID('ship1'), 'tmp-ship', 1, { k: 'FLEET', seat: 1 })
		s = {
			...s,
			phase: { k: 'ACTION' },
			activeSeat: 0,
			players: [
				s.players[0],
				{
					...s.players[1],
					modifiers: [
						{ id: 'TEMP_CLOAK', source: ID('ship1') },
						{ id: '1PER09_HAND', source: ID('ship1') },
					],
				},
			] as GameState['players'],
		}
		const out = advance(s)
		expect(out.activeSeat).toBe(1)
		// the temporary layer is gone, a permanent one stays
		expect(player(out, 1).modifiers).toEqual([
			{ id: '1PER09_HAND', source: ID('ship1') },
		])
	})
})

describe('CADET Training (rules/10 §10.3) — the extra Market-wipe substep', () => {
	it('runs CADET_WIPE every Clean-up, before Glory placement', () => {
		const catalog = picShrCatalog()
		let s = setup({ ...picShrConfig, mode: 'CADET', seed: 1 }, catalog)
		s = { ...s, activeSeat: 0 }
		const action = run(beginTurnStep(s)) // RESUPPLY -> CONTROL -> ACTION
		expect(action.phase.k).toBe('ACTION')
		const halted = advance(action) // ACTION -> CLEANUP -> OPERATIONS -> STARDATE -> CADET_WIPE
		expect(halted.phase.k).toBe('CLEANUP')
		expect(halted.pendingChoice?.k).toBe('CHOOSE_CARDS')
		const wipe = halted.pendingChoice
		if (!wipe || wipe.k !== 'CHOOSE_CARDS')
			throw new Error('expected the CADET wipe choice')
		expect(wipe.min).toBe(1)
		expect(wipe.max).toBe(1)
		expect(wipe.candidates).toHaveLength(4)
		const picked = wipe.candidates[0]!
		const suit = (
			halted.cards[picked]!.zone as {
				k: 'MARKET_OFFER'
				suit: 'PERSON' | 'CARGO' | 'SHIP' | 'ALLY'
			}
		).suit
		const resumed = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: wipe.id,
				selection: [picked],
			}),
		)
		expect(resumed.cards[picked]!.zone.k).toBe('JUNK') // wiped card junks
		const refilled = resumed.zones[zoneKey({ k: 'MARKET_OFFER', suit })] ?? []
		expect(refilled).toHaveLength(1) // a replacement was revealed
		expect(refilled[0]).not.toBe(picked)
		expect(resumed.pendingChoice?.k).toBe('CHOOSE_CARDS') // Glory placement still to come
		expect(resumed.phase).toEqual({ k: 'CLEANUP', sub: 'GLORY_PLACEMENT' })
		assertSerialisable(resumed)
	})
})

describe('Turn bookkeeping (docs/state-machine.md §6)', () => {
	/** State with Resolution already triggered (mid-turn) and the given base
	 *  bookkeeping. `turnsAfterResolution` threads through the real hand-offs. */
	function budgetState(
		taken: [number, number],
		active: Seat,
		after = 0,
	): GameState {
		const s = newGameState(1)
		return {
			...s,
			resolutionTriggered: true,
			turnsTaken: taken,
			activeSeat: active,
			turnsAfterResolution: after,
		}
	}

	it('Resolution on the starting player’s turn → finish the round, then 1 turn each', () => {
		// p0 (starting) is mid-turn-1 when Resolution triggers. Their turn end:
		// turnsTaken [0,0]->[1,0], budget = (unequal? 1 : 0) + 2 = 3 more turn ends.
		let s = handOffTurn(budgetState([0, 0], 0), 0)
		expect(s.turnsTaken).toEqual([1, 0])
		expect(s.turnsAfterResolution).toBe(3)
		expect(s.activeSeat).toBe(1)
		expect(s.phase.k).toBe('RESUPPLY')
		s = handOffTurn(s, 1) // p1 finishes their round turn
		expect(s.turnsTaken).toEqual([1, 1])
		expect(s.turnsAfterResolution).toBe(2)
		s = handOffTurn(s, 0) // p0 takes their extra turn
		expect(s.turnsAfterResolution).toBe(1)
		s = handOffTurn(s, 1) // p1 takes theirs
		expect(s.turnsTaken).toEqual([2, 2])
		expect(s.result).toEqual({ kind: 'FINAL_SCORING' })
		expect(s.phase.k).toBe('GAME_OVER')
	})

	it('Resolution on the second player’s turn → budget 2, then score', () => {
		// p1 is mid-turn-1 (turnsTaken [1,0]) when Resolution triggers. Their turn
		// end: [1,0]->[1,1], equal -> budget = 0 + 2.
		let s = handOffTurn(budgetState([1, 0], 1), 1)
		expect(s.turnsTaken).toEqual([1, 1])
		expect(s.turnsAfterResolution).toBe(2)
		s = handOffTurn(s, 0) // p0 extra turn
		expect(s.turnsAfterResolution).toBe(1)
		s = handOffTurn(s, 1) // p1 extra turn
		expect(s.result).toEqual({ kind: 'FINAL_SCORING' })
	})

	it('Burn during the extra turns ends the game immediately (takes priority)', () => {
		let s = budgetState([1, 1], 0, 2)
		s = { ...s, zones: { ...s.zones, ['INCIDENT_DECK']: [] } } // a real, emptied deck
		s = handOffTurn(s, 0)
		expect(s.turnsAfterResolution).toBe(1) // budget not yet exhausted
		const out = run(s) // the pushed RESUPPLY frame runs; the Burn fires first
		expect(out.result).toEqual({ kind: 'BURN' })
		expect(out.phase.k).toBe('GAME_OVER')
	})
})
