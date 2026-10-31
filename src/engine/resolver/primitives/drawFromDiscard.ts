import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickCards, moveCard, emit } from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'

export const drawFromDiscard: Primitive<
	Extract<Effect, { k: 'DRAW_FROM_DISCARD' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const cand = candidates(state, node, ctx)
		const r = pickCards(state, node, ctx, 'drawFromDiscard', {
			prompt: 'Draw from Discard',
			declinable: true,
			candidates: cand,
			min: 1,
			max: Math.max(1, Math.min(node.count, cand.length)),
			from: `DISCARD:${ctx.actor}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		if (node.bind !== undefined && r.iids.length > 0)
			ctx.bindings[node.bind] = r.iids[r.iids.length - 1]!
		let next = state
		for (const iid of r.iids) {
			next = emit(moveCard(next, iid, { k: 'HAND', seat: ctx.actor }), {
				k: 'CARD_DRAWN',
				iid,
				seat: ctx.actor,
			})
		}
		return next
	},
}

function candidates(
	state: GameState,
	node: Effect & { k: 'DRAW_FROM_DISCARD' },
	ctx: EffectCtx,
): CardInstanceId[] {
	return resolveQuery(
		state,
		{ zones: [{ k: 'DISCARD', seat: 0 }], filter: node.filter },
		ctx,
	)
}
