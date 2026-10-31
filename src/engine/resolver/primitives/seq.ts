import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { withoutDecline } from '../runtime'

/** Resolve steps in order, one primitive per executeOne (instruction-pointer
 *  SEQ). An open "you may" decline goes to the first step only (may.ts). */
export const seq: Primitive<Extract<Effect, { k: 'SEQ' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, frame) {
		if (frame.ip >= node.steps.length) return state
		const later = withoutDecline(ctx)
		state.stack.push({
			k: 'EFFECT',
			node: frame.node,
			ctx: later,
			ip: frame.ip + 1,
		})
		state.stack.push({
			k: 'EFFECT',
			node: node.steps[frame.ip]!,
			ctx: frame.ip === 0 ? ctx : later,
			ip: 0,
		})
		return state
	},
}
