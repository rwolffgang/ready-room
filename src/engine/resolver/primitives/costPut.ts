import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	putCandidates,
	pickCards,
	moveCard,
	failOperation,
	specToRef,
	emit,
	thisOnly,
} from '../runtime'

export const costPut: Primitive<Extract<Effect, { k: 'COST_PUT' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = thisOnly(
			putCandidates(state, ctx, node.filter, node.from),
			node,
			ctx,
		)
		const r = pickCards(state, node, ctx, 'costPut', {
			prompt: 'Put a card',
			declinable: true,
			candidates,
			min: node.count,
			max: node.count,
			from: node.from === undefined ? `HAND:${ctx.actor}` : 'ZONES',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_PUT: no legal selection')
		const to = specToRef(node.to, ctx.actor)
		let next = state
		for (const iid of r.iids) {
			// a Draw deck destination is "the top of your deck" (describeZoneSpec)
			next = moveCard(
				next,
				iid,
				to,
				to.k === 'DRAW' ? { toTop: true } : undefined,
			)
			// putting a card into the Staging Area puts it into play (rules/08 →
			// put into play) — a SHIP staged this way skips its PLAY operation
			// (1PER25, 1PER10)
			if (to.k === 'STAGING')
				next = emit(next, { k: 'PUT_INTO_PLAY', iid, seat: ctx.actor })
		}
		return next
	},
}
