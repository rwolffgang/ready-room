import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { failOperation, skipBenefit, withoutDecline } from '../runtime'
import { canPayAll } from './index'

/** PAY_THEN: pre-validate the whole cost subtree, THEN push body under cost
 *  (cost executes first — rules/12 §12.1, todo/04 §4). An unpayable cost
 *  fails the operation — unless this PAY_THEN runs inside an accepted MAY
 *  (`ctx.optional`): then only the optional part is skipped and the rest of
 *  the operation continues ("You may discard a SHIP to …" — 1PIC04). An
 *  open "you may" decline goes to the cost, which is asked first (may.ts). */
export const payThen: Primitive<Extract<Effect, { k: 'PAY_THEN' }>> = {
	isCost: false,
	canResolve: () => true, // execute fails upward if the cost cannot be paid
	execute(state, node, ctx, _frame) {
		if (!canPayAll(state, node.cost, ctx)) {
			if (ctx.optional === true)
				return skipBenefit(state, node, ctx, 'optional cost cannot be paid')
			return failOperation(state, 'PAY_THEN: cannot pay the full cost')
		}
		state.stack.push({
			k: 'EFFECT',
			node: node.body,
			ctx: withoutDecline(ctx),
			ip: 0,
		})
		state.stack.push({ k: 'EFFECT', node: node.cost, ctx, ip: 0 })
		return state
	},
}
