// Central + player setup (todo/06 §1, rules/02). Everything runs in the
// rulebook's numbered order (§2.1) because every shuffle consumes state.rng —
// reordering the shuffles changes every game with the same seed:
//
//   central:  Market decks → Encounter deck → Incident deck (incl. crew
//             INCIDENT_DECK cards) → Location deck (Advanced shuffle, Starting
//             shuffle, 1 unseen Starting on top, Neutral Zone, box the rest) →
//             Stardate track (mode-filtered, #1 on top, printed Glory seeded
//             from the supply) → token supplies → starting player.
//   per player ($2.2): split by position indicator, captain/status places,
//             Development pile, Reserve shuffle, Available shuffle, fleet /
//             location / discard places, 1 DIL + 1 LAT + 1 GLO from the
//             supply, away teams from the Captain, mission tokens by board
//             side, then the opening hand (through the handSize modifier —
//             BUR draws 6 while 1BUR02 is in play).
//
// The card catalog is INJECTED (CardCatalog) so the same code runs fixture
// decks today and the real card JSON later — this file never imports
// src/data/cards or cards/records.

import type { CardDef } from '../data/schema'
import type { DeckId } from '../data/ids'
import type { Effect } from './resolver/nodes'
import type { GameState, MissionState, PlayerState, TrackTable } from './state'
import type { Seat, ZoneRef } from './resolver/queries'
import { newGameState, addCard, moveCard, zoneKey, inPlayCards } from './state'
import type { GameMode, SoloLevel } from './state'
import { registerCards, cardDef } from './cards'
import { shuffle, next } from './rng'
import { effectiveHandSize } from './modifiers'
import { toIid, type CardInstanceId } from './ids'

export type { GameMode, SoloLevel } from './state'

export interface SetupPlayer {
	deck: DeckId
	boardSide: 'BASIC' | 'ADVANCED'
}

export interface SetupConfig {
	mode: GameMode
	players: SetupPlayer[]
	seed: number
	/** An agreed first player (an online invite: the captain who answers it
	 *  opens). Absent = the random draw of §2.1 #17. The draw is still made
	 *  either way, so the seed stream is the same as a random game's. */
	startingSeat?: Seat | undefined
	/** mode 'SOLO' only: the official Bot's game (rules/13). The Bot plays
	 *  `players[1]`'s crew deck; the human, `players[0]`, always starts. */
	solo?: SoloSetup | undefined
}

/** How a solo game against the official Bot is set up (rules/13 §13.2). */
export interface SoloSetup {
	level: SoloLevel
	/** the Conspiring Admirals challenge (rules/13 §13.14) */
	conspiringAdmirals?: boolean | undefined
}

/** A Stardate card: the registered CardDef carries the Clean-up (wipe) effect;
 *  the spec adds the mode filter, sequence and printed Glory that the static
 *  CardDef schema has no field for (docs/data-model.md §1). */
export interface StardateSpec {
	id: string
	name: string
	sequence: number // 1 sits on top (rules/02 §2.1 #11)
	glory: number // printed Glory tokens
	modes: GameMode[] // the modes that use this card; boxed in every other
	def: CardDef // registered like any other def; CLEANUP op = the wipe effect
	/** Solo-vs-Bot cards only (SD08–SD32): difficulty level and the printed Bot
	 *  action count (rules/13 §13.2). */
	solo?: SoloStardate | undefined
}

export interface SoloStardate {
	level: SoloLevel
	botActions: number
}

/** One Crew board → the missions of each side (docs/data-model.md §6) and
 *  each side's track multiplier glyphs (rules/07 §7.1.4). A board without
 *  `tracks` (test fixtures) prints no multiplier: Focus scores ×0. */
export interface BoardMissions {
	basic: MissionState[]
	advanced: MissionState[]
	tracks?: { basic: TrackTable; advanced: TrackTable } | undefined
}

/** The injected card catalog. `defs` carries every common + crew card face;
 *  stardates + boards carry the data the static schema has no home for. */
