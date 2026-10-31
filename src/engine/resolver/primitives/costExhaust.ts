import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	exhaustibleCandidates,
	pickSingle,
	failOperation,
	thisOnly,
} from '../runtime'

export const costExhaust: Primitive<Extract<Effect, { k: 'COST_EXHAUST' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = thisOnly(
			exhaustibleCandidates(state, ctx, node.filter),
			node,
			ctx,
		)
		const r = pickSingle(state, node, ctx, 'costExhaust', {
			prompt: 'Exhaust a card',
			declinable: true,
			candidates,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_EXHAUST: no legal selection')
		const iid = r.iids[0]!
		// bind: the exhausted card ("exhaust a SHIP to refresh ITS LOCATION" — 1BUR21)
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
		return {
			...state,
			cards: {
				...state.cards,
				[iid]: { ...state.cards[iid]!, exhausted: true },
			},
		}
	},
}
