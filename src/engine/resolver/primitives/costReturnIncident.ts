import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	moveCard,
	emit,
	failOperation,
	pickCards,
	costCanResolve,
	handCandidates,
} from '../runtime'
import { cardDef } from '../../cards'
import type { GameState } from '../../state'

/** COST_RETURN_INCIDENT (docs/effect-dsl.md §3): return N INCIDENT cards from
 *  your hand to the bottom of the Incident deck as a cost (the mirror of
 *  COST_TAKE_INCIDENT — returning pushes the Burn further away, rules/08 →
 *  return an INCIDENT, rules/12 §12.11). Unpayable → the parent fails rather
 *  than mutating anything. */
export const costReturnIncident: Primitive<
	Extract<Effect, { k: 'COST_RETURN_INCIDENT' }>
> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	offersDecline: () => true,
	execute(state, node, ctx, _frame) {
		const candidates = handCandidates(state, ctx, node.filter).filter(
			(iid) => cardDef(state.cards[iid]!.def).suit === 'INCIDENT',
		)
		const r = pickCards(state, node, ctx, 'costReturnIncident', {
			prompt: 'Return an Incident',
			declinable: true,
			candidates,
			min: node.count,
			max: node.count,
			from: `HAND:${ctx.actor}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none')
			return failOperation(state, 'COST_RETURN_INCIDENT: no legal selection')
		let next: GameState = state
		for (const iid of r.iids) {
			// bottom of the Incident deck = plain append
			next = emit(moveCard(next, iid, { k: 'INCIDENT_DECK' }), {
				k: 'CARD_RETURNED_INCIDENT',
				iid,
				seat: ctx.actor,
			})
		}
		return next
	},
}
