import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickSingle } from '../runtime'
import { resolveQuery, evalAmount } from '../../queries/resolveQuery'
import { EMPTY_CTX } from '../runtime'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ResourceId } from '../../../data/ids'

/** PLACE_RESOURCE_ON_MARKET (rules/08 §glory placement; docs/effect-dsl §4):
 *  put `amount` resource tokens on a faceup Market card — typically the
 *  Clean-up Glory placement. PROVISIONAL: tokens are sourced externally (the
 *  Stardate / supply), no pool deduction; todo/08 wires the Clean-up step. */
export const placeResourceOnMarket: Primitive<
	Extract<Effect, { k: 'PLACE_RESOURCE_ON_MARKET' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		void ctx
		return (
			evalAmount(state, node.amount, EMPTY_CTX) > 0 &&
			candidates(state, node).length > 0
		)
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount <= 0) return state
		const cands = candidates(state, node)
		const r = pickSingle(state, node, ctx, 'placeRes', {
			prompt: 'Place tokens on which Market card?',
			declinable: true,
			candidates: cands,
			from: 'MARKET',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		return put(state, r.iids[0]!, node.res, amount)
	},
}

function candidates(
	state: GameState,
	node: Effect & { k: 'PLACE_RESOURCE_ON_MARKET' },
): CardInstanceId[] {
	const offers: CardInstanceId[] = []
	for (const suit of ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const) {
		offers.push(
			...resolveQuery(
				state,
				{ zones: [{ k: 'MARKET_OFFER', suit }] },
				EMPTY_CTX,
			),
		)
	}
	const targeted =
		node.target !== undefined
			? resolveQuery(state, node.target, EMPTY_CTX)
			: offers
	return targeted
}

function put(
	state: GameState,
	iid: CardInstanceId,
	res: ResourceId,
	amount: number,
): GameState {
	const card = state.cards[iid]!
	const tokens = {
		...card.resourceTokens,
		[res]: (card.resourceTokens[res] ?? 0) + amount,
	}
	return {
		...state,
		cards: { ...state.cards, [iid]: { ...card, resourceTokens: tokens } },
	}
}
