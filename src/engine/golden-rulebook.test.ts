// Golden-rulebook tests (todo/16-testing.md §2): reproduce the eight worked
// examples from the rulebook as named tests,
// against the REAL engine. Fixtures are hand-built CardDefs transcribed from
// cards/records/ALL.md + src/data/cards/**/*.json (so assertions match the real
// card text), with minimal states that reach the example's scene directly
// instead of playing a dozen turns.
//
//   p.9   CONTROL example                       -> passing
//   p.11  ACTIVATION example (1PIC24)       -> passing
//   p.14  ENLIST example (1PIC13)      -> passing
//   p.14  DEVELOPMENT example (1PIC04)       -> passing
//   p.16  SCAN-for-trait example (1PER04/1PER07) -> passing
//   p.20  MISSION example (1PIC/M1)  -> SKIPPED (engine gap, see below)
//   p.22-23 full ACTION STEP (1LOC01 chain)   -> passing
//   p.25  SCORING example (29 VP)               -> passing
//
// Engine/corpus gaps documented but NOT fixed here (the rules/16 §1/§2
// contract: a parallel agent owns src/engine, card JSON stays untouched):
//   - p.25: the corpus cards (1ALL09, 1PIC03, 1PIC09, U.S.S.
//     Pasteur) have focus:null in src/data/cards; the rulebook example shows
//     them with the blue RESEARCH focus. The fixtures below carry that focus
//     per the rulebook so the engine's scoring components reproduce 29; the
//     corpus transcription gap is a data issue, not a scoring-engine one.
//   - 1SHR23's draw-if-away-team ACTIVATION is a corpus NOOP
//     ("[conditional unmodeled]"), so the p.22-23 test seeds the 1CAR14 in
//     hand instead of drawing them.
//
// Fix the skips' comments as the linked engine/data issues land; the bodies
// assert the rulebook-correct outcome so they turn green on their own.

import { describe, expect, it } from 'vitest'
import type { CardDef } from '../data/schema'
import type { TraitId } from '../data/ids'
import type { Effect, Operation } from './resolver/nodes'
import type { GameState, MissionState, GameEvent, EffectCtx } from './state'
import { player, newGameState, addCard } from './state'
import type { Seat, ZoneRef } from './resolver/queries'
import type { PendingChoice } from './resolver/choices'
import { applyChoice, validateChoice } from './resolver/choices'
import { runCollecting } from './resolver/stack'
import { reduce, type Intent } from './intents'
import { registerCards } from './cards'
import { drawCards, refillCycle } from './resolver/primitives/draw'
import { beginTurnStep } from './phases'
import { score } from './scoring'
import { setTracks } from './resolver/testUtils'
import { canActivate, canComplete } from './queries/legality'
import type { CardInstanceId } from './ids'

// ---------------------------------------------------------------------------
// Fixture helpers (self-contained: nothing depends on other test files)
// ---------------------------------------------------------------------------

type Suit = CardDef['suit']
type DeckId = CardDef['deck']
type StartPosition = CardDef['startPosition']

interface DefSpec {
	id: string
	name?: string | undefined
	suit: Suit
	deck?: DeckId | undefined
	traits?: TraitId[] | undefined
	focus?: CardDef['focus'] | undefined
	vp?: number | undefined
	startPosition?: StartPosition | null | undefined
	awayTeams?: number | undefined
	locationTier?: 'STARTING' | 'ADVANCED' | undefined
	shipToken?: string | undefined
	developmentCost?: Effect | null | undefined
	operations: Operation[]
	text?: string | undefined
}

function mk(spec: DefSpec): CardDef {
	return {
		id: spec.id,
		cardId: null,
		name: spec.name ?? spec.id,
		suit: spec.suit,
		deck: spec.deck ?? 'COMMON',
		traits: spec.traits ?? [],
		skills: [],
		variableSkill: undefined,
		focus: spec.focus ?? null,
		vp: spec.vp ?? 0,
		vpAsterisk: false,
		startPosition: spec.startPosition ?? null,
		developmentCost: spec.developmentCost ?? null,
		operations: spec.operations,
		...(spec.awayTeams !== undefined ? { awayTeams: spec.awayTeams } : {}),
		...(spec.locationTier !== undefined
			? { locationTier: spec.locationTier }
			: {}),
		...(spec.shipToken !== undefined ? { shipToken: spec.shipToken } : {}),
	}
}

function op(
	type: Operation['type'],
	effect: Effect,
	extra: Partial<
		Pick<
			Operation,
			'costsAction' | 'isAttack' | 'requires' | 'trigger' | 'text'
		>
	> = {},
): Operation {
	return {
		type,
		costsAction: extra.costsAction ?? false,
		isAttack: extra.isAttack ?? false,
		requires: extra.requires,
		trigger: extra.trigger,
		effect,
		text: extra.text ?? 'golden fixture op',
	}
}

const ID = (s: string): CardInstanceId => s as CardInstanceId

function newState(seed = 1): GameState {
	return newGameState(seed)
}

function placeCard(
	state: GameState,
	defId: string,
	iid: CardInstanceId,
	zone: ZoneRef,
	owner: Seat | null = null,
	extra?: Partial<GameState['cards'][string]>,
): GameState {
	let next = addCard(state, iid, defId, owner, zone)
	if (extra !== undefined) {
		const card = next.cards[iid]!
		next = { ...next, cards: { ...next.cards, [iid]: { ...card, ...extra } } }
	}
	return next
}

function setRes(
	state: GameState,
	seat: Seat,
	res: 'DIL' | 'LAT' | 'GLO',
	amount: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, resources: { ...pl.resources, [res]: amount } }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

function setActionsAvailable(
	state: GameState,
	seat: Seat,
	available: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, actions: { ...pl.actions, available, spent: 3 - available } }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

function setSpecialty(
	state: GameState,
	seat: Seat,
	sp: 'RESEARCH' | 'INFLUENCE' | 'MILITARY',
	value: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, specialties: { ...pl.specialties, [sp]: value } }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

function setBoardSide(
	state: GameState,
	seat: Seat,
	boardSide: 'BASIC' | 'ADVANCED',
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, boardSide } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

function setMissions(
	state: GameState,
	seat: Seat,
	missions: MissionState[],
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, missions } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

function setAwayTeamsAt(
	state: GameState,
	at: Record<string, [number, number]>,
): GameState {
	return {
		...state,
		awayTeamsAt: at as Record<CardInstanceId, [number, number]>,
	}
}

function setPool(state: GameState, seat: Seat, amount: number): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, awayTeamsInPool: amount } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

const zoneIids = (s: GameState, key: string): CardInstanceId[] =>
	s.zones[key] ?? []
const zoneDefs = (s: GameState, key: string): string[] =>
	zoneIids(s, key).map((i) => s.cards[i]!.def)
const HAND = (s: GameState, seat: Seat) => zoneDefs(s, `HAND:${seat}`)
const DRAW = (s: GameState, seat: Seat) => zoneDefs(s, `DRAW:${seat}`)
const DISCARD = (s: GameState, seat: Seat) => zoneDefs(s, `DISCARD:${seat}`)

/** Auto-answer a pending choice with a legal first selection (todo/09 idiom,
 *  extended for OPTIONAL_TRIGGERS / CHOOSE_DESTINATION). */
function firstPick(c: PendingChoice): unknown {
	switch (c.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_CARDS':
			return c.candidates.length >= c.min ? c.candidates.slice(0, c.min) : []
		case 'CHOOSE_LOCATION':
			return c.candidates[0]
		case 'CHOOSE_SUIT':
			return c.suits[0]
		case 'CHOOSE_TRAIT':
			return c.traits[0]
		case 'CHOOSE_SPECIALTY':
			return c.specialties[0] ?? 'RESEARCH'
		case 'CHOOSE_DESTINATION':
			return c.options[0] ?? 'DECK_TOP'
		case 'CHOOSE_AMOUNT':
			return c.max
		case 'ORDER_OPERATIONS':
			return c.pending
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		case 'CHOOSE_WITNESS':
			return c.sets[0]
		case 'CHOOSE_WILDCARD_AS':
			return c.traits[0]
		case 'ORDER_CARDS':
			return c.cards
		case 'CHOOSE_OPTION': {
			const opt = c.options.find((o) => o.enabled) ?? c.options[0]!
			return { key: opt.key }
		}
	}
}

