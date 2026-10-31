import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickCards, moveCard } from '../runtime'
import { refillMarket, suitOfOffer, resolveMarketQuery } from '../../market'
import type { CardInstanceId } from '../../ids'

export const junk: Primitive<Extract<Effect, { k: 'JUNK' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return legalCandidates(state, node, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const cands = candidates(state, node, ctx)
		const tainted = cands.filter((iid) => {
			const rt = state.cards[iid]!.resourceTokens
			return Object.values(rt).some((v) => v !== undefined && v > 0)
		})
		const r = pickCards(state, node, ctx, 'junk', {
			prompt: 'Junk a card',
			declinable: true,
			candidates: cands,
			min: 1,
			max: 1,
			from: 'MARKET',
			disabled: tainted.map((iid) => ({
				iid,
				reason: 'bears resource tokens',
			})),
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		const suit = suitOfOffer(state, iid)
		let next = moveCard(state, iid, { k: 'JUNK' })
		// a Market offer slot refills after its card leaves (rules/05 §5.4.4).
		if (suit !== undefined) next = refillMarket(next, suit)
		return next
	},
}

/** Every Market card the JUNK query names ("the Market" = the four faceup
 *  offers only — `resolveMarketQuery` narrows a MarketQuery to them, so a card
 *  JSON that lists a deck can't widen the target set; rules/08 → market), the
 *  token-bearing ones surfaced greyed so the player sees why (rules/08 → junk).
 *  `resolveMarketQuery` needs an EffectCtx — the primitive's ctx carries it. */
function candidates(
	state: Parameters<Primitive<Effect>['execute']>[0],
	node: Effect & { k: 'JUNK' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	return resolveMarketQuery(state, node.target, ctx)
}

/** The legal (non-tainted) subset — what `canResolve` and auto-select see. */
function legalCandidates(
	state: Parameters<Primitive<Effect>['execute']>[0],
	node: Effect & { k: 'JUNK' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	return candidates(state, node, ctx).filter((iid) => {
		const rt = state.cards[iid]!.resourceTokens
		return Object.values(rt).every((v) => v === undefined || v === 0)
	})
}
