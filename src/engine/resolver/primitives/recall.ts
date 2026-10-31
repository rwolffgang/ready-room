import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { pickCards, moveCard, emit } from '../runtime'
import { isSoloBot } from '../../solo/seat'
import { cardDef, isLocationDef } from '../../cards'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'

export const recall: Primitive<Extract<Effect, { k: 'RECALL' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const cands = candidates(state, node, ctx)
		const r = pickCards(state, node, ctx, 'recall', {
			prompt: 'Recall a card',
			declinable: true,
			candidates: cands,
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		// the official solo Bot has no hand: a recalled card — a SHIP, its Duty
		// Officer — is discarded instead (rules/13 §13.7, §13.11.2)
		if (isSoloBot(state, ctx.actor))
			return emit(moveCard(state, r.iids[0]!, { k: 'DISCARD', seat: ctx.actor }), {
				k: 'CARD_DISMISSED',
				iid: r.iids[0]!,
				seat: ctx.actor,
			})
		return moveCard(state, r.iids[0]!, { k: 'HAND', seat: ctx.actor })
	},
}

/** Locations can never be recalled (rules/06 §6.1.3), so they are filtered out
 *  of every RECALL target regardless of the query. */
function candidates(
	state: GameState,
	node: Effect & { k: 'RECALL' },
	ctx: EffectCtx,
): CardInstanceId[] {
	return resolveQuery(state, node.target, ctx).filter(
		(iid) => !isLocationDef(cardDef(state.cards[iid]!.def)),
	)
}
