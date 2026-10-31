// Who is the official solo Bot (rules/13)? The human always sits at seat 0
// and the Bot at seat 1, but every rule branch asks through here so the
// mode stays the one switch.

import type { GameState } from '../state'
import type { Seat } from '../resolver/queries'

/** Is `seat` the official solo Bot in this game? */
export function isSoloBot(state: GameState, seat: Seat): boolean {
	return state.mode === 'SOLO' && state.solo?.bot === seat
}

/** The solo Bot's seat, or null outside a solo game. */
export function soloBotSeat(state: GameState): Seat | null {
	return state.mode === 'SOLO' ? (state.solo?.bot ?? null) : null
}
