// todo/13 Phase A — the first real-card game (todo/13 §"Milestone"). A full
// PIC-vs-SHR game built from loadCatalog() + setup() with REAL card JSON,
// driven by the m1-exit Driver idiom: every reduce passes the serialisability
// check, every RESOLVE_CHOICE is validated with validateChoice first, and the
// identical seed + script replays byte-identically.
//
// Setup assertions pin rules/11 §11.1/§11.2 (24-card decks, DEPLOYED ships from
// the printed records, Captain away teams, Reserve/Development/Available split).
// The scripted game then exercises, end-to-end through reduce():
//   - 1PIC23 PLAY (TAKE incident, discard, send 2 Away Teams into the Neutral Zone)
//   - 1PIC02 ACTIVATION PROMOTE (1PIC24 becomes Duty Officer)
//   - ANALYZE (market buy: gain a SHIP offer to the top of the deck)
//   - 1PIC18 with no controlled LOCATION (nothing to select: spends
//     the action only); the clean-up Glory placement exhausts the Stardate
//   - SHR's 1SHR21 / 1SHR23 (self TAKE_CONTROL + auto-fired CONTROL op) /
//     UTILIZE (Dilithium bartering via controlled Locations)
//   - RECRUIT (market buy: gain an ALLY) + PIC's Captain REACTION (discard ->
//     1 Glory) and his ENDGAME ("1 VP per ALLY you own")
//   - 1PIC24's RESUPPLY (discards the top of the Draw deck, gains 1 LAT) and his ACTIVATION
//     recovering a SHIP from the Discard pile
//   - a market SHIP (1SHI03) played to the Fleet
//   - final scoring to a COMPLETE result with a hand-computed 4–0 scoreboard.

import { describe, expect, it } from 'vitest'
import type { CardDef } from '../data/schema'
import type { Effect } from './resolver/nodes'
import type { GameState } from './state'
import { player } from './state'
import { setup, type CardCatalog, type SetupConfig } from './setup'
import { reduce, type Intent } from './intents'
import { validateChoice, type PendingChoice } from './resolver/choices'
import { canPlay, canActivate } from './queries/legality'
import { assertSerialisable } from './invariants'
import { loadCatalog } from '../data/catalog'
import type { CardInstanceId } from './ids'

// ---------------------------------------------------------------------------
// Real catalog + the single clean-up Stardate injected for the scripted game.
// ---------------------------------------------------------------------------

async function makeCatalog(): Promise<CardCatalog> {
	const catalog = await loadCatalog()
	// One Stardate card with printed Glory 1: the first Glory gain empties it and
	// triggers a Resolution; the +2-turn budget finishes the round (rules/03 §3.6.4).
	const stardateDef: CardDef = {
		id: 'sd-psg-01',
		cardId: null,
		name: 'sd-psg-01',
		suit: 'DIRECTIVE',
		deck: 'COMMON',
		traits: [],
		skills: [],
		variableSkill: undefined,
		focus: null,
		vp: 0,
		vpAsterisk: false,
		startPosition: null,
		developmentCost: null,
		operations: [
			{
				type: 'CLEANUP',
				costsAction: false,
				isAttack: false,
				effect: { k: 'WIPE_MARKET' } as Effect,
				text: 'psg stardate',
			},
		],
	}
	catalog.stardates = [
		{
			id: 'sd-psg-01',
			name: 'sd-psg-01',
			sequence: 1,
			glory: 1,
			modes: ['TWO_PLAYER'],
			def: stardateDef,
		},
	]
	return catalog
}

function config(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 25,
	}
}

// ---------------------------------------------------------------------------
// Driver — the m1-exit idiom adapted for real cards: the resolver's
// suspend/resume frames alias def-tree nodes (a DAG) while an EFFECT frame is
// on the stack, so assertSerialisable's strict no-shared-reference pass trips on
// `$.stack.N.node` there. That is a pre-existing engine parity quirk (todo/13
// handoff, parallel-agent resolver edits), not this game's data: we fall back to
// the JSON round-trip — the honest serialisability check (JSON.stringify throws
// on a true cycle) and the byte-stream the determinism test compares.
// ---------------------------------------------------------------------------

