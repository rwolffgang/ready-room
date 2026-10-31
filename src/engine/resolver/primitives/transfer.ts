import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { addLog, moveCard, setOwner } from '../runtime'

/** TRANSFER — "put this card on the bottom of your Draw deck": the resolving
 *  card leaves wherever it is (the solo Bot's Staging Area, for 1DIR01/2's
 *  SURPRISE) and becomes the actor's, at the bottom of their deck. */
export const transfer: Primitive<Extract<Effect, { k: 'TRANSFER' }>> = {
	isCost: false,
	canResolve: (state, _node, ctx) => state.cards[ctx.source] !== undefined,
	execute(state, _node, ctx, _frame) {
		const iid = ctx.duplicating ?? ctx.source
		const next = moveCard(setOwner(state, iid, ctx.actor), iid, {
			k: 'DRAW',
			seat: ctx.actor,
		})
		return addLog(next, {
			kind: 'EVENT',
			seat: ctx.actor,
			iid,
			message: `put ${iid} on the bottom of their Draw deck`,
		})
	},
}
