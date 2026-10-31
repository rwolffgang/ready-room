import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { cardDef } from '../../cards'
import { pickCards, moveCard, emit } from '../runtime'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'

/** Deployable = SHIP suit or ONGOING trait; both go Staging → FLEET. */
function deployable(
	state: GameState,
	iids: CardInstanceId[],
): CardInstanceId[] {
	return iids.filter((iid) => {
		const def = cardDef(state.cards[iid]!.def)
		return def.suit === 'SHIP' || def.traits.includes('ONGOING')
	})
}

export const deploy: Primitive<Extract<Effect, { k: 'DEPLOY' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return deployable(state, resolveQuery(state, node.target, ctx)).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = deployable(state, resolveQuery(state, node.target, ctx))
		const r = pickCards(state, node, ctx, 'deploy', {
			prompt: 'Deploy a card',
			declinable: true,
			candidates,
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		const def = cardDef(state.cards[iid]!.def)
		if (def.suit === 'SHIP') {
			// Staging → Fleet and take the Ship token from the supply onto the card.
			// On a deploy the token is always on the card (shipTokenAt = null = "on
			// card" in docs/data-model.md §3) — even if a previous leave-play sent
			// it to the supply (rules/08 → deploy).
			const moved = moveCard(state, iid, { k: 'FLEET', seat: ctx.actor })
			return emit(
				{
					...moved,
					cards: {
						...moved.cards,
						[iid]: { ...moved.cards[iid]!, shipTokenAt: null },
					},
				},
				// "After deploying a SHIP …" (1KOL03, 1CAR03 — CARD_DEPLOYED trigger)
				{ k: 'CARD_DEPLOYED', iid, seat: ctx.actor },
			)
		}
		// A card that counts as a LOCATION (1ENC07): on deploy it
		// goes to the Location area as a controlled LOCATION.
		if (def.treatedAsLocation === true) {
			const moved = moveCard(state, iid, {
				k: 'LOCATION_AREA',
				seat: ctx.actor,
			})
			return emit(emit(moved, { k: 'CARD_DEPLOYED', iid, seat: ctx.actor }), {
				k: 'LOCATION_CONTROLLED',
				iid,
				seat: ctx.actor,
			})
		}
		// ONGOING (rules/05, rules/02): deployed Staging → Fleet Area, so it
		// survives the Clean-up wipe of the Staging Area and can be dismissed.
		return emit(moveCard(state, iid, { k: 'FLEET', seat: ctx.actor }), {
			k: 'CARD_DEPLOYED',
			iid,
			seat: ctx.actor,
		})
	},
}
