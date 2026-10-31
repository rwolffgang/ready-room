import type { Effect, Operation } from '../nodes'
import type { Primitive } from './index'
import {
	pickCards,
	suspend,
	answered,
	answer,
	answerSingle,
	skipBenefit,
	declinedPick,
} from '../runtime'
import { evalPredicate, matchFilter } from '../../queries/resolveQuery'
import { cardDef } from '../../cards'
import { zonesOf } from '../../state'
import { marketOffers } from '../../market'
import { describeOperation } from '../../describe'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'

/**
 * DUPLICATE (rules/08 §duplicate, docs/effect-dsl §4, todo/04 §7):
 *   1. CHOOSE_CARDS over the legal sources (Market / your Discard / your Log)
 *      whose suit matches `node.suits` and that carry an operation of
 *      `node.opType`;
 *   2. CHOOSE_OPTION over that card's matching operations;
 *   3. push the chosen operation's effect with a modified ctx:
 *        { ...ctx, source: dupCard, duplicating: ctx.source, noNestedDuplicate: true }
 *      — the action cost is NOT paid (no OPERATION frame), `requires` is still
 *      checked, 'THIS' targets redirect to `ctx.duplicating`, and nested
 *      duplicates are a no-op.
 */
export const duplicate: Primitive<Extract<Effect, { k: 'DUPLICATE' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (ctx.noNestedDuplicate === true) return true // nested → no-op, trivially fine
		return sourceCards(state, node, ctx).length > 0
	},
	offersDecline: (_state, _node, ctx) => ctx.noNestedDuplicate !== true,
	execute(state, node, ctx, _frame) {
		if (ctx.noNestedDuplicate === true) {
			return skipBenefit(state, node, ctx, 'nested DUPLICATE is a no-op')
		}
		const cardKey = 'duplicate.card'
		if (answered(ctx, cardKey)) {
			const declined = declinedPick(state, ctx, cardKey)
			if (declined !== null) return declined
			return chooseOption(state, node, ctx, answerSingle(ctx, cardKey))
		}
		const cands = sourceCards(state, node, ctx)
		const r = pickCards(state, node, ctx, cardKey, {
			prompt: 'Duplicate which card?',
			declinable: true,
			candidates: cands,
			min: 1,
			max: 1,
			from: 'SOURCES',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		return chooseOption(state, node, ctx, r.iids[0]!)
	},
}

function chooseOption(
	state: GameState,
	node: Effect & { k: 'DUPLICATE' },
	ctx: EffectCtx,
	iid: CardInstanceId,
): GameState {
	const opKey = 'duplicate.op'
	const ops = matchingOps(state, iid, node, ctx)
	if (answered(ctx, opKey)) {
		// CHOOSE_OPTION selections are `{ key: '0' }` — never trust the client to
		// have stored a number (rules/12 §12.14; choices.ts validateSelection).
		const sel = answer<{ key: string }>(ctx, opKey)
		const idx = Number(sel?.key)
		const op = ops[idx]
		if (!op)
			return skipBenefit(
				state,
				node,
				ctx,
				`no matching operation for key ${sel?.key}`,
			)
		return pushDup(state, node, ctx, iid, op)
	}
	if (ops.length === 0) return state // skip (benefit)
	if (ops.length === 1) return pushDup(state, node, ctx, iid, ops[0]!)
	const all = cardDef(state.cards[iid]!.def).operations
	return suspend(state, node, ctx, opKey, {
		k: 'CHOOSE_OPTION',
		prompt: `Duplicate which ${node.opType} operation?`,
		options: ops.map((o, i) => ({
			key: String(i),
			label: o.text ?? describeOperation(o),
			enabled: true,
			reason: undefined,
			op: { card: iid, opIndex: all.indexOf(o) },
		})),
	})
}

function pushDup(
	state: GameState,
	node: Effect & { k: 'DUPLICATE' },
	ctx: EffectCtx,
	dupCard: CardInstanceId,
	op: Operation,
): GameState {
	const childCtx: EffectCtx = {
		...ctx,
		source: dupCard,
		duplicating: ctx.source,
		noNestedDuplicate: true,
	}
	// skip the action cost (we push a plain EFFECT, no OPERATION frame), but the
	// Specialty restriction still gates the operation (rules/08 §duplicate).
	if (op.requires !== undefined) {
		const ok = evalPredicate(
			state,
			{
				k: 'SPECIALTY_AT_LEAST',
				specialty: op.requires.specialty,
				value: op.requires.min,
			},
			childCtx,
		)
		if (!ok) {
			return skipBenefit(
				state,
				node,
				ctx,
				`requires ${op.requires.specialty} ${op.requires.min}+`,
			)
		}
	}
	state.stack.push({ k: 'EFFECT', node: op.effect, ctx: childCtx, ip: 0 })
	void node
	return state
}

/** Cards in the declared sources whose suit and operations qualify. */
function sourceCards(
	state: GameState,
	node: Effect & { k: 'DUPLICATE' },
	ctx: EffectCtx,
): CardInstanceId[] {
	const seen = new Set<CardInstanceId>()
	const out: CardInstanceId[] = []
	if (node.from.includes('MARKET')) {
		for (const iid of marketOffers(state)) {
			if (!seen.has(iid)) {
				seen.add(iid)
				out.push(iid)
			}
		}
	}
	if (node.from.includes('DISCARD')) {
		for (const iid of zonesOf(state, { k: 'DISCARD', seat: ctx.actor })) {
			if (!seen.has(iid)) {
				seen.add(iid)
				out.push(iid)
			}
		}
	}
	if (node.from.includes('LOG')) {
		for (const iid of zonesOf(state, { k: 'LOG', seat: ctx.actor })) {
			if (!seen.has(iid)) {
				seen.add(iid)
				out.push(iid)
			}
		}
	}
	if (node.from.includes('DEPLOYED')) {
		// "deployed by any player" (1SHI04): both Fleets
		for (const seat of [0, 1] as const)
			for (const iid of zonesOf(state, { k: 'FLEET', seat })) {
				if (!seen.has(iid)) {
					seen.add(iid)
					out.push(iid)
				}
			}
	}
	if (node.from.includes('BOUND') && node.bound !== undefined) {
		// exactly the bound card, wherever it is ("Utilize's other play
		// operation" — 1LOC20 on $event.card)
		const v = ctx.bindings[node.bound]
		if (
			typeof v === 'string' &&
			state.cards[v] !== undefined &&
			!seen.has(v as CardInstanceId)
		) {
			seen.add(v as CardInstanceId)
			out.push(v as CardInstanceId)
		}
	}
	if (node.from.includes('RESOLVED_THIS_TURN')) {
		for (const ref of resolvedRefs(state, node, ctx)) {
			if (!seen.has(ref.card)) {
				seen.add(ref.card)
				out.push(ref.card)
			}
		}
	}
	return out.filter((iid) => qualifies(state, iid, node, ctx))
}

/** Operations of `node.opType` the actor completed this turn (1PER11). */
function resolvedRefs(
	state: GameState,
	node: Effect & { k: 'DUPLICATE' },
	ctx: EffectCtx,
): { card: CardInstanceId; opIndex: number }[] {
	const r = state.resolvedOps
	if (r === undefined || r.turn !== state.turnNumber) return []
	return r.refs.filter((ref) => {
		if (ref.seat !== ctx.actor) return false
		const card = state.cards[ref.card]
		if (card === undefined) return false
		return cardDef(card.def).operations[ref.opIndex]?.type === node.opType
	})
}

function qualifies(
	state: GameState,
	iid: CardInstanceId,
	node: Effect & { k: 'DUPLICATE' },
	ctx: EffectCtx,
): boolean {
	const card = state.cards[iid]!
	const def = cardDef(card.def)
	if (!node.suits.includes(def.suit)) return false
	// "a non-TIME TRAVEL SHIP" (1SHI04)
	if (
		node.filter !== undefined &&
		!matchFilter(state, card, node.filter, {
			allowWildcard: true,
			actorMayOptIn: true,
		})
	)
		return false
	return matchingOps(state, iid, node, ctx).length > 0
}

/** The card's operations of `node.opType`; with RESOLVED_THIS_TURN as the
 *  only source, just the ones the actor already resolved this turn. */
function matchingOps(
	state: GameState,
	iid: CardInstanceId,
	node: Effect & { k: 'DUPLICATE' },
	ctx: EffectCtx,
): Operation[] {
	const def = cardDef(state.cards[iid]!.def)
	if (node.from.length === 1 && node.from[0] === 'RESOLVED_THIS_TURN') {
		const idx = new Set(
			resolvedRefs(state, node, ctx)
				.filter((r) => r.card === iid)
				.map((r) => r.opIndex),
		)
		return def.operations.filter((_, i) => idx.has(i))
	}
	// "the OTHER play operation": not one the actor already resolved this turn
	const done =
		node.other === true
			? new Set(
					(state.resolvedOps?.turn === state.turnNumber
						? state.resolvedOps.refs
						: []
					)
						.filter((r) => r.card === iid && r.seat === ctx.actor)
						.map((r) => r.opIndex),
				)
			: new Set<number>()
	return def.operations.filter((o, i) => o.type === node.opType && !done.has(i))
}
