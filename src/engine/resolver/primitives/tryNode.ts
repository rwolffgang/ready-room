import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { canResolveEffect } from './index'
import { otherSeat, type EffectCtx, type GameState } from '../../state'

/** Could `node` fully resolve right now? Like `canResolveEffect`, but looks
 *  through FORCE, OPPONENT and ATTACK into what would actually happen ("if
 *  able, you remove an AWAY TEAM" asks whether YOU have one to remove). */
export function able(state: GameState, node: Effect, ctx: EffectCtx): boolean {
	switch (node.k) {
		case 'FORCE':
		case 'OPPONENT':
			return able(state, node.body, { ...ctx, actor: otherSeat(ctx.actor) })
		case 'ATTACK':
			return able(state, node.body, ctx)
		case 'SEQ':
			return (
				node.steps.length > 0 && node.steps.every((s) => able(state, s, ctx))
			)
		case 'TRY':
			return (
				able(state, node.test ?? node.body, ctx) ||
				(node.otherwise !== undefined && able(state, node.otherwise, ctx))
			)
		default:
			return canResolveEffect(state, node, ctx)
	}
}

/** TRY — "If able, X. Otherwise, Y." (rules/13 §13.6.2). Decided once, before
 *  anything runs: X (or `test`, for "if able to do both …") must be able to
 *  resolve now. A cancelled attack inside X therefore still counts as done, and
 *  Y does not follow (rules/13 §13.12.1). */
export const tryNode: Primitive<Extract<Effect, { k: 'TRY' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const branch = able(state, node.test ?? node.body, ctx)
			? node.body
			: node.otherwise
		if (branch !== undefined)
			state.stack.push({ k: 'EFFECT', node: branch, ctx, ip: 0 })
		return state
	},
}
