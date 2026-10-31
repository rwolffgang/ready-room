import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { moveCard, emit, setOwner, gainResource, pickCards } from '../runtime'
import { isCadetOpponent } from '../../../bot/cadet'
import { otherSeat, zoneKey, zonesOf, type GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { EffectCtx } from '../../state'
import type { ZoneRef } from '../queries'
import { isSoloBot } from '../../solo/seat'

/** TAKE (rules/08 → take, todo/13 follow-up gap #4):
 *  - plain: move the top `count` cards of the deck to the taker.
 *  - `look`: look at the top `look` cards and CHOOSE `count` of them
 *    (CHOOSE_CARDS, shown to the taker only) — peek at 2
 *    ENCOUNTER and keep one (1PIC18/1SIS11/1BUR18,
 *    1SHR16).
 *  - `returnUnpicked`: the looked-at cards not taken go to the BOTTOM of the
 *    same deck, underneath.
 *  - `to`: where a taken card goes — HAND (default), DISCARD ("take an
 *    INCIDENT to your Discard pile" — 1PIC23), DECK_TOP, DECK_BOTTOM
 *    (under your Draw deck — 1LOC17). It is
 *    still a take: ownership passes and INCIDENT_TAKEN / ENCOUNTER_TAKEN fire.
 *  - `bind`: the (last) taken card.
 *  Cadet mode (rules/10 §10.2 #4): a Forced INCIDENT take is skipped for the
 *  virtual opponent and the human gains 1 Glory; ENCOUNTERs are unaffected.
 *  REINFORCEMENT (rules/14 §14.4, ruling 8): the taker picks any `count`
 *  cards of their own Reinforcement pile, which they can see; no event.
 */
export const take: Primitive<Extract<Effect, { k: 'TAKE' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (node.deck === 'REINFORCEMENT')
			return zonesOf(state, { k: 'REINFORCEMENT', seat: ctx.actor }).length > 0
		return (
			(state.zones[
				node.deck === 'INCIDENT' ? 'INCIDENT_DECK' : 'ENCOUNTER_DECK'
			]?.length ?? 0) > 0
		)
	},
	execute(state, node, ctx, _frame) {
		if (node.deck === 'REINFORCEMENT') return takeReinforcement(state, node, ctx)
		const key =
			node.deck === 'INCIDENT'
				? ('INCIDENT_DECK' as const)
				: ('ENCOUNTER_DECK' as const)

		// rules/10 §10.2 #4: every time the opponent would be forced to take an
		// INCIDENT, skip it and gain 1 Glory instead — the Incident deck is NOT
		// depleted by your attacks. ENCOUNTERs are unaffected.
		if (isCadetOpponent(state.mode, ctx.actor) && node.deck === 'INCIDENT') {
			const human = otherSeat(ctx.actor)
			return gainResource(state, human, 'GLO', node.count)
		}

		// look-and-choose path: the taker picks `count` of the top `look`.
		if (node.look !== undefined && node.look > node.count) {
			const top = zonesOf(state, { k: key }).slice(0, node.look)
			const n = Math.min(node.count, top.length)
			const r = pickCards(state, node, ctx, 'take.pick', {
				prompt: `Look at the top ${top.length} ${node.deck === 'INCIDENT' ? 'INCIDENT' : 'ENCOUNTER'} cards — take ${n === 1 ? 'one' : n}`,
				candidates: top,
				min: n,
				max: n,
				from: key,
			})
			if (r.kind === 'suspended') return r.state
			if (r.kind === 'none') return state
			return finishTake(state, node, key, ctx, top, r.iids)
		}

		// plain path: take the top `count`.
		let next: GameState = state
		for (let i = 0; i < node.count; i++) {
			const top = next.zones[key]?.[0]
			if (top === undefined) break
			next = takeIt(next, node, ctx, top)
		}
		return next
	},
}

/** A card of your choice from your Reinforcement pile, to your hand (or
 *  wherever `to` says). It is your own card already: nothing fires. */
