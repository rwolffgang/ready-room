// todo/12 + todo/13 engine-gap regression tests. Each `it` names the card/rule
// it serves (the two fidelity-pass docs list these as the "unfixable engine"
// gaps). These exercise the NEW nodes added for the pass:
//   - Amount { k: 'PER' }                (1PER05, 1SHI13 XINDI, 1PIC12,
//                                         1BUR10)
//   - Predicate BOUND_IS / BOUND_SHARES_TRAIT  (1PER07, 1KOL12 HOSTILE
//     CONTACT, 1LOC06, 1PER19 op[1], 1SHI13, 1KOL23)
//   - REVEAL + opponent-hand COST_DISCARD/DISCARD (1CAR09, 1KOL22
//     1KOL22)
//   - Trigger ATTACK_MADE                (1SEL01)
//   - Trigger LOCATION_CONTROLLED seat:'OPPONENT' (1PER04)
//   - Predicate LOG_LEGAL                (1PIC18)

// extra todo/13-follow-up sections appended below (see that file's tail): the
// PUT_ON_DECK_TOP / captain-predicate / AWAY_TEAMS_AT / TAKE-returnUnpicked /
// COST_LOG-array / LOG-bind+ICON_COUNT / CardDef-passives gaps.

import { describe, expect, it } from 'vitest'
import type { Effect, Operation, TriggerSpec } from './nodes'
import type { Amount, Predicate } from './queries'
import type { EffectCtx, GameState, GameEvent } from '../state'
import { zonesOf } from '../state'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setResources,
	pushAndRun,
} from './testUtils'
import { run } from './stack'
import { applyChoice } from './choices'
import { probe } from './probe'
import { evalAmount, evalPredicate } from '../queries/resolveQuery'
import { matchesTrigger } from './triggers'
import {
	effectiveHandSize,
	blocksSendsTo,
	ignoresOpponentShips,
	scanIncludesJunk,
} from '../modifiers'
import { canSendAwayTeam } from '../queries/board'
import type { CardInstanceId } from '../ids'

const SRC = ID('src')
const ctx0 = (): EffectCtx => ({ actor: 0, source: SRC, bindings: {} })

function reactOp(trigger: TriggerSpec, effect: Effect): Operation {
	return {
		type: 'REACTION',
		costsAction: false,
		isAttack: false,
		trigger,
		effect,
		text: 'test reaction',
	}
}

function discardResult(state: GameState, iid: CardInstanceId): GameState {
	const ch = state.pendingChoice
	if (ch === null || ch.k !== 'CHOOSE_CARDS')
		throw new Error('expected CHOOSE_CARDS')
	return run(
		applyChoice(state, {
			t: 'RESOLVE_CHOICE',
			choiceId: ch.id,
			selection: [iid],
		}),
	)
}

/** Emit an event, run a trivial frame so the queue drains, and return both the
 *  halted state (any REACTION window) and the final state. */
function drainWith(state: GameState, event: GameEvent): GameState {
	return pushAndRun({ ...state, eventQueue: [event] }, { k: 'NOOP' }, SRC, 0)
}

/** Patch `seat`'s away-team pool level (fresh() starts empty). */
function pool(state: GameState, seat: number, n: number): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, awayTeamsInPool: n } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

/* ------------------------------------------------------------------ *
 * Amount { k: 'PER' } — "1 for every N, rounded down" (docs gap 2)
 * ------------------------------------------------------------------ */