export interface CardCatalog {
	defs: CardDef[]
	stardates: StardateSpec[]
	boards: Partial<Record<DeckId, BoardMissions>>
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

/** Top-level setup: `setup(config, catalog)` = `setupGame(newGameState(...))`.
 *  Deterministic from (config, catalog) — same seed twice → deep-equal. The
 *  whole catalog is registered first so `cardDef(iid)` resolves for every
 *  instance setup mints (registerCards is idempotent per id). */
export function setup(config: SetupConfig, catalog: CardCatalog): GameState {
	registerCards([...catalog.defs, ...catalog.stardates.map((s) => s.def)])
	const base = newGameState(config.seed, { mode: config.mode })
	return setupGame(base, config, catalog)
}

/** Full pipeline onto an existing base state (tests drive this and the
 *  granular pieces below independently). Returns the state in SETUP phase; the
 *  START intent hands it to the starting player's first turn. */
export function setupGame(
	state: GameState,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	let s = state
	s = setupMarket(s, catalog) // §2.1 #2/#3/#7
	s = setupEncounterDeck(s, catalog) // #4
	s = setupIncidentDeck(s, config, catalog) // #5 (+ crew INCIDENT_DECK, §2.1.1)
	s = setupLocationDeck(s, catalog) // #8/#9/#10
	s = setupStardateTrack(s, config, catalog) // #11/#13
	s = setupSupply(s, config, catalog) // #15 (token supplies are unbounded)
	s = setupStartingPlayer(s, config.startingSeat) // #17
	s = setupPlayerBoard(s, 0, config, catalog) // §2.2
	s = setupPlayerBoard(s, 1, config, catalog)
	s = assertSetupCompleteness(s, config, catalog)
	return { ...s, phase: { k: 'SETUP' } }
}

// ---------------------------------------------------------------------------
// Granular central setup
// ---------------------------------------------------------------------------

/** §2.1 #2/#3/#7: separate the common Market suits into four facedown decks,
 *  shuffle each, and reveal one card of each below the strip. */
export function setupMarket(state: GameState, catalog: CardCatalog): GameState {
	let s = state
	for (const suit of ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const) {
		const defs = catalog.defs.filter(
			(d) => d.deck === 'COMMON' && d.suit === suit,
		)
		s = placeShuffledDeck(s, defs, { k: 'MARKET_DECK', suit }, null, 'cm')
	}
	for (const suit of ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const) {
		const top = s.zones[zoneKey({ k: 'MARKET_DECK', suit })]?.[0]
		if (top === undefined)
			throw new Error(`setupMarket: no ${suit} cards offerable`)
		s = moveCard(s, top, { k: 'MARKET_OFFER', suit })
	}
	return s
}

/** §2.1 #4: place the shuffled Encounter deck facedown above the Market. */
export function setupEncounterDeck(
	state: GameState,
	catalog: CardCatalog,
): GameState {
	const defs = catalog.defs.filter(
		(d) => d.deck === 'COMMON' && d.suit === 'ENCOUNTER',
	)
	return placeShuffledDeck(state, defs, { k: 'ENCOUNTER_DECK' }, null, 'cm')
}

/** §2.1 #5 (+ crew INCIDENT_DECK, §2.1.1): the Incident deck is the shuffled
 *  common INCIDENT pile plus the chosen crews' INCIDENT_DECK cards, which keep
 *  their owner seat (the Burn counts INCIDENTs by ownership, rules/03 §3.1). */
export function setupIncidentDeck(
	state: GameState,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const iids: CardInstanceId[] = []
	let s = state
	for (const d of catalog.defs.filter(
		(d) => d.deck === 'COMMON' && d.suit === 'INCIDENT',
	)) {
		const r = mintInto(s, d.id, null, { k: 'INCIDENT_DECK' }, 'cm')
		s = r.state
		iids.push(r.iid)
	}
	// Chosen crews' INCIDENT_DECK cards, in seat order, appended before the shuffle.
	config.players.forEach((pl, seat) => {
		for (const d of catalog.defs.filter(
			(d) => d.deck === pl.deck && d.startPosition === 'INCIDENT_DECK',
		)) {
			const r = mintInto(
				s,
				d.id,
				seat as Seat,
				{ k: 'INCIDENT_DECK' },
				`p${seat}`,
			)
			s = r.state
			iids.push(r.iid)
		}
	})
	const [shuffled, rng] = shuffle(iids, s.rng)
	return {
		...s,
		rng,
		zones: { ...s.zones, [zoneKey({ k: 'INCIDENT_DECK' })]: shuffled },
	}
}

/** §2.1 #8/#9/#10: Advanced Locations shuffled facedown; Starting Locations
 *  shuffled, one placed unseen on top of the Advanced pile (so the 4th
 *  revealed Location is a Starting one and the rest Advanced); the next three
 *  become the Neutral Zone; the rest return to the box. */
export function setupLocationDeck(
	state: GameState,
	catalog: CardCatalog,
): GameState {
	const starting = catalog.defs.filter(
		(d) =>
			d.deck === 'COMMON' &&
			d.suit === 'LOCATION' &&
			d.locationTier === 'STARTING',
	)
	const advanced = catalog.defs.filter(
		(d) =>
			d.deck === 'COMMON' &&
			d.suit === 'LOCATION' &&
			d.locationTier === 'ADVANCED',
	)
	let s = state

	const [advOrder, rngA] = shuffle(
		advanced.map((d) => d.id),
		s.rng,
	)
	s = { ...s, rng: rngA }
	const advIids: CardInstanceId[] = []
	for (const id of advOrder) {
		const r = mintInto(s, id, null, { k: 'LOCATION_DECK' }, 'cm')
		s = r.state
		advIids.push(r.iid)
	}
	s = {
		...s,
		zones: { ...s.zones, [zoneKey({ k: 'LOCATION_DECK' })]: advIids },
	}

	const [startOrder, rngS] = shuffle(
		starting.map((d) => d.id),
		s.rng,
	)
	s = { ...s, rng: rngS }
	const startIids: CardInstanceId[] = []
	for (const id of startOrder) {
		const r = mintInto(s, id, null, { k: 'BOX' }, 'cm')
		s = r.state
		startIids.push(r.iid)
	}
	if (startIids.length < 4)
		throw new Error(
			`setupLocationDeck: need ≥4 Starting Locations, got ${startIids.length}`,
		)
	const top = startIids[0]!
	const nz = startIids.slice(1, 4) as [
		CardInstanceId,
		CardInstanceId,
		CardInstanceId,
	]

	// top Starting Location, unseen, on top of the Advanced deck
	s = moveCard(s, top, { k: 'LOCATION_DECK' }, { toTop: true })
	// Neutral Zone: 3 Starting Locations, revealed extending away from the deck
	s = moveCard(s, nz[0], { k: 'NEUTRAL_ZONE', slot: 0 })
	s = moveCard(s, nz[1], { k: 'NEUTRAL_ZONE', slot: 1 })
	s = moveCard(s, nz[2], { k: 'NEUTRAL_ZONE', slot: 2 })
	// Unused Starting Locations return to the box, not to the deck (§2.1.1)
	for (const iid of startIids.slice(4)) s = moveCard(s, iid, { k: 'BOX' })
	return s
}

/** §2.1 #11/#13: Stardate cards for the current mode, sorted by sequence with
 *  #1 on top; the printed Glory of the visible (top) card is seeded from the
 *  supply. Cards of the other modes return to the box. */
export function setupStardateTrack(
	state: GameState,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const inMode = catalog.stardates
		.filter((st) => st.modes.includes(config.mode))
		.sort((a, b) => a.sequence - b.sequence)
	const outOfMode = catalog.stardates.filter(
		(st) => !st.modes.includes(config.mode),
	)
	let s = state
	for (const st of inMode) {
		const r = mintInto(s, st.id, null, { k: 'STARDATE_PILE' }, 'sd')
		s = r.state
	}
	for (const st of outOfMode) {
		const r = mintInto(s, st.id, null, { k: 'BOX' }, 'sd')
		s = r.state
	}
	const top = inMode[0]
	if (!top)
		throw new Error(
			`setupStardateTrack: no ${config.mode} Stardate cards in the catalog`,
		)
	// Copy the pile: stardates.pile must not alias the zones array (the
	// serialisability invariant treats a shared array reference as a cycle).
	// `glories` mirrors the printed Glory of each card in pile order, so the
	// Clean-up handoff can refill the next card with ITS printed Glory instead
	// of a flat constant (handoffStardate, runtime.ts).
	return {
		...s,
		stardates: {
			pile: [...(s.zones[zoneKey({ k: 'STARDATE_PILE' })] ?? [])],
			gloryOnTop: top.glory,
			glories: inMode.map((st) => st.glory),
		},
	}
}

/** §2.1 #15: Ship-token supplies. The model keeps tokens on the instances
 *  (shipTokenAt) with the shared supply implicit ('SUPPLY', rules/04 §4.3.4
 *  unbounded model), so no state mutation is needed — retained as the
 *  enumerated step for order-of-operations clarity. */
export function setupSupply(
	state: GameState,
	_config: SetupConfig,
	_catalog: CardCatalog,
): GameState {
	return state
}

/** §2.1 #17: randomly determine the starting player. Cadet Training is a
 *  solo mode — the human (seat 0) always starts, and the random draw is
 *  SKIPPED (its RNG consumption would otherwise reorder the seed stream for no
 *  reason): the virtual opponent never takes a turn (rules/10 §10.1). */
export function setupStartingPlayer(
	state: GameState,
	agreed?: Seat,
): GameState {
	if (state.mode === 'CADET') {
		return { ...state, startingSeat: 0, activeSeat: 0 }
	}
	const [u, rng] = next(state.rng)
	const startingSeat = agreed ?? ((u < 0.5 ? 0 : 1) as Seat)
	return { ...state, rng, startingSeat, activeSeat: startingSeat }
}

// ---------------------------------------------------------------------------
// Granular player setup (§2.2)
// ---------------------------------------------------------------------------

/** §2.2: the whole per-player board, in order. */
export function setupPlayerBoard(
	state: GameState,
	seat: Seat,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	let s = setupDeck(state, seat, config, catalog)
	s = setupMissions(s, seat, config, catalog)
	s = setupPlayerRecord(s, seat, config, catalog)
	s = attachSetupModifiers(s, seat)
	s = drawOpeningHand(s, seat)
	return s
}

/** §2.2 #2–#10: split the crew deck by position indicator and place every
 *  card. Captain/status have no indicator; INCIDENT_DECK cards were already
 *  shuffled into the Incident deck during central setup. */
export function setupDeck(
	state: GameState,
	seat: Seat,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const deckId = pl(config, seat).deck
	const defs = catalog.defs.filter((d) => d.deck === deckId)
	let s = state
	const prefix = `p${seat}`

	const reserveDefs: CardDef[] = []
	const availableDefs: CardDef[] = []
	const deployedDefs: CardDef[] = []
	const controlledDefs: CardDef[] = []
	const discardDefs: CardDef[] = []

	for (const d of defs) {
		if (d.suit === 'CAPTAIN') {
			const r = mintInto(s, d.id, seat, { k: 'CAPTAIN', seat }, prefix)
			s = r.state
			continue
		}
		if (d.suit === 'STATUS') {
			const r = mintInto(s, d.id, seat, { k: 'STATUS', seat }, prefix)
			s = r.state
			continue
		}
		if (d.startPosition === 'INCIDENT_DECK') continue // already in the Incident deck
		switch (d.startPosition) {
			case 'DEVELOPMENT': {
				// Development pile: faceup, public, unordered (§2.2 #6) — minted below.
				break
			}
			case 'RESERVE':
				reserveDefs.push(d)
				break
			case 'AVAILABLE':
				availableDefs.push(d)
				break
			case 'DEPLOYED':
				deployedDefs.push(d)
				break
			case 'CONTROLLED_LOCATION':
				controlledDefs.push(d)
				break
			case 'DISCARD':
				discardDefs.push(d)
				break
			case null:
				throw new Error(
					`setupDeck: ${d.id} has no startPosition and is not a Captain/Status`,
				)
			default:
				throw new Error(
					`setupDeck: ${d.id} has unsupported startPosition ${d.startPosition}`,
				)
		}
	}

	// Development pile (faceup, unordered) — catalog order.
	for (const d of defs) {
		if (d.startPosition === 'DEVELOPMENT') {
			const r = mintInto(s, d.id, seat, { k: 'DEVELOPMENT', seat }, prefix)
			s = r.state
		}
	}
	// Reserve deck — shuffled ($2.2 #7).
	s = placeShuffledDeck(s, reserveDefs, { k: 'RESERVE', seat }, seat, prefix)
	// Draw deck (AVAILABLE) — shuffled ($2.2 #5).
	s = placeShuffledDeck(s, availableDefs, { k: 'DRAW', seat }, seat, prefix)
	// Fleet Area (DEPLOYED) — ship tokens on the card (shipTokenAt = null, §2.2 #9).
	for (const d of deployedDefs) {
		const r = mintInto(s, d.id, seat, { k: 'FLEET', seat }, prefix)
		s = r.state
	}
	// Location Area (CONTROLLED_LOCATION, §2.2 #8).
	for (const d of controlledDefs) {
		const r = mintInto(s, d.id, seat, { k: 'LOCATION_AREA', seat }, prefix)
		s = r.state
	}
	// DISCARD start pile (§2.2 #10).
	for (const d of discardDefs) {
		const r = mintInto(s, d.id, seat, { k: 'DISCARD', seat }, prefix)
		s = r.state
	}
	return s
}

/** §2.2 #1: the missions from the chosen board side. */
export function setupMissions(
	state: GameState,
	seat: Seat,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const deckId = pl(config, seat).deck
	const board = catalog.boards[deckId]
	if (!board) throw new Error(`setupMissions: no board for deck ${deckId}`)
	// Read the requested side from the CONFIG, not the (still-defaulted) player
	// record: setupPlayerBoard runs missions BEFORE setupPlayerRecord stamps the
	// boardSide onto the player, so `p.boardSide` is always the newGameState
	// default ('BASIC') at this point — an ADVANCED board would silently get the
	// single Basic mission (todo/13 boards).
	const basic = pl(config, seat).boardSide === 'BASIC'
	const source = basic ? board.basic : board.advanced
	const missions: MissionState[] = source.map((m, i) => ({
		...structuredClone(m),
		index: i as 0 | 1 | 2,
		completed: false,
	}))
	const printed = board.tracks?.[basic ? 'basic' : 'advanced']
	// fresh objects per player (assertSerialisable treats shared refs as cycles)
	const tracks: TrackTable = {
		RESEARCH: (printed?.RESEARCH ?? []).map((t) => ({ ...t })),
		INFLUENCE: (printed?.INFLUENCE ?? []).map((t) => ({ ...t })),
		MILITARY: (printed?.MILITARY ?? []).map((t) => ({ ...t })),
	}
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, missions, tracks } : pl,
	) as GameState['players']
	return { ...state, players }
}

