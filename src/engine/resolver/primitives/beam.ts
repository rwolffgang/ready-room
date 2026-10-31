import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	pickCards,
	suspend,
	answered,
	answerSingle,
	moveCard,
	emit,
	thisOnly,
} from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'
import { cardDef, isLocationDef } from '../../cards'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ZoneSpec } from '../queries'

/** The source zones for a beam: `from` is either one zone or several (hand or
 *  Discard pile → an array; docs/effect-dsl.md §3/§4).
 *  Defaults to the actor's hand. */
function fromZones(node: Extract<Effect, { k: 'BEAM' }>): ZoneSpec[] {
	if (node.from === undefined) return [{ k: 'HAND', seat: 0 }]
	return Array.isArray(node.from) ? node.from : [node.from]
}

function candidatesOf(
	state: GameState,
	node: Extract<Effect, { k: 'BEAM' }>,
	ctx: Parameters<Primitive<Extract<Effect, { k: 'BEAM' }>>['execute']>[2],
): CardInstanceId[] {
	return thisOnly(
		resolveQuery(
			state,
			{
				zones: fromZones(node),
				seat: 'SELF',
				filter: node.filter,
				bound: node.bound,
			},
			ctx,
		),
		node,
		ctx,
	).filter(
		(iid) => !isLocationDef(cardDef(state.cards[iid]!.def)), // rules/06 §6.4.2
	)
}

export const beam: Primitive<Extract<Effect, { k: 'BEAM' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (candidatesOf(state, node, ctx).length === 0) return false
		return resolveQuery(state, node.to, ctx).length > 0
	},
	preview(state, node, ctx) {
		const cards = candidatesOf(state, node, ctx)
		const onto = resolveQuery(state, node.to, ctx)
		return cards.length === 0 || onto.length === 0 ? null : { cards, onto }
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		if (answered(ctx, 'beam.host')) {
			// the picked cards ride along as a plain binding (suspend `extra`)
			const cards = ctx.bindings['$beam.cards'] as CardInstanceId[]
			delete ctx.bindings['$beam.cards']
			const host = answerSingle(ctx, 'beam.host')
			return finish(state, node, ctx, cards, host)
		}
		const candidates = candidatesOf(state, node, ctx)
		const r = pickCards(state, node, ctx, 'beam.cards', {
			prompt: 'Beam a card',
			declinable: true,
			candidates,
			min: 1,
			max: node.count,
			from: `HAND:${ctx.actor}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const hosts = resolveQuery(state, node.to, ctx)
		if (hosts.length === 0) return state
		if (hosts.length === 1) return finish(state, node, ctx, r.iids, hosts[0]!)
		return suspend(
			state,
			node,
			ctx,
			'beam.host',
			{
				k: 'CHOOSE_CARDS',
				prompt: 'Beam onto which ship?',
				candidates: hosts,
				min: 1,
				max: 1,
				from: 'IN_PLAY',
			},
			{ '$beam.cards': [...r.iids] },
		)
	},
}

/** `bind` = the (first) beamed card, written only once a beam happened
 *  ("If you do both, …" — 1BUR21, 1SEL07). */
function finish(
	state: GameState,
	node: Extract<Effect, { k: 'BEAM' }>,
	ctx: EffectCtx,
	cards: CardInstanceId[],
	host: CardInstanceId,
): GameState {
	if (node.bind !== undefined && cards.length > 0)
		ctx.bindings[node.bind] = cards[0]!
	let next = state
	for (const iid of cards) {
		const seat = next.cards[iid]?.owner ?? 0
		next = moveCard(next, iid, { k: 'BEAMED', host })
		// Emits PUT_INTO_PLAY: beaming puts the card into play (rules/08 → beam,
		// todo/09 §1 emission table).
		next = emit(next, { k: 'PUT_INTO_PLAY', iid, seat })
	}
	return next
}