describe('Amount PER divisor (docs gap 2)', () => {
	it('1PER05 op[2]: 1 {GLO} per 2 Log cards, rounded down', () => {
		register([makeDef({ id: 'perLogCard', suit: 'PERSON', operations: [] })])
		let s = fresh()
		for (let i = 0; i < 3; i++)
			s = place(s, 'perLogCard', ID(`l${i}`), { k: 'LOG', seat: 0 }, 0)
		const node: Effect = {
			k: 'GAIN_RESOURCE',
			res: 'GLO',
			amount: {
				k: 'PER',
				every: 2,
				of: { k: 'COUNT', query: { zones: [{ k: 'LOG', seat: 0 }] } },
			},
		}
		expect(pushAndRun(s, node, SRC, 0).players[0]!.resources.GLO).toBe(1) // floor(3/2)
	})

	it('1PIC12: advance a specialty by 1 for every 5 cards in your Log', () => {
		register([makeDef({ id: 'dataLogCard', suit: 'PERSON', operations: [] })])
		let s = fresh()
		for (let i = 0; i < 5; i++)
			s = place(s, 'dataLogCard', ID(`d${i}`), { k: 'LOG', seat: 0 }, 0)
		const amount: Amount = {
			k: 'PER',
			every: 5,
			of: { k: 'COUNT', query: { zones: [{ k: 'LOG', seat: 0 }] } },
		}
		expect(evalAmount(s, amount, ctx0())).toBe(1) // floor(5/5)
		let s11 = s
		for (let i = 0; i < 5; i++)
			s11 = place(s11, 'dataLogCard', ID(`e${i}`), { k: 'LOG', seat: 0 }, 0)
		expect(evalAmount(s11, amount, ctx0())).toBe(2) // floor(10/5)
	})

	it('1BUR10: ENDGAME scores 1 VP for every 2 {DIL} you have', () => {
		const s = setResources(fresh(), 0, 'DIL', 5)
		const amount: Amount = {
			k: 'PER',
			every: 2,
			of: { k: 'RESOURCE', res: 'DIL' },
		}
		expect(evalAmount(s, amount, ctx0())).toBe(2) // floor(5/2)
		expect(evalAmount(setResources(fresh(), 0, 'DIL', 0), amount, ctx0())).toBe(
			0,
		)
	})

	it('1SHI13 XINDI-REPTILIAN op[1]: draw 1 for every 2 ANOMALY, capped at 4', () => {
		register([
			makeDef({
				id: 'anomCard',
				suit: 'PERSON',
				traits: ['ANOMALY'],
				operations: [],
			}),
		])
		const amount: Amount = {
			k: 'MIN',
			terms: [
				{
					k: 'PER',
					every: 2,
					of: {
						k: 'COUNT',
						query: { zones: ['IN_PLAY'], filter: { traits: ['ANOMALY'] } },
					},
				},
				4,
			],
		}
		let s = fresh()
		for (let i = 0; i < 6; i++)
			s = place(s, 'anomCard', ID(`a${i}`), { k: 'FLEET', seat: 0 }, 0)
		expect(evalAmount(s, amount, ctx0())).toBe(3) // floor(6/2) = 3 (under the cap)
		for (let i = 6; i < 10; i++)
			s = place(s, 'anomCard', ID(`b${i}`), { k: 'FLEET', seat: 0 }, 0)
		expect(evalAmount(s, amount, ctx0())).toBe(4) // floor(10/2) = 5 → capped at 4
	})
})

/* ------------------------------------------------------------------ *
 * Predicate BOUND_IS — "the just-discarded/gained card is X" (docs gap 1)
 * ------------------------------------------------------------------ */
describe('Predicate BOUND_IS (docs gap 1)', () => {
	it('1PER07: discard a card; if it is a WEAPON gain a SHIP', () => {
		register([
			makeDef({
				id: 'per07Weapon',
				suit: 'PERSON',
				traits: ['WEAPON'],
				operations: [],
			}),
			makeDef({ id: 'per07Civic', suit: 'PERSON', traits: [], operations: [] }),
		])
		let s = fresh()
		s = place(s, 'per07Weapon', ID('w'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'per07Civic', ID('c'), { k: 'HAND', seat: 0 }, 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'DISCARD', count: 1, from: 'HAND', bind: 'discarded' },
				{
					k: 'IF',
					cond: {
						k: 'BOUND_IS',
						bind: 'discarded',
						filter: { traits: ['WEAPON'] },
					},
					then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
				},
			],
		}
		// discarding the WEAPON satisfies the predicate
		const out = discardResult(pushAndRun(s, node, SRC, 0), ID('w'))
		expect(out.players[0]!.resources.GLO).toBe(1)
		expect(out.cards[ID('w')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		// discarding the plain card does not
		const out2 = discardResult(pushAndRun(s, node, SRC, 0), ID('c'))
		expect(out2.players[0]!.resources.GLO).toBe(0)
	})

	it('1KOL12: COST_DISCARD binds; if COMMUNICATION gain 2 {DIL}', () => {
		register([
			makeDef({
				id: 'hozCom',
				suit: 'PERSON',
				traits: ['COMMUNICATION'],
				operations: [],
			}),
		])
		let s = fresh()
		s = place(s, 'hozCom', ID('co'), { k: 'HAND', seat: 0 }, 0)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_DISCARD', count: 1, bind: 'discarded' },
			body: {
				k: 'IF',
				cond: {
					k: 'BOUND_IS',
					bind: 'discarded',
					filter: { traits: ['COMMUNICATION'] },
				},
				then: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 },
			},
		}
		const out = pushAndRun(s, node, SRC, 0) // single hand candidate → auto-picked
		expect(out.pendingChoice).toBeNull()
		expect(out.players[0]!.resources.DIL).toBe(2)
	})

	it('1SHI13 op[0]: bind the card the GAIN_CARD produced; if WEAPON beam it here and gain 1 {GLO}', () => {
		register([
			makeDef({
				id: 'shiWeapon',
				suit: 'CARGO',
				traits: ['WEAPON'],
				operations: [],
			}),
			makeDef({ id: 'shiPlain', suit: 'CARGO', traits: [], operations: [] }),
		])
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'GAIN_CARD', suits: ['CARGO'], bind: 'gained' },
				{
					k: 'IF',
					cond: {
						k: 'BOUND_IS',
						bind: 'gained',
						filter: { traits: ['WEAPON'] },
					},
					then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
				},
			],
		}
		let s = fresh()
		s = place(s, 'shiWeapon', ID('gw'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		// one offer → auto-picked → the only pending choice is the destination
		let halted = pushAndRun(s, node, SRC, 0)
		let ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_DESTINATION')
			throw new Error('expected CHOOSE_DESTINATION')
		const out = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: 'DISCARD',
			}),
		)
		expect(out.players[0]!.resources.GLO).toBe(1)
		// non-WEAPON gained card → predicate false
		const s2 = place(fresh(), 'shiPlain', ID('gp'), {
			k: 'MARKET_OFFER',
			suit: 'CARGO',
		})
		halted = pushAndRun(s2, node, SRC, 0)
		ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_DESTINATION')
			throw new Error('expected CHOOSE_DESTINATION')
		const out2 = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: 'DISCARD',
			}),
		)
		expect(out2.players[0]!.resources.GLO).toBe(0)
	})

	it('1KOL23: the SCAN_N card is bound; if WEAPON gain 1 {GLO}', () => {
		register([
			makeDef({
				id: 'kol23Weapon',
				suit: 'CARGO',
				traits: ['WEAPON'],
				operations: [],
			}),
		])
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{
					k: 'PAY_THEN',
					cost: { k: 'COST_RESOURCE', res: 'GLO', amount: 1 },
					body: { k: 'SCAN_N', n: 2, suits: ['CARGO'], bind: 'gained' },
				},
				{
					k: 'IF',
					cond: {
						k: 'BOUND_IS',
						bind: 'gained',
						filter: { traits: ['WEAPON'] },
					},
					then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
				},
			],
		}
		let s = setResources(fresh(), 0, 'GLO', 1)
		s = place(s, 'kol23Weapon', ID('kw'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		const halted = pushAndRun(s, node, SRC, 0)
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_DESTINATION')
			throw new Error('expected CHOOSE_DESTINATION')
		const out = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: 'DISCARD',
			}),
		)
		expect(out.players[0]!.resources.GLO).toBe(1)
	})
})

