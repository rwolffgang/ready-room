import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { player } from '../../state'
import { evalAmount } from '../../queries/resolveQuery'
import { place, pullFrom } from './sendAwayTeam'
import { pullSource, sendTarget } from '../../solo/rank'

type Node = Extract<Effect, { k: 'BOT_SEND_AWAY_TEAM' }>

/** BOT_SEND_AWAY_TEAM — the Bot sends `count` Away Teams, one at a time, each
 *  to the LOCATION `sendTarget` picks (rules/13 §13.11.3). With none left on
 *  its Captain it pulls one back from where it has the fewest tokens first;
 *  with none anywhere, or no legal target, the rest is skipped. */
export const botSendAwayTeam: Primitive<Node> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (evalAmount(state, node.count, ctx) <= 0) return false
		return sendTarget(state, ctx.actor, node) !== null
	},
	execute(state, node, ctx, _frame) {
		const bot = ctx.actor
		const count = Math.max(0, Math.floor(evalAmount(state, node.count, ctx)))
		let next = state
		for (let i = 0; i < count; i++) {
			const target = sendTarget(next, bot, node)
			if (target === null) break
			if (player(next, bot).awayTeamsInPool === 0) {
				const source = pullSource(next, bot, target)
				if (source === null) break
				next = pullFrom(next, source, bot, 1)
			}
			next = place(next, target, bot, 1)
		}
		return next
	},
}
