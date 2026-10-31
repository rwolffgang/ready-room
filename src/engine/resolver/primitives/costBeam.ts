import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import {
	moveCard,
	emit,
	failOperation,
	pickCards,
	costCanResolve,
	thisOnly,
	suspend,
	answered,
	answerSingle,
	discardProtected,
} from '../runtime'
import { cardDef, isLocationDef } from '../../cards'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ZoneSpec } from '../queries'

function fromZones(node: Extract<Effect, { k: 'COST_BEAM' }>): ZoneSpec[] {
	if (node.from === undefined) return [{ k: 'HAND', seat: 0 }]
	return Array.isArray(node.from) ? node.from : [node.from]
}

function candidatesOf(
	state: GameState,
	node: Extract<Effect, { k: 'COST_BEAM' }>,
	ctx: Parameters<Primitive<Extract<Effect, { k: 'COST_BEAM' }>>['execute']>[2],
): CardInstanceId[] {
	return thisOnly(
		resolveQuery(
			state,
			{ zones: fromZones(node), seat: 'SELF', filter: node.filter },
			ctx,
		),
		node,
		ctx,
	).filter(
		(iid) =>
			!isLocationDef(cardDef(state.cards[iid]!.def)) && // rules/06 §6.4.2
			!discardProtected(state, iid),
	)
}

/** COST_BEAM (docs/effect-dsl.md §3): beam a card to a host as a cost
 *  (1LOC04 beams the Duty Officer to it for an action). Mirrors BEAM
 *  but is a cost: unpayable (no candidate or no legal host) → parent fails. */
export const costBeam: Primitive<Extract<Effect, { k: 'COST_BEAM' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		if (answered(ctx, 'costBeam.host')) {
			// the picked cards ride along as a plain binding (suspend `extra`)
			const cards = ctx.bindings['$costBeam.cards'] as CardInstanceId[]
			delete ctx.bindings['$costBeam.cards']
			return finish(state, cards, answerSingle(ctx, 'costBeam.host'))
		}
		const candidates = candidatesOf(state, node, ctx)
		const r = pickCards(state, node, ctx, 'costBeam', {
			prompt: 'Beam a card',
			declinable: true,
			candidates,
			min: 1,
			max: node.count,
			from: 'IN_PLAY',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_BEAM: no legal selection')
		const hosts = resolveQuery(state, node.to, ctx)
		if (hosts.length === 0)
			return failOperation(state, 'COST_BEAM: no legal target')
		if (hosts.length === 1) return finish(state, r.iids, hosts[0]!)
		// Several legal hosts ("beam this card to a SHIP" — 1PER13): the
		// player chooses, as for BEAM.
		return suspend(
			state,
			node,
			ctx,
			'costBeam.host',
			{
				k: 'CHOOSE_CARDS',
				prompt: 'Beam onto which card?',
				candidates: hosts,
				min: 1,
				max: 1,
				from: 'IN_PLAY',
			},
			{ '$costBeam.cards': [...r.iids] },
		)
	},
}

function finish(
	state: GameState,
	cards: CardInstanceId[],
	host: CardInstanceId,
): GameState {
	let next = state
	for (const iid of cards) {
		const seat = next.cards[iid]?.owner ?? 0
		next = moveCard(next, iid, { k: 'BEAMED', host })
		next = emit(next, { k: 'PUT_INTO_PLAY', iid, seat })
	}
	return next
}