/* ------------------------------------------------------------------ *
 * Predicate BOUND_SHARES_TRAIT (docs gap 1 — 1LOC06, 1PER04 op[1]...)
 * ------------------------------------------------------------------ */
describe('Predicate BOUND_SHARES_TRAIT (docs gap 1)', () => {
	it('1LOC06: if the discarded top card shares a trait with your CAPTAIN gain 2 {DIL}, else 1', () => {
		register([
			makeDef({
				id: 'corvTop',
				suit: 'PERSON',
				traits: ['VULCAN'],
				operations: [],
			}),
			makeDef({
				id: 'corvOther',
				suit: 'PERSON',
				traits: ['KLINGON'],
				operations: [],
			}),
			makeDef({
				id: 'corvCaptain',
				suit: 'PERSON',
				traits: ['VULCAN'],
				operations: [],
			}),
		])
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'DISCARD', count: 1, from: 'DECK_TOP', bind: 'discarded' },
				{
					k: 'IF',
					cond: {
						k: 'BOUND_SHARES_TRAIT',
						bind: 'discarded',
						with: { zones: [{ k: 'CAPTAIN', seat: 0 }] },
					},
					then: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 },
					else: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
				},
			],
		}
		// top card shares VULCAN with the CAPTAIN → 2
		let s = fresh()
		s = place(s, 'corvCaptain', ID('cap'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = place(s, 'corvTop', ID('t1'), { k: 'DRAW', seat: 0 }, 0)
		expect(pushAndRun(s, node, SRC, 0).players[0]!.resources.DIL).toBe(2)
		// top card does not share → 1
		const s2 = fresh()
		const p2 = place(
			s2,
			'corvCaptain',
			ID('cap2'),
			{ k: 'CAPTAIN', seat: 0 },
			0,
		)
		const p3 = place(p2, 'corvOther', ID('t2'), { k: 'DRAW', seat: 0 }, 0)
		expect(pushAndRun(p3, node, SRC, 0).players[0]!.resources.DIL).toBe(1)
	})

	it('1PER19 op[1]: the discarded card shares a trait with a 1PER19 in play → gain 1 (approximation of "count shared traits")', () => {
		register([
			makeDef({
				id: 'per19Named',
				suit: 'PERSON',
				traits: ['BORG'],
				operations: [],
			}),
			makeDef({
				id: 'per19Discard',
				suit: 'PERSON',
				traits: ['BORG'],
				operations: [],
			}),
		])
		let s = fresh()
		s = place(s, 'per19Named', ID('named'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'per19Discard', ID('pd'), { k: 'HAND', seat: 0 }, 0)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_DISCARD', count: 1, bind: 'discarded' },
			body: {
				k: 'IF',
				cond: {
					k: 'BOUND_SHARES_TRAIT',
					bind: 'discarded',
					with: { zones: ['IN_PLAY'], filter: { ids: ['per19Named'] } },
				},
				then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
			},
		}
		const out = pushAndRun(s, node, SRC, 0) // single discard candidate → auto
		expect(out.players[0]!.resources.GLO).toBe(1)
	})
})

