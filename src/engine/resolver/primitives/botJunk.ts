import type { Effect } from '../nodes'
import type { Primitive } from './index'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import { otherSeat } from '../../state'
import { addLog, moveCard } from '../runtime'
import { marketOffers, refillMarket, suitOfOffer } from '../../market'
import { pickByValue, tokensOn } from '../../solo/value'
import type { Seat } from '../queries'

/** The token-free Market card most valuable to the Bot's opponent. */
function junkPick(state: GameState, bot: Seat): CardInstanceId | null {
	return pickByValue(
		state,
		marketOffers(state).filter((iid) => tokensOn(state, iid) === 0),
		otherSeat(bot),
		'MOST',
	)
}

/** BOT_JUNK — "Junk the most valuable card in the Market (ignoring any with
 *  tokens)": the one most valuable to the opponent (rules/13 §13.10.2). */
export const botJunk: Primitive<Extract<Effect, { k: 'BOT_JUNK' }>> = {
	isCost: false,
	canResolve: (state, _node, ctx) => junkPick(state, ctx.actor) !== null,
	execute(state, _node, ctx, _frame) {
		const iid = junkPick(state, ctx.actor)
		if (iid === null) return state
		const suit = suitOfOffer(state, iid)
		let next = moveCard(state, iid, { k: 'JUNK' })
		if (suit !== undefined) next = refillMarket(next, suit)
		return addLog(next, {
			kind: 'EVENT',
			seat: ctx.actor,
			iid,
			message: `junked ${iid} from the Market`,
		})
	},
}
