// The heuristic house AI (todo/15 §4): it is deterministic and its rule
// priors behave. Also pins playBots against autoPlay. The whole-game checks
// (never invalid, beats first-legal) are in heuristic.games.test.ts.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { legalIntents } from '../engine/intents'
import { checkSelection, type PendingChoice } from '../engine/resolver/choices'
import { SKIP_LOCATION } from '../engine/resolver/choices'
import type { CardInstanceId } from '../engine/ids'
import type { Seat } from '../engine/resolver/queries'
import { autoPlay, playBots } from './autoPlay'
import { candidates, MAX_CANDIDATES } from './candidates'
import {
	makeHeuristicBot,
	priorBonus,
	priorSelection,
	PRIORS,
} from './heuristic'
import { firstLegalBot, makeBot } from './index'
import type { Bot } from './types'
import { toAsync } from './types'

let catalog: CardCatalog

beforeAll(async () => {
	catalog = await loadCatalog()
})

type Deck = 'PIC' | 'SHR' | 'KOL' | 'SIS' | 'SEL'

function config(a: Deck, b: Deck, seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: a, boardSide: 'ADVANCED' },
			{ deck: b, boardSide: 'ADVANCED' },
		],
		seed,
	}
}

/** States along a first-legal game, for decision-level checks. */
function statesOf(a: Deck, b: Deck, seed: number, cap = 400): GameState[] {
	const out: GameState[] = []
	autoPlay(setup(config(a, b, seed), catalog), undefined, cap, (s) => {
		out.push(s)
	})
	return out
}

describe('playBots', () => {
	it('two first-legal bots replay autoPlay intent for intent', () => {
		const start = setup(config('PIC', 'SHR', 2), catalog)
		const a = autoPlay(start)
		const b = playBots(start, [firstLegalBot, firstLegalBot])
		expect(b.stopped).toBe(a.stopped)
		expect(b.intents).toEqual(a.intents)
		expect(b.fallbacks).toBe(0)
		expect(b.timing.decisions[0] + b.timing.decisions[1]).toBe(b.steps)
	})

	it('replaces an illegal answer by the first-legal one and counts it', () => {
		const rogue: Bot = { id: 'normal', decide: () => ({ t: 'END_TURN' }) }
		const start = setup(config('KOL', 'SIS', 4), catalog)
		const r = playBots(start, [rogue, firstLegalBot], { cap: 300 })
		expect(r.fallbacksBySeat[0]).toBeGreaterThan(0)
		expect(r.fallbacksBySeat[1]).toBe(0)
		expect(['GAME_OVER', 'CAP']).toContain(r.stopped)
	})
})

describe('heuristic bot', () => {
	it('is deterministic: same input, same output (also through toAsync)', async () => {
		const states = statesOf('SHR', 'KOL', 9, 160).filter((_, i) => i % 9 === 0)
		const a = makeHeuristicBot()
		const b = makeHeuristicBot()
		const easyA = makeBot('easy')
		const easyB = makeBot('easy')
		for (const s of states) {
			if (s.result !== null) continue
			const seat: Seat = s.pendingChoice?.seat ?? s.activeSeat
			const legal = legalIntents(s)
			const before = JSON.stringify(s)
			const out = a.decide(s, seat, legal)
			expect(JSON.stringify(s)).toBe(before) // decide does not mutate
			expect(b.decide(s, seat, legal)).toEqual(out)
			expect(a.decide(s, seat, legal)).toEqual(out)
			expect(easyA.decide(s, seat, legal)).toEqual(easyB.decide(s, seat, legal))
			expect(await toAsync(a).decide(s, seat, legal)).toEqual(out)
		}
	})
})

