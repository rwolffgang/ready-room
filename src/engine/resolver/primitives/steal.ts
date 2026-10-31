import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount } from '../../queries/resolveQuery'
import { stealResource } from '../runtime'
import { player, otherSeat, type GameState } from '../../state'
import { isCadetOpponent } from '../../../bot/cadet'
import { stealProtected } from '../../modifiers'
import { isSoloBot } from '../../solo/seat'

/** STEAL (rules/08 §steal, rules/04 §4.3.3, rules/12 §12.8): transfer resources
 *  from the opponent, capped at what they actually hold (parked tokens first,
 *  then pool). Never emits RESOURCE_GAINED — stealing is not gaining. Routes
 *  through the victim's onStolenFrom modifiers (1BUR02). */
export const steal: Primitive<Extract<Effect, { k: 'STEAL' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount <= 0) return true
		const from = otherSeat(ctx.actor)
		// "Your {DIL} cannot be stolen" (1BUR03): nothing to take
		if (stealProtected(state, from, node.res)) return false
		// The virtual cadet holds 1 of that resource (rules/10 §10.2 #3).
		if (isCadetOpponent(state.mode, from)) return true
		// Stealing from the official solo Bot always succeeds (rules/13 §13.12.2).
		if (isSoloBot(state, from)) return true
		const victim = player(state, from)
		if (victim.resources[node.res] > 0) return true
		// parked tokens on the victim's modifier cards are also stealable
		if (parkedTotal(state, from, node.res) > 0) return true
		return false
	},
	execute(state, node, ctx, _frame) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount <= 0) return state
		return stealResource(
			state,
			otherSeat(ctx.actor),
			ctx.actor,
			node.res,
			amount,
		)
	},
}

function parkedTotal(
	state: GameState,
	seat: GameState['players'][0]['seat'],
	res: 'DIL' | 'LAT' | 'GLO',
): number {
	let total = 0
	const p = player(state, seat)
	for (const m of p.modifiers) {
		total += state.cards[m.source]?.resourceTokens?.[res] ?? 0
	}
	return total
}
