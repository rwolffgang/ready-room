import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	dismissibleCandidates,
	pickCards,
	failOperation,
	moveCard,
	emit,
	thisOnly,
} from '../runtime'

/** COST_DISMISS (docs/effect-dsl.md §3): dismiss `count` of your in-play cards
 *  as a cost. Emits CARD_DISMISSED per card exactly like DISMISS, so "when a
 *  card is dismissed" reactions see cost-paid dismissals too. */

export const costDismiss: Primitive<Extract<Effect, { k: 'COST_DISMISS' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = thisOnly(
			dismissibleCandidates(state, ctx, node.filter, node.from),
			node,
			ctx,
		)
		const r = pickCards(state, node, ctx, 'costDismiss', {
			prompt: 'Dismiss a card',
			declinable: true,
			candidates,
			min: node.count,
			max: node.count,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_DISMISS: no legal selection')
		let next = state
		for (const iid of r.iids) {
			const owner = next.cards[iid]!.owner
			next = emit(
				moveCard(next, iid, { k: 'DISCARD', seat: owner ?? ctx.actor }),
				{ k: 'CARD_DISMISSED', iid, seat: ctx.actor },
			)
		}
		return next
	},
}
