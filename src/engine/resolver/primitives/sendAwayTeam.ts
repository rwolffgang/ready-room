import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'
import { player, type GameState } from '../../state'
import { suspend, answered, answer, emit, declineMay } from '../runtime'
import { SKIP_LOCATION } from '../choices'
import { canSendAwayTeam } from '../../queries/board'
import { cardDef, isLocationDef } from '../../cards'
import type { CardInstanceId } from '../../ids'
import type { Seat } from '../queries'

/** SEND_AWAY_TEAM (rules/06 §6.3, rules/12 §12.15, rules/08 → send/remove):
 *  move `count` away-team tokens from your Captain card to a Location. Legal
 *  targets are controlled Locations ∪ neutral Locations where the opponent has
 *  NO MORE Ship tokens than you (`canSendAwayTeam`); `ignoreBlocking` overrides
 *  that (1ENC04). No Ship presence is required. If your pool cannot
 *  cover `count` you may freely pull tokens off your other Locations to
 *  complete the placement (CHOOSE_LOCATION over the sources, auto when only
 *  one) — `awayTeamsTotal` never decreases (asserted at the stack boundary).
 *  Emits AWAY_TEAM_SENT. A "you may send" asked without a CONFIRM (may.ts)
 *  always asks the destination, with a Skip that declines. */
export const sendAwayTeam: Primitive<Extract<Effect, { k: 'SEND_AWAY_TEAM' }>> =
	{
		isCost: false,
		canResolve(state, node, ctx) {
			const count = countOf(state, node, ctx)
			if (count <= 0) return false
			if (targets(state, node, ctx).length === 0) return false
			return tokensAvailable(state, ctx.actor) > 0
		},
		offersDecline: () => true,
		execute(state, node, ctx, _frame) {
			const targetKey = 'sendAwayTeam.target'
			const sourceKey = 'sendAwayTeam.source'
			// 3. source answered (pull): complete the placement, pulling from `source`
			//    first, then any other of your locations in a fixed order. The
			//    destination is the answered target, or the single legal one that
			//    was taken without asking (bound directly under AUTO_TARGET).
			if (answered(ctx, sourceKey)) {
				const target = answered(ctx, targetKey)
					? answer<CardInstanceId>(ctx, targetKey)
					: (ctx.bindings[AUTO_TARGET] as CardInstanceId)
				return pullAndPlace(
					state,
					node,
					ctx,
					target,
					answer<CardInstanceId>(ctx, sourceKey),
				)
			}
			// 2. target answered: evaluate pool; if short, pull from a source.
			if (answered(ctx, targetKey)) {
				const target = answer<CardInstanceId>(ctx, targetKey)
				if (target === SKIP_LOCATION && ctx.declinable !== undefined)
					return declineMay(state, ctx.declinable)
				return send(state, node, ctx, target)
			}
			// 1. fresh: choose the destination Location.
			const cands = targets(state, node, ctx)
			if (cands.length === 0) return state
			const decline = ctx.declinable
			if (decline !== undefined)
				return suspend(state, node, ctx, targetKey, {
					k: 'CHOOSE_LOCATION',
					prompt: `${decline.prompt} (Skip declines)`,
					candidates: [...cands, SKIP_LOCATION],
					mayDecline: true,
				})
			if (cands.length === 1) {
				// remembered for step 3, should `send` still have to ask for a source
				ctx.bindings[AUTO_TARGET] = cands[0]!
				return send(state, node, ctx, cands[0]!)
			}
			return suspend(state, node, ctx, targetKey, {
				k: 'CHOOSE_LOCATION',
				prompt: 'Send an Away Team to which Location?',
				candidates: cands,
			})
		},
	}

/** Binding of a destination taken without a choice (the only legal one). */
const AUTO_TARGET = 'sendAwayTeam.autoTarget'

