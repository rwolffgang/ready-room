import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	discardCandidates,
	pickCards,
	moveCard,
	emit,
	onlyBoundAllows,
} from '../runtime'
import { otherSeat, type GameState, type EffectCtx } from '../../state'
import { isSoloBot } from '../../solo/seat'
import { botDeckCanAdvance, botDeckTop } from '../../solo/deck'

/** The seat the discard acts on — DISCARD `whose` (default SELF). */
function discardSeat(
	ctx: EffectCtx,
	whose: 'SELF' | 'OPPONENT' | undefined,
): 0 | 1 {
	return whose === 'OPPONENT' ? otherSeat(ctx.actor) : ctx.actor
}

/** The actor-flipped context when discarding from the opponent (so HAND
 *  resolves to their hand). */
function flipCtx(
	ctx: EffectCtx,
	whose: 'SELF' | 'OPPONENT' | undefined,
): EffectCtx {
	return whose === 'OPPONENT' ? { ...ctx, actor: otherSeat(ctx.actor) } : ctx
}

export const discard: Primitive<Extract<Effect, { k: 'DISCARD' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const seat = discardSeat(ctx, node.whose)
		if (node.from === 'DECK_TOP' && isSoloBot(state, seat))
			return botDeckCanAdvance(state, seat)
		if (node.from === 'DECK_TOP')
			return (state.zones[`DRAW:${seat}`]?.length ?? 0) > 0
		return discardCandidates(state, flipCtx(ctx, node.whose), node.filter).some(
			(iid) => onlyBoundAllows(ctx, node.onlyBound, iid),
		)
	},
	offersDecline: (_state, node) =>
		node.from !== 'DECK_TOP' && node.whose !== 'OPPONENT',
	execute(state, node, ctx, _frame) {
		if (node.from === 'DECK_TOP') {
			const seat = discardSeat(ctx, node.whose)
			const deck = state.zones[`DRAW:${seat}`] ?? []
			const n = Math.min(node.count, deck.length)
			let next = state
			// the official solo Bot's deck reshuffles when it runs out (rules/13 §13.5)
			const bot = isSoloBot(state, seat)
			for (let i = 0; i < (bot ? node.count : n); i++) {
				let top = next.zones[`DRAW:${seat}`]?.[0]
				if (bot) {
					const r = botDeckTop(next, seat)
					next = r.state
					top = r.top ?? undefined
				}
				if (top === undefined) break
				if (node.bind !== undefined) ctx.bindings[node.bind] = top
				next = emit(moveCard(next, top, { k: 'DISCARD', seat }), {
					k: 'CARD_DISCARDED',
					iid: top,
					seat,
				})
			}
			return next
		}
		const seat = discardSeat(ctx, node.whose)
		// onlyBound: "discard one of THEM" — only the bound (just-drawn) cards (1PIC16)
		const candidates = discardCandidates(
			state,
			flipCtx(ctx, node.whose),
			node.filter,
		).filter((iid) => onlyBoundAllows(ctx, node.onlyBound, iid))
		const r = pickCards(state, node, ctx, 'discard', {
			prompt: 'Discard cards',
			declinable: true,
			candidates,
			// "discard 2 cards": as many as the hand allows, never fewer
			min: Math.min(node.count, candidates.length),
			max: node.count,
			from: `HAND:${seat}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		// Bind the just-discarded card (1PER13 / 1PER07 / …) — an in-place write on
		// the shared operation ctx, visible to the later IF steps.
		if (node.bind !== undefined && r.iids.length > 0)
			ctx.bindings[node.bind] = r.iids[0]!
		let next: GameState = state
		for (const iid of r.iids) {
			next = emit(moveCard(next, iid, { k: 'DISCARD', seat }), {
				k: 'CARD_DISCARDED',
				iid,
				seat,
			})
		}
		return next
	},
}
