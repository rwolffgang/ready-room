import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	pickCards,
	pickSingle,
	suspend,
	answered,
	answer,
	answerSingle,
	addLog,
	emit,
} from '../runtime'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'
import { cardDef } from '../../cards'
import { warnUnprinted } from '../../market'
import { cannotBeWarped } from '../../modifiers'
import { type EffectCtx, type GameState, type JsonValue } from '../../state'
import type { CardInstanceId } from '../../ids'
import { SKIP_LOCATION } from '../choices'
import { cardToken } from '../../../data/cardNames'

/** WARP (rules/06 §6.3, rules/12 §12.16, rules/08 → warp): move a deployed
 *  SHIP's token to a Location you control or one in the Neutral Zone. Staying
 *  in place is NOT warping — the current Location is excluded from the
 *  candidates (rules/12 §12.16), and the token can never return to the card
 *  (only DEPLOY sets shipTokenAt = null). Beamed cards travel implicitly — they
 *  are attached to the card and "at" derives from shipTokenAt. There is no
 *  limit on tokens at a Location. Emits SHIP_WARPED. A query naming a
 *  card no box prints (rules/12 §12.30) resolves empty with a one-time warning.
 *
 *  "You may warp" (a MAY around a single WARP) asks no CONFIRM: nothing moves
 *  before the destination is picked, so the pick carries the decline
 *  (`ctx.declinable`) — the ship choice may be left empty and the destination
 *  choice has a Skip (SKIP_LOCATION), asked even when only one Location is
 *  left, since it is the only prompt. */
export const warp: Primitive<Extract<Effect, { k: 'WARP' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return (
			ships(state, node, ctx).length > 0 &&
			destinations(state, node, ctx, undefined).length > 0
		)
	},
	offersDecline: (_state, node) => node.count === undefined,
	execute(state, node, ctx, _frame) {
		if (node.count !== undefined) return warpSeveral(state, node, ctx)
		const s = warnUnprinted(state, [node.to], ctx)
		const shipKey = 'warp.ship'
		const toKey = 'warp.to'
		// destination already chosen (highest-priority resume branch)
		if (answered(ctx, toKey)) {
			const to = answer<CardInstanceId>(ctx, toKey)
			if (to === SKIP_LOCATION) return declined(s, ctx)
			return finish(s, ctx, node, answerSingle(ctx, shipKey), to)
		}
		// ship already chosen → choose a destination that is not where it sits now
		if (answered(ctx, shipKey)) {
			const picked = answer<unknown>(ctx, shipKey)
			if (Array.isArray(picked) && picked.length === 0) return declined(s, ctx)
			return pickDestination(s, node, ctx, answerSingle(ctx, shipKey))
		}
		// fresh: pick the ship first
		const fleet = ships(s, node, ctx)
		const r =
			ctx.declinable === true && fleet.length > 1
				? pickCards(s, node, ctx, shipKey, {
						prompt: 'You may warp a ship — which one?',
						candidates: fleet,
						min: 0,
						max: 1,
						from: 'FLEET',
						optional: true,
					})
				: pickSingle(s, node, ctx, shipKey, {
						prompt: 'Warp which ship?',
						candidates: fleet,
						from: 'FLEET',
					})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none' || r.iids.length === 0) return s
		// Auto-selected (exactly one ship): the destination choice's resume branch
		// reads `shipKey` through the choiceId indirection, so bind the picked ship
		// as if it had gone through the picker (rules/06 §6.3, rules/12 §12.16).
		// Published with the destination choice on the SHARED ctx (not a copy), so
		// `bind` stays visible to the sibling steps after the resume (1BUR20).
		const picked = r.iids[0]!
		const autoKey = `${shipKey}@${ctx.source.length}:solo`
		return pickDestination(s, node, ctx, picked, {
			[shipKey]: autoKey,
			[autoKey]: [picked],
		})
	},
}

/** `count` — "warp up to 2 of your SHIPs" (1PIC22, 1SEL21, 1PER02): pick the
 *  DIFFERENT ships first (UP_TO: 0..max; a fixed count: exactly that many, or
 *  as many as can warp), then warp each in the chosen order, one single-ship
 *  WARP each (its own destination choice, its own SHIP_WARPED). Only ships
 *  that have somewhere to go are offered. */
