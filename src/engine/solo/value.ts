// Card value for the solo Bot (rules/13 §13.3): what a card would score for
// a seat if the game ended right after that seat gained it — printed VP, each
// Focus icon at that seat's current multiplier, 5 per ENDGAME operation and 1
// per Glory token on it. Ties go to the card with more resource tokens of any
// kind, then to the leftmost (Market: PERSON, CARGO, SHIP, ALLY; Neutral Zone:
// slot order). "Least valuable" is the mirror image, so fewer tokens first.

import { MARKET_SUITS, type SpecialtyId } from '../../data/ids'
import { cardDef } from '../cards'
import { highestMultiplierReached } from '../scoring'
import type { GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'

/** The card's value to `forSeat` (rules/13 §13.3). */
export function cardValue(
	state: GameState,
	iid: CardInstanceId,
	forSeat: Seat,
): number {
	const card = state.cards[iid]
	if (card === undefined) return 0
	const def = cardDef(card.def)
	let value = def.vp
	if (def.focus !== null)
		value += highestMultiplierReached(
			state,
			forSeat,
			def.focus.slice('FOCUS_'.length) as SpecialtyId,
		)
	value += 5 * def.operations.filter((op) => op.type === 'ENDGAME').length
	value += card.resourceTokens.GLO ?? 0
	return value
}

/** Resource tokens of any kind sitting on the card (the first tie-break). */
export function tokensOn(state: GameState, iid: CardInstanceId): number {
	let n = 0
	for (const v of Object.values(state.cards[iid]?.resourceTokens ?? {}))
		n += v ?? 0
	return n
}

/** Left-to-right position for the last tie-break: Market offers by suit,
 *  Neutral Zone slots, otherwise the order within the card's zone. */
export function leftIndex(state: GameState, iid: CardInstanceId): number {
	const zone = state.cards[iid]?.zone
	if (zone === undefined) return Number.MAX_SAFE_INTEGER
	if (zone.k === 'MARKET_OFFER') return MARKET_SUITS.indexOf(zone.suit)
	if (zone.k === 'NEUTRAL_ZONE') return zone.slot
	const key =
		'seat' in zone ? `${zone.k}:${zone.seat}` : (zone.k as string)
	return 10 + (state.zones[key]?.indexOf(iid) ?? 0)
}

/** The most (or least) valuable of `iids` to `forSeat`, ties broken by tokens
 *  then leftmost; null for an empty list. */
export function pickByValue(
	state: GameState,
	iids: readonly CardInstanceId[],
	forSeat: Seat,
	want: 'MOST' | 'LEAST',
): CardInstanceId | null {
	let best: CardInstanceId | null = null
	let bestKey: [number, number, number] = [0, 0, 0]
	for (const iid of iids) {
		const sign = want === 'MOST' ? 1 : -1
		// larger key wins: value, then tokens (same direction), then leftmost
		const key: [number, number, number] = [
			sign * cardValue(state, iid, forSeat),
			sign * tokensOn(state, iid),
			-leftIndex(state, iid),
		]
		if (best === null || compareKeys(key, bestKey) > 0) {
			best = iid
			bestKey = key
		}
	}
	return best
}

function compareKeys(
	a: [number, number, number],
	b: [number, number, number],
): number {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
	return 0
}
