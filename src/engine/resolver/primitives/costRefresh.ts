import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	refreshableCandidates,
	pickSingle,
	failOperation,
	thisOnly,
} from '../runtime'

/** COST_REFRESH: "Refresh a BAJORAN to draw a card" (1SIS04 ORB OF PROPHECY
 *  AND CHANGE) — refreshing one of your exhausted in-play cards IS the cost,
 *  so nothing is drawn when there is nothing to refresh. `bind` = the
 *  refreshed card. */
export const costRefresh: Primitive<Extract<Effect, { k: 'COST_REFRESH' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx) {
		const r = pickSingle(state, node, ctx, 'costRefresh', {
			prompt: 'Refresh a card',
			declinable: true,
			candidates: thisOnly(
				refreshableCandidates(state, ctx, node.filter),
				node,
				ctx,
			),
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_REFRESH: no legal selection')
		const iid = r.iids[0]!
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
		return {
			...state,
			cards: {
				...state.cards,
				[iid]: { ...state.cards[iid]!, exhausted: false },
			},
		}
	},
}
