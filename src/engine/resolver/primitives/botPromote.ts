import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { addLog, emit, moveCard } from '../runtime'
import { botTargetCard } from '../../solo/target'

type Node = Extract<Effect, { k: 'BOT_PROMOTE' }>

/** BOT_PROMOTE — the PERSON becomes the Bot's Duty Officer (rules/13 §13.7).
 *  The Bot has one slot whatever its cards say, so a previous Duty Officer is
 *  dismissed to the Bot Discard pile first. Its SUITS card side follows from
 *  the slot (solo/classify.ts), so nothing else flips. */
export const botPromote: Primitive<Node> = {
	isCost: false,
	canResolve: (state, node, ctx) =>
		botTargetCard(state, node.target, ctx, 'PERSON') !== null,
	execute(state, node, ctx, _frame) {
		const bot = ctx.actor
		const person = botTargetCard(state, node.target, ctx, 'PERSON')
		if (person === null) return state
		let next = state
		for (const old of [...(next.zones[`DUTY_OFFICER:${bot}`] ?? [])])
			next = emit(moveCard(next, old, { k: 'DISCARD', seat: bot }), {
				k: 'CARD_DISMISSED',
				iid: old,
				seat: bot,
			})
		next = moveCard(next, person, { k: 'DUTY_OFFICER', seat: bot })
		return addLog(next, {
			kind: 'EVENT',
			seat: bot,
			iid: person,
			message: `promoted ${person} to Duty Officer`,
		})
	},
}
