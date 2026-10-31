import type { Effect } from '../nodes'
import type { Primitive } from './index'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { Seat } from '../queries'
import { addLog, emit, moveCard } from '../runtime'
import { cardDef } from '../../cards'
import { botDeckCanAdvance, botDeckTop } from '../../solo/deck'

/** Log one of the Bot's cards — an INCIDENT is returned to the Incident deck
 *  instead (rules/13 §13.9). Shared with the Bot's other logging paths. */
export function botLogCard(
	state: GameState,
	iid: CardInstanceId,
	bot: Seat,
): GameState {
	if (cardDef(state.cards[iid]!.def).suit === 'INCIDENT')
		return emit(
			addLog(moveCard(state, iid, { k: 'INCIDENT_DECK' }), {
				kind: 'EVENT',
				seat: bot,
				iid,
				message: `returned ${iid} to the Incident deck instead of logging it`,
			}),
			{ k: 'CARD_RETURNED_INCIDENT', iid, seat: bot },
		)
	return emit(moveCard(state, iid, { k: 'LOG', seat: bot }), {
		k: 'CARD_LOGGED',
		iid,
		seat: bot,
	})
}

/** BOT_DECK — "log / discard the top N cards of the Bot deck" (reshuffling it
 *  whenever it runs out — rules/13 §13.5), or of the Supplement deck, or
 *  "take the top card of the Supplement deck" onto the Bot deck. Stops early
 *  when nothing is left. */
export const botDeck: Primitive<Extract<Effect, { k: 'BOT_DECK' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return node.from === 'DECK'
			? botDeckCanAdvance(state, ctx.actor)
			: (state.zones[`SUPPLEMENT:${ctx.actor}`]?.length ?? 0) > 0
	},
	execute(state, node, ctx, _frame) {
		const bot = ctx.actor
		let next = state
		for (let i = 0; i < node.count; i++) {
			let top: CardInstanceId | null
			if (node.from === 'DECK') {
				const r = botDeckTop(next, bot)
				next = r.state
				top = r.top
			} else top = next.zones[`SUPPLEMENT:${bot}`]?.[0] ?? null
			if (top === null) break
			if (node.op === 'LOG') next = botLogCard(next, top, bot)
			else if (node.op === 'DISCARD')
				next = emit(moveCard(next, top, { k: 'DISCARD', seat: bot }), {
					k: 'CARD_DISCARDED',
					iid: top,
					seat: bot,
				})
			else
				next = addLog(
					moveCard(next, top, { k: 'DRAW', seat: bot }, { toTop: true }),
					{
						kind: 'EVENT',
						seat: bot,
						message: 'put the top card of its Supplement deck on top of the Bot deck',
					},
				)
		}
		return next
	},
}
