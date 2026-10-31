import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import {
	moveCard,
	failOperation,
	pickCards,
	costCanResolve,
	thisOnly,
} from '../runtime'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'

function candidatesOf(
	state: GameState,
	node: Effect & { k: 'COST_RECALL' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	const zone = node.from ?? 'IN_PLAY'
	return thisOnly(
		resolveQuery(
			state,
			{ zones: [zone], seat: 'SELF', filter: node.filter },
			ctx,
		),
		node,
		ctx,
	)
}

/** COST_RECALL (docs/effect-dsl.md §3): recall an in-play card of yours to
 *  your hand as a cost (rules/08 → recall, rules/12 §12.1). The card moves
 *  hand-ward and cascades its beamed cards; unpayable → parent fails. */
export const costRecall: Primitive<Extract<Effect, { k: 'COST_RECALL' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = candidatesOf(state, node, ctx)
		const r = pickCards(state, node, ctx, 'costRecall', {
			prompt: 'Recall a card',
			declinable: true,
			candidates,
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_RECALL: no legal selection')
		let next: GameState = state
		for (const iid of r.iids)
			next = moveCard(next, iid, { k: 'HAND', seat: ctx.actor })
		return next
	},
}
