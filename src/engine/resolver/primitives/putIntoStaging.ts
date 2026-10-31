import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { pickSingle, moveCard, emit } from '../runtime'

export const putIntoStaging: Primitive<
	Extract<Effect, { k: 'PUT_INTO_STAGING' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return resolveQuery(state, node.target, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = resolveQuery(state, node.target, ctx)
		const r = pickSingle(state, node, ctx, 'staging', {
			prompt: 'Put a card into your Staging Area',
			declinable: true,
			candidates,
			from: 'SELECT',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		return emit(moveCard(state, iid, { k: 'STAGING', seat: ctx.actor }), {
			k: 'PUT_INTO_PLAY',
			iid,
			seat: ctx.actor,
		})
	},
}
