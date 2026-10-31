import type { Effect } from '../nodes'
import type { Primitive } from './index'
import type { EffectCtx, Frame, GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import { resolveQuery } from '../../queries/resolveQuery'
import { cardDef } from '../../cards'
import {
	pickSingle,
	moveCard,
	emit,
	answered,
	answerSingle,
	declinedPick,
} from '../runtime'

type LogNode = Extract<Effect, { k: 'LOG' }>
type EffectFrame = Extract<Frame, { k: 'EFFECT' }>

/** The binding that carries the picked card across the pre-leave detour. */
const PRE_LEAVE_TARGET = '$log.preLeave'

/** Op indices of the card's "When you log this card" SPECIALs that resolve
 *  while it is still in play (`trigger.beforeLeaving`) — 1LOC01
 *  OBSERVATORY: "before dismissing any ships at this location, … warp all of
 *  your deployed ships" (STCC FAQ 1LOC01-warp). */
function preLeaveSpecials(state: GameState, iid: CardInstanceId): number[] {
	const card = state.cards[iid]
	if (card === undefined) return []
	const out: number[] = []
	cardDef(card.def).operations.forEach((op, i) => {
		if (
			op.type === 'SPECIAL' &&
			op.trigger?.on === 'CARD_LOGGED' &&
			op.trigger.beforeLeaving === true
		)
			out.push(i)
	})
	return out
}

/** Move `iid` to the actor's Log and raise CARD_LOGGED — unless it has
 *  pre-leave SPECIALs that have not run yet: then re-push this LOG (gate
 *  'PRE_LOG', the target kept in a binding) under those SPECIALs' OPERATION
 *  frames, so they resolve first and the log follows. */
function logCard(
	state: GameState,
	node: LogNode,
	ctx: EffectCtx,
	frame: EffectFrame,
	iid: CardInstanceId,
): GameState {
	const specials = state.probe === true ? [] : preLeaveSpecials(state, iid)
	const ran = frame.gates?.includes('PRE_LOG') === true
	if (specials.length > 0 && !ran) {
		ctx.bindings[PRE_LEAVE_TARGET] = iid
		const ops: Frame[] = specials
			.slice()
			.reverse()
			.map((opIndex) => ({
				k: 'OPERATION',
				card: iid,
				opIndex,
				ctx: {
					actor: ctx.actor,
					source: iid,
					bindings: { '$event.card': iid },
				},
				phase: 0,
			}))
		return {
			...state,
			stack: [
				...state.stack,
				{ ...frame, gates: [...(frame.gates ?? []), 'PRE_LOG'] },
				...ops,
			],
		}
	}
	delete ctx.bindings[PRE_LEAVE_TARGET]
	if (node.bind !== undefined) ctx.bindings[node.bind] = iid
	return emit(moveCard(state, iid, { k: 'LOG', seat: ctx.actor }), {
		k: 'CARD_LOGGED',
		iid,
		seat: ctx.actor,
		...(ran && specials.length > 0 ? { specialsRan: true } : {}),
	})
}

/** LOG (docs/effect-dsl.md §4, rules/08 → log): move an in-play card (default
 *  seat-relative 0) to the Log. Logging cascades beamed cards; logging a
 *  LOCATION clears its tokens (rules/08 → log the Location: Ships present are
 *  dismissed, Away Teams return, tokens are wiped — handled by moveCard's
 *  cascade). `bind` names the logged card so a later step can test/count it
 *  (1SEL07 "the logged card's Skill icons" — todo/13 gap #6). */
export const log: Primitive<LogNode> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (node.target === 'THIS') return true
		return resolveQuery(state, node.target, ctx).length > 0
	},
	offersDecline: (_state, node) => node.target !== 'THIS',
	execute(state, node, ctx, frame) {
		const kept = ctx.bindings[PRE_LEAVE_TARGET]
		if (typeof kept === 'string' && frame.gates?.includes('PRE_LOG') === true)
			return logCard(state, node, ctx, frame, kept as CardInstanceId)
		if (node.target === 'THIS') {
			// self-reference redirects to the duplicating card when inside DUPLICATE
			return logCard(state, node, ctx, frame, ctx.duplicating ?? ctx.source)
		}
		if (answered(ctx, 'log')) {
			const declined = declinedPick(state, ctx, 'log')
			if (declined !== null) return declined
			return logCard(state, node, ctx, frame, answerSingle(ctx, 'log'))
		}
		const candidates = resolveQuery(state, node.target, ctx)
		const r = pickSingle(state, node, ctx, 'log', {
			prompt: 'Log a card',
			declinable: true,
			candidates,
			from: 'SELECT',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		return logCard(state, node, ctx, frame, r.iids[0]!)
	},
}