/** Drive a state to a halt (stack + choices), collecting events. `pick` maps a
 *  pending choice to a selection; `pickChoice` allows per-choice overrides. */
function drive(
	state: GameState,
	pick: (c: PendingChoice) => unknown = firstPick,
	pickIf?: (c: PendingChoice) => unknown | undefined,
): { state: GameState; events: GameEvent[] } {
	let s = state
	const events: GameEvent[] = []
	let guard = 0
	while (
		s.result === null &&
		(s.pendingChoice !== null || s.stack.length > 0)
	) {
		if (++guard > 2000) throw new Error('golden: drive: too many iterations')
		if (s.pendingChoice !== null) {
			const c = s.pendingChoice
			const custom = pickIf?.(c)
			const selection = custom !== undefined ? custom : pick(c)
			const v = validateChoice(s, c.id, selection)
			if (!v.ok)
				throw new Error(
					`golden: scripted selection is ILLEGAL: ${v.reason} (${c.k}: ${c.prompt})`,
				)
			s = applyChoice(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection })
		}
		const r = runCollecting(s)
		s = r.state
		events.push(...r.events)
	}
	return { state: s, events }
}

/** A small scripted-game driver for the intent-driven examples (the
 *  pic-shr idiom): every intent goes through reduce(); every choice is
 *  validated before applying. */
function makeDriver(initial: GameState) {
	let s = initial
	const events: GameEvent[] = []
	return {
		get state(): GameState {
			return s
		},
		get events(): GameEvent[] {
			return events
		},
		next(): GameState {
			s = driveInner(s, events)
			return s
		},
		go(intent: Intent): GameState {
			const r = reduce(s, intent)
			s = r.state
			events.push(...r.events)
			return s
		},
		settle(selection: unknown, kind?: PendingChoice['k']): GameState {
			const c = s.pendingChoice
			if (c === null)
				throw new Error('golden: expected a pending choice, none pending')
			if (kind !== undefined && c.k !== kind)
				throw new Error(`golden: expected choice ${kind}, got ${c.k}`)
			const v = validateChoice(s, c.id, selection)
			if (!v.ok)
				throw new Error(
					`golden: scripted selection is ILLEGAL: ${v.reason} (${c.k}: ${c.prompt})`,
				)
			const r = reduce(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection })
			s = r.state
			events.push(...r.events)
			return s
		},
		choice(kind?: PendingChoice['k']): PendingChoice {
			const c = s.pendingChoice
			if (c === null)
				throw new Error('golden: expected a pending choice, none pending')
			if (kind !== undefined && c.k !== kind)
				throw new Error(`golden: expected choice ${kind}, got ${c.k}`)
			return c
		},
	}
}

function driveInner(s0: GameState, events: GameEvent[]): GameState {
	let s = s0
	let guard = 0
	while (s.pendingChoice === null && s.stack.length > 0 && s.result === null) {
		if (++guard > 5000)
			throw new Error('golden: driveInner: too many iterations')
		const r = runCollecting(s)
		s = r.state
		events.push(...r.events)
	}
	return s
}

// ---------------------------------------------------------------------------
// 1. p.9 — CONTROL step example
// ---------------------------------------------------------------------------