/** §2.2 #1/#11/#12 + the 3-action budget from central setup #16. */
function setupPlayerRecord(
	state: GameState,
	seat: Seat,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	void catalog
	const deckId = pl(config, seat).deck
	const boardSide = pl(config, seat).boardSide
	const p = state.players[seat]!
	const captainIid = state.zones[zoneKey({ k: 'CAPTAIN', seat })]?.[0]
	const awayTeams = captainIid
		? (cardDef(state.cards[captainIid]!.def).awayTeams ?? 0)
		: 0
	const nextP: PlayerState = {
		...p,
		deckId,
		boardSide,
		resources: { DIL: 1, LAT: 1, GLO: 1 }, // #11: 1 DIL + 1 LAT + 1 GLO from the supply
		actions: { available: 3, spent: 0 },
		specialties: { RESEARCH: 0, INFLUENCE: 0, MILITARY: 0 },
		awayTeamsInPool: awayTeams, // #12: away teams sit on the Captain card
		awayTeamsTotal: awayTeams,
		missionTokens: boardSide === 'BASIC' ? 1 : 3, // #1: Basic keeps 1, Advanced keeps 3
		handSize: 5, // default; BUR's 1BUR02 layer makes it 6
		dutyOfficerLimit: 1,
		heldStardate: null,
		modifiers: p.modifiers,
	}
	const players = state.players.map((pl) =>
		pl.seat === seat ? nextP : pl,
	) as GameState['players']
	return { ...state, players }
}

