// A full PIC-vs-SHR game driven through the SESSION adapter (not the
// engine test driver) — the fixture the session tests replay/undo/save over.
// The prose mirrors src/engine/pic-shr-game.test.ts (which asserts the
// outcomes); here the point is purely that each intent goes through
// SessionAdapter → the recorded session is a faithful replay. The script is
// stateless-in-time: every step re-derives card ids from the current state, so
// driving a second fresh adapter reproduces it byte-identically.
//
// Includes mid-choice RESOLVE_CHOICEs (CHOOSE_CARDS / CHOOSE_LOCATION /
// CHOOSE_DESTINATION / OPTIONAL_TRIGGERS / CONFIRM), turn boundaries, a Runaway
// Stardate, an OPTIONAL trigger window and final scoring — spanning multiple
// of every intent kind the engine knows.

import type { CardDef } from '../data/schema'
import type { Effect } from '../engine/resolver/nodes'
import type { PendingChoice } from '../engine/resolver/choices'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import type { CardInstanceId } from '../engine/ids'
import { loadCatalog } from '../data/catalog'
import type { SessionAdapter } from './adapter'

/** Real catalog + the single clean-up Stardate (printed Glory 1) the scripted
 *  game needs — same treatment as the engine's real-card test. */
export async function makeCatalog(): Promise<CardCatalog> {
	const catalog = await loadCatalog()
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

export function sessionConfig(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 25,
	}
}

const zoneIids = (s: SessionAdapter['state'], key: string): CardInstanceId[] =>
	s.zones[key] ?? []
const findDef = (
	s: SessionAdapter['state'],
	key: string,
	def: string,
): CardInstanceId => {
	const iid = zoneIids(s, key).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`playGame: ${def} not in ${key}`)
	return iid
}

/** Drive a full scripted game through `adapter`. `onStep(adapter)` fires after
 *  every accepted intent (for snapshot capture). */
export function playGame(
	adapter: SessionAdapter,
	onStep: (adapter: SessionAdapter) => void = () => {},
): void {
	let s = adapter.state

	const dispatch = (
		intent: Parameters<SessionAdapter['dispatch']>[0],
	): void => {
		s = adapter.dispatch(intent)
		onStep(adapter)
	}
	const settle = (selection: unknown): void => {
		s = adapter.settle(selection)
		onStep(adapter)
	}

	// ---------- Turn 1 — PIC (seat 0) ----------
	dispatch({ t: 'START' })
	const pic23 = findDef(s, 'HAND:0', '1PIC23-24')
	dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
	const slot0Loc = findDef(s, 'NEUTRAL_ZONE:0', '1LOC16-20')
	settle(slot0Loc)
	const ent = findDef(s, 'FLEET:0', '1PIC02-24')
	dispatch({ t: 'ACTIVATE', iid: ent, operationIndex: 3 })
	const analyze = findDef(s, 'HAND:0', '1PIC15-24')
	dispatch({ t: 'PLAY_CARD', iid: analyze, operationIndex: 0 })
	const shipOffer = zoneIids(s, 'MARKET_OFFER:SHIP')[0]!
	settle([shipOffer])
	settle('DECK_TOP')
	const snw = findDef(s, 'HAND:0', '1PIC18-24')
	dispatch({ t: 'PLAY_CARD', iid: snw, operationIndex: 0 })
	dispatch({ t: 'END_TURN' })
	const allyOffer = zoneIids(s, 'MARKET_OFFER:ALLY')[0]!
	settle([allyOffer])
	settle([])

	// ---------- Turn 2 — SHR (seat 1) ----------
	const shr21 = findDef(s, 'HAND:1', '1SHR21-24')
	dispatch({ t: 'PLAY_CARD', iid: shr21, operationIndex: 0 })
	const slot1Loc = findDef(s, 'NEUTRAL_ZONE:1', '1LOC02-20')
	settle(slot1Loc)
	const shr23 = findDef(s, 'HAND:1', '1SHR23-24')
	dispatch({ t: 'PLAY_CARD', iid: shr23, operationIndex: 0 })
	const utilize = findDef(s, 'HAND:1', '1SHR22-24')
	dispatch({ t: 'PLAY_CARD', iid: utilize, operationIndex: 0 })
	dispatch({ t: 'END_TURN' })
	settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!])
	settle([])

	// ---------- Turn 3 — PIC ----------
	const recruit = findDef(s, 'HAND:0', '1PIC17-24')
	dispatch({ t: 'PLAY_CARD', iid: recruit, operationIndex: 1 })
	const allyBuy = zoneIids(s, 'MARKET_OFFER:ALLY')[0]!
	settle([allyBuy])
	settle('DISCARD')
	const triggers = s.pendingChoice as PendingChoice & {
		offered: { card: string; opIndex: number; seat: number }[]
	}
	settle(triggers.offered)
	const dkyrShip = findDef(s, 'HAND:0', '1SHI03-13')
	settle([dkyrShip])
	settle([]) // decline the "you may" (asked as the pick itself)
	const pic24 = findDef(s, 'DUTY_OFFICER:0', '1PIC24-24')
	dispatch({ t: 'ACTIVATE', iid: pic24, operationIndex: 3 })
	const dkyr = findDef(s, 'HAND:0', '1SHI03-13')
	dispatch({ t: 'PLAY_CARD', iid: dkyr, operationIndex: 0 })
	settle(zoneIids(s, 'NEUTRAL_ZONE:2')[0]!) // WARP to the empty NZ slot 2
	const inc05 = findDef(s, 'HAND:0', '1INC05-6')
	settle([inc05]) // the "you may" is asked as this pick
	dispatch({ t: 'END_TURN' })
	settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!])
	settle([])

	// ---------- Turn 4 — SHR (last turn of the round) ----------
	const shr17 = findDef(s, 'HAND:1', '1SHR17-24')
	dispatch({ t: 'PLAY_CARD', iid: shr17, operationIndex: 2 })
	dispatch({ t: 'END_TURN' })
	settle([zoneIids(s, 'MARKET_OFFER:SHIP')[0]!])
	settle([])

	if (adapter.state.result?.kind !== 'COMPLETE') {
		throw new Error(
			`playGame: expected COMPLETE, got ${adapter.state.result?.kind ?? 'ongoing'}`,
		)
	}
}