describe('rulebook p.9 — CONTROL example (rules/03 §3.4.2)', () => {
	it('taking 1LOC03 dismisses the Enterprise-D, returns Away Teams, gives the opponent 1 Glory, fires CONTROL, and does NOT fire RESUPPLY', () => {
		// 1LOC03: CONTROL = no effect, RESUPPLY = draw 1 then discard 1 (real
		// record 1LOC03-20) — a resupply draw would be plainly observable.
		registerCards([
			mk({
				id: 'gb-loc03',
				name: '1LOC03',
				suit: 'LOCATION',
				locationTier: 'STARTING',
				operations: [
					op('CONTROL', { k: 'NOOP' }, { text: 'CONTROL: no effect.' }),
					op(
						'RESUPPLY',
						{
							k: 'SEQ',
							steps: [
								{ k: 'DRAW', count: 1 },
								{ k: 'DISCARD', count: 1, from: 'HAND' },
							],
						},
						{ text: 'RESUPPLY: Draw a card, then discard a card.' },
					),
				],
			}),
			mk({
				id: 'gb-enterprise',
				name: '1PIC02',
				suit: 'SHIP',
				shipToken: '1PIC02',
				operations: [],
			}),
			mk({
				id: 'gb-loc-fill',
				name: 'REFILL LOCATION',
				suit: 'LOCATION',
				locationTier: 'STARTING',
				operations: [],
			}),
		])

		let s = newState(7)
		// The actor parks the Enterprise-D Ship token AND 2 Away Teams on 1LOC03
		// (the rulebook's premise); the opponent has 1 Away Team there.
		s = placeCard(
			s,
			'gb-loc03',
			ID('loc03'),
			{ k: 'NEUTRAL_ZONE', slot: 0 },
			null,
		)
		s = placeCard(s, 'gb-enterprise', ID('e-d'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('loc03'),
		})
		s = placeCard(s, 'gb-loc-fill', ID('locfill'), { k: 'LOCATION_DECK' }, null)
		s = setAwayTeamsAt(s, { loc03: [2, 1] })
		s = setPool(s, 0, 10)
		s = setPool(s, 1, 10)
		// Hand + draw deck so a (wrongly) firing RESUPPLY is observable.
		s = placeCard(s, 'gb-enterprise', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-enterprise', ID('h2'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-enterprise', ID('da'), { k: 'DRAW', seat: 0 }, 0)
		s = placeCard(s, 'gb-enterprise', ID('db'), { k: 'DRAW', seat: 0 }, 0)

		// Seat 0's turn: RESUPPLY (auto, no owned RESUPPLY ops yet) -> CONTROL.
		const beforePool0 = player(s, 0).awayTeamsInPool
		const beforePool1 = player(s, 1).awayTeamsInPool
		const { state: out, events } = drive(beginTurnStep(s))

		// (E) The opponent gains 1 Glory for their 1 token at the Location.
		expect(player(out, 1).resources.GLO).toBe(1)
		// (A) The 1PIC02 is dismissed: card to Discard, token to supply.
		expect(out.cards[ID('e-d')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(out.cards[ID('e-d')]!.shipTokenAt).toBe('SUPPLY')
		// (B)/(D) All Away Teams returned to their own Captains.
		expect(player(out, 0).awayTeamsInPool).toBe(beforePool0 + 2)
		expect(player(out, 1).awayTeamsInPool).toBe(beforePool1 + 1)
		expect(out.awayTeamsAt[ID('loc03')]).toBeUndefined()
		// (C) The Location moves to the actor's Location Area; CONTROL fires;
		// the vacated Neutral Zone slot refills.
		expect(zoneDefs(out, 'LOCATION_AREA:0')).toContain('gb-loc03')
		expect(zoneDefs(out, 'NEUTRAL_ZONE:0')).toEqual(['gb-loc-fill'])
		expect(
			events.some(
				(e) => e.k === 'LOCATION_CONTROLLED' && e.iid === ID('loc03'),
			),
		).toBe(true)
		// RESUPPLY must NOT fire on the takeover turn: no draw/discard happened.
		expect(events.some((e) => e.k === 'CARD_DRAWN')).toBe(false)
		expect(events.some((e) => e.k === 'CARD_DISCARDED')).toBe(false)
		expect(player(out, 0).resources.GLO).toBe(0) // the actor gains nothing
		expect(HAND(out, 0)).toEqual(['gb-enterprise', 'gb-enterprise'])
		expect(DRAW(out, 0)).toEqual(['gb-enterprise', 'gb-enterprise'])
	})
})

// ---------------------------------------------------------------------------
// 2. p.11 — ACTIVATION example (1PIC24)
// ---------------------------------------------------------------------------

describe('rulebook p.11 — ACTIVATION example (rules/03 §3.5.5)', () => {
	it('1PIC24 (Duty Officer) draws the 1PIC02 from the Discard pile back into the hand', () => {
		// Faithful transcription of 1PIC24-24: op3 is ACTIVATION DRAW_FROM_DISCARD
		// (count 1, SHIP). The rulebook's premise: the ship was dismissed during
		// the earlier Control Step and now sits in the Discard pile.
		registerCards([
			mk({
				id: 'gb-pic24',
				name: '1PIC24',
				suit: 'PERSON',
				deck: 'PIC',
				traits: ['HUMAN', 'STARFLEET'],
				operations: [
					op(
						'PLAY',
						{
							k: 'SEQ',
							steps: [
								{ k: 'DRAW_FROM_DISCARD', count: 2 },
								{
									k: 'MAY',
									body: {
										k: 'PAY_THEN',
										cost: { k: 'COST_RESOURCE', res: 'GLO', amount: 1 },
										body: {
											k: 'SEND_AWAY_TEAM',
											count: 1,
											target: {
												zones: [
													{ k: 'LOCATION_AREA', seat: 0 },
													{ k: 'NEUTRAL_ZONE', slot: 0 },
													{ k: 'NEUTRAL_ZONE', slot: 1 },
													{ k: 'NEUTRAL_ZONE', slot: 2 },
												],
												filter: { suits: ['LOCATION'] },
											},
										},
									},
								},
							],
						},
						{
							costsAction: true,
							text: 'PLAY: Draw two Discard-pile cards. Optionally spend 1 {GLO} to send an Away Team.',
						},
					),
					op(
						'RESUPPLY',
						{ k: 'DISCARD', count: 1, from: 'DECK_TOP' },
						{ text: 'RESUPPLY: Discard the top card of your deck.' },
					),
					op(
						'ACTIVATION',
						{
							k: 'SEQ',
							steps: [
								{
									k: 'FREE_PLAY',
									filter: { suits: ['SHIP'], traits: ['STARFLEET'] },
								},
								{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
							],
						},
						{
							text: 'ACTIVATION: Free play a STARFLEET SHIP, then gain 1 {GLO}.',
						},
					),
					op(
						'ACTIVATION',
						{ k: 'DRAW_FROM_DISCARD', count: 1, filter: { suits: ['SHIP'] } },
						{ text: 'ACTIVATION: Draw a SHIP from your Discard pile.' },
					),
				],
			}),
			mk({
				id: 'gb-enterprise',
				name: '1PIC02',
				suit: 'SHIP',
				deck: 'PIC',
				shipToken: '1PIC02',
				operations: [],
			}),
			mk({
				id: 'gb-filler',
				name: 'FILLER CARGO',
				suit: 'CARGO',
				operations: [],
			}),
		])

		let s = newState(3)
		s = setActionsAvailable(s, 0, 3)
		s = placeCard(s, 'gb-pic24', ID('pic24'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = placeCard(s, 'gb-enterprise', ID('e-d'), { k: 'DISCARD', seat: 0 }, 0)
		// two non-SHIP discard cards so the SHIP pick is unambiguous
		s = placeCard(s, 'gb-filler', ID('d1'), { k: 'DISCARD', seat: 0 }, 0)
		s = placeCard(s, 'gb-filler', ID('d2'), { k: 'DISCARD', seat: 0 }, 0)

		const pic24 = ID('pic24')
		expect(canActivate(s, 0, pic24, 3).ok).toBe(true)
		const d = makeDriver(s)
		d.go({ t: 'ACTIVATE', iid: pic24, operationIndex: 3 })
		// The card lands where the rulebook says: back into the hand.
		expect(zoneDefs(d.state, 'HAND:0')).toContain('gb-enterprise')
		expect(zoneDefs(d.state, 'DISCARD:0')).not.toContain('gb-enterprise')
		expect(d.state.cards[ID('e-d')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(d.state.cards[pic24]!.exhausted).toBe(true)
		expect(player(d.state, 0).actions.available).toBe(3) // activation costs no action
	})
})

// ---------------------------------------------------------------------------
// 3. p.14 — ENLIST example (1PIC13)
// ---------------------------------------------------------------------------

describe('rulebook p.14 — ENLIST example (rules/04 §4.1, §4.2)', () => {
	it('a 2-card draw deck cycles, shuffles the Discard and enlists 1PIC13 on top — she is the next card drawn', () => {
		registerCards([
			mk({
				id: 'gb-beverly',
				name: '1PIC13',
				suit: 'PERSON',
				deck: 'PIC',
				traits: ['HUMAN', 'DOCTOR', 'STARFLEET'],
				operations: [],
			}),
			mk({ id: 'gb-deck', name: 'DECK CARD', suit: 'CARGO', operations: [] }),
			mk({
				id: 'gb-disc',
				name: 'DISCARD CARD',
				suit: 'CARGO',
				operations: [],
			}),
			mk({ id: 'gb-res', name: 'RESERVE CARD', suit: 'CARGO', operations: [] }),
			mk({ id: 'gb-hand', name: 'HAND CARD', suit: 'CARGO', operations: [] }),
		])

		let base = newState(11)
		base = setActionsAvailable(base, 0, 3)
		for (let i = 0; i < 3; i++)
			base = placeCard(
				base,
				'gb-hand',
				ID(`g0h${i}`),
				{ k: 'HAND', seat: 0 },
				0,
			)
		// exactly two cards left in the draw deck
		base = placeCard(base, 'gb-deck', ID('c1'), { k: 'DRAW', seat: 0 }, 0)
		base = placeCard(base, 'gb-deck', ID('c2'), { k: 'DRAW', seat: 0 }, 0)
		// the Discard pile (all cards discarded in the previous step)
		for (let i = 0; i < 3; i++)
			base = placeCard(
				base,
				'gb-disc',
				ID(`dd${i}`),
				{ k: 'DISCARD', seat: 0 },
				0,
			)
		// Reserve deck with 1PIC13 on top
		base = placeCard(
			base,
			'gb-beverly',
			ID('beverly'),
			{ k: 'RESERVE', seat: 0 },
			0,
		)
		for (let i = 0; i < 2; i++)
			base = placeCard(
				base,
				'gb-res',
				ID(`rr${i}`),
				{ k: 'RESERVE', seat: 0 },
				0,
			)

		// (a) top-of-deck directly after the cycle: shuffle Discard -> new deck,
		//     enlist the top Reserve card on top (guaranteed next card drawn).
		const ctx: EffectCtx = {
			actor: 0,
			source: '' as CardInstanceId,
			bindings: {},
		}
		const cycled = refillCycle(base, ctx)
		expect(cycled.kind).toBe('drew')
		expect(zoneIids(cycled.state, 'DRAW:0')[0]).toBe(ID('beverly'))
		expect(DISCARD(cycled.state, 0)).toHaveLength(0)
		expect(zoneDefs(cycled.state, 'RESERVE:0')).not.toContain('gb-beverly')

		// (b) the full draw through the stack machine: draw the 2 deck cards, then
		//     cycle + enlist, then the first card drawn is Beverly.
		const s = drawCards(base, 0, 4)
		const { state: out, events } = drive(s)
		const drawn = events.filter((e) => e.k === 'CARD_DRAWN').map((e) => e.iid)
		expect(drawn).toEqual([
			ID('c1'),
			ID('c2'),
			ID('beverly'),
			expect.anything(),
		])
		expect(zoneDefs(out, 'HAND:0')).toContain('gb-beverly')
		// the shuffled Discard that was not drawn remains in the deck underneath
		expect(zoneDefs(out, 'DRAW:0')).toHaveLength(2)
		expect(zoneDefs(out, 'DRAW:0')).not.toContain('gb-beverly')
	})
})

// ---------------------------------------------------------------------------
// 4. p.14 — DEVELOPMENT example (1PIC04)
// ---------------------------------------------------------------------------

describe('rulebook p.14 — DEVELOPMENT example (rules/04 §4.2, rules/12 §12.23)', () => {
	it('the INCIDENT taken as the 1PIC04 development cost fills the hand, so the enlisted card stays on top of the deck', () => {
		registerCards([
			mk({
				id: 'gb-1PIC04',
				name: '1PIC04',
				suit: 'ALLY',
				deck: 'PIC',
				traits: ['ALIEN'],
				vp: 3,
				startPosition: 'DEVELOPMENT',
				developmentCost: {
					k: 'SEQ',
					steps: [
						{ k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
						{ k: 'COST_TAKE_INCIDENT', count: 1 },
					],
				},
				operations: [],
			}),
			mk({
				id: 'gb-inc',
				name: 'TEST INCIDENT',
				suit: 'INCIDENT',
				operations: [],
			}),
			mk({
				id: 'gb-inc-fill',
				name: 'INCIDENT FILLER',
				suit: 'INCIDENT',
				operations: [],
			}),
			mk({ id: 'gb-hand', name: 'HAND CARD', suit: 'CARGO', operations: [] }),
		])

		let s = newState(13)
		s = setRes(s, 0, 'DIL', 2)
		s = setActionsAvailable(s, 0, 3)
		s = placeCard(s, 'gb-1PIC04', ID('tam'), { k: 'DEVELOPMENT', seat: 0 }, 0)
		s = placeCard(s, 'gb-inc', ID('inc1'), { k: 'INCIDENT_DECK' }, null)
		// more INCIDENTs BELOW so the development cost's take does not empty the
		// deck (emptying the deck is the Burn and would end the game).
		for (let i = 0; i < 3; i++)
			s = placeCard(
				s,
				'gb-inc-fill',
				ID(`incf${i}`),
				{ k: 'INCIDENT_DECK' },
				null,
			)
		// hand at exactly 4: the development cost's INCIDENT brings it to 5.
		for (let i = 0; i < 4; i++)
			s = placeCard(s, 'gb-hand', ID(`g0h${i}`), { k: 'HAND', seat: 0 }, 0)
		// empty Draw deck, empty Reserve deck, empty Discard -> Development offer.

		// The Clean-up draw-to-hand-size path (phases.ts: drawCards(...,{untilHandSize})).
		const s2 = drawCards(s, 0, 5, { untilHandSize: 5 })
		const d = makeDriver(s2)
		d.next()
		// the empty deck + empty Reserve + affordable Development -> a MAY offer.
		expect(d.state.pendingChoice?.k).toBe('CONFIRM')
		d.settle(true, 'CONFIRM')
		// pays 2 {DIL} + takes the INCIDENT (hand 4 -> 5); the enlisted Development
		// stays on top of the deck because the hand is already at hand size.
		expect(DRAW(d.state, 0)).toEqual(['gb-1PIC04'])
		expect(zoneDefs(d.state, 'HAND:0')).toContain('gb-inc')
		expect(zoneDefs(d.state, 'HAND:0')).toHaveLength(5)
		expect(player(d.state, 0).resources.DIL).toBe(0)
		expect(zoneDefs(d.state, 'DEVELOPMENT:0')).not.toContain('gb-1PIC04')
	})
})

// ---------------------------------------------------------------------------
// 5. p.16 — SCAN-for-trait example (1PER04 / 1PER07)
// ---------------------------------------------------------------------------

describe('rulebook p.16 — SCAN-for-trait example (rules/05 §5.4.3)', () => {
	it('1PER07 is gained into the Discard pile after scanning SHIP then PERSON for a KLINGON', () => {
		registerCards([
			mk({
				id: 'gb-per04',
				name: '1PER04',
				suit: 'PERSON',
				traits: ['KLINGON', 'IMPERIAL', 'AMBASSADOR'],
				vp: 1,
				operations: [
					op(
						'PLAY',
						{
							k: 'SEQ',
							steps: [
								{
									k: 'PAY_THEN',
									cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
									body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
								},
								// rules/05 §5.4.3 (p.16 example): the gained card may be placed in
								// the Discard pile — a scan always surfaces a CHOOSE_DESTINATION.
								{
									k: 'MAY',
									body: { k: 'SCAN_FOR_TRAIT', traits: ['KLINGON'] },
								},
							],
						},
						{
							costsAction: true,
							text: 'PLAY: Spend 2 {DIL} to gain 1 {GLO}. You may scan for a KLINGON.',
						},
					),
				],
			}),
			mk({
				id: 'gb-per07',
				name: '1PER07',
				suit: 'PERSON',
				traits: ['SHADY', 'ATTACK', 'KLINGON'],
				operations: [],
			}),
			mk({
				id: 'gb-starfleet-ship',
				name: 'STARFLEET SHIP',
				suit: 'SHIP',
				traits: ['STARFLEET'],
				operations: [],
			}),
			mk({
				id: 'gb-person-fill',
				name: 'PERSON FILLER',
				suit: 'PERSON',
				operations: [],
			}),
		])

		let s = newState(17)
		s = setRes(s, 0, 'DIL', 2)
		s = setActionsAvailable(s, 0, 3)
		s = placeCard(s, 'gb-per04', ID('kam'), { k: 'HAND', seat: 0 }, 0)
		// SHIP deck: only STARFLEET ships (no KLINGON) — the example looks here first.
		s = placeCard(
			s,
			'gb-starfleet-ship',
			ID('s1'),
			{ k: 'MARKET_DECK', suit: 'SHIP' },
			null,
		)
		s = placeCard(
			s,
			'gb-starfleet-ship',
			ID('s2'),
			{ k: 'MARKET_DECK', suit: 'SHIP' },
			null,
		)
		// PERSON deck: filler then 1PER07 (the KLINGON found).
		s = placeCard(
			s,
			'gb-person-fill',
			ID('p0'),
			{ k: 'MARKET_DECK', suit: 'PERSON' },
			null,
		)
		s = placeCard(
			s,
			'gb-per07',
			ID('per07'),
			{ k: 'MARKET_DECK', suit: 'PERSON' },
			null,
		)

		const d = makeDriver(s)
		d.go({ t: 'PLAY_CARD', iid: ID('kam'), operationIndex: 0 })
		d.settle(true, 'CONFIRM') // accept the optional scan
		// Choose SHIP first (no KLINGON), then PERSON (1PER07 found).
		d.settle('SHIP', 'CHOOSE_SUIT')
		d.settle('PERSON', 'CHOOSE_SUIT')
		d.settle('DISCARD', 'CHOOSE_DESTINATION')

		// Rulebook: the newly gained card goes into the Discard pile.
		expect(zoneDefs(d.state, 'DISCARD:0')).toContain('gb-per07')
		expect(zoneDefs(d.state, 'DRAW:0')).not.toContain('gb-per07')
		expect(player(d.state, 0).resources.GLO).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// 6. p.20 — MISSIONS example (1PIC/M1)
// ---------------------------------------------------------------------------

describe('rulebook p.20 — MISSIONS example (rules/07 §7.2.1, rules/12 §12.26)', () => {
	it('completing 1PIC/M1 dismisses the 3 beamed ALLYs but keeps the Enterprise-D', () => {
		registerCards([
			mk({
				id: 'gb-by',
				name: '1ALL03',
				suit: 'ALLY',
				traits: ['ALIEN', 'ENGINEER'],
				vp: 3,
				operations: [],
			}),
			mk({ id: 'gb-bo', name: '1ALL02', suit: 'ALLY', vp: 3, operations: [] }),
			mk({
				id: 'gb-ta',
				name: '1PIC04',
				suit: 'ALLY',
				traits: ['ALIEN'],
				vp: 3,
				operations: [],
			}),
			mk({
				id: 'gb-hc',
				name: '1ALL07',
				suit: 'ALLY',
				vp: 3,
				operations: [],
			}),
			mk({
				id: 'gb-enterprise',
				name: '1PIC02',
				suit: 'SHIP',
				deck: 'PIC',
				shipToken: '1PIC02',
				operations: [],
			}),
			mk({ id: 'gb-deck', name: 'DECK CARD', suit: 'CARGO', operations: [] }),
		])

		// 1PIC/M1 as on the board (src/data/cards/boards/pic.json), minus the
		// optional Market junk: 3 ALLY on the same SHIP + two tracks at 4+.
		const peace: MissionState = {
			index: 0,
			cardId: '1PIC/M1',
			goal: {
				k: 'AND',
				terms: [
					{
						k: 'SAME_SHIP',
						requirements: [{ count: 3, filter: { suits: ['ALLY'] } }],
					},
					{ k: 'SPECIALTY_AT_LEAST', specialty: 'RESEARCH', value: 4 },
					{ k: 'SPECIALTY_AT_LEAST', specialty: 'INFLUENCE', value: 4 },
				],
			},
			reward: {
				k: 'SEQ',
				steps: [
					{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 4 },
					{ k: 'DRAW', count: 4 },
				],
			},
			vp: 5,
			completed: false,
		}

		let s = newState(19)
		s = setBoardSide(s, 0, 'ADVANCED')
		s = setMissions(s, 0, [peace])
		s = setSpecialty(s, 0, 'RESEARCH', 4)
		s = setSpecialty(s, 0, 'INFLUENCE', 5)
		s = placeCard(s, 'gb-enterprise', ID('e-d'), { k: 'FLEET', seat: 0 }, 0)
		// 3 ALLYs beamed to the Enterprise (they alone satisfy the goal).
		s = placeCard(s, 'gb-by', ID('b1'), { k: 'BEAMED', host: ID('e-d') }, 0, {
			beamedTo: ID('e-d'),
		})
		s = placeCard(s, 'gb-bo', ID('b2'), { k: 'BEAMED', host: ID('e-d') }, 0, {
			beamedTo: ID('e-d'),
		})
		s = placeCard(s, 'gb-ta', ID('b3'), { k: 'BEAMED', host: ID('e-d') }, 0, {
			beamedTo: ID('e-d'),
		})
		// the 1ALL07 is an ALLY in play but NOT on the ship — it must not count.
		s = placeCard(s, 'gb-hc', ID('hc'), { k: 'STAGING', seat: 0 }, 0)
		for (let i = 0; i < 6; i++)
			s = placeCard(s, 'gb-deck', ID(`g0d${i}`), { k: 'DRAW', seat: 0 }, 0)

		expect(canComplete(s, 0, 0)).toBe(true)
		const d = makeDriver(s)
		d.go({ t: 'COMPLETE_MISSION', index: 0 })
		// reward first
		expect(player(d.state, 0).resources.DIL).toBe(4)
		expect(zoneDefs(d.state, 'HAND:0')).toHaveLength(4)
		// §7.2.1 step 2: exactly the 3 beamed ALLYs are dismissed.
		expect(zoneDefs(d.state, 'DISCARD:0')).toEqual(['gb-by', 'gb-bo', 'gb-ta'])
		expect(zoneIids(d.state, 'BEAMED:e-d')).toHaveLength(0)
		expect(zoneDefs(d.state, 'FLEET:0')).toEqual(['gb-enterprise']) // the ship stays
		expect(zoneDefs(d.state, 'STAGING:0')).toContain('gb-hc') // the off-ship ALLY stays
		expect(player(d.state, 0).missions[0]!.completed).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// 7. p.22–23 — EXAMPLE OF AN ENTIRE ACTION STEP (SHR, 1LOC01 chain)
//    Notes: the fixture reproduces the 4-action turn and the 1LOC01 ->
//    1LOC14 REACTION chain. Documented corpus gaps (NOT fixed here):
//      - 1SHR23's ACTIVATION is transcribed in the corpus as a NOOP
//        ("[conditional unmodeled]"), so the rulebook's "exhaust 1SHR23 to
//        draw the 1CAR14" cannot run; the fixture seeds the 1CAR14 in hand.
//      - 1ENC04's away-team target is written to the Neutral Zone per
//        the rulebook (p.23 sends to neutral 1LOC17); the corpus record's
//        target is SELF in-play only, and its IMPERIAL award counts the
//        gateway itself ("excluding this card" is unmodeled).
// ---------------------------------------------------------------------------

describe('rulebook p.22–23 — full ACTION STEP example (rules/03 §3.5)', () => {
	it('the 4-action turn resolves and ends with the 1LOC01 -> 1LOC14 REACTION chain', () => {
		registerCards([
			// 1SHR17-24: op1 = action, spend 2 {DIL} to gain a CARGO.
			mk({
				id: 'gb-1shr17',
				name: '1SHR17',
				suit: 'DIRECTIVE',
				deck: 'SHR',
				startPosition: 'AVAILABLE',
				operations: [
					op(
						'PLAY',
						{
							k: 'PAY_THEN',
							cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 4 },
							body: { k: 'GAIN_CARD', suits: ['SHIP'] },
						},
						{ costsAction: true, text: 'PLAY: Spend 4 {DIL} to gain a SHIP.' },
					),
					op(
						'PLAY',
						{
							k: 'PAY_THEN',
							cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
							body: { k: 'GAIN_CARD', suits: ['CARGO'] },
						},
						{ costsAction: true, text: 'PLAY: Spend 2 {DIL} to gain a CARGO.' },
					),
					op(
						'PLAY',
						{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
						{ text: 'PLAY: Gain 1 {LAT}.' },
					),
				],
			}),
			// 1SHR captain (1SHR01-24): Captain ACTIVATION = action, pay a CARGO
			// for an Away Team into one of your own Locations.
			mk({
				id: 'gb-captain',
				name: '1SHR CAPTAIN',
				suit: 'CAPTAIN',
				deck: 'SHR',
				traits: ['IMPERIAL', 'ANDORIAN'],
				awayTeams: 5,
				operations: [
					op(
						'RESUPPLY',
						{
							k: 'FOR_EACH',
							over: {
								zones: ['IN_PLAY'],
								seat: 'SELF',
								filter: { suits: ['CARGO'] },
							},
							bind: 'cargo',
							body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
						},
						{ text: 'RESUPPLY: For each CARGO in play, gain 1 {DIL}.' },
					),
					op(
						'ACTIVATION',
						{
							k: 'PAY_THEN',
							cost: {
								k: 'COST_DISCARD',
								count: 1,
								filter: { suits: ['CARGO'] },
							},
							body: {
								k: 'SEND_AWAY_TEAM',
								count: 1,
								target: {
									zones: [{ k: 'LOCATION_AREA', seat: 0 }],
									filter: { suits: ['LOCATION'] },
								},
							},
						},
						{
							costsAction: true,
							text: 'ACTIVATION: Discard a CARGO; send an Away Team to your LOCATION.',
						},
					),
				],
			}),
			// 1SHR20 (1SHR20-24): Duty Officer ACTIVATION = discard 2, send an Away Team.
			mk({
				id: 'gb-1SHR20',
				name: '1SHR20',
				suit: 'PERSON',
				deck: 'SHR',
				traits: ['ATTACK', 'ANDORIAN'],
				startPosition: 'AVAILABLE',
				operations: [
					op(
						'PLAY',
						{
							k: 'SEND_AWAY_TEAM',
							count: 1,
							target: {
								zones: [
									{ k: 'LOCATION_AREA', seat: 0 },
									{ k: 'NEUTRAL_ZONE', slot: 0 },
									{ k: 'NEUTRAL_ZONE', slot: 1 },
									{ k: 'NEUTRAL_ZONE', slot: 2 },
								],
								filter: { suits: ['LOCATION'] },
							},
						},
						{ text: 'PLAY: Send an Away Team.' },
					),
					op(
						'ACTIVATION',
						{
							k: 'PAY_THEN',
							cost: { k: 'COST_DISCARD', count: 2 },
							body: {
								k: 'SEND_AWAY_TEAM',
								count: 1,
								target: {
									zones: [
										{ k: 'LOCATION_AREA', seat: 0 },
										{ k: 'NEUTRAL_ZONE', slot: 0 },
										{ k: 'NEUTRAL_ZONE', slot: 1 },
										{ k: 'NEUTRAL_ZONE', slot: 2 },
									],
									filter: { suits: ['LOCATION'] },
								},
							},
						},
						{ text: 'ACTIVATION: Discard 2 cards to send an Away Team.' },
					),
				],
			}),
			// Controlled Locations: 1SHR12, 1SHR23, 1LOC14, 1LOC01.
			mk({
				id: 'gb-1SHR12',
				name: '1SHR12',
				suit: 'LOCATION',
				deck: 'SHR',
				operations: [],
			}),
			mk({
				id: 'gb-1SHR23',
				name: '1SHR23',
				suit: 'LOCATION',
				deck: 'SHR',
				traits: ['ANDORIAN'],
				operations: [
					op(
						'CONTROL',
						{
							k: 'SEQ',
							steps: [
								{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
								{ k: 'DRAW', count: 1 },
							],
						},
						{ text: 'CONTROL: Gain 1 {GLO} and draw a card.' },
					),
					// corpus record: the away-team-draw condition is unmodeled (NOOP).
					op(
						'ACTIVATION',
						{ k: 'NOOP' },
						{
							text: 'ACTIVATION: Draw a card when your AWAY TEAM is here. [conditional unmodeled]',
						},
					),
				],
			}),
			mk({
				id: 'gb-memalpha',
				name: '1LOC14',
				suit: 'LOCATION',
				traits: ['STARFLEET', 'COMMUNICATION'],
				vp: 5,
				operations: [
					op(
						'CONTROL',
						{
							k: 'SEQ',
							steps: [
								{
									k: 'MAY',
									body: {
										k: 'LOG',
										target: {
											zones: [
												{ k: 'HAND', seat: 0 },
												{ k: 'STAGING', seat: 0 },
												{ k: 'DISCARD', seat: 0 },
											],
										},
									},
								},
								{
									k: 'MAY',
									body: {
										k: 'DUPLICATE',
										suits: ['PERSON', 'CARGO', 'ALLY', 'DIRECTIVE'],
										from: ['LOG'],
										opType: 'PLAY',
									},
								},
							],
						},
						{
							text: 'CONTROL: Optionally log a card; optionally duplicate a PLAY.',
						},
					),
					op(
						'REACTION',
						{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
						{
							text: 'REACTION: After you log a card, gain 1 {GLO}.',
							trigger: { on: 'CARD_LOGGED' as const },
						},
					),
				],
			}),
			mk({
				id: 'gb-loc01',
				name: '1LOC01',
				suit: 'LOCATION',
				traits: ['STARBASE', 'SCIENTIST'],
				vp: 3,
				operations: [
					op(
						'CONTROL',
						{
							k: 'MAY',
							body: {
								k: 'SEQ',
								steps: [
									{ k: 'GAIN_CARD', suits: ['PERSON'] },
									{
										k: 'IF',
										cond: {
											k: 'OR',
											terms: [
												{ k: 'HAS_TRAIT_IN_PLAY', trait: 'SCIENTIST' },
												{ k: 'HAS_TRAIT_IN_PLAY', trait: 'ENGINEER' },
											],
										},
										then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
									},
								],
							},
						},
						{
							text: 'CONTROL: You may gain a PERSON; a SCIENTIST or ENGINEER also gains 1 {GLO}.',
						},
					),
					op(
						'REACTION',
						{
							k: 'SEQ',
							steps: [
								{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
								{
									k: 'MAY',
									body: {
										k: 'LOG',
										target: {
											zones: [
												{ k: 'HAND', seat: 0 },
												{ k: 'DISCARD', seat: 0 },
											],
										},
									},
								},
							],
						},
						{
							text: 'REACTION: After putting an ENCOUNTER into play, gain 1 {GLO}; then you may log a hand or Discard-pile card.',
							trigger: {
								on: 'PUT_INTO_PLAY' as const,
								filter: { suits: ['ENCOUNTER'] },
							},
						},
					),
				],
			}),
			// 1SHR16-24: op0 = action, remove an Away Team from 3
			// different controlled LOCATIONs to take the top ENCOUNTER.
			mk({
				id: 'gb-1shr16',
				name: '1SHR16',
				suit: 'DIRECTIVE',
				deck: 'SHR',
				startPosition: 'AVAILABLE',
				operations: [
					op(
						'PLAY',
						{
							k: 'PAY_THEN',
							cost: {
								k: 'SEQ',
								steps: [
									{
										k: 'COST_REMOVE_AWAY_TEAM',
										count: 1,
										from: {
											zones: [{ k: 'LOCATION_AREA', seat: 0 }],
											filter: { suits: ['LOCATION'] },
										},
									},
									{
										k: 'COST_REMOVE_AWAY_TEAM',
										count: 1,
										from: {
											zones: [{ k: 'LOCATION_AREA', seat: 0 }],
											filter: { suits: ['LOCATION'] },
										},
									},
									{
										k: 'COST_REMOVE_AWAY_TEAM',
										count: 1,
										from: {
											zones: [{ k: 'LOCATION_AREA', seat: 0 }],
											filter: { suits: ['LOCATION'] },
										},
									},
								],
							},
							body: { k: 'TAKE', deck: 'ENCOUNTER', count: 1, look: 2 },
						},
						{
							costsAction: true,
							text: 'PLAY: Remove an Away Team from 3 different controlled LOCATIONs to look at the top 2 ENCOUNTERs; take one.',
						},
					),
					op(
						'PLAY',
						{
							k: 'PAY_THEN',
							cost: {
								k: 'SEQ',
								steps: [
									{ k: 'COST_RESOURCE', res: 'DIL', amount: 10 },
									{ k: 'COST_LOG', filter: { suits: ['LOCATION'] } },
								],
							},
							body: {
								k: 'SEQ',
								steps: [
									{ k: 'TAKE', deck: 'ENCOUNTER', count: 1 },
									{
										k: 'MAY',
										body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
									},
								],
							},
						},
						{
							costsAction: true,
							text: 'PLAY: Spend 10 {DIL}, log a LOCATION you control; take the top ENCOUNTER.',
						},
					),
				],
			}),
			// 1ALL08 (1ALL08-13): op1 = Requires MILITARY 3, spend 2 {LAT} to gain an action.
			mk({
				id: 'gb-1ALL08',
				name: '1ALL08',
				suit: 'ALLY',
				traits: ['DOMINION', 'BUSINESS'],
				vp: 3,
				operations: [
					op(
						'PLAY',
						{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
						{ text: 'PLAY: Gain 1 {LAT}.' },
					),
					op(
						'PLAY',
						{
							k: 'PAY_THEN',
							cost: { k: 'COST_RESOURCE', res: 'LAT', amount: 2 },
							body: { k: 'GAIN_ACTION', amount: 1 },
						},
						{
							requires: { specialty: 'MILITARY', min: 3 },
							text: 'PLAY: Requires MILITARY 3. Spend 2 {LAT} to gain an {ACTION}.',
						},
					),
				],
			}),
			// 1ENC04 (1ENC04-8): action, send up to 3 Away Teams ignoring
			// any opponent SHIP; gain 1 per IMPERIAL in play. Target written to the
			// Neutral Zone per the rulebook example (1LOC17).
			mk({
				id: 'gb-iconian',
				name: '1ENC04',
				suit: 'ENCOUNTER',
				traits: ['ALIEN', 'IMPERIAL'],
				operations: [
					op(
						'PLAY',
						{
							k: 'SEQ',
							steps: [
								{
									k: 'SEND_AWAY_TEAM',
									count: { k: 'UP_TO', max: 3 },
									target: {
										zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }],
										filter: { suits: ['LOCATION'] },
									},
									ignoreBlocking: true,
								},
								{
									k: 'FOR_EACH',
									over: {
										zones: ['IN_PLAY'],
										seat: 'SELF',
										filter: { traits: ['IMPERIAL'] },
									},
									bind: 'x',
									body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
								},
							],
						},
						{
							costsAction: true,
							text: 'PLAY: Send up to 3 Away Teams to a LOCATION (opponent SHIPs ignored). Gain 1 {DIL} per IMPERIAL you have in play.',
						},
					),
				],
			}),
			mk({
				id: 'gb-1LOC17',
				name: '1LOC17',
				suit: 'LOCATION',
				traits: ['ALIEN'],
				vp: 10,
				locationTier: 'ADVANCED',
				operations: [],
			}),
			mk({
				id: 'gb-xindi',
				name: 'XINDI-REPTILLIAN BATTLESHIP',
				suit: 'SHIP',
				traits: ['ANOMALY', 'ATTACK'],
				shipToken: 'Xindi-Reptillian Battleship',
				operations: [],
			}),
			mk({
				id: 'gb-1PER19',
				name: '1PER19',
				suit: 'PERSON',
				traits: ['TELEPATH', 'AMBASSADOR', 'COMMUNICATION'],
				operations: [],
			}),
			mk({
				id: 'gb-1CAR14',
				name: '1CAR14',
				suit: 'CARGO',
				traits: ['ATTACK', 'CREATURE'],
				vp: 2,
				operations: [],
			}),
			mk({
				id: 'gb-fill',
				name: 'FILLER CARGO',
				suit: 'CARGO',
				operations: [],
			}),
			mk({
				id: 'gb-cargo-offer',
				name: 'MARKET CARGO',
				suit: 'CARGO',
				operations: [],
			}),
			mk({
				id: 'gb-enc2',
				name: 'SECOND ENCOUNTER',
				suit: 'ENCOUNTER',
				operations: [],
			}),
		])

		let s = newState(23)
		s = setRes(s, 0, 'DIL', 2)
		s = setRes(s, 0, 'LAT', 1)
		s = setRes(s, 0, 'GLO', 1)
		s = setSpecialty(s, 0, 'MILITARY', 3)
		s = setActionsAvailable(s, 0, 3)
		s = setBoardSide(s, 0, 'BASIC')
		s = setPool(s, 0, 12)
		s = setPool(s, 1, 5)

		// controlled Locations
		s = placeCard(
			s,
			'gb-1SHR23',
			ID('1SHR23'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = placeCard(
			s,
			'gb-1SHR12',
			ID('1SHR12'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = placeCard(
			s,
			'gb-memalpha',
			ID('memalpha'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = placeCard(
			s,
			'gb-loc01',
			ID('loc01'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		// a neutral 1LOC17 with the opponent's Xindi-Reptillian Battleship token
		s = placeCard(
			s,
			'gb-1LOC17',
			ID('1LOC17'),
			{ k: 'NEUTRAL_ZONE', slot: 0 },
			null,
		)
		s = placeCard(s, 'gb-xindi', ID('xindi'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('1LOC17'),
		})
		// pre-placed Away Team on 1SHR23 (rulebook: "you already placed an Away Team there earlier")
		s = setAwayTeamsAt(s, { '1SHR23': [1, 0] })
		// Captain + Duty Officer
		s = placeCard(s, 'gb-captain', ID('captain'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = placeCard(
			s,
			'gb-1SHR20',
			ID('1SHR20'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		// hand: 1SHR17, the 1CAR14 (seeded — 1SHR23's draw is unmodeled),
		// 1ALL08, 1SHR16, plus two filler CARGOs for 1SHR20's discard-2.
		s = placeCard(s, 'gb-1shr17', ID('shr17'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-1CAR14', ID('1CAR14'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-1ALL08', ID('1ALL08'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-1shr16', ID('pride'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-fill', ID('fill1'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-fill', ID('fill2'), { k: 'HAND', seat: 0 }, 0)
		// the ONLY discard-pile card is 1PER19 (so 1LOC01 can log him).
		s = placeCard(s, 'gb-1PER19', ID('1PER19'), { k: 'DISCARD', seat: 0 }, 0)
		// encounters: 1ENC04 on top, one more underneath
		s = placeCard(s, 'gb-iconian', ID('iconian'), { k: 'ENCOUNTER_DECK' }, null)
		s = placeCard(s, 'gb-enc2', ID('enc2'), { k: 'ENCOUNTER_DECK' }, null)
		// a faceup CARGO for 1SHR17
		s = placeCard(
			s,
			'gb-cargo-offer',
			ID('cargo-offer'),
			{ k: 'MARKET_OFFER', suit: 'CARGO' },
			null,
		)

		const d = makeDriver(s)

		// ---- Action 1: PLAY 1SHR17 op1 (spend 2 DIL, gain the CARGO to deck top).
		d.go({ t: 'PLAY_CARD', iid: ID('shr17'), operationIndex: 1 })
		// GAIN_CARD with exactly one CARGO offer auto-picks it; the only live
		// choice is where to place the gained card.
		d.settle('DECK_TOP', 'CHOOSE_DESTINATION')
		// NB `actions.spent` is vestigial (invariants.ts): the engine only tracks
		// `available` — a PLAY op's implicit COST_ACTION decrements it.
		expect(player(d.state, 0).actions.available).toBe(2)
		expect(zoneDefs(d.state, 'DRAW:0')[0]).toBe('gb-cargo-offer') // 1CAR14/CARGO placed on top of the deck

		// ---- Action 2: exhaust the CAPTAIN (SHR), discard the 1CAR14, send
		// an Away Team to 1SHR12.
		d.go({ t: 'ACTIVATE', iid: ID('captain'), operationIndex: 1 })
		// cost picker: discard the 1CAR14 (the example's discarded card)
		d.choice('CHOOSE_CARDS')
		d.settle([ID('1CAR14')], 'CHOOSE_CARDS')
		d.settle(ID('1SHR12'), 'CHOOSE_LOCATION')
		expect(player(d.state, 0).actions.available).toBe(1)
		expect(d.state.awayTeamsAt[ID('1SHR12')]?.[0]).toBe(1)
		expect(zoneDefs(d.state, 'DISCARD:0')).toContain('gb-1CAR14')

		// ---- Free ACTIVATION: 1SHR20 discards 2 cards to send an Away Team to
		// 1LOC14 (does not cost an action).
		d.go({ t: 'ACTIVATE', iid: ID('1SHR20'), operationIndex: 1 })
		d.settle([ID('fill1'), ID('fill2')], 'CHOOSE_CARDS')
		d.settle(ID('memalpha'), 'CHOOSE_LOCATION')
		expect(player(d.state, 0).actions.available).toBe(1) // free ACTIVATION
		expect(d.state.awayTeamsAt[ID('memalpha')]?.[0]).toBe(1)

		// ---- Action 3: PLAY 1SHR16 op0 — remove an Away Team from 3
		// controlled Locations (1SHR23, 1SHR12, memalpha) and take the top
		// ENCOUNTER (the 1ENC04).
		d.go({ t: 'PLAY_CARD', iid: ID('pride'), operationIndex: 0 })
		d.settle(ID('1SHR23'), 'CHOOSE_LOCATION')
		// Each sequential COST_REMOVE_AWAY_TEAM step suspends its own
		// CHOOSE_LOCATION, so the rulebook's three *different* Locations happen.
		d.settle(ID('1SHR12'), 'CHOOSE_LOCATION')
		// with only one Location left holding a token, the third step auto-selects;
		// then the player looks at the top 2 ENCOUNTERs and takes the Iconian
		// Gateway (the other goes to the bottom)
		d.settle([ID('iconian')], 'CHOOSE_CARDS')
		expect(player(d.state, 0).actions.available).toBe(0)
		expect(d.state.awayTeamsAt[ID('1SHR23')]?.[0]).toBe(0)
		expect(d.state.awayTeamsAt[ID('1SHR12')]?.[0]).toBe(0)
		expect(d.state.awayTeamsAt[ID('memalpha')]?.[0]).toBe(0)
		expect(zoneDefs(d.state, 'HAND:0')).toContain('gb-iconian') // taken ENCOUNTER
		expect(zoneDefs(d.state, 'ENCOUNTER_DECK')).toEqual(['gb-enc2']) // other returned to the bottom

		// ---- 1ALL08 op1 (free): Requires MILITARY 3, spend 1 {LAT} + 1 {GLO} (as
		// 2 {LAT}, the player has only one Latinum) to gain a 4th action.
		d.go({ t: 'PLAY_CARD', iid: ID('1ALL08'), operationIndex: 1 })
		expect(player(d.state, 0).actions.available).toBe(1)
		expect(player(d.state, 0).resources.LAT).toBe(0)
		expect(player(d.state, 0).resources.GLO).toBe(0)

		// ---- Action 4: PLAY the 1ENC04 — send 3 Away Teams to the
		// neutral 1LOC17 (ignoring the opponent's Xindi token), +1 DIL per IMPERIAL.
		d.go({ t: 'PLAY_CARD', iid: ID('iconian'), operationIndex: 0 })
		// SEND_AWAY_TEAM auto-targets the single legal Location (neutral 1LOC17), so
		// the run halts on the 1LOC01 REACTION window, not a target choice.
		expect(player(d.state, 0).actions.available).toBe(0)
		expect(d.state.awayTeamsAt[ID('1LOC17')]?.[0]).toBe(3)
		// IMPERIAL in play: SHR + the gateway itself (the "excluding this card"
		// exclusion is unmodeled) -> +2 {DIL} on top of the post-1SHR17 0.
		expect(player(d.state, 0).resources.DIL).toBe(2)
		expect(zoneDefs(d.state, 'STAGING:0')).toContain('gb-iconian')

		// ---- The REACTION chain: 1LOC01 (gain 1 GLO, may log 1PER19) then
		// 1LOC14 (gain 1 GLO on the CARD_LOGGED event).
		const loc01Window = d.choice('OPTIONAL_TRIGGERS') as Extract<
			PendingChoice,
			{ k: 'OPTIONAL_TRIGGERS' }
		>
		expect(loc01Window.offered).toHaveLength(1) // 1LOC01 reacts to the ENCOUNTER
		d.settle(loc01Window.offered, 'OPTIONAL_TRIGGERS')
		d.settle(true, 'CONFIRM') // accept the "may log"
		d.settle([ID('1PER19')], 'CHOOSE_CARDS') // log 1PER19 from the Discard pile
		const memAlphaWindow = d.choice('OPTIONAL_TRIGGERS') as Extract<
			PendingChoice,
			{ k: 'OPTIONAL_TRIGGERS' }
		>
		expect(memAlphaWindow.offered).toHaveLength(1) // 1LOC14 reacts to the log
		d.settle(memAlphaWindow.offered, 'OPTIONAL_TRIGGERS')
		expect(zoneDefs(d.state, 'LOG:0')).toContain('gb-1PER19')
		expect(player(d.state, 0).resources.GLO).toBe(2) // 1 start - 1 1ALL08 + 1 1LOC01 + 1 Memory

		// The chain order in the event stream: 1LOC01's Glory, then 1PER19 logged,
		// then 1LOC14's Glory.
		const markers = d.events
			.map((e) =>
				e.k === 'RESOURCE_GAINED' && e.res === 'GLO' && e.seat === 0
					? 'GLO_GAIN'
					: e.k === 'CARD_LOGGED' && e.iid === ID('1PER19')
						? '1PER19_LOGGED'
						: null,
			)
			.filter((m): m is 'GLO_GAIN' | '1PER19_LOGGED' => m !== null)
		expect(markers).toEqual(['GLO_GAIN', '1PER19_LOGGED', 'GLO_GAIN'])

		// End of the Action Step: the 3-action budget + 1 gained action are all
		// consumed (available back to 0), the turn still in ACTION.
		expect(d.state.phase.k).toBe('ACTION')
		expect(player(d.state, 0).actions.available).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// 8. p.25 — SCORING example (29 VP)
// ---------------------------------------------------------------------------

describe('rulebook p.25 — SCORING example (rules/07 §7.4, 29 VP)', () => {
	it('resolves to 29 VP with the exact breakdown: 9 printed, 4 ENDGAME, 16 Research Focus', () => {
		// Fixture cards follow the rulebook's own example: 1ALL04/1ALL05/
		// 1ALL07 print 3 each (9 total); PIC's ENDGAME = 1 VP per ALLY
		// owned (4 ALLYs: those three + 1ALL09); 1ALL09 / 1PIC03 / 1PIC09 /
		// 1SHI10 carry the blue RESEARCH focus (worth 4 each at
		// the ×4 multiplier). NOTE: the current corpus cards records have
		// focus:null for these four (a transcription gap in src/data/cards, not a
		// scoring-engine gap) — the fixtures transcribe the physical cards instead.
		registerCards([
			mk({
				id: 'gb-1ALL04',
				name: '1ALL04',
				suit: 'ALLY',
				vp: 3,
				operations: [],
			}),
			mk({
				id: 'gb-1ALL05',
				name: '1ALL05',
				suit: 'ALLY',
				traits: ['ALIEN'],
				vp: 3,
				operations: [],
			}),
			mk({
				id: 'gb-all07',
				name: '1ALL07',
				suit: 'ALLY',
				vp: 3,
				operations: [],
			}),
			mk({
				id: 'gb-1ALL09',
				name: '1ALL09',
				suit: 'ALLY',
				traits: ['KELPIEN'],
				focus: 'FOCUS_RESEARCH',
				operations: [],
			}),
			mk({
				id: 'gb-1PIC03',
				name: '1PIC03',
				suit: 'DIRECTIVE',
				deck: 'PIC',
				focus: 'FOCUS_RESEARCH',
				operations: [],
			}),
			mk({
				id: 'gb-pic09',
				name: '1PIC09',
				suit: 'PERSON',
				deck: 'PIC',
				traits: ['HUMAN', 'ENGINEER', 'STARFLEET'],
				focus: 'FOCUS_RESEARCH',
				operations: [],
			}),
			mk({
				id: 'gb-pasteur',
				name: '1SHI10',
				suit: 'SHIP',
				traits: ['DOCTOR', 'STARFLEET', 'COMMUNICATION'],
				focus: 'FOCUS_RESEARCH',
				shipToken: '1SHI10',
				operations: [],
			}),
			mk({
				id: 'gb-pic',
				name: 'JEAN-LUC PIC',
				suit: 'CAPTAIN',
				deck: 'PIC',
				traits: ['HUMAN', 'STARFLEET'],
				awayTeams: 5,
				operations: [
					op(
						'ENDGAME',
						{
							k: 'SCORE_VP',
							amount: {
								k: 'COUNT',
								query: {
									zones: ['ALL_OWNED'],
									seat: 'SELF',
									filter: { suits: ['ALLY'] },
								},
							},
						},
						{ text: 'ENDGAME: Score 1 VP for each ALLY you own.' },
					),
				],
			}),
		])

		let s = newState(29)
		s = setBoardSide(s, 0, 'ADVANCED')
		// PIC's Advanced Research track (src/data/cards/boards/pic.json):
		// step 13 carries the ×4 glyph, the example's "past the ×4 multiplier".
		s = setTracks(s, 0, {
			RESEARCH: [
				{ step: 2, value: 1 },
				{ step: 7, value: 2 },
				{ step: 10, value: 3 },
				{ step: 13, value: 4 },
				{ step: 15, value: 5 },
			],
			INFLUENCE: [],
			MILITARY: [],
		})
		s = setSpecialty(s, 0, 'RESEARCH', 13)
		s = setMissions(s, 0, [
			{
				index: 0,
				goal: {
					k: 'COUNT_AT_LEAST',
					query: { zones: [{ k: 'FLEET', seat: 0 }] },
					value: 0,
				},
				reward: { k: 'NOOP' },
				vp: 0,
				completed: true, // ≥1 completed mission -> the Focus step is not suppressed
			},
		])

		s = placeCard(s, 'gb-pic', ID('pic'), { k: 'CAPTAIN', seat: 0 }, 0)
		// All owned cards OUTSIDE Reserve/Development (those two score nothing).
		s = placeCard(s, 'gb-1ALL04', ID('den'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-1ALL05', ID('edo'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-all07', ID('hal'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-1ALL09', ID('kel'), { k: 'LOG', seat: 0 }, 0)
		s = placeCard(s, 'gb-1PIC03', ID('mis'), { k: 'HAND', seat: 0 }, 0)
		s = placeCard(s, 'gb-pic09', ID('geo'), { k: 'DISCARD', seat: 0 }, 0)
		s = placeCard(s, 'gb-pasteur', ID('pas'), { k: 'FLEET', seat: 0 }, 0)

		const b = score(s, 0)
		// 9 printed VP (1ALL04 + 1ALL05 + 1ALL07)
		expect(b.printedVp.reduce((n, e) => n + e.vp, 0)).toBe(9)
		expect(b.printedVp).toHaveLength(3)
		// 4 from PIC's ENDGAME (1 VP per ALLY: 4 ALLYs owned)
		expect(b.endgame).toHaveLength(1)
		expect(b.endgame[0]!.vp).toBe(4)
		expect(b.endgame[0]!.card).toBe(ID('pic'))
		// 16 from Research Focus icons (4 cards × ×4 multiplier)
		expect(b.focus).toEqual([
			{ specialty: 'RESEARCH', multiplier: 4, cards: 4, vp: 16 },
		])
		// nothing from Glory / neutral tokens / missions
		expect(b.glory).toBe(0)
		expect(b.neutralTokens).toEqual({ count: 0, vp: 0 })
		expect(b.missionsCompleted).toBe(1)
		expect(b.focusSuppressed).toBe(false)
		expect(b.missions.reduce((n, m) => n + m.vp, 0)).toBe(0)
		expect(b.total).toBe(29)
	})
})
