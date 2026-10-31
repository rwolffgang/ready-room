import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	discardCandidates,
	pickCards,
	moveCard,
	failOperation,
	onlyBoundAllows,
	thisOnly,
	emit,
} from '../runtime'
import { otherSeat, type EffectCtx } from '../../state'
import { isSoloBot } from '../../solo/seat'
import { ASSUMED } from '../../solo/outcome'

/** The seat whose hand is discarded from (COST_DISCARD `whose`). */
function discardSeat(
	ctx: EffectCtx,
	whose: 'SELF' | 'OPPONENT' | undefined,
): 0 | 1 {
	return whose === 'OPPONENT' ? otherSeat(ctx.actor) : ctx.actor
}

/** "Discard a different card" (1PIC07): the card bound under `exceptBound`
 *  is not a legal discard. */
export function exceptBound(
	ctx: EffectCtx,
	node: { exceptBound?: string | undefined },
): unknown {
	return node.exceptBound !== undefined
		? ctx.bindings[node.exceptBound]
		: undefined
}

export const costDiscard: Primitive<Extract<Effect, { k: 'COST_DISCARD' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => {
		// the official solo Bot has no hand: making it discard always "works"
		// — by paying, you chose that it succeeded (rules/13 §13.12.2)
		if (n.whose === 'OPPONENT' && isSoloBot(s, otherSeat(ctx.actor))) return true
		if (n.whose === 'OPPONENT') {
			const flip = discardCandidates(
				s,
				{ ...ctx, actor: otherSeat(ctx.actor) },
				n.filter,
			)
			return flip.length >= n.count
		}
		return costCanResolve(s, n, ctx)
	},
	offersDecline: (_state, node) => node.whose !== 'OPPONENT',
	execute(state, node, ctx, _frame) {
		const seat = discardSeat(ctx, node.whose)
		if (node.whose === 'OPPONENT' && isSoloBot(state, seat)) {
			if (node.bind !== undefined) ctx.bindings[node.bind] = ASSUMED
			return state
		}
		const candidates =
			node.whose === 'OPPONENT'
				? discardCandidates(
						state,
						{ ...ctx, actor: otherSeat(ctx.actor) },
						node.filter,
					)
				: thisOnly(discardCandidates(state, ctx, node.filter), node, ctx).filter(
						(iid) =>
							iid !== exceptBound(ctx, node) &&
							onlyBoundAllows(ctx, node.onlyBound, iid),
					)
		const r = pickCards(state, node, ctx, 'costDiscard', {
			prompt: 'Discard a card',
			declinable: true,
			candidates,
			min: node.count,
			max: node.count,
			from: `HAND:${seat}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_DISCARD: no legal selection')
		// Bind the just-discarded card so a later IF can test it (todo/13 §2:
		// 1PER13 / HOSTILE CONTACT / …). ctx.bindings is shared forward with the
		// same operation's later steps, so an in-place write is visible to them.
		if (node.bind !== undefined && r.iids.length > 0) {
			ctx.bindings[node.bind] = r.iids[0]!
		}
		let next = state
		// CARD_DISCARDED per card, exactly like DISCARD (cost-paid discards are
		// discards too — rules/08 → discard)
		for (const iid of r.iids)
			next = emit(moveCard(next, iid, { k: 'DISCARD', seat }), {
				k: 'CARD_DISCARDED',
				iid,
				seat,
			})
		return next
	},
}
