import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickCards } from '../runtime'
import { resolveQuery, evalAmount } from '../../queries/resolveQuery'

/** REFRESH (rules/08 §refresh): rotate exhausted in-play cards upright.
 *  Action tokens stay (a refresh does not cost or refund an action). */
export const refresh: Primitive<Extract<Effect, { k: 'REFRESH' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return resolveQuery(state, node.target, ctx).some(
			(iid) => state.cards[iid]!.exhausted,
		)
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const count =
			node.count !== undefined
				? Math.max(1, evalAmount(state, node.count, ctx))
				: 1
		const candidates = resolveQuery(state, node.target, ctx).filter(
			(iid) => state.cards[iid]!.exhausted,
		)
		const r = pickCards(state, node, ctx, 'refresh', {
			prompt: 'Refresh cards',
			declinable: true,
			candidates,
			min: 1,
			max: Math.min(count, candidates.length),
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		let next = state
		for (const iid of r.iids)
			next = {
				...next,
				cards: {
					...next.cards,
					[iid]: { ...next.cards[iid]!, exhausted: false },
				},
			}
		return next
	},
}
