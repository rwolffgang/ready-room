import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickCards, moveCard, emit, isCaptainZone } from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'
import { cardDef, isLocationDef } from '../../cards'
import { zoneProps, type GameState, type EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import { attackGate, attackVictim } from '../replacement'

/** DISMISS (rules/08 → dismiss): an in-play card → its owner's Discard pile
 *  (moveCard cascades beamed cards; a LOCATION leaving play dismisses the
 *  Ships present and returns Away Teams). Never a Staging Area card, never a
 *  LOCATION, never a Captain or Status card (card-rulings 042) — unless the
 *  card itself instructs it: `target: 'THIS'`
 *  dismisses the resolving card, whatever its suit (1SHR12 dismisses itself
 *  at Clean-up once no AWAY TEAM is left there). `bind` names the
 *  dismissed card, written only when a card was actually dismissed ("If they
 *  do, …" — 1CAR08). */
export const dismiss: Primitive<Extract<Effect, { k: 'DISMISS' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidate(state, node, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, frame) {
		const candidates = candidate(state, node, ctx)
		const r = pickCards(state, node, ctx, 'dismiss', {
			prompt: 'Dismiss a card',
			declinable: true,
			candidates,
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		// "When an attack would dismiss your Duty Officer" (1BUR15):
		// the window opens once the victim's Duty Officer is the picked card.
		const picked = state.cards[iid]!
		if (
			picked.zone.k === 'DUTY_OFFICER' &&
			picked.owner === attackVictim(state, ctx)
		) {
			const gate = attackGate(state, frame, 'ATTACK_DO', [
				'DISMISS_DUTY_OFFICER',
			])
			if (!gate.run) return gate.state
			state = gate.state
		}
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
		const owner = state.cards[iid]!.owner
		return emit(
			moveCard(state, iid, { k: 'DISCARD', seat: owner ?? ctx.actor }),
			{ k: 'CARD_DISMISSED', iid, seat: ctx.actor },
		)
	},
}

function candidate(
	state: GameState,
	node: Effect & { k: 'DISMISS' },
	ctx: EffectCtx,
): CardInstanceId[] {
	if (node.target === 'THIS') {
		const iid = ctx.duplicating ?? ctx.source
		const card = state.cards[iid]
		if (card === undefined || card.zone.k === 'STAGING') return []
		if (!zoneProps(card.zone).inPlay) return []
		return [iid]
	}
	return resolveQuery(state, node.target, ctx).filter((iid) => {
		const card = state.cards[iid]!
		if (card.zone.k === 'STAGING') return false
		if (isCaptainZone(card.zone.k)) return false
		if (isLocationDef(cardDef(card.def))) return false
		return true
	})
}
