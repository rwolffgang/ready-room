// The Bot deck and its reshuffle (rules/13 §13.5). Whenever the Bot needs a
// card from an empty Bot deck, its Discard pile (never the Staging Area) is
// shuffled into a new Bot deck and the top Supplement card goes on top — the
// Bot's version of enlisting, with no difference between Reserve and
// Development cards and nothing to pay.

import { addLog, moveCard } from '../resolver/runtime'
import { shuffleDiscardIntoDeck } from '../resolver/primitives/draw'
import type { GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'

const size = (state: GameState, key: string): number =>
	state.zones[key]?.length ?? 0

/** Can the Bot deck give a card, directly or by reshuffling? Read-only. */
export function botDeckCanAdvance(state: GameState, seat: Seat): boolean {
	return (
		size(state, `DRAW:${seat}`) > 0 ||
		size(state, `DISCARD:${seat}`) > 0 ||
		size(state, `SUPPLEMENT:${seat}`) > 0
	)
}

/** The Bot deck's top card, after the reshuffle if the deck was empty; null
 *  when even that yields nothing. The returned state carries the reshuffle
 *  (it consumes RNG), so callers must thread it. */
export function botDeckTop(
	state: GameState,
	seat: Seat,
): { state: GameState; top: CardInstanceId | null } {
	const top = state.zones[`DRAW:${seat}`]?.[0]
	if (top !== undefined) return { state, top }
	if (!botDeckCanAdvance(state, seat)) return { state, top: null }
	let next = shuffleDiscardIntoDeck(state, seat)
	const supplement = next.zones[`SUPPLEMENT:${seat}`]?.[0]
	if (supplement !== undefined)
		next = moveCard(next, supplement, { k: 'DRAW', seat }, { toTop: true })
	next = addLog(next, {
		kind: 'INFO',
		seat,
		message: 'The Bot deck was empty: the Bot shuffles its Discard pile into a new deck and adds the top card of its Supplement deck',
	})
	return { state: next, top: next.zones[`DRAW:${seat}`]?.[0] ?? null }
}
