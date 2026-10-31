import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { otherSeat } from '../../state'
import { ATTACK_BINDING, closePending, openAttack } from '../replacement'
import { emit } from '../runtime'

/** Bindings an ATTACK lends its body (the same ones an ATTACK operation's
 *  frame carries — stack.ts), removed again when it closes. */
const ATTACK_KEYS = ['$op.isAttack', '$op.seat', ATTACK_BINDING] as const

/** ATTACK — the red part of a solo Bot row (rules/13 §13.12.1): an attack on
 *  the opponent around `body`, exactly like an ATTACK operation. The record
 *  opens first, so the victim's "would be attacked" windows and cancels apply
 *  to the body's negative effects; once the body is done the record closes
 *  and ATTACKED fires — even when it was cancelled, which still counts as
 *  performed. The keys go into the shared bindings (not a copy), so what the
 *  body binds ("discard the top card … if it is a PERSON") stays visible to
 *  the rest of the row. */
export const attack: Primitive<Extract<Effect, { k: 'ATTACK' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, frame) {
		if (frame.ip === 1) {
			const id = ctx.bindings[ATTACK_BINDING]
			for (const key of ATTACK_KEYS) delete ctx.bindings[key]
			const closed = typeof id === 'string' ? closePending(state, id) : state
			return emit(closed, {
				k: 'ATTACKED',
				seat: ctx.actor,
				victim: otherSeat(ctx.actor),
			})
		}
		const opened = openAttack(state, ctx.source, -1, ctx.actor)
		ctx.bindings['$op.isAttack'] = true
		ctx.bindings['$op.seat'] = ctx.actor
		ctx.bindings[ATTACK_BINDING] = opened.id
		return {
			...opened.state,
			stack: [
				...opened.state.stack,
				{ k: 'EFFECT', node, ctx, ip: 1 },
				{ k: 'EFFECT', node: node.body, ctx, ip: 0 },
			],
		}
	},
}