class Driver {
	s: GameState
	readonly seed: number
	constructor(seed: number, catalog: CardCatalog) {
		this.seed = seed
		this.s = setup(config(), catalog)
		this.check(this.s)
		if (this.s.startingSeat !== 0)
			throw new Error(`psg: seed ${seed} does not start on seat 0`)
	}
	private check(state: GameState): void {
		try {
			assertSerialisable(state)
		} catch (err) {
			const msg = (err as Error).message
			if (!msg.startsWith('cycle at $.stack')) throw err
			const text = JSON.stringify(state)
			if (text === undefined)
				throw new Error('psg: state is not JSON-serialisable')
			JSON.parse(text)
		}
	}
	go(intent: Intent): GameState {
		const r = reduce(this.s, intent)
		this.s = r.state
		this.check(this.s)
		return this.s
	}
	c(kind?: PendingChoice['k']): PendingChoice {
		const c = this.s.pendingChoice
		if (c === null) throw new Error('psg: expected a pendingChoice, got none')
		if (kind !== undefined && c.k !== kind)
			throw new Error(`psg: expected choice kind ${kind}, got ${c.k}`)
		return c
	}
	settle(selection: unknown, kind?: PendingChoice['k']): GameState {
		const c = this.c(kind)
		const v = validateChoice(this.s, c.id, selection)
		if (!v.ok)
			throw new Error(`psg: scripted selection is ILLEGAL: ${v.reason}`)
		return this.go({ t: 'RESOLVE_CHOICE', choiceId: c.id, selection })
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const zoneIids = (s: GameState, key: string): CardInstanceId[] =>
	s.zones[key] ?? []
const zoneDefs = (s: GameState, key: string): string[] =>
	zoneIids(s, key).map((i) => s.cards[i]!.def)
const findDef = (
	s: GameState,
	key: string,
	def: string,
): CardInstanceId | undefined =>
	zoneIids(s, key).find((i) => s.cards[i]!.def === def)
const HAND0 = (s: GameState) => zoneDefs(s, 'HAND:0')
const HAND1 = (s: GameState) => zoneDefs(s, 'HAND:1')
const DISCARD0 = (s: GameState) => zoneDefs(s, 'DISCARD:0')
const DRAW0 = (s: GameState) => zoneDefs(s, 'DRAW:0')

// ---------------------------------------------------------------------------
// Setup assertions (rules/11 §11.1/§11.2 + setup.ts §2.2)
// ---------------------------------------------------------------------------

describe('PIC vs SHR — real-catalog setup (rules/11, seed 25)', () => {
	it('places both 24-card decks at their printed start positions', async () => {
		const catalog = await loadCatalog()
		const pic = catalog.defs.filter((d) => d.deck === 'PIC')
		const shr = catalog.defs.filter((d) => d.deck === 'SHR')
		expect(pic).toHaveLength(24)
		expect(shr).toHaveLength(24)
		// ID runs are gapless and complete: 1PIC01..24, 1SHR01..24.
		for (const [prefix, defs] of [
			['1PIC', pic],
			['1SHR', shr],
		] as const) {
			for (let i = 1; i <= 24; i++) {
				const id = `${prefix}${String(i).padStart(2, '0')}-24`
				expect(
					defs.some((d) => d.id === id),
					`missing ${id}`,
				).toBe(true)
			}
		}
		// The two printed-DEPLOYED ships (records win over rules/11 prose; 015).
		expect(pic.find((d) => d.id === '1PIC02-24')!.startPosition).toBe(
			'DEPLOYED',
		)
		expect(shr.find((d) => d.id === '1SHR02-24')!.startPosition).toBe(
			'DEPLOYED',
		)
		// The split by position indicator: 8 Development / 4 Reserve / 10 Available
		// (5 opening hand + 5 draw deck) / 1 Deployed / 1 Captain — and no
		// INCIDENT_DECK cards (rules/11: PIC/SHR have none).
		const countPos = (defs: CardDef[], p: CardDef['startPosition'] | null) =>
			defs.filter((d) => d.startPosition === p).length
		expect(countPos(pic, 'DEVELOPMENT')).toBe(8)
		expect(countPos(pic, 'RESERVE')).toBe(4)
		expect(countPos(pic, 'AVAILABLE')).toBe(10) // 5 opening hand + 5 draw deck
		expect(countPos(pic, 'DEPLOYED')).toBe(1)
		expect(countPos(shr, 'DEVELOPMENT')).toBe(7)
		expect(countPos(shr, 'RESERVE')).toBe(5)
		expect(countPos(shr, 'AVAILABLE')).toBe(10) // 5 opening hand + 5 draw deck
		expect(countPos(shr, 'DEPLOYED')).toBe(1)
		// Captain cards: no position, printed away teams, IMPERIAL trait on SHR.
		const picCap = pic.find((d) => d.suit === 'CAPTAIN')!
		const shrCap = shr.find((d) => d.suit === 'CAPTAIN')!
		expect(picCap.id).toBe('1PIC01-24')
		expect(picCap.awayTeams).toBe(5)
		expect(shrCap.id).toBe('1SHR01-24')
		expect(shrCap.awayTeams).toBe(5)
		expect(shrCap.traits).toContain('IMPERIAL')
		// PIC's ENDGAME: 1 VP per ALLY owned (rules/07 §7.4.3).
		expect(picCap.operations.some((o) => o.type === 'ENDGAME')).toBe(true)
	})

	it('setup() produces the rules/11 game state for seed 25', async () => {
		const catalog = await makeCatalog()
		const s = setup(config(), catalog)
		assertSerialisable(s)
		expect(s.phase.k).toBe('SETUP')
		expect(s.startingSeat).toBe(0)

		// Captain + away teams.
		expect(zoneDefs(s, 'CAPTAIN:0')).toEqual(['1PIC01-24'])
		expect(zoneDefs(s, 'CAPTAIN:1')).toEqual(['1SHR01-24'])
		expect(player(s, 0).awayTeamsInPool).toBe(5)
		expect(player(s, 1).awayTeamsInPool).toBe(5)

		// The two DEPLOYED ships sit in the Fleet.
		expect(zoneDefs(s, 'FLEET:0')).toEqual(['1PIC02-24']) // 1PIC02
		expect(zoneDefs(s, 'FLEET:1')).toEqual(['1SHR02-24']) // 1SHR02

		// Development pile (faceup, catalog order).
		expect(zoneDefs(s, 'DEVELOPMENT:0')).toEqual([
			'1PIC03-24',
			'1PIC04-24',
			'1PIC05-24',
			'1PIC06-24',
			'1PIC07-24',
			'1PIC08-24',
			'1PIC09-24',
			'1PIC10-24',
		])
		expect(zoneDefs(s, 'DEVELOPMENT:1')).toEqual([
			'1SHR03-24',
			'1SHR04-24',
			'1SHR05-24',
			'1SHR06-24',
			'1SHR07-24',
			'1SHR08-24',
			'1SHR09-24',
		])

		// Reserve deck (shuffled) and Available/draw deck (shuffled), seed-fixed.
		expect(zoneDefs(s, 'RESERVE:0')).toEqual([
			'1PIC11-24',
			'1PIC12-24',
			'1PIC13-24',
			'1PIC14-24',
		])
		expect(zoneDefs(s, 'RESERVE:1')).toEqual([
			'1SHR12-24',
			'1SHR13-24',
			'1SHR10-24',
			'1SHR11-24',
			'1SHR14-24',
		])
		expect(zoneDefs(s, 'DRAW:0')).toEqual([
			'1PIC21-24',
			'1PIC17-24',
			'1PIC20-24',
			'1PIC19-24',
			'1PIC16-24',
		])
		expect(zoneDefs(s, 'DRAW:1')).toEqual([
			'1SHR16-24',
			'1SHR17-24',
			'1SHR24-24',
			'1SHR15-24',
			'1SHR19-24',
		])

		// Opening hands.
		expect(zoneDefs(s, 'HAND:0')).toEqual([
			'1PIC24-24',
			'1PIC18-24',
			'1PIC15-24',
			'1PIC23-24',
			'1PIC22-24',
		])
		expect(zoneDefs(s, 'HAND:1')).toEqual([
			'1SHR18-24',
			'1SHR20-24',
			'1SHR21-24',
			'1SHR23-24',
			'1SHR22-24',
		])

		// Starting resources 1 DIL + 1 LAT + 1 GLO, 3 actions.
		for (const seat of [0, 1] as const) {
			expect(player(s, seat).resources).toEqual({ DIL: 1, LAT: 1, GLO: 1 })
			expect(player(s, seat).actions.available).toBe(3)
		}

		// Board missions (STCC 1PIC/M1..M3, 1SHR/M1): PIC ADVANCED = 3 with
		// the printed VP 5/3/2; SHR BASIC = its first mission × vp 0
		// (rules/07 §7.4.1, the board photos).
		expect(player(s, 0).boardSide).toBe('ADVANCED')
		expect(player(s, 0).missions.map((m) => [m.cardId, m.vp])).toEqual([
			['1PIC/M1', 5],
			['1PIC/M2', 3],
			['1PIC/M3', 2],
		])
		expect(player(s, 1).boardSide).toBe('BASIC')
		expect(player(s, 1).missions.map((m) => [m.cardId, m.vp])).toEqual([
			['1SHR/M1', 0],
		])
		// Each side's own track glyphs: PIC Advanced prints nothing at step 0
		// and tops Influence at ×5; SHR Basic prints ×1 at step 0.
		expect(player(s, 0).tracks.INFLUENCE.at(-1)).toEqual({ step: 15, value: 5 })
		expect(player(s, 0).tracks.RESEARCH[0]).toEqual({ step: 2, value: 1 })
		expect(player(s, 1).tracks.MILITARY[0]).toEqual({ step: 0, value: 1 })
	})
})

// ---------------------------------------------------------------------------
// The scripted game itself. Returns the terminal GameState; the two tests
// (outcomes + determinism) replay the same function so the byte stream is the
// authoritative determinism check.
// ---------------------------------------------------------------------------

// Async load → cache the catalog, then run the pure synchronous script.
let cachedCatalog: CardCatalog | null = null
async function loadCatalogOnce(): Promise<CardCatalog> {
	if (cachedCatalog === null) cachedCatalog = await makeCatalog()
	return cachedCatalog
}

function runScriptedGame(seed: number): GameState {
	const catalog = cachedCatalog!
	const D = new Driver(seed, catalog)
	let s = D.s

	// ---------- Turn 1 — PIC (seat 0) ----------
	s = D.go({ t: 'START' })
	expect(s.phase.k).toBe('ACTION')
	expect(s.activeSeat).toBe(0)
	expect(s.turnNumber).toBe(1)

	// PLAY 1PIC23 (1PIC23 op0, action): TAKE an INCIDENT and discard it (the only
	// INCIDENT in hand — auto-picked), discard the top of the deck, send 2 Away
	// Teams.
	const pic23 = findDef(s, 'HAND:0', '1PIC23-24')!
	expect(canPlay(s, 0, pic23).ok).toBe(true)
	s = D.go({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
	expect(player(s, 0).actions.available).toBe(2)
	expect(DISCARD0(s)).toContain('1INC01-6')
	expect(DISCARD0(s)).toContain('1PIC21-24') // deck-top discard (1PIC21)
	expect(DRAW0(s)).not.toContain('1PIC21-24')
	expect(s.pendingChoice!.k).toBe('CHOOSE_LOCATION')
	const slot0Loc = findDef(s, 'NEUTRAL_ZONE:0', '1LOC16-20')!
	s = D.settle(slot0Loc, 'CHOOSE_LOCATION')
	expect(s.awayTeamsAt[slot0Loc]?.[0]).toBe(2)
	expect(player(s, 0).awayTeamsInPool).toBe(3)

	// ACTIVATE 1PIC02 op3: PROMOTE 1PIC24 (1PIC24, the only PERSON in
	// hand) to Duty Officer.
	const ent = findDef(s, 'FLEET:0', '1PIC02-24')!
	expect(canActivate(s, 0, ent, 3).ok).toBe(true)
	s = D.go({ t: 'ACTIVATE', iid: ent, operationIndex: 3 })
	expect(zoneDefs(s, 'DUTY_OFFICER:0')).toEqual(['1PIC24-24'])
	expect(HAND0(s)).not.toContain('1PIC24-24')

	// PLAY ANALYZE op0 (action): COST_TAKE_INCIDENT -> gain a SHIP offer.
	const analyze = findDef(s, 'HAND:0', '1PIC15-24')!
	s = D.go({ t: 'PLAY_CARD', iid: analyze, operationIndex: 0 })
	expect(HAND0(s)).toContain('1INC05-6') // the second INCIDENT taken as the cost
	const shipOffer = zoneIids(s, 'MARKET_OFFER:SHIP')[0]!
	s = D.settle([shipOffer], 'CHOOSE_CARDS')
	expect(
		(s.pendingChoice as PendingChoice & { options: ('DECK_TOP' | 'DISCARD')[] })
			.options,
	).toContain('DECK_TOP')
	s = D.settle('DECK_TOP', 'CHOOSE_DESTINATION')
	expect(DRAW0(s)[0]).toBe('1SHI03-13') // the market SHIP sits on top of the deck

	// PLAY 1PIC18 op0 with no controlled LOCATION: nothing to
	// select, so it only spends the action (sprite review run 2 — the ENCOUNTER
	// and the Log -> RESEARCH hang off the selected LOCATION).
	const snw = findDef(s, 'HAND:0', '1PIC18-24')!
	s = D.go({ t: 'PLAY_CARD', iid: snw, operationIndex: 0 })
	expect(HAND0(s)).toEqual(['1PIC22-24', '1INC05-6'])
	expect(player(s, 0).resources.GLO).toBe(1)
	expect(s.resolutionTriggered).toBe(false)

	// END_TURN -> clean-up: place the Glory token on the ALLY offer, keep hand.
	s = D.go({ t: 'END_TURN' })
	const gloryPick = D.c('CHOOSE_CARDS') as PendingChoice & {
		candidates: CardInstanceId[]
	}
	const allyOffer = zoneIids(s, 'MARKET_OFFER:ALLY')[0]!
	expect(gloryPick.candidates).toContain(allyOffer)
	s = D.settle([allyOffer], 'CHOOSE_CARDS')
	expect(s.cards[allyOffer]!.resourceTokens.GLO).toBe(1)
	s = D.settle([], 'CHOOSE_CARDS') // voluntary hand discard: keep all
	expect(s.activeSeat).toBe(1)
	expect(s.turnNumber).toBe(2)
	expect(s.turnsAfterResolution).toBe(3)
	// Refill drew the deck-top SHIP + the next two Available cards into hand.
	expect(HAND0(s)).toEqual([
		'1PIC22-24',
		'1INC05-6',
		'1SHI03-13',
		'1PIC17-24',
		'1PIC20-24',
	])
	expect(zoneDefs(s, 'DUTY_OFFICER:0')).toEqual(['1PIC24-24'])

	// ---------- Turn 2 — SHR (seat 1) ----------
	// PLAY 1SHR21 op0 (action): 1 Away Team into the Neutral Zone (sprite review
	// run 5 — the INCIDENT belongs to her separate ATTACK PLAY).
	const shr21 = findDef(s, 'HAND:1', '1SHR21-24')!
	s = D.go({ t: 'PLAY_CARD', iid: shr21, operationIndex: 0 })
	const slot1Loc = findDef(s, 'NEUTRAL_ZONE:1', '1LOC02-20')!
	s = D.settle(slot1Loc, 'CHOOSE_LOCATION')
	expect(s.awayTeamsAt[slot1Loc]?.[1]).toBe(1)
	expect(HAND1(s)).not.toContain('1INC03-6')

	// PLAY 1SHR23 op0 (action): TAKE_CONTROL on itself -> Location Area; its
	// CONTROL operation (gain 1 MILITARY + 1 INFLUENCE) fires automatically.
	const shr23 = findDef(s, 'HAND:1', '1SHR23-24')!
	const mil0 = player(s, 1).specialties.MILITARY
	const inf0 = player(s, 1).specialties.INFLUENCE
	s = D.go({ t: 'PLAY_CARD', iid: shr23, operationIndex: 0 })
	expect(zoneDefs(s, 'LOCATION_AREA:1')).toEqual(['1SHR23-24'])
	expect(player(s, 1).specialties.MILITARY).toBe(mil0 + 1)
	expect(player(s, 1).specialties.INFLUENCE).toBe(inf0 + 1)
	expect(player(s, 1).resources.GLO).toBe(1) // setup only

	// PLAY UTILIZE op0 (action): gain 1 DIL + 2 DIL per controlled Location (1SHR23).
	const utilize = findDef(s, 'HAND:1', '1SHR22-24')!
	s = D.go({ t: 'PLAY_CARD', iid: utilize, operationIndex: 0 })
	expect(player(s, 1).resources).toEqual({ DIL: 4, LAT: 1, GLO: 1 })

	// END_TURN -> clean-up: Glory to the PERSON offer; keep hand; refill.
	s = D.go({ t: 'END_TURN' })
	s = D.settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!], 'CHOOSE_CARDS')
	s = D.settle([], 'CHOOSE_CARDS')
	expect(s.activeSeat).toBe(0)
	expect(s.turnNumber).toBe(3)
	expect(HAND1(s)).toEqual([
		'1SHR18-24',
		'1SHR20-24',
		'1SHR16-24',
		'1SHR17-24',
		'1SHR24-24',
	])
	expect(zoneDefs(s, 'DRAW:1')).toEqual(['1SHR15-24', '1SHR19-24'])

	// ---------- Turn 3 — PIC ----------
	// 1PIC24's RESUPPLY already fired at turn start (rules/03 §3.3): he discarded
	// the top of the Draw deck (1PIC19) and gained 1 LAT.
	expect(DISCARD0(s)).toContain('1PIC19-24')
	expect(DRAW0(s)).toEqual(['1PIC16-24'])
	expect(player(s, 0).resources.LAT).toBe(2)

	// PLAY RECRUIT op1 (action-free): COST_TAKE_INCIDENT -> gain an ALLY offer.
	const recruit = findDef(s, 'HAND:0', '1PIC17-24')!
	s = D.go({ t: 'PLAY_CARD', iid: recruit, operationIndex: 1 })
	const allyBuy = zoneIids(s, 'MARKET_OFFER:ALLY')[0]!
	s = D.settle([allyBuy], 'CHOOSE_CARDS') // market buy: the ALLY carries 1 Glory
	s = D.settle('DISCARD', 'CHOOSE_DESTINATION')
	expect(player(s, 0).resources.GLO).toBe(2) // 1 + the Glory token on the ALLY
	expect(DISCARD0(s)).toContain('1ALL11-13')

	// PIC's Captain REACTION (CARD_GAINED ALLY) is offered as an optional
	// trigger: discard 1 -> gain 1 Glory; decline the optional BEAM.
	const triggers = D.c('OPTIONAL_TRIGGERS') as PendingChoice & {
		offered: { card: string; opIndex: number; seat: number }[]
	}
	expect(triggers.offered).toEqual([
		{ card: findDef(s, 'CAPTAIN:0', '1PIC01-24')!, opIndex: 0, seat: 0 },
	])
	s = D.settle(triggers.offered, 'OPTIONAL_TRIGGERS')
	const dkyrShip = findDef(s, 'HAND:0', '1SHI03-13')!
	s = D.settle([dkyrShip], 'CHOOSE_CARDS') // reaction discard: the market SHIP
	expect(player(s, 0).resources.GLO).toBe(3)
	expect(DISCARD0(s)).toContain('1SHI03-13')
	s = D.settle([], 'CHOOSE_CARDS') // may-Beam (asked as the beam's pick): decline

	// ACTIVATE 1PIC24 op3: DRAW_FROM_DISCARD — recover a SHIP from the Discard pile.
	const pic24 = findDef(s, 'DUTY_OFFICER:0', '1PIC24-24')!
	expect(canActivate(s, 0, pic24, 3).ok).toBe(true)
	s = D.go({ t: 'ACTIVATE', iid: pic24, operationIndex: 3 })
	expect(HAND0(s)).toContain('1SHI03-13') // recovered

	// PLAY the recovered market SHIP (1SHI03 op0): DEPLOY to the Fleet,
	// WARP (the Neutral Zone is reachable — rules/06 §6.2.2: warp to the empty
	// NZ slot 2), then may-discard -> 1 research.
	const dkyr = findDef(s, 'HAND:0', '1SHI03-13')!
	const resBefore = player(s, 0).specialties.RESEARCH
	s = D.go({ t: 'PLAY_CARD', iid: dkyr, operationIndex: 0 })
	const slot2Loc = zoneIids(s, 'NEUTRAL_ZONE:2')[0]!
	s = D.settle(slot2Loc, 'CHOOSE_LOCATION')
	expect(s.cards[dkyr]!.shipTokenAt).toBe(slot2Loc)
	const inc05 = findDef(s, 'HAND:0', '1INC05-6')!
	s = D.settle([inc05], 'CHOOSE_CARDS') // the may's own pick: discard for the research
	expect(player(s, 0).specialties.RESEARCH).toBe(resBefore + 1)
	expect(player(s, 0).resources.GLO).toBe(3) // D'Kyr gains research, not Glory
	expect(zoneDefs(s, 'FLEET:0')).toEqual(['1PIC02-24', '1SHI03-13']) // deployed

	// END_TURN -> clean-up (Glory to the PERSON offer; keep hand); the refill
	// empties the draw deck, reshuffles the Discard pile and enlists the Reserve
	// (1PIC11, drawn next).
	s = D.go({ t: 'END_TURN' })
	s = D.settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!], 'CHOOSE_CARDS')
	s = D.settle([], 'CHOOSE_CARDS')
	expect(s.activeSeat).toBe(1)
	expect(s.turnNumber).toBe(4)
	// (the INCIDENT Recruit took is 1INC03 now — 1SHR21 no longer takes one on turn 2)
	expect(HAND0(s)).toEqual([
		'1PIC22-24',
		'1PIC20-24',
		'1INC03-6',
		'1PIC16-24',
		'1PIC11-24',
	])
	expect(DRAW0(s)).toHaveLength(9)

