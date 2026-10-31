import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { pickSingle, moveCard, emit } from '../runtime'

export const returnIncident: Primitive<
	Extract<Effect, { k: 'RETURN_INCIDENT' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		if (node.target === 'THIS') return true
		return resolveQuery(state, node.target, ctx).length > 0
	},
	offersDecline: (_state, node) => node.target !== 'THIS',
	execute(state, node, ctx, _frame) {
		if (node.target === 'THIS') {
			// "return this card" — the resolving INCIDENT itself (mirror of LOG 'THIS').
			const iid = ctx.duplicating ?? ctx.source
			return emit(moveCard(state, iid, { k: 'INCIDENT_DECK' }), {
				k: 'CARD_RETURNED_INCIDENT',
				iid,
				seat: ctx.actor,
			})
		}
		const candidates = resolveQuery(state, node.target, ctx)
		const r = pickSingle(state, node, ctx, 'returnIncident', {
			prompt: 'Return an Incident',
			declinable: true,
			candidates,
			from: 'SELECT',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		// bottom of the Incident deck = plain append
		return emit(moveCard(state, iid, { k: 'INCIDENT_DECK' }), {
			k: 'CARD_RETURNED_INCIDENT',
			iid,
			seat: ctx.actor,
		})
	},
}
