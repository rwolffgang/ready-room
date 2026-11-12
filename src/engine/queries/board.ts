// Board queries (todo/05 §5, rules/06, rules/08 → `secured`, rules/12 §12.15):
//   - tokensAt: Away Teams + Ship tokens at a Location for one player
//     (rules/03 §3.4.1 "tokens" = Away Teams + Ship tokens, in any combination);
//   - isSecured: a neutral LOCATION is secured iff ≥3 tokens and ≥2 more than
//     the opponent (rules/03 §3.4.1, rules/08 → `secured`);
//   - canSendAwayTeam: blocked iff the Location is neutral AND the opponent has
//     MORE Ship tokens there than you (Away Teams never block, ties never
//     block, controlled Locations are never blocked — rules/12 §12.15).

import { otherSeat, type GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'
import { blocksSendsTo, ignoresOpponentShips } from '../modifiers'

/** Ship tokens of `seat` parked at `locIid` (a SHIP only counts from its
 *  deployed Fleet position — same rule takeControl's compensation uses). */
export function shipTokensAt(
	state: GameState,
	locIid: CardInstanceId,
	seat: Seat,
): number {
	let n = 0
	for (const card of Object.values(state.cards)) {
		if (
			card.owner === seat &&
			card.zone.k === 'FLEET' &&
			card.shipTokenAt === locIid
		)
			n++
	}
	return n
}

/** Total tokens (Away Teams + Ship tokens) of `seat` at `locIid`. */
export function tokensAt(
	state: GameState,
	locIid: CardInstanceId,
	seat: Seat,
): number {
	return (
		(state.awayTeamsAt[locIid]?.[seat] ?? 0) + shipTokensAt(state, locIid, seat)
	)
}

/** Is `locIid` a neutral (uncontrolled) Location? */
function isNeutral(state: GameState, locIid: CardInstanceId): boolean {
	return state.cards[locIid]?.zone.k === 'NEUTRAL_ZONE'
}

/** Is `locIid` controlled by anyone? */
function isControlled(state: GameState, locIid: CardInstanceId): boolean {
	return state.cards[locIid]?.zone.k === 'LOCATION_AREA'
}

/** A neutral LOCATION is secured by `seat` iff they have ≥3 tokens there and
 *  ≥2 more than the opponent (rules/03 §3.4.1). Non-neutral Locations are
 *  never secured. */
export function isSecured(
	state: GameState,
	locIid: CardInstanceId,
	seat: Seat,
): boolean {
	if (!isNeutral(state, locIid)) return false
	const mine = tokensAt(state, locIid, seat)
	const opp = tokensAt(state, locIid, otherSeat(seat))
	return mine >= 3 && mine - opp >= 2
}

/** May `seat` send an Away Team to `locIid`? Blocked iff neutral AND
 *  oppShipTokens > yourShipTokens (rules/12 §12.15); ties and controlled
 *  Locations are always allowed. */
export function canSendAwayTeam(
	state: GameState,
	seat: Seat,
	locIid: CardInstanceId,
	ignoreOpponentShips = false,
): boolean {
	// Passive block: the Location's own passives can forbid sends outright
	// (1BUR10 "you cannot send here" — docs-notes gap #1).
	if (blocksSendsTo(state, locIid)) return false
	if (isControlled(state, locIid)) return true // controlled Locations are never blocked
	if (!isNeutral(state, locIid)) return true // not a live contestable Location
	// Passive ignore: while the seat has a 1PIC05-style modifier active,
	// opponent SHIP tokens never block at neutral Locations (1PIC05).
	const opp =
		ignoreOpponentShips || ignoresOpponentShips(state, seat)
			? 0
			: shipTokensAt(state, locIid, otherSeat(seat))
	const mine = shipTokensAt(state, locIid, seat)
	return !(opp > mine) // ties do not block
}
