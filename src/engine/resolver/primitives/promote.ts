import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { pickCards, moveCard, emit } from '../runtime'
import type { GameState, EffectCtx } from '../../state'
import type { ZoneSpec } from '../queries'
import type { CardInstanceId } from '../../ids'
import { promotable, promoteDismissOptions } from '../../dutyOfficers'

/** PROMOTE (rules/08 `promote`): a PERSON from hand / Staging / Discard to the
 *  Duty Officer slot. When every slot is taken, the player dismisses a Duty
 *  Officer to make room ("you may dismiss one when promoting a new one"); a
 *  slot restricted by traits (1BUR06, 1PER01) only takes a matching PERSON.
 *  `target: 'THIS'` promotes only the resolving card itself. */
function personCandidates(
	state: GameState,
	node: Effect & { k: 'PROMOTE' },
	ctx: EffectCtx,
): CardInstanceId[] {
	const from: ZoneSpec =
		node.from === 'HAND'
			? { k: 'HAND', seat: 0 }
			: node.from === 'STAGING'
				? { k: 'STAGING', seat: 0 }
				: { k: 'DISCARD', seat: 0 }
	return resolveQuery(
		state,
		{ zones: [from], seat: 'SELF', filter: node.filter },
		ctx,
	).filter(
		(iid) =>
			(node.target !== 'THIS' || iid === ctx.source) &&
			promotable(state, ctx.actor, iid),
	)
}

export const promote: Primitive<Extract<Effect, { k: 'PROMOTE' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return personCandidates(state, node, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const cands = personCandidates(state, node, ctx)
		const r = pickCards(state, node, ctx, 'promote', {
			prompt: 'Promote to Duty Officer',
			declinable: true,
			candidates: cands,
			min: 1,
			max: 1,
			from: 'SELECT',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		let s = state
		const room = promoteDismissOptions(s, ctx.actor, iid)
		if (room !== null) {
			// Every slot is taken: dismiss a Duty Officer to make room.
			const d = pickCards(s, node, ctx, 'promote.dismiss', {
				prompt: 'Dismiss a Duty Officer to make room',
				candidates: room,
				min: 1,
				max: 1,
				from: `DUTY_OFFICER:${ctx.actor}`,
			})
			if (d.kind === 'suspended') return d.state
			if (d.kind === 'none') return s
			const out = d.iids[0]!
			s = emit(moveCard(s, out, { k: 'DISCARD', seat: ctx.actor }), {
				k: 'CARD_DISMISSED',
				iid: out,
				seat: ctx.actor,
			})
		}
		return emit(moveCard(s, iid, { k: 'DUTY_OFFICER', seat: ctx.actor }), {
			k: 'PUT_INTO_PLAY',
			iid,
			seat: ctx.actor,
		})
	},
}
