// The solo rulebook's "complete Bot turn" example (solo p.11–15), replayed
// beat by beat against the real card data: a Commander KOL Bot against PIC.
// Cards by id only (no names in code): the Bot flips its PERSON, SHIP and
// LOCATION, the LOCATION's row resolves the top of its deck, whose WEAPON row
// junks and attacks — and your saver card keeps the Away Team.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { setup, type CardCatalog } from '../setup'
import { reduce, legalIntents } from '../intents'
import { cardDef } from '../cards'
import { moveCard } from '../resolver/runtime'
import { setSpecialty, setTracks, TEST_TRACKS_BASIC } from '../resolver/testUtils'
import { assertInvariants } from '../invariants'
import type { GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { ZoneRef } from '../resolver/queries'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

/** The instance printed with card number `cardId`. */
function iid(s: GameState, cardId: string): CardInstanceId {
	const card = Object.values(s.cards).find(
		(c) => cardDef(c.def).cardId === cardId,
	)
	if (card === undefined) throw new Error(`no instance of ${cardId}`)
	return card.iid
}

const ROW_PERSON = '1KOL23/24' // PERSON, KLINGON only
const ROW_SHIP = '1KOL24/24' // SHIP
const ROW_LOCATION = '1KOL13/24' // LOCATION
const MILLED = '1KOL17/24' // DIRECTIVE
const LOGGED_INCIDENT = '1KOL12/24' // INCIDENT
const NEXT_WEAPON = '1KOL19/24' // CARGO, WEAPON + ATTACK
const MARKET_WEAPON = '1CAR08/16' // CARGO, WEAPON
const MARKET_RESEARCH = '1CAR01/16' // CARGO, Research Focus
const MARKET_CARGO = '1CAR09/16' // CARGO
const YOUR_SAVER = '1CAR11/16' // your ONGOING CARGO, saves an Away Team
const MARKET_PERSON = '1PER08/25' // PERSON, 1 VP
const MARKET_SHIP = '1SHI13/13' // SHIP, Military Focus
const MARKET_ALLY = '1ALL09/13' // ALLY, Research Focus
const NZ_PLAIN = '1LOC02/20' // LOCATION, 0 VP
const NZ_VALUABLE = '1LOC05/20' // LOCATION, more valuable

/** The board just before the Bot's turn in the rulebook example. */
function rulebookBoard(): GameState {
	let s = setup(
		{
			mode: 'SOLO',
			players: [
				{ deck: 'PIC', boardSide: 'BASIC' },
				{ deck: 'KOL', boardSide: 'BASIC' },
			],
			seed: 11,
			solo: { level: 'COMMANDER' },
		},
		catalog,
	)
	const put = (cardId: string, zone: ZoneRef, toTop = false) => {
		s = moveCard(s, iid(s, cardId), zone, { toTop })
	}
	// the Bot deck, top first: the three row cards, then what the rows hit
	for (const id of [NEXT_WEAPON, LOGGED_INCIDENT, MILLED, ROW_LOCATION, ROW_SHIP, ROW_PERSON])
		put(id, { k: 'DRAW', seat: 1 }, true)
	// the Market: one WEAPON; two known CARGO refills
	for (const [suit, id] of [
		['PERSON', MARKET_PERSON],
		['CARGO', MARKET_WEAPON],
		['SHIP', MARKET_SHIP],
		['ALLY', MARKET_ALLY],
	] as const) {
		const old = s.zones[`MARKET_OFFER:${suit}`]![0]!
		s = moveCard(s, old, { k: 'MARKET_DECK', suit })
		put(id, { k: 'MARKET_OFFER', suit })
	}
	put(MARKET_CARGO, { k: 'MARKET_DECK', suit: 'CARGO' }, true)
	put(MARKET_RESEARCH, { k: 'MARKET_DECK', suit: 'CARGO' }, true)
	const marketShip = iid(s, MARKET_SHIP)
	s = {
		...s,
		cards: { ...s.cards, [marketShip]: { ...s.cards[marketShip]!, resourceTokens: { DIL: 1 } } },
	}
	// the Neutral Zone: your Away Teams at slot 0, the Bot's at slot 1
	for (const [slot, id] of [
		[0, NZ_PLAIN],
		[1, NZ_VALUABLE],
	] as const) {
		const old = s.zones[`NEUTRAL_ZONE:${slot}`]![0]!
		s = moveCard(s, old, { k: 'BOX' })
		put(id, { k: 'NEUTRAL_ZONE', slot })
	}
	const plainLoc = iid(s, NZ_PLAIN)
	const valuableLoc = iid(s, NZ_VALUABLE)
	s = {
		...s,
		awayTeamsAt: { [plainLoc]: [2, 0], [valuableLoc]: [0, 1] },
		players: [
			{ ...s.players[0], awayTeamsInPool: s.players[0].awayTeamsInPool - 2 },
			{ ...s.players[1], awayTeamsInPool: s.players[1].awayTeamsInPool - 1 },
		],
	}
	// your saver card deployed; your Research at ×3, Military at ×1
	const saver = iid(s, YOUR_SAVER)
	s = { ...s, cards: { ...s.cards, [saver]: { ...s.cards[saver]!, owner: 0 } } }
	s = moveCard(s, saver, { k: 'FLEET', seat: 0 })
	s = setSpecialty(setTracks(s, 0, TEST_TRACKS_BASIC), 0, 'RESEARCH', 8)
	// the Bot: Influence below Military; 3 Bot actions, 2 Glory left on the Stardate
	s = setSpecialty(setSpecialty(s, 1, 'INFLUENCE', 0), 1, 'MILITARY', 2)
	s = {
		...s,
		stardates: { ...s.stardates, botActions: [3, 3, 3, 3, 4], gloryOnTop: 2 },
		phase: { k: 'BOT', beat: 'CONTROL' },
		activeSeat: 1,
		turnNumber: 1,
		turnsTaken: [1, 0],
	}
	return s
}

const step = (s: GameState): GameState => reduce(s, { t: 'BOT_STEP' }).state
const zone = (s: GameState, key: string) => s.zones[key] ?? []

describe('the solo rulebook’s complete Bot turn (solo p.11–15)', () => {
	it('plays out beat by beat', () => {
		let s = rulebookBoard()
		const id = (cardId: string) => iid(s, cardId)
		expect(legalIntents(s)).toEqual([{ t: 'BOT_STEP' }])

		// Control: nothing secured — straight on to drawing 3 face down
		s = step(s)
		expect(zone(s, 'BOT_ROW:1')).toEqual([id(ROW_PERSON), id(ROW_SHIP), id(ROW_LOCATION)])
		expect(s.phase).toEqual({ k: 'BOT', beat: 'RESOLVE' })

		// the PERSON (KLINGON is no TRAITS row) → SUITS PERSON, no Duty Officer
		s = step(s)
		expect(s.solo?.beat?.row).toEqual({ deck: 'KOL', suit: 'PERSON', do: false })
		expect(zone(s, 'DISCARD:1')).toContain(id(MILLED))
		expect(zone(s, 'INCIDENT_DECK').at(-1)).toBe(id(LOGGED_INCIDENT)) // logged → returned
		expect(s.players[1].specialties.INFLUENCE).toBe(1) // the lower of the two
		expect(zone(s, 'DISCARD:1')).toContain(id(MARKET_WEAPON)) // WEAPON over the SHIP
		expect(zone(s, 'DUTY_OFFICER:1')).toEqual([id(ROW_PERSON)])

		// the SHIP → SUITS SHIP, with Duty Officer: +1 Influence, deploy, engage, send
		s = step(s)
		expect(s.players[1].specialties.INFLUENCE).toBe(2)
		expect(s.cards[id(ROW_SHIP)]!.zone).toEqual({ k: 'FLEET', seat: 1 })
		expect(s.cards[id(ROW_SHIP)]!.shipTokenAt).toBe(id(NZ_PLAIN)) // most of yours
		expect(s.awayTeamsAt[id(NZ_VALUABLE)]).toEqual([0, 2]) // tie → the more valuable

		// the LOCATION → SUITS LOCATION, with Duty Officer: dismiss the Duty Officer, gain 1
		// Glory, resolve the top of the deck: its WEAPON row attacks
		s = step(s)
		expect(zone(s, 'DISCARD:1')).toContain(id(ROW_PERSON))
		expect(s.players[1].resources.GLO).toBe(1)
		expect(s.stardates.gloryOnTop).toBe(1)
		expect(zone(s, 'JUNK')).toContain(id(MARKET_RESEARCH)) // ties, leftmost
		expect(s.players[1].specialties.MILITARY).toBe(3)
		// you are asked whether your saver card reacts to the Away Team attack
		const window = s.pendingChoice
		expect(window?.k).toBe('OPTIONAL_TRIGGERS')
		expect(window?.seat).toBe(0)
		// a mid-beat save/reload resumes identically
		s = JSON.parse(JSON.stringify(s)) as GameState
		s = reduce(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: window!.id,
			selection: window!.k === 'OPTIONAL_TRIGGERS' ? window!.offered : [],
		}).state
		expect(s.awayTeamsAt[id(NZ_PLAIN)]?.[0]).toBe(2) // saved
		expect(zone(s, 'DISCARD:0')).toContain(id(YOUR_SAVER))
		expect(s.players[1].specialties.MILITARY).toBe(3) // no "otherwise"
		expect(zone(s, 'LOCATION_AREA:1')).toEqual([id(ROW_LOCATION)]) // into the Control Area
		expect(s.pending ?? {}).toEqual({})

		// Clean-up: discard Staging, Glory on the card least valuable to you
		s = step(s)
		expect(zone(s, 'DISCARD:1')).toContain(id(NEXT_WEAPON))
		expect(s.cards[id(MARKET_PERSON)]!.resourceTokens.GLO).toBe(1) // ties, fewer tokens
		// that emptied the Stardate card: it goes to you, and your turn begins
		expect(s.players[0].heldStardate).not.toBeNull()
		expect(s.activeSeat).toBe(0)
		expect(s.phase.k).not.toBe('BOT')
		assertInvariants(s)
	})
})
