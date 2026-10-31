import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import {
	moveCard,
	emit,
	failOperation,
	pickCards,
	costCanResolve,
	thisOnly,
} from '../runtime'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ZoneSpec } from '../queries'

function candidatesOf(
	state: GameState,
	node: Effect & { k: 'COST_LOG' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	// `from` may be hand-OR-zones (1BUR22 "from your hand or Discard
	// pile" — todo/13 gap #5); an array means the union of those zones.
	const zones: ZoneSpec[] =
		node.from === undefined
			? ['IN_PLAY']
			: Array.isArray(node.from)
				? node.from
				: [node.from]
	return thisOnly(
		resolveQuery(state, { zones, seat: 'SELF', filter: node.filter }, ctx),
		node,
		ctx,
	)
}

/** COST_LOG (docs/effect-dsl.md §3): log one of your in-play cards (default)
 *  as a cost (rules/08 → log). Logging cascades beamed cards; unpayable →
 *  parent fails. Distinguished from COST_LOG_THIS, which logs the resolving
 *  card itself. */
export const costLog: Primitive<Extract<Effect, { k: 'COST_LOG' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = candidatesOf(state, node, ctx)
		const r = pickCards(state, node, ctx, 'costLog', {
			prompt: 'Log a card',
			declinable: true,
			candidates,
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_LOG: no legal selection')
		const iid = r.iids[0]!
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
		return emit(moveCard(state, iid, { k: 'LOG', seat: ctx.actor }), {
			k: 'CARD_LOGGED',
			iid,
			seat: ctx.actor,
		})
	},
}