/* ------------------------------------------------------------------ *
 * REVEAL + opponent-hand discards (docs gap 3 — 1CAR09, 1KOL22)
 * ------------------------------------------------------------------ */
describe('REVEAL and opponent-hand discard (docs gap 3)', () => {
	it('1CAR09: REVEAL the opponent hand is a resolvable informational step', () => {
		const s = fresh()
		const out = pushAndRun(s, { k: 'REVEAL', whose: 'OPPONENT' }, SRC, 0)
		expect(out.pendingChoice).toBeNull()
		expect(JSON.stringify(out)).toBe(JSON.stringify(s)) // purely informational, no mutation
	})

	it('1CAR09: you may discard an ATTACK from the OPPONENT hand to gain 1 {GLO}', () => {
		register([
			makeDef({
				id: 'mekAttack',
				suit: 'PERSON',
				traits: ['ATTACK'],
				operations: [],
			}),
			makeDef({ id: 'mekPlain', suit: 'PERSON', traits: [], operations: [] }),
		])
		const node: Effect = {
			k: 'PAY_THEN',
			cost: {
				k: 'COST_DISCARD',
				count: 1,
				filter: { traits: ['ATTACK'] },
				whose: 'OPPONENT',
			},
			body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
		}
		// opponent holds exactly one ATTACK → auto-picked from THEIR hand
		let s = fresh()
		s = place(s, 'mekAttack', ID('ma'), { k: 'HAND', seat: 1 }, 1)
		s = place(s, 'mekPlain', ID('mp'), { k: 'HAND', seat: 1 }, 1)
		// two candidate ATTACKs → choice over the opponent hand
		const s2 = place(s, 'mekAttack', ID('ma2'), { k: 'HAND', seat: 1 }, 1)
		const halted = pushAndRun(s2, node, SRC, 0)
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_CARDS')
			throw new Error('expected CHOOSE_CARDS over the opponent hand')
		const out = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [ID('ma')],
			}),
		)
		expect(out.players[0]!.resources.GLO).toBe(1)
		expect(out.cards[ID('ma')]!.zone).toEqual({ k: 'DISCARD', seat: 1 }) // opponent's pile
	})

	it('1KOL22: opponent discards their deck top; the bind still tests the discarded card for the benefit', () => {
		register([
			makeDef({
				id: 'kol22Top',
				suit: 'PERSON',
				traits: ['BORG'],
				operations: [],
			}),
		])
		let s = fresh()
		s = place(s, 'kol22Top', ID('kt'), { k: 'DRAW', seat: 1 }, 1)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{
					k: 'OPPONENT',
					body: { k: 'DISCARD', count: 1, from: 'DECK_TOP', bind: 'discarded' },
				},
				{
					k: 'IF',
					cond: {
						k: 'BOUND_IS',
						bind: 'discarded',
						filter: { suits: ['PERSON'] },
					},
					then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
				},
			],
		}
		const out = pushAndRun(s, node, SRC, 0)
		expect(out.players[0]!.resources.GLO).toBe(1) // binding from inside the OPPONENT flip is visible outside
		expect(out.cards[ID('kt')]!.zone).toEqual({ k: 'DISCARD', seat: 1 })
	})
})

/* ------------------------------------------------------------------ *
 * Trigger ATTACK_MADE (docs gap 6 — 1SEL01)
 * ------------------------------------------------------------------ */
describe('Trigger ATTACK_MADE (docs gap 6)', () => {
	it('1SEL01: "After you attack the opponent" fires on the channel the ATTACKED event carries', () => {
		register([
			makeDef({
				id: 'sel',
				suit: 'PERSON',
				operations: [
					reactOp(
						{ on: 'ATTACK_MADE' },
						{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
					),
				],
			}),
		])
		const s = place(fresh(), 'sel', ID('s'), { k: 'FLEET', seat: 0 }, 0)
		// the owner resolved an ATTACK against seat 1 → seat 0's SEL reacts
		const halted = drainWith(s, { k: 'ATTACKED', seat: 0, victim: 1 })
		const ch = halted.pendingChoice
		expect(ch).not.toBeNull()
		if (ch === null || ch.k !== 'OPTIONAL_TRIGGERS')
			throw new Error('expected OPTIONAL_TRIGGERS window')
		expect(ch.offered).toHaveLength(1)
		const fin = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [ch.offered[0]!],
			}),
		)
		expect(fin.players[0]!.resources.GLO).toBe(1)
		// being attacked (seat 1 attacked seat 0) does NOT fire SEL's ATTACK_MADE
		const noWin = drainWith(s, { k: 'ATTACKED', seat: 1, victim: 0 })
		expect(noWin.pendingChoice).toBeNull()
	})

	it('matchesTrigger: ATTACKED from seat X matches ATTACK_MADE only for the aggressor', () => {
		expect(
			matchesTrigger(
				fresh(),
				{ k: 'ATTACKED', seat: 0, victim: 1 },
				{ on: 'ATTACK_MADE' },
				0,
			),
		).toBe(true)
		expect(
			matchesTrigger(
				fresh(),
				{ k: 'ATTACKED', seat: 1, victim: 0 },
				{ on: 'ATTACK_MADE' },
				0,
			),
		).toBe(false)
	})
})

