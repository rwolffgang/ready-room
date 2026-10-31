import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { addLog, emit, moveCard } from '../runtime'
import { botTargetCard } from '../../solo/target'
import { warpTarget } from '../../solo/rank'

type Node = Extract<Effect, { k: 'BOT_DEPLOY' }>

/** BOT_DEPLOY — "Deploy this SHIP; it explores / engages" (rules/13
 *  §13.11.2): the SHIP joins the Bot's Control Area (FLEET, in deploy order)
 *  with its Ship token on it, then warps that token to the neutral LOCATION
 *  `warpTarget` picks. */
export const botDeploy: Primitive<Node> = {
	isCost: false,
	canResolve: (state, node, ctx) =>
		botTargetCard(state, node.target, ctx, 'SHIP') !== null,
	execute(state, node, ctx, _frame) {
		const bot = ctx.actor
		const ship = botTargetCard(state, node.target, ctx, 'SHIP')
		if (ship === null) return state
		const moved = moveCard(state, ship, { k: 'FLEET', seat: bot })
		let next = emit(
			{
				...moved,
				cards: {
					...moved.cards,
					[ship]: { ...moved.cards[ship]!, shipTokenAt: null },
				},
			},
			{ k: 'CARD_DEPLOYED', iid: ship, seat: bot },
		)
		if (node.then === undefined) return next
		const loc = warpTarget(next, bot, node.then)
		if (loc === null) return next
		next = {
			...next,
			cards: {
				...next.cards,
				[ship]: { ...next.cards[ship]!, shipTokenAt: loc },
			},
		}
		next = addLog(next, {
			kind: 'EVENT',
			seat: bot,
			iid: ship,
			message: `warped ${ship} to ${loc} (it ${node.then === 'EXPLORE' ? 'explores' : 'engages'})`,
		})
		return emit(next, { k: 'SHIP_WARPED', iid: ship, seat: bot })
	},
}