describe('candidates', () => {
	it('every pending-choice candidate passes checkSelection, within the cap', () => {
		let checked = 0
		for (const s of statesOf('SEL', 'PIC', 13, 300)) {
			const choice = s.pendingChoice
			if (choice === null) continue
			const c = candidates(s, choice.seat, legalIntents(s))
			expect(c.length).toBeGreaterThan(0)
			expect(c.length).toBeLessThanOrEqual(MAX_CANDIDATES)
			for (const i of c) {
				expect(i.t).toBe('RESOLVE_CHOICE')
				if (i.t === 'RESOLVE_CHOICE')
					expect(checkSelection(choice, i.selection).ok).toBe(true)
			}
			checked++
		}
		expect(checked).toBeGreaterThan(10)
	})

	it('top level: deduplicated, PASS dropped beside END_TURN, turn-enders last', () => {
		const s = statesOf('PIC', 'SHR', 3, 200).find(
			(x) =>
				x.result === null && x.pendingChoice === null && x.phase.k === 'ACTION',
		)!
		const legal = legalIntents(s)
		const c = candidates(s, s.activeSeat, [...legal, ...legal])
		expect(c.filter((i) => i.t === 'PASS')).toHaveLength(0)
		expect(c[c.length - 1]).toEqual({ t: 'END_TURN' })
		expect(new Set(c.map((i) => JSON.stringify(i))).size).toBe(c.length)
	})
})

describe('rule priors (todo/15 §4)', () => {
	function withChoice(
		s: GameState,
		phase: GameState['phase'],
		choice: PendingChoice,
	): GameState {
		return { ...s, phase, pendingChoice: choice }
	}
	const base = (): GameState => setup(config('PIC', 'SHR', 1), catalog)

	it('takes control of a secured Location rather than skipping', () => {
		const s0 = base()
		const loc = s0.zones['NEUTRAL_ZONE:0']![0]!
		const s = withChoice(
			s0,
			{ k: 'CONTROL' },
			{
				k: 'CHOOSE_LOCATION',
				id: 'c1',
				seat: 0,
				prompt: '',
				sourceCard: null,
				candidates: [SKIP_LOCATION, loc],
			},
		)
		expect(priorSelection(s, s.pendingChoice!)).toBe(loc)
		const take: Intent = { t: 'RESOLVE_CHOICE', choiceId: 'c1', selection: loc }
		const skip: Intent = {
			t: 'RESOLVE_CHOICE',
			choiceId: 'c1',
			selection: SKIP_LOCATION,
		}
		expect(priorBonus(s, 0, take)).toBe(PRIORS.takeControl)
		expect(priorBonus(s, 0, skip)).toBe(0)
		expect(priorBonus(s, 0, { t: 'COMPLETE_MISSION', index: 0 })).toBe(
			PRIORS.completeMission,
		)
	})

	it('gains the best Market card, keeps the hand at Clean-up, accepts a "may"', () => {
		const s0 = base()
		const offer = (['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const).flatMap(
			(suit) => s0.zones[`MARKET_OFFER:${suit}`] ?? [],
		) as CardInstanceId[]
		expect(offer.length).toBeGreaterThan(1)
		const gain = withChoice(
			s0,
			{ k: 'ACTION' },
			{
				k: 'CHOOSE_CARDS',
				id: 'c2',
				seat: 0,
				prompt: '',
				sourceCard: null,
				candidates: offer,
				min: 1,
				max: 1,
				from: 'MARKET:PERSON',
			},
		)
		const picked = priorSelection(gain, gain.pendingChoice!) as CardInstanceId[]
		expect(picked).toHaveLength(1)
		// it is a highest-prior card, and the skill-match bonus never goes negative
		const bonus = priorBonus(gain, 0, {
			t: 'RESOLVE_CHOICE',
			choiceId: 'c2',
			selection: picked,
		})
		expect(bonus).toBeGreaterThanOrEqual(0)
		const hand = s0.zones['HAND:0'] as CardInstanceId[]
		const discard = withChoice(
			s0,
			{ k: 'CLEANUP', sub: 'DISCARD' },
			{
				k: 'CHOOSE_CARDS',
				id: 'c3',
				seat: 0,
				prompt: '',
				sourceCard: null,
				candidates: hand,
				min: 0,
				max: hand.length,
				from: 'HAND',
			},
		)
		expect(priorSelection(discard, discard.pendingChoice!)).toEqual([])
		const may = withChoice(
			s0,
			{ k: 'ACTION' },
			{
				k: 'CONFIRM',
				id: 'c4',
				seat: 0,
				prompt: '',
				sourceCard: null,
			},
		)
		expect(priorSelection(may, may.pendingChoice!)).toBe(true)
	})
})
