import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { mostHeldLocation } from '../../solo/rank'

/** Where BOT_TAKE_CONTROL parks its pick for the TAKE_CONTROL it pushes. */
export const BOT_TAKE_CONTROL_BINDING = '$bot.takeControl'

/** BOT_TAKE_CONTROL — "take control of the neutral LOCATION with most Bot
 *  tokens (minimum 1)": picks it (solo/rank.ts) and hands over to TAKE_CONTROL,
 *  so tokens return, the opponent is paid for theirs, and the Neutral Zone
 *  refills exactly as for a player. */
export const botTakeControl: Primitive<
	Extract<Effect, { k: 'BOT_TAKE_CONTROL' }>
> = {
	isCost: false,
	canResolve: (state, _node, ctx) =>
		mostHeldLocation(state, ctx.actor) !== null,
	execute(state, _node, ctx, _frame) {
		const loc = mostHeldLocation(state, ctx.actor)
		if (loc === null) return state
		ctx.bindings[BOT_TAKE_CONTROL_BINDING] = loc
		state.stack.push({
			k: 'EFFECT',
			node: {
				k: 'TAKE_CONTROL',
				target: {
					zones: ['NEUTRAL_LOCATIONS'],
					bound: BOT_TAKE_CONTROL_BINDING,
				},
			},
			ctx,
			ip: 0,
		})
		return state
	},
}
