import type { Effect, Operation } from '../nodes'
import type { Primitive } from './index'
import { pickSingle, moveCard, suspend, answered, answer } from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'
import { cardDef } from '../../cards'
import {
	player,
	zoneProps,
	type GameState,
	type EffectCtx,
	type JsonValue,
} from '../../state'
import type { CardInstanceId } from '../../ids'
import type { Seat, ZoneSpec } from '../queries'
import { forbidsAttackCards } from '../../modifiers'
import { hasAttack } from '../../dutyOfficers'
import { probe } from '../probe'
import { describe } from '../../describe'
import { cardToken } from '../../../data/cardNames'

/** FREE_PLAY (rules/08 → free play): play a card with its action cost waived;
 *  any other costs and restrictions on the operation still stand. Like a
 *  normal play (intents.ts reducePlayCard) the card goes to Staging and an
 *  OPERATION frame runs the chosen PLAY operation (so its own costs fail only
 *  that operation, an ATTACK notifies the victim, and it counts as resolved
 *  this turn), followed by CARD_PLAYED and PUT_INTO_PLAY.
 *
 *  - Only cards with at least one PLAY operation that could resolve right now
 *    (Specialty requirement met, effect passes the probe) are offered.
 *  - A card with several such PLAY operations asks which one to resolve
 *    (CHOOSE_OPTION) — "free play" never silently picks the first
 *    (1PIC05, 1PIC07, 1PIC09, 1PIC24, 1SHR12, 1SHR13).
 *  - `from` is one zone or a list ("from your hand or Discard pile", 1SIS08);
 *    `bound` restricts it to one bound card, wherever it sits.
 *  - `bind` names the played card once it was actually played (an optional
 *    free play of the gained card with a follow-up — 1SHR13, 1BUR13, 1SIS08). */
export const freePlay: Primitive<Extract<Effect, { k: 'FREE_PLAY' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const opKey = 'freePlay.op'
		const cardKey = '$freePlay.card'
		if (answered(ctx, opKey)) {
			const iid = ctx.bindings[cardKey] as CardInstanceId
			delete ctx.bindings[cardKey]
			const sel = answer<{ key: string }>(ctx, opKey)
			return play(state, node, ctx, iid, Number(sel.key))
		}
		const cands = candidates(state, node, ctx)
		const r = pickSingle(state, node, ctx, 'freePlay', {
			prompt: 'Play which card for free?',
			declinable: true,
			candidates: cands,
			from: `HAND:${ctx.actor}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		const ops = playableOps(state, ctx.actor, iid)
		if (ops.length === 0) return state
		if (ops.length === 1) return play(state, node, ctx, iid, ops[0]!)
		const def = cardDef(state.cards[iid]!.def)
		const extra: Record<string, JsonValue> = { [cardKey]: iid }
		return suspend(
			state,
			node,
			ctx,
			opKey,
			{
				k: 'CHOOSE_OPTION',
				prompt: `Free play ${cardToken(def.id)}: resolve which play operation?`,
				options: ops.map((i) => ({
					key: String(i),
					label: opLabel(def.operations[i]!),
					enabled: true,
					op: { card: iid, opIndex: i },
				})),
			},
			extra,
		)
	},
}

function opLabel(op: Operation): string {
	const text = describe(op.effect).trim()
	return text === '' ? 'Play' : `Play: ${text}`
}

function play(
	state: GameState,
	node: Effect & { k: 'FREE_PLAY' },
	ctx: EffectCtx,
	iid: CardInstanceId,
	opIndex: number,
): GameState {
	const seat = ctx.actor
	if (node.bind !== undefined) ctx.bindings[node.bind] = iid
	const next = moveCard(state, iid, { k: 'STAGING', seat })
	next.stack.push(
		{
			k: 'EMIT',
			event: { k: 'PUT_INTO_PLAY', iid, seat },
			ifInPlay: { iid, seat },
		},
		{ k: 'EMIT', event: { k: 'CARD_PLAYED', iid, seat } },
		{
			k: 'OPERATION',
			card: iid,
			opIndex,
			ctx: {
				actor: seat,
				source: iid,
				bindings: { '$op.skipActionCost': true },
			},
			phase: 0,
		},
	)
	return next
}

/** PLAY operations of `iid` that could resolve if it were free-played now:
 *  the Specialty requirement is met and (outside probe mode) the effect
 *  passes a probe with the card already in Staging. The action cost is
 *  waived, so it is not checked. */
export function playableOps(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): number[] {
	const def = cardDef(state.cards[iid]!.def)
	const out: number[] = []
	let staged: GameState | undefined
	def.operations.forEach((op, i) => {
		if (op.type !== 'PLAY') return
		if (op.requires !== undefined) {
			const have = player(state, seat).specialties[op.requires.specialty]
			if (have < op.requires.min) return
		}
		// a nested probe inside a probe is skipped: the outer dry-run only
		// needs "some PLAY operation exists" (and stays cheap)
		if (state.probe !== true) {
			staged ??= moveCard(state, iid, { k: 'STAGING', seat })
			if (!probe(staged, op.effect, { actor: seat, source: iid, bindings: {} }))
				return
		}
		out.push(i)
	})
	return out
}

/** 1PER01: "You cannot play … cards with ATTACK" — free play
 *  is still a play. */
function candidates(
	state: GameState,
	node: Effect & { k: 'FREE_PLAY' },
	ctx: EffectCtx,
): CardInstanceId[] {
	const all = rawCandidates(state, node, ctx)
	const allowed = forbidsAttackCards(state, ctx.actor)
		? all.filter((iid) => !hasAttack(state, iid))
		: all
	return allowed.filter((iid) => playableOps(state, ctx.actor, iid).length > 0)
}

function fromZones(node: Effect & { k: 'FREE_PLAY' }): ZoneSpec[] {
	if (node.from === undefined) return [{ k: 'HAND', seat: 0 }]
	return Array.isArray(node.from) ? node.from : [node.from]
}

function rawCandidates(
	state: GameState,
	node: Effect & { k: 'FREE_PLAY' },
	ctx: EffectCtx,
): CardInstanceId[] {
	if (node.bound !== undefined) {
		// "free play the found/gained card": exactly the bound card, wherever it
		// now sits (hand, deck top, Discard) — as long as it is ours, out of play
		// and still matches the filter.
		const raw = ctx.bindings[node.bound]
		if (typeof raw !== 'string') return []
		const bound = raw as CardInstanceId
		const card = state.cards[bound]
		if (
			card === undefined ||
			card.owner !== ctx.actor ||
			zoneProps(card.zone).inPlay
		)
			return []
		if (
			!resolveQuery(
				state,
				{ zones: [card.zone], seat: 'SELF', filter: node.filter },
				ctx,
			).includes(bound)
		)
			return []
		return [bound]
	}
	return resolveQuery(
		state,
		{ zones: fromZones(node), seat: 'SELF', filter: node.filter },
		ctx,
	)
}
