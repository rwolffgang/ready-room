// Endgame detection (todo/06 §3, rules/03 §3.1, rules/12 §12.11). The Burn is
// a *continuous* condition: "check 'Incident deck is empty' immediately after
// any effect that draws from it". It is wired into the run-loop's event drain
// so it fires after every primitive, not only at phase boundaries. Resolution
// turn-budget accounting lives in phases.ts (it needs the turn-end bookkeeping
// the run loop cannot see).
//
// The Burn takes priority over a pending Resolution (rules/03 §3.1). Final
// winner/scoreboard computation (and the Burn→scoring fallback for a tie) is
// todo/10's `finalizeGame` in scoring.ts; here we only count the INCIDENTs a
// Burn would compare.

import type { GameState } from './state'
import { campaignCheck } from './solo/campaign'
import { cardDef } from './cards'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

/** Run after every primitive. Returns the state, possibly ended by a Burn. */
export function checkEndgame(state: GameState): GameState {
	if (state.result !== null) return state
	// The Burn is "the Incident deck empties". A game only has an Incident deck
	// once setup ran — module-level engine tests build bare states with no
	// INCIDENT_DECK zone, and must not trip the Burn. Key presence (an empty
	// array) discriminates a real, emptied deck from an uninitialised one.
	const incident = state.zones['INCIDENT_DECK']
	if (incident !== undefined && incident.length === 0) {
		return { ...state, result: { kind: 'BURN' }, phase: { k: 'GAME_OVER' } }
	}
	// a Five-Year Mission game's challenges (rules/14 §14.5)
	return state.mode === 'SOLO' ? campaignCheck(state) : state
}

/** INCIDENT cards `seat` owns in hand + Discard pile + Draw deck + Captain's
 *  Log (rules/03 §3.1). The Reserve deck is explicitly excluded; INCIDENT cards
 *  in the Incident deck or the Junk pile are not owned by anyone (todo/10 §1). */
export function countIncidents(state: GameState, seat: Seat): number {
	let n = 0
	for (const iid of Object.keys(state.cards) as CardInstanceId[]) {
		const card = state.cards[iid]
		if (!card || card.owner !== seat) continue
		if (cardDef(card.def).suit !== 'INCIDENT') continue
		const z = card.zone
		if (z.k === 'HAND' || z.k === 'DISCARD' || z.k === 'DRAW' || z.k === 'LOG')
			n++
	}
	return n
}
