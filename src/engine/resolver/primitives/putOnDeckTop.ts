import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { moveCard, pickSingle } from '../runtime'
import type { CardInstanceId } from '../../ids'

/** PUT_ON_DECK_TOP (todo/13 follow-up): move an in-play card to the top of its
 *  owner's deck (1PER17 does this to itself after
 *  being attacked). 'THIS' targets the resolving card. */
export const putOnDeckTop: Primitive<
	Extract<Effect, { k: 'PUT_ON_DECK_TOP' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (node.target === 'THIS') return true
		return resolveQuery(state, node.target, ctx).length > 0
	},
	offersDecline: (_state, node) => node.target !== 'THIS',
	execute(state, node, ctx, _frame) {
		let iid: CardInstanceId
		if (node.target === 'THIS') {
			iid = ctx.duplicating ?? ctx.source
		} else {
			const candidates = resolveQuery(state, node.target, ctx)
			const r = pickSingle(state, node, ctx, 'putOnDeckTop', {
				prompt: 'Put a card on top of your deck',
				declinable: true,
				candidates,
				from: 'IN_PLAY',
			})
			if (r.kind === 'suspended') return r.state
			if (r.kind === 'none') return state
			iid = r.iids[0]!
		}
		const card = state.cards[iid]
		if (card === undefined) return state
		const owner = card.owner ?? ctx.actor
		return moveCard(state, iid, { k: 'DRAW', seat: owner }, { toTop: true })
	},
}
