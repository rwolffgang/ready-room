import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pullFrom } from './sendAwayTeam'
import { pickByValue } from '../../solo/value'
import { tokensAt } from '../../queries/board'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { Seat } from '../queries'

/** LOCATIONs holding at least one of the Bot's Away Teams. */
function held(state: GameState, bot: Seat): CardInstanceId[] {
	return (Object.keys(state.awayTeamsAt) as CardInstanceId[]).filter(
		(loc) => (state.awayTeamsAt[loc]?.[bot] ?? 0) > 0,
	)
}

/** BOT_REMOVE_AWAY_TEAM — the Bot gives up `count` of its own Away Teams
 *  (back to its Captain), one at a time, each from the LOCATION where it has
 *  the fewest tokens, ties to the least valuable (ruling 055). */
export const botRemoveAwayTeam: Primitive<
	Extract<Effect, { k: 'BOT_REMOVE_AWAY_TEAM' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		let total = 0
		for (const loc of held(state, ctx.actor))
			total += state.awayTeamsAt[loc]?.[ctx.actor] ?? 0
		return total >= node.count
	},
	execute(state, node, ctx, _frame) {
		const bot = ctx.actor
		let next = state
		for (let i = 0; i < node.count; i++) {
			const locs = held(next, bot)
			const fewest = Math.min(...locs.map((l) => tokensAt(next, l, bot)))
			const from = pickByValue(
				next,
				locs.filter((l) => tokensAt(next, l, bot) === fewest),
				bot,
				'LEAST',
			)
			if (from === null) break
			next = pullFrom(next, from, bot, 1)
		}
		return next
	},
}