function takeReinforcement(
	state: GameState,
	node: Effect & { k: 'TAKE' },
	ctx: EffectCtx,
): GameState {
	const pile = zonesOf(state, { k: 'REINFORCEMENT', seat: ctx.actor })
	const n = Math.min(node.count, pile.length)
	if (n === 0) return state
	const r = pickCards(state, node, ctx, 'take.reinforcement', {
		prompt: `Take ${n === 1 ? 'a card' : `${n} cards`} from your Reinforcement pile`,
		candidates: pile,
		min: n,
		max: n,
		from: zoneKey({ k: 'REINFORCEMENT', seat: ctx.actor }),
	})
	if (r.kind === 'suspended') return r.state
	if (r.kind === 'none') return state
	let next = state
	for (const iid of [...new Set(r.iids)]) {
		next = setOwner(next, iid, ctx.actor)
		const dest = destination(node, ctx.actor)
		next = moveCard(next, iid, dest.zone, dest.toTop ? { toTop: true } : undefined)
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
	}
	return next
}

function finishTake(
	state: GameState,
	node: Effect & { k: 'TAKE' },
	key: 'INCIDENT_DECK' | 'ENCOUNTER_DECK',
	ctx: EffectCtx,
	looked: CardInstanceId[],
	chosen: CardInstanceId[],
): GameState {
	let next = state
	const chosenSet = new Set<CardInstanceId>(chosen)
	// the cards that were looked at but not chosen — still in the deck.
	const unpicked = looked.filter((iid) => !chosenSet.has(iid))
	// take the chosen cards (they leave the deck); dedupe a malformed double pick.
	const toTake = [...new Set(chosen)]
	for (const iid of toTake) next = takeIt(next, node, ctx, iid)
	// the others go to the bottom of the deck, order preserved.
	if (node.returnUnpicked === true) {
		for (const iid of unpicked) {
			next = moveCard(next, iid, { k: key }) // plain move appends → bottom
		}
	}
	return next
}

/** Where a taken card lands for `seat`. */
function destination(
	node: Effect & { k: 'TAKE' },
	seat: 0 | 1,
): { zone: ZoneRef; toTop: boolean } {
	switch (node.to) {
		case 'DISCARD':
			return { zone: { k: 'DISCARD', seat }, toTop: false }
		case 'DECK_TOP':
			return { zone: { k: 'DRAW', seat }, toTop: true }
		case 'DECK_BOTTOM':
			return { zone: { k: 'DRAW', seat }, toTop: false }
		default:
			return { zone: { k: 'HAND', seat }, toTop: false }
	}
}

/** Move `iid` to the taker (ownership + event). */
function takeIt(
	state: GameState,
	node: Effect & { k: 'TAKE' },
	ctx: EffectCtx,
	iid: CardInstanceId,
): GameState {
	let next = state
	// Taking puts the INCIDENT/ENCOUNTER under the taker's ownership (the Burn
	// counts taken INCIDENTs by owner — rules/03 §3.1, rules/12 §12.11).
	next = setOwner(next, iid, ctx.actor)
	// a card the official solo Bot takes goes on top of its deck (rules/13
	// §13.10.1) — it has no hand
	const dest = isSoloBot(state, ctx.actor)
		? { zone: { k: 'DRAW', seat: ctx.actor } as ZoneRef, toTop: true }
		: destination(node, ctx.actor)
	next = moveCard(
		next,
		iid,
		dest.zone,
		dest.toTop ? { toTop: true } : undefined,
	)
	if (node.bind !== undefined) ctx.bindings[node.bind] = iid
	// `take` is not a gain (rules/08 → take): no CARD_GAINED. It IS taking an
	// INCIDENT / ENCOUNTER, which REACTIONs can watch (todo/09 §1).
	const kind = node.deck === 'INCIDENT' ? 'INCIDENT_TAKEN' : 'ENCOUNTER_TAKEN'
	return emit(next, { k: kind, iid, seat: ctx.actor })
}