/** Attach rule-modifier layers whose cards start in play (BUR's Inert
 *  Dilithium Status card): scan the in-play defs' operations for
 *  MODIFIER_ATTACH nodes and attach — data-driven, no per-deck special case. */
function attachSetupModifiers(state: GameState, seat: Seat): GameState {
	let s = state
	for (const iid of inPlayCards(state, seat)) {
		const ids = new Set<string>()
		for (const op of cardDef(state.cards[iid]!.def).operations)
			collectAttachIds(op.effect, ids)
		for (const id of ids) {
			const p = s.players[seat]!
			if (p.modifiers.some((m) => m.id === id)) continue
			const players = s.players.map((pl) =>
				pl.seat === seat
					? { ...pl, modifiers: [...pl.modifiers, { id, source: iid }] }
					: pl,
			) as GameState['players']
			s = { ...s, players }
		}
	}
	return s
}

/** §2.2 #13: draw the opening hand. Routed through effectiveHandSize so
 *  BUR draws 6 while 1BUR02 is in play — no special case. */
function drawOpeningHand(state: GameState, seat: Seat): GameState {
	const n = effectiveHandSize(state, seat)
	let s = state
	for (let i = 0; i < n; i++) {
		const top = s.zones[zoneKey({ k: 'DRAW', seat })]?.[0]
		if (top === undefined) break
		s = moveCard(s, top, { k: 'HAND', seat })
	}
	return s
}