/* ------------------------------------------------------------------ *
 * Trigger LOCATION_CONTROLLED seat (docs gap 4 — 1PER04)
 * ------------------------------------------------------------------ */
describe('Trigger LOCATION_CONTROLLED with an OPPONENT seat (docs gap 4)', () => {
	it('1PER04: reacts on the OPPONENT taking control of a Location', () => {
		register([
			makeDef({
				id: 'per04',
				suit: 'PERSON',
				operations: [
					reactOp(
						{ on: 'LOCATION_CONTROLLED', seat: 'OPPONENT' },
						{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
					),
				],
			}),
		])
		const s = place(
			fresh(),
			'per04',
			ID('k'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		// the opponent (seat 1) controls a location → fires
		const halted = drainWith(s, {
			k: 'LOCATION_CONTROLLED',
			seat: 1,
			iid: ID('loc'),
		})
		const ch = halted.pendingChoice
		expect(ch).not.toBeNull()
		if (ch === null || ch.k !== 'OPTIONAL_TRIGGERS')
			throw new Error('expected OPTIONAL_TRIGGERS window')
		expect(ch.offered).toHaveLength(1)
		// your own control does not
		const noWin = drainWith(s, {
			k: 'LOCATION_CONTROLLED',
			seat: 0,
			iid: ID('loc'),
		})
		expect(noWin.pendingChoice).toBeNull()
	})

	it('matchesTrigger: seat resolution flips for OPPONENT', () => {
		expect(
			matchesTrigger(
				fresh(),
				{ k: 'LOCATION_CONTROLLED', seat: 1, iid: ID('x') },
				{ on: 'LOCATION_CONTROLLED', seat: 'OPPONENT' },
				0,
			),
		).toBe(true)
		expect(
			matchesTrigger(
				fresh(),
				{ k: 'LOCATION_CONTROLLED', seat: 0, iid: ID('x') },
				{ on: 'LOCATION_CONTROLLED', seat: 'OPPONENT' },
				0,
			),
		).toBe(false)
	})
})

/* ------------------------------------------------------------------ *
 * Predicate LOG_LEGAL (docs gap 5 — 1PIC18 mandatory-log payoff)
 * ------------------------------------------------------------------ */
describe('Predicate LOG_LEGAL — mandatory-log payoff playability (docs gap 5)', () => {
	it('1PIC18: the log-payoff gate opens only when a legal LOG target is in play', () => {
		register([makeDef({ id: 'locCard', suit: 'LOCATION', operations: [] })])
		const gate: Predicate = {
			k: 'LOG_LEGAL',
			from: 'IN_PLAY',
			filter: { suits: ['LOCATION'] },
		}
		const mandatory: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_LOG', filter: { suits: ['LOCATION'] }, from: 'IN_PLAY' },
			body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
		}
		// no controlled LOCATION → no legal log target → the payoff is unplayable
		let s = fresh()
		expect(evalPredicate(s, gate, ctx0())).toBe(false)
		expect(probe(s, mandatory, ctx0())).toBe(false)
		// a controlled LOCATION makes the gate true and the mandatory-log playable
		s = place(s, 'locCard', ID('l'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		expect(evalPredicate(s, gate, ctx0())).toBe(true)
		expect(probe(s, mandatory, ctx0())).toBe(true)
	})
})

/* ------------------------------------------------------------------ *
 * PUT_ON_DECK_TOP (todo/13 gap #2 — 1PER17)
 * ------------------------------------------------------------------ */
describe('PUT_ON_DECK_TOP (todo/13 gap #2)', () => {
	it('1PER17: once attacked, the card goes onto the deck top', () => {
		register([
			makeDef({
				id: 'peanut',
				suit: 'PERSON',
				operations: [
					reactOp({ on: 'ATTACKED' }, { k: 'PUT_ON_DECK_TOP', target: 'THIS' }),
				],
			}),
		])
		let s = fresh()
		s = place(s, 'peanut', ID('p'), { k: 'FLEET', seat: 0 }, 0)
		// seat 1 attacks seat 0 → the victim's card reacts ("after you are attacked")
		const halted = drainWith(s, { k: 'ATTACKED', seat: 1, victim: 0 })
		const ch = halted.pendingChoice
		expect(ch).not.toBeNull()
		if (ch === null || ch.k !== 'OPTIONAL_TRIGGERS')
			throw new Error('expected OPTIONAL_TRIGGERS window')
		expect(ch.offered).toHaveLength(1)
		const fin = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [ch.offered[0]!],
			}),
		)
		expect(fin.cards[ID('p')]!.zone).toEqual({ k: 'DRAW', seat: 0 })
		expect(zonesOf(fin, { k: 'DRAW', seat: 0 })[0]).toBe(ID('p')) // on top
		// being the attacker never fires it
		const noWin = drainWith(s, { k: 'ATTACKED', seat: 0, victim: 1 })
		expect(noWin.pendingChoice).toBeNull()
	})
})

/* ------------------------------------------------------------------ *
 * Captain predicates (todo/13 gap #2 — 1CAR02)
 * ------------------------------------------------------------------ */
describe('CAPTAIN_HAS_TRAIT / TOTAL_VP_AT_LEAST (todo/13 gap #2)', () => {
	it('1CAR02 op[1]: the gate "your captain has BORG and you have 6+ value" evaluates', () => {
		register([
			makeDef({
				id: 'carCap',
				suit: 'PERSON',
				traits: ['BORG'],
				vp: 4,
				operations: [],
			}),
			makeDef({ id: 'carVp', suit: 'CARGO', vp: 3, operations: [] }),
		])
		const gate: Predicate = {
			k: 'AND',
			terms: [
				{ k: 'CAPTAIN_HAS_TRAIT', trait: 'BORG' },
				{ k: 'TOTAL_VP_AT_LEAST', value: 6 },
			],
		}
		// no BORG captain → false
		let s = fresh()
		expect(evalPredicate(s, gate, ctx0())).toBe(false)
		// BORG captain in the CAPTAIN zone, but only 4 value → false
		s = place(s, 'carCap', ID('cap'), { k: 'CAPTAIN', seat: 0 }, 0)
		expect(evalPredicate(s, gate, ctx0())).toBe(false)
		// a 3-VP card in play makes it 7 value → true
		s = place(s, 'carVp', ID('vp'), { k: 'FLEET', seat: 0 }, 0)
		expect(evalPredicate(s, gate, ctx0())).toBe(true)
	})

	it('1CAR02 op[1]: when the gate holds, the MAY send fires at a Location (ignoreBlocking)', () => {
		register([
			makeDef({
				id: 'carCap2',
				suit: 'PERSON',
				traits: ['BORG'],
				vp: 4,
				operations: [],
			}),
			makeDef({ id: 'carVp2', suit: 'CARGO', vp: 3, operations: [] }),
			makeDef({ id: 'carLoc', suit: 'LOCATION', operations: [] }),
		])
		const node: Effect = {
			k: 'IF',
			cond: {
				k: 'AND',
				terms: [
					{ k: 'CAPTAIN_HAS_TRAIT', trait: 'BORG' },
					{ k: 'TOTAL_VP_AT_LEAST', value: 6 },
				],
			},
			then: {
				k: 'MAY',
				body: {
					k: 'SEND_AWAY_TEAM',
					count: 1,
					target: { zones: ['IN_PLAY'], filter: { suits: ['LOCATION'] } },
					ignoreBlocking: true,
				},
			},
		}
		let s = fresh()
		s = place(s, 'carCap2', ID('cap'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = place(s, 'carVp2', ID('vp'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'carLoc', ID('loc'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = pool(s, 0, 3)
		const halted = pushAndRun(s, node, SRC, 0)
		const ch = halted.pendingChoice
		// the MAY is asked as the send's destination, with a Skip
		if (ch === null || ch.k !== 'CHOOSE_LOCATION')
			throw new Error('expected CHOOSE_LOCATION (MAY send)')
		const out = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: ID('loc'),
			}),
		)
		expect(out.players[0]!.awayTeamsInPool).toBe(2)
		expect(out.awayTeamsAt[ID('loc')]?.[0]).toBe(1)
	})
})

/* ------------------------------------------------------------------ *
 * Predicate AWAY_TEAMS_AT (todo/13 gap #3 — 1SHR12, ruling 026)
 * ------------------------------------------------------------------ */
describe('Predicate AWAY_TEAMS_AT (todo/13 gap #3)', () => {
	it('1SHR12: "2 or more AWAY TEAMS here" is true only when the Location holds 2+ of YOUR tokens', () => {
		register([
			makeDef({
				id: 'shr12Loc',
				suit: 'LOCATION',
				operations: [],
			}),
		])
		const at: Predicate = {
			k: 'AWAY_TEAMS_AT',
			at: {
				zones: [{ k: 'LOCATION_AREA', seat: 0 }],
				filter: { ids: ['shr12Loc'] },
			},
			value: 2,
		}
		// none here → false
		let s = place(
			fresh(),
			'shr12Loc',
			ID('w'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		expect(evalPredicate(s, at, ctx0())).toBe(false)
		// one here → false (need 2+)
		s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, [ID('w')]: [1, 1] } }
		expect(evalPredicate(s, at, ctx0())).toBe(false)
		// two of your own → true
		s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, [ID('w')]: [2, 0] } }
		expect(evalPredicate(s, at, ctx0())).toBe(true)
		// the CLEAN-UP gate (gap #3, ruling 026): "if there are no AWAY TEAMs
		// here" = NOT (≥1 here) → dismissal condition true with no tokens
		const clean: Predicate = { k: 'NOT', term: { ...at, value: 1 } }
		s = { ...s, awayTeamsAt: {} }
		expect(evalPredicate(s, clean, ctx0())).toBe(true)
		s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, [ID('w')]: [1, 0] } }
		expect(evalPredicate(s, clean, ctx0())).toBe(false)
	})
})

