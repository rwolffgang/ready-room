import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickSingle } from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'

/** EXHAUST: rotate an unexhausted in-play card face down. */
export const exhaust: Primitive<Extract<Effect, { k: 'EXHAUST' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return resolveQuery(state, node.target, ctx).some(
			(iid) => !state.cards[iid]!.exhausted,
		)
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = resolveQuery(state, node.target, ctx).filter(
			(iid) => !state.cards[iid]!.exhausted,
		)
		const r = pickSingle(state, node, ctx, 'exhaust', {
			prompt: 'Exhaust a card',
			declinable: true,
			candidates,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		return {
			...state,
			cards: {
				...state.cards,
				[iid]: { ...state.cards[iid]!, exhausted: true },
			},
		}
	},
}
