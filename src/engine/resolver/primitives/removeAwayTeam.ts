import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { suspend, answered, answer, emit, declineMay } from '../runtime'
import { SKIP_LOCATION } from '../choices'
import { resolveQuery } from '../../queries/resolveQuery'
import { otherSeat, type GameState } from '../../state'
import { isCadetOpponent, opponentAwayTeamsAt } from '../../../bot/cadet'
import type { CardInstanceId } from '../../ids'

/** REMOVE_AWAY_TEAM: pull `count` away-team tokens off a Location back to the
 *  owning player's pool ("removing" is the attacker's phrasing, but tokens
 *  belong to the seat named by `whose`). A "you may remove" asked without a
 *  CONFIRM (may.ts) always asks the Location, with a Skip that declines. */
export const removeAwayTeam: Primitive<
	Extract<Effect, { k: 'REMOVE_AWAY_TEAM' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const side = node.whose === 'SELF' ? ctx.actor : otherSeat(ctx.actor)
		return candidates(state, node, ctx, side).length > 0
	},
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const key = 'removeAwayTeam.loc'
		const side = node.whose === 'SELF' ? ctx.actor : otherSeat(ctx.actor)
		// bind: the Location the token came off (1SHR24)
		const done = (loc: CardInstanceId): GameState => {
			if (node.bind !== undefined) ctx.bindings[node.bind] = loc
			return remove(state, loc, side, node.count)
		}
		if (answered(ctx, key)) {
			const loc = answer<CardInstanceId>(ctx, key)
			if (loc === SKIP_LOCATION && ctx.declinable !== undefined)
				return declineMay(state, ctx.declinable)
			return done(loc)
		}
		const cands = candidates(state, node, ctx, side)
		if (cands.length === 0) return state
		const decline = ctx.declinable
		if (decline !== undefined)
			return suspend(state, node, ctx, key, {
				k: 'CHOOSE_LOCATION',
				prompt: `${decline.prompt} (Skip declines)`,
				candidates: [...cands, SKIP_LOCATION],
				mayDecline: true,
			})
		if (cands.length === 1) return done(cands[0]!)
		return suspend(state, node, ctx, key, {
			k: 'CHOOSE_LOCATION',
			prompt: 'Remove an Away Team from which Location?',
			candidates: cands,
		})
	},
}

function candidates(
	state: GameState,
	node: Effect & { k: 'REMOVE_AWAY_TEAM' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	side: GameState['players'][0]['seat'],
): CardInstanceId[] {
	return resolveQuery(state, node.target, ctx).filter((iid) => {
		// The virtual cadet has 1 Away Team at ANY Location (rules/10 §10.2 #3).
		if (isCadetOpponent(state.mode, side)) return true
		return (state.awayTeamsAt[iid]?.[side] ?? 0) > 0
	})
}

function remove(
	state: GameState,
	loc: CardInstanceId,
	side: GameState['players'][0]['seat'],
	count: number,
): GameState {
	// rules/10 §10.2 #3: only the cadet's ONE virtual Away Team is there to
	// remove — the token is virtual, so the state is untouched; the event is
	// reported truthfully (count 1) for any per-token follow-up.
	if (isCadetOpponent(state.mode, side)) {
		const take = Math.min(count, opponentAwayTeamsAt(loc as string))
		if (take <= 0) return state
		return emit(state, {
			k: 'AWAY_TEAM_REMOVED',
			seat: side,
			location: state.cards[loc]?.def ?? (loc as string),
			count: take,
		})
	}
	const at = state.awayTeamsAt[loc] ?? [0, 0]
	const at2: [number, number] = [at[0] ?? 0, at[1] ?? 0]
	const take = Math.min(count, at2[side] ?? 0)
	if (take <= 0) return state
	at2[side] = (at2[side] ?? 0) - take
	const awayTeamsAt = { ...state.awayTeamsAt, [loc]: at2 }
	const players = state.players.map((pl) =>
		pl.seat === side
			? { ...pl, awayTeamsInPool: pl.awayTeamsInPool + take }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return emit(
		{ ...state, awayTeamsAt, players },
		{
			k: 'AWAY_TEAM_REMOVED',
			seat: side,
			location: state.cards[loc]?.def ?? loc,
			count: take,
		},
	)
}