// ---------------------------------------------------------------------------
// Setup-completeness invariant ("assert at the end of setup", rules/02 §2.1)
// ---------------------------------------------------------------------------

/** Assert: every card of both chosen decks plus all commons — and every
 *  catalog Stardate card — sits in exactly one zone, and the total face count
 *  is consistent (matches rules/01 §1.3 when the catalog carries those counts;
 *  the fixture catalog does: 101 common + 48 crew + 27 Stardate; the real
 *  catalog ships 32 Stardate faces, SD01–SD32). Throws on
 *  mismatch. */
export function assertSetupCompleteness(
	state: GameState,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const chosen = new Set(config.players.map((p) => p.deck))
	const expected = new Set<string>()
	for (const d of catalog.defs) {
		if (d.deck === 'COMMON' || chosen.has(d.deck)) expected.add(d.id)
	}
	for (const st of catalog.stardates) expected.add(st.id)

	const counts = new Map<string, number>()
	for (const c of Object.values(state.cards))
		counts.set(c.def, (counts.get(c.def) ?? 0) + 1)
	for (const id of expected) {
		const n = counts.get(id) ?? 0
		if (n !== 1)
			throw new Error(
				`assertSetupCompleteness: expected exactly 1 instance of '${id}' (got ${n})`,
			)
	}

	const seen = new Set<string>()
	for (const [key, arr] of Object.entries(state.zones)) {
		for (const iid of arr) {
			if (seen.has(iid))
				throw new Error(
					`assertSetupCompleteness: ${iid} sits in two zones (${key})`,
				)
			seen.add(iid)
		}
	}
	for (const iid of Object.keys(state.cards)) {
		if (!seen.has(iid))
			throw new Error(`assertSetupCompleteness: ${iid} is in no zone`)
	}

	if (Object.keys(state.cards).length !== expected.size) {
		throw new Error(
			`assertSetupCompleteness: expected ${expected.size} card faces, got ${Object.keys(state.cards).length}`,
		)
	}
	return state
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pl(config: SetupConfig, seat: Seat): SetupPlayer {
	const p = config.players[seat]
	if (!p) throw new Error(`setup: missing player config for seat ${seat}`)
	return p
}

/** Mint one CardInstance (deterministic iid from the instance serial). */
function mintInto(
	state: GameState,
	defId: string,
	owner: Seat | null,
	zone: ZoneRef,
	prefix: string,
): { state: GameState; iid: CardInstanceId } {
	const count = Object.keys(state.cards).length
	const iid = toIid(`${prefix}#${count.toString().padStart(4, '0')}`)
	return { state: addCard(state, iid, defId, owner, zone), iid }
}

/** Mint a facedown deck and place its instances in shuffled order. */
function placeShuffledDeck(
	state: GameState,
	defs: CardDef[],
	zone: ZoneRef,
	owner: Seat | null,
	prefix: string,
): GameState {
	let s = state
	const iids: CardInstanceId[] = []
	for (const d of defs) {
		const r = mintInto(s, d.id, owner, zone, prefix)
		s = r.state
		iids.push(r.iid)
	}
	const [shuffled, rng] = shuffle(iids, s.rng)
	return { ...s, rng, zones: { ...s.zones, [zoneKey(zone)]: shuffled } }
}

/** Walk an effect tree for MODIFIER_ATTACH ids. */
function collectAttachIds(node: Effect, out: Set<string>): void {
	if (node.k === 'MODIFIER_ATTACH') out.add(node.id)
	for (const child of effectChildren(node)) collectAttachIds(child, out)
}

function* effectChildren(node: Effect): Iterable<Effect> {
	switch (node.k) {
		case 'SEQ':
			for (const s of node.steps) yield s
			break
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
			yield node.body
			break
		case 'CHOOSE_ONE':
			for (const o of node.options) yield o.body
			break
		case 'PAY_THEN':
			yield node.cost
			yield node.body
			break
		case 'IF':
			yield node.then
			if (node.else !== undefined) yield node.else
			break
		case 'REPEAT':
		case 'FOR_EACH':
		case 'LET':
			yield node.body
			break
		case 'ATTACK':
			yield node.body
			break
		case 'TRY':
			yield node.body
			if (node.otherwise !== undefined) yield node.otherwise
			if (node.test !== undefined) yield node.test
			break
		default:
			break
	}
}