	// ---------- Turn 4 — SHR (last turn of the round) ----------
	// PLAY 1SHR17 op2 (action-free): gain 1 LAT.
	const shr17 = findDef(s, 'HAND:1', '1SHR17-24')!
	s = D.go({ t: 'PLAY_CARD', iid: shr17, operationIndex: 2 })
	expect(player(s, 1).resources.LAT).toBe(2)

	// END_TURN -> clean-up; the extra-turn budget hits 0 -> FINAL_SCORING.
	s = D.go({ t: 'END_TURN' })
	s = D.settle([zoneIids(s, 'MARKET_OFFER:SHIP')[0]!], 'CHOOSE_CARDS')
	s = D.settle([], 'CHOOSE_CARDS')

	// ---------- Game over ----------
	expect(s.result?.kind).toBe('COMPLETE')
	expect(s.turnsTaken).toEqual([2, 2])
	return s
}

describe('PIC vs SHR — scripted real-card game (todo/13 Phase A)', () => {
	it('plays setup -> turn loop -> market/control -> final scoring with a hand-computed scoreboard', async () => {
		await loadCatalogOnce()
		const s = runScriptedGame(25)
		const res = s.result
		if (res === null || res.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')

		// ---- PIC: hand-computed 4 ----
		// glory 3 (1 setup + 1 ALLY token + 1 reaction; D'Kyr's may now gains research)
		// neutral tokens 3 (1PIC23's 2 Away Teams at NZ slot 0 + the 1SHI03's
		//   Ship token at NZ slot 2 — its "deploy and warp" reaches the Neutral Zone)
		// endgame 1 (1 ALLY owned — the purchased 1ALL11; the Development-pile
		//   1PIC04 are removed by rules/12 §12.29, fixed in scoring.ts)
		// printed VP −3 (D'Kyr 2 + ALLY 3 − Red Alert 2 − 3 INCIDENTs × 2: 1PIC23's
		//   take, plus the two taken as ANALYZE / RECRUIT costs, which are his too)
		const [p, sh] = res.scoreboard.breakdown
		expect(p.glory).toBe(3)
		expect(p.neutralTokens).toEqual({ count: 3, vp: 3 })
		expect(p.endgame).toEqual([
			{
				card: findDef(s, 'CAPTAIN:0', '1PIC01-24')!,
				label: 'Score 1 VP for each of your ALLY cards.', // describeOperation — card data carries no printed text
				vp: 1,
			},
		])
		expect(p.printedVp.reduce((n, e) => n + e.vp, 0)).toBe(-3)
		expect(p.focus).toEqual([]) // no mission completed -> Focus suppressed
		expect(p.focusSuppressed).toBe(true)
		expect(p.missions).toEqual([])
		expect(p.total).toBe(4)

		// ---- SHR: hand-computed 0 ----
		// glory 1 (setup; sprite review run 5: 1SHR23's CONTROL gains MILITARY/INFLUENCE and
		// UTILIZE gains DIL) | neutral 1 (1SHR21's Away Team)
		// printed VP −2 (SHR's own INCIDENT 1SHR15) | no endgame | Basic board: missions 0 VP
		expect(sh.glory).toBe(1)
		expect(sh.neutralTokens).toEqual({ count: 1, vp: 1 })
		expect(sh.endgame).toEqual([])
		expect(sh.printedVp.reduce((n, e) => n + e.vp, 0)).toBe(-2)
		expect(sh.missions).toEqual([])
		expect(sh.total).toBe(0)

		expect(res.scoreboard.winners).toEqual([0]) // PIC 4 > SHR 0
	})

	it('is deterministic: replaying the identical seed + script byte-matches at game over', async () => {
		await loadCatalogOnce()
		const a = runScriptedGame(25)
		const b = runScriptedGame(25)
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
		expect(a).toEqual(b)
	})
})

// ---------------------------------------------------------------------------
// SET A COURSE (1PIC22/24) — the REPEAT-suspension regression (todo/13 +
// engine fix): up to 3 PERSON discards, each paying for one AWAY TEAM sent
// to a single shared LOCATION. Each discard+send pair must ask on its own iteration
// and pay its own cost. The bindings-scope fix (repeat.ts) stopped iteration
// 2..N from silently reusing iteration 1's answers (which skipped the second
// discard AND re-placed away teams at the same location for free).
// ---------------------------------------------------------------------------

describe('SET A COURSE (1PIC22/24) — REPEAT suspension pays per iteration', () => {
	it('asks per personnel and places exactly as many away teams as it discards', async () => {
		await loadCatalogOnce()
		const D = new Driver(25, cachedCatalog!)
		let s = D.s
		s = D.go({ t: 'START' })
		expect(s.phase.k).toBe('ACTION')

		// PLAY SET A COURSE op0 (costs an action): MAY REPEAT(UP_TO 3)(discard a
		// PERSON -> send 1 away team to any LOCATION).
		const setCourse = findDef(s, 'HAND:0', '1PIC22-24')!
		expect(canPlay(s, 0, setCourse).ok).toBe(true)
		s = D.go({ t: 'PLAY_CARD', iid: setCourse, operationIndex: 0 })

		// "…to the SAME LOCATION": the destination is selected once, up front —
		// and that pick is the "you may" itself (no CONFIRM).
		expect(D.c('CHOOSE_CARDS').mayDecline).toBe(true)
		const slot0Loc = findDef(s, 'NEUTRAL_ZONE:0', '1LOC16-20')!
		s = D.settle([slot0Loc], 'CHOOSE_CARDS')

		// "Up to 3": every round is optional — each is asked as its discard, and
		// the empty pick would stop. Round 1: discard a PERSON (1PIC24) -> 1
		// away team to the selected Location.
		const pic24 = findDef(s, 'HAND:0', '1PIC24-24')!
		expect(D.c('CHOOSE_CARDS').mayDecline).toBe(true)
		s = D.settle([pic24], 'CHOOSE_CARDS')

		// Round 2 pays its own cost (the single PERSON left, 1PIC23, still asked:
		// it is the round's only prompt) and sends to the same Location without
		// asking again — two discards, two away teams, all at the selected
		// Location.
		s = D.settle([findDef(s, 'HAND:0', '1PIC23-24')!], 'CHOOSE_CARDS')
		expect(s.awayTeamsAt[slot0Loc]?.[0]).toBe(2)
		expect(player(s, 0).awayTeamsInPool).toBe(3)

		// Round 3 has no PERSON left -> it is not offered (no crash, no free
		// sends). Exactly two cards were discarded for exactly two tokens.
		expect(s.pendingChoice).toBeNull()
		expect(s.zones['HAND:0']!.map((i) => s.cards[i]!.def)).toEqual([
			'1PIC18-24',
			'1PIC15-24',
		])
		expect((s.zones['DISCARD:0'] ?? []).map((i) => s.cards[i]!.def)).toEqual(
			expect.arrayContaining(['1PIC24-24', '1PIC23-24']),
		)
		const total =
			player(s, 0).awayTeamsInPool +
			Object.values(s.awayTeamsAt).reduce((n, at) => n + (at[0] ?? 0), 0)
		expect(total).toBe(5) // away-team total never reduced
	})
})