function countOf(
	state: GameState,
	node: Effect & { k: 'SEND_AWAY_TEAM' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): number {
	return Math.max(0, Math.floor(evalAmount(state, node.count, ctx)))
}

/** Legal destinations: Location cards the query names that `canSendAwayTeam`
 *  allows (or every named Location when `ignoreBlocking`). */
function targets(
	state: GameState,
	node: Effect & { k: 'SEND_AWAY_TEAM' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	const locs = resolveQuery(state, node.target, ctx).filter((iid) =>
		isLocationDef(cardDef(state.cards[iid]!.def)),
	)
	if (node.ignoreBlocking === true) return locs
	return locs.filter((iid) => canSendAwayTeam(state, ctx.actor, iid))
}

/** How many of `seat`'s away-team tokens exist anywhere (pool + Locations). */
function tokensAvailable(state: GameState, seat: Seat): number {
	let total = player(state, seat).awayTeamsInPool
	for (const at of Object.values(state.awayTeamsAt)) total += at[seat] ?? 0
	return total
}

/** Choose the destination, then handle an empty/insufficient pool by pulling
 *  from other Locations. */
function send(
	state: GameState,
	node: Effect & { k: 'SEND_AWAY_TEAM' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	loc: CardInstanceId,
): GameState {
	// "If you targeted a controlled LOCATION, …" (1PIC24): bind the target.
	if (node.bind !== undefined) ctx.bindings[node.bind] = loc
	const count = countOf(state, node, ctx)
	if (count <= 0) return state
	const pool = player(state, ctx.actor).awayTeamsInPool
	if (pool >= count) return place(state, loc, ctx.actor, count)
	const sources = sourcesOf(state, ctx.actor, [loc])
	if (sources.length === 0)
		return pool > 0 ? place(state, loc, ctx.actor, pool) : state
	if (sources.length === 1)
		return pullAndPlace(state, node, ctx, loc, sources[0]!)
	return suspend(state, node, ctx, 'sendAwayTeam.source', {
		k: 'CHOOSE_LOCATION',
		prompt: 'Pull an Away Team from which Location?',
		candidates: sources,
	})
}

/** Locations (other than `skip`) where `seat` has at least one token. */
function sourcesOf(
	state: GameState,
	seat: Seat,
	skip: CardInstanceId[],
): CardInstanceId[] {
	const skipSet = new Set(skip)
	const out: CardInstanceId[] = []
	for (const [iid, at] of Object.entries(state.awayTeamsAt)) {
		if (!skipSet.has(iid as CardInstanceId) && (at[seat] ?? 0) > 0)
			out.push(iid as CardInstanceId)
	}
	return out
}

/** Pull `<count> - pool` from `source` first, then from any other of the
 *  actor's Locations (deterministic order) until the placement is covered,
 *  then place `count` at the destination (as many as are available). */
function pullAndPlace(
	state: GameState,
	node: Effect & { k: 'SEND_AWAY_TEAM' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	loc: CardInstanceId,
	source: CardInstanceId,
): GameState {
	if (node.bind !== undefined) ctx.bindings[node.bind] = loc
	const count = countOf(state, node, ctx)
	if (count <= 0) return state
	let next = state
	const seat = ctx.actor
	const pullOrder = [source, ...sourcesOf(next, seat, [source, loc])]
	for (const from of pullOrder) {
		const pool = player(next, seat).awayTeamsInPool
		if (pool >= count) break
		const need = count - pool
		const at = next.awayTeamsAt[from]?.[seat] ?? 0
		if (at <= 0) continue
		const take = Math.min(need, at)
		next = pullFrom(next, from, seat, take)
	}
	const placed = Math.min(count, player(next, seat).awayTeamsInPool)
	return placed > 0 ? place(next, loc, seat, placed) : next
}

/** Move `take` of `seat`'s tokens from `from` back to their pool. The total
 *  (pool + Locations) is unchanged — the stack-boundary invariant holds. */
function pullFrom(
	state: GameState,
	from: CardInstanceId,
	seat: Seat,
	take: number,
): GameState {
	if (take <= 0) return state
	const at = state.awayTeamsAt[from] ?? [0, 0]
	const at2: [number, number] = [at[0] ?? 0, at[1] ?? 0]
	at2[seat] = (at2[seat] ?? 0) - take
	const awayTeamsAt = { ...state.awayTeamsAt, [from]: at2 }
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, awayTeamsInPool: pl.awayTeamsInPool + take }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return emit(
		{ ...state, awayTeamsAt, players },
		{ k: 'AWAY_TEAM_REMOVED', seat, location: from as string, count: take },
	)
}

/** Place `count` tokens at `loc` from the pool (never more than the pool
 *  holds), then emit AWAY_TEAM_SENT. */
function place(
	state: GameState,
	loc: CardInstanceId,
	seat: Seat,
	count: number,
): GameState {
	const pool = player(state, seat).awayTeamsInPool
	const take = Math.min(count, pool)
	if (take <= 0) return state
	const at = state.awayTeamsAt[loc] ?? [0, 0]
	const at2: [number, number] = [at[0] ?? 0, at[1] ?? 0]
	at2[seat] = (at2[seat] ?? 0) + take
	const awayTeamsAt = { ...state.awayTeamsAt, [loc]: at2 }
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, awayTeamsInPool: pl.awayTeamsInPool - take }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return emit(
		{ ...state, awayTeamsAt, players },
		{
			k: 'AWAY_TEAM_SENT',
			seat,
			location: state.cards[loc]?.def ?? loc,
			count: take,
		},
	)
}
