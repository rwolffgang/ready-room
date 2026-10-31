import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { pickSingle } from '../runtime'

/** SELECT: "Select a controlled LOCATION. If there … Log the selected
 *  LOCATION" (1PIC18). Choose one card the query names and
 *  bind it under `bind` for the operation's later steps; nothing moves. */
export const select: Primitive<Extract<Effect, { k: 'SELECT' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return resolveQuery(state, node.target, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = resolveQuery(state, node.target, ctx)
		const r = pickSingle(state, node, ctx, 'select', {
			prompt: 'Select a card',
			declinable: true,
			candidates,
			from: 'SELECT',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		ctx.bindings[node.bind] = r.iids[0]!
		return state
	},
}
