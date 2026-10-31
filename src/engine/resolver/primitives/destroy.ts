import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { pickCards, moveCard, emit } from '../runtime'

export const destroy: Primitive<Extract<Effect, { k: 'DESTROY' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (node.target === 'THIS') return true
		return resolveQuery(state, node.target, ctx).length > 0
	},
	offersDecline: (_state, node) => node.target !== 'THIS',
	execute(state, node, ctx, _frame) {
		if (node.target === 'THIS') {
			const iid = ctx.duplicating ?? ctx.source
			return emit(moveCard(state, iid, { k: 'BOX' }), {
				k: 'CARD_DESTROYED',
				iid,
				seat: ctx.actor,
			})
		}
		const candidates = resolveQuery(state, node.target, ctx)
		const r = pickCards(state, node, ctx, 'destroy', {
			prompt: 'Destroy a card',
			declinable: true,
			candidates,
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		return emit(moveCard(state, iid, { k: 'BOX' }), {
			k: 'CARD_DESTROYED',
			iid,
			seat: ctx.actor,
		})
	},
}