/* ------------------------------------------------------------------ *
 * TAKE returnUnpicked (todo/13 gap #4 — 1PIC18)
 * ------------------------------------------------------------------ */
describe('TAKE returnUnpicked (todo/13 gap #4)', () => {
	it('1PIC18: look 2 take 1, the unchosen ENCOUNTER goes to the deck bottom', () => {
		register([
			makeDef({ id: 'encKeep', suit: 'ENCOUNTER', operations: [] }),
			makeDef({ id: 'encDrop', suit: 'ENCOUNTER', operations: [] }),
		])
		let s = fresh()
		s = place(s, 'encKeep', ID('a'), { k: 'ENCOUNTER_DECK' }) // top (deck [0])
		s = place(s, 'encDrop', ID('e'), { k: 'ENCOUNTER_DECK' })
		s = place(s, 'encDrop', ID('c'), { k: 'ENCOUNTER_DECK' }) // bottom (deck [2])
		const node: Effect = {
			k: 'TAKE',
			deck: 'ENCOUNTER',
			count: 1,
			look: 2,
			returnUnpicked: true,
		}
		// the taker chooses among the top 2 (a, e); the other looked-at card is
		// returned to the BOTTOM (below c)
		const halted = pushAndRun(s, node, SRC, 0)
		const ch = halted.pendingChoice
		expect(ch?.k).toBe('CHOOSE_CARDS')
		if (ch?.k !== 'CHOOSE_CARDS') throw new Error('expected CHOOSE_CARDS')
		expect(ch.candidates).toEqual([ID('a'), ID('e')])
		expect(ch.seat).toBe(0)
		// taking the SECOND card returns the top one
		const out = discardResult(halted, ID('e'))
		expect(out.cards[ID('e')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(zonesOf(out, { k: 'ENCOUNTER_DECK' })).toEqual([ID('c'), ID('a')])
	})
})

/* ------------------------------------------------------------------ *
 * COST_LOG.from zone array (todo/13 gap #5 — 1BUR22)
 * ------------------------------------------------------------------ */
describe('COST_LOG.from hand-or-Discard (todo/13 gap #5)', () => {
	it('1BUR22 op[1]: logging from hand or Discard pile accepts either zone', () => {
		register([makeDef({ id: 'b22Card', suit: 'PERSON', operations: [] })])
		const node: Effect = {
			k: 'PAY_THEN',
			cost: {
				k: 'COST_LOG',
				from: [
					{ k: 'HAND', seat: 0 },
					{ k: 'DISCARD', seat: 0 },
				],
			},
			body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
		}
		// only a Discard candidate → still payable, logged from the Discard pile
		const s = place(fresh(), 'b22Card', ID('d'), { k: 'DISCARD', seat: 0 }, 0)
		let out = pushAndRun(s, node, SRC, 0)
		expect(out.players[0]!.resources.GLO).toBe(1)
		expect(out.cards[ID('d')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		// only a HAND candidate → payable, logged from the hand
		const s2 = place(fresh(), 'b22Card', ID('h'), { k: 'HAND', seat: 0 }, 0)
		out = pushAndRun(s2, node, SRC, 0)
		expect(out.players[0]!.resources.GLO).toBe(1)
		expect(out.cards[ID('h')]!.zone).toEqual({ k: 'LOG', seat: 0 })
	})
})

/* ------------------------------------------------------------------ *
 * LOG.bind + ICON_COUNT (todo/13 gap #6 — 1SEL07)
 * ------------------------------------------------------------------ */
describe('LOG bind + ICON_COUNT (todo/13 gap #6)', () => {
	it('1SEL07 op[2]: gain 1 {GLO} per Skill icon of the logged opponent LOCATION, then dismiss this ship', () => {
		register([
			makeDef({
				id: 'selLoc',
				suit: 'LOCATION',
				skills: ['SKILL_MILITARY', 'SKILL_RESEARCH'],
				operations: [],
			}),
			makeDef({
				id: 'sel07Ship',
				suit: 'SHIP',
				operations: [],
			}),
		])
		let s = fresh()
		s = place(s, 'selLoc', ID('loc'), { k: 'LOCATION_AREA', seat: 1 }, 1)
		s = place(s, 'sel07Ship', ID('sc'), { k: 'FLEET', seat: 0 }, 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{
					k: 'LOG',
					target: {
						zones: ['IN_PLAY'],
						seat: 'OPPONENT',
						filter: { suits: ['LOCATION'] },
					},
					bind: 'logged',
				},
				{
					k: 'GAIN_RESOURCE',
					res: 'GLO',
					amount: { k: 'ICON_COUNT', bind: 'logged', kind: 'SKILL' },
				},
				{
					k: 'DISMISS',
					target: {
						zones: ['IN_PLAY'],
						seat: 'SELF',
						filter: { ids: ['sel07Ship'] },
					},
				},
			],
		}
		const out = pushAndRun(s, node, SRC, 0)
		expect(out.players[0]!.resources.GLO).toBe(2) // 2 Skill icons on the logged card
		expect(out.cards[ID('loc')]!.zone).toEqual({ k: 'LOG', seat: 0 }) // into the actor's LOG
		expect(out.cards[ID('sc')]!.zone).toEqual({ k: 'DISCARD', seat: 0 }) // dismissed
	})
})

/* ------------------------------------------------------------------ *
 * CardDef passives (todo/13 gap #1 — always-on rule modifiers)
 * ------------------------------------------------------------------ */
describe('CardDef passives (todo/13 gap #1)', () => {
	it('1PER09 / 1SIS09: passive cards in play raise your effective hand size', () => {
		register([
			makeDef({
				id: 'per09',
				suit: 'PERSON',
				passives: ['1PER09_HAND'],
				operations: [],
			}),
			makeDef({
				id: '1SIS09',
				suit: 'PERSON',
				passives: ['1SIS09_HAND'],
				operations: [],
			}),
		])
		let s = fresh()
		expect(effectiveHandSize(s, 0)).toBe(5)
		s = place(s, 'per09', ID('j'), { k: 'FLEET', seat: 0 }, 0)
		expect(effectiveHandSize(s, 0)).toBe(6) // +1
		s = place(s, '1SIS09', ID('g'), { k: 'FLEET', seat: 0 }, 0)
		expect(effectiveHandSize(s, 0)).toBe(8) // +2 more
		// a passive in the HAND (not in play) contributes nothing
		const sHand = place(fresh(), 'per09', ID('j2'), { k: 'HAND', seat: 0 }, 0)
		expect(effectiveHandSize(sHand, 0)).toBe(5)
	})

	it("1BUR10: the Location's passive forbids sending an AWAY TEAM here", () => {
		register([
			makeDef({
				id: 'theta',
				suit: 'LOCATION',
				passives: ['1BUR10_BLOCK'],
				operations: [],
			}),
		])
		const s = place(
			fresh(),
			'theta',
			ID('t'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		expect(blocksSendsTo(s, ID('t'))).toBe(true)
		expect(canSendAwayTeam(s, 0, ID('t'))).toBe(false) // the integrated gate
		expect(canSendAwayTeam(s, 0, ID('t'), true)).toBe(false)
		// 1BUR15 may ignore opponent ships, but cannot ignore 1BUR10.
		const out = pushAndRun(
			pool(s, 0, 2),
			{
				k: 'SEND_AWAY_TEAM',
				count: 1,
				target: { zones: [{ k: 'LOCATION_AREA', seat: 0 }] },
				ignoreBlocking: true,
			},
			SRC,
			0,
		)
		expect(out.awayTeamsAt[ID('t')]).toBeUndefined()
		expect(out.players[0].awayTeamsInPool).toBe(2)
		expect(out.pendingChoice).toBeNull()
	})

	it('1PIC05: your active modifier ignores opponent SHIP tokens at a neutral LOCATION', () => {
		register([
			makeDef({
				id: 'phasing',
				suit: 'CARGO',
				passives: ['1PIC05_BLOCK'],
				operations: [],
			}),
			makeDef({ id: 'neutralLoc', suit: 'LOCATION', operations: [] }),
			makeDef({ id: 'oppShip', suit: 'SHIP', operations: [] }),
		])
		// a neutral Location guarded by an opponent SHIP token (opp 1 > mine 0)
		let s = fresh()
		s = place(s, 'neutralLoc', ID('nl'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, 'oppShip', ID('os'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('nl'),
		})
		// uncloaked → blocked; with 1PIC05 in play → open
		expect(canSendAwayTeam(s, 0, ID('nl'))).toBe(false)
		s = place(s, 'phasing', ID('pc'), { k: 'FLEET', seat: 0 }, 0)
		expect(ignoresOpponentShips(s, 0)).toBe(true)
		expect(ignoresOpponentShips(s, 1)).toBe(false) // only the owner benefits
		expect(canSendAwayTeam(s, 0, ID('nl'))).toBe(true)
	})

	it('1ENC03: scanning includes the Junk, and hand size +1', () => {
		register([
			makeDef({
				id: 'guard',
				suit: 'ENCOUNTER',
				passives: ['1ENC03'],
				operations: [],
			}),
		])
		const s = place(fresh(), 'guard', ID('g'), { k: 'FLEET', seat: 0 }, 0)
		expect(scanIncludesJunk(s, 0)).toBe(true)
		expect(scanIncludesJunk(s, 1)).toBe(false)
		expect(effectiveHandSize(s, 0)).toBe(6)
	})
})