function warpSeveral(
	state: GameState,
	node: Effect & { k: 'WARP' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): GameState {
	const amount = node.count!
	const cands = ships(state, node, ctx).filter(
		(iid) => destinations(state, node, ctx, iid).length > 0,
	)
	const upTo = typeof amount === 'object' && amount.k === 'UP_TO'
	const n = Math.min(evalAmount(state, amount, ctx), cands.length)
	if (n <= 0) return state
	const r = pickCards(state, node, ctx, 'warp.ships', {
		prompt: upTo ? `Warp up to ${n} of your ships` : `Warp ${n} ships`,
		candidates: cands,
		min: upTo ? 0 : n,
		max: n,
		from: 'FLEET',
	})
	if (r.kind !== 'selected') return r.kind === 'suspended' ? r.state : state
	const single: Effect & { k: 'WARP' } = {
		k: 'WARP',
		ship: { ...node.ship, bound: EACH },
		to: node.to,
		...(node.bind !== undefined ? { bind: node.bind } : {}),
	}
	for (const iid of [...r.iids].reverse())
		state.stack.push({
			k: 'EFFECT',
			node: single,
			ctx: { ...ctx, bindings: { ...ctx.bindings, [EACH]: iid } },
			ip: 0,
		})
	return state
}

const EACH = '$warp.each'

function pickDestination(
	state: GameState,
	node: Effect & { k: 'WARP' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	ship: CardInstanceId,
	autoShip?: Record<string, JsonValue>,
): GameState {
	const remaining = destinations(state, node, ctx, ship)
	if (remaining.length === 0) return state
	const declinable = ctx.declinable === true
	if (remaining.length === 1 && !declinable)
		return finish(state, ctx, node, ship, remaining[0]!)
	return suspend(
		state,
		node,
		ctx,
		'warp.to',
		declinable
			? {
					k: 'CHOOSE_LOCATION',
					prompt: `You may warp ${cardToken(state.cards[ship]!.def)} — to which Location? (Skip declines)`,
					candidates: [...remaining, SKIP_LOCATION],
				}
			: {
					k: 'CHOOSE_LOCATION',
					prompt: 'Warp to which Location?',
					candidates: remaining,
				},
		autoShip,
	)
}

/** The optional warp was declined: drop its choice keys, like `finish`. */
function declined(state: GameState, ctx: EffectCtx): GameState {
	delete ctx.bindings['warp.ship']
	delete ctx.bindings['warp.to']
	return state
}

function ships(
	state: GameState,
	node: Effect & { k: 'WARP' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	return resolveQuery(state, node.ship, ctx).filter((iid) => {
		const card = state.cards[iid]!
		// "This ship cannot be warped" (1SIS03)
		return (
			cardDef(card.def).suit === 'SHIP' &&
			card.zone.k === 'FLEET' &&
			!cannotBeWarped(state, iid)
		)
	})
}

/** Reachable destinations: controlled Locations ∪ Neutral Zone. If `ship` is
 *  given, its current Location is excluded (staying put is not warping —
 *  rules/12 §12.16). */
function destinations(
	state: GameState,
	node: Effect & { k: 'WARP' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	ship: CardInstanceId | undefined,
): CardInstanceId[] {
	let locs = resolveQuery(state, node.to, ctx).filter((iid) => {
		const zone = state.cards[iid]!.zone.k
		return zone === 'LOCATION_AREA' || zone === 'NEUTRAL_ZONE'
	})
	if (ship !== undefined) {
		const current = state.cards[ship]!.shipTokenAt
		locs = locs.filter((iid) => iid !== current)
	}
	return locs
}

function finish(
	state: GameState,
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	node: Effect & { k: 'WARP' },
	ship: CardInstanceId,
	loc: CardInstanceId,
): GameState {
	// This WARP is done: drop its choice keys from the shared ctx so a later
	// WARP step of the same operation asks afresh instead of re-reading them.
	delete ctx.bindings['warp.ship']
	delete ctx.bindings['warp.to']
	// the warp destination, for a follow-up send there (1BUR20)
	if (node.bind !== undefined) ctx.bindings[node.bind] = loc
	const seat = state.cards[ship]!.owner ?? 0
	const next = {
		...state,
		cards: {
			...state.cards,
			[ship]: { ...state.cards[ship]!, shipTokenAt: loc },
		},
	}
	const logged = addLog(next, {
		kind: 'EVENT',
		seat,
		message: `warped ${ship} to ${loc}`,
	})
	return emit(logged, { k: 'SHIP_WARPED', iid: ship, seat })
}
