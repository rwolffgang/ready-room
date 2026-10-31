import type { BotPrefTerm, Effect } from '../nodes'
import type { Primitive } from './index'
import type { EffectCtx, GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ResourceId } from '../../../data/ids'
import { addLog, emit, gainResource, moveCard, setOwner } from '../runtime'
import { matchFilter } from '../../queries/resolveQuery'
import { marketOffers, refillMarket, suitOfOffer } from '../../market'
import { pickByValue } from '../../solo/value'

type Node = Extract<Effect, { k: 'BOT_ACQUIRE' }>

const MATCH = { allowWildcard: false, actorMayOptIn: false } as const

/** The face-up Market cards one preference term allows. A filter matches by
 *  printed suit/traits/icons (a WILDCARD in the Market is nobody's yet, so it
 *  never stands in); `most` keeps only the cards holding the most of that
 *  token, and none when no card holds any (ruling 061). */
function termCards(
	state: GameState,
	offers: CardInstanceId[],
	term: BotPrefTerm,
): CardInstanceId[] {
	if ('most' in term) {
		const res = term.most as ResourceId
		const held = (iid: CardInstanceId) =>
			state.cards[iid]?.resourceTokens[res] ?? 0
		const best = Math.max(0, ...offers.map(held))
		return best === 0 ? [] : offers.filter((iid) => held(iid) === best)
	}
	return offers.filter((iid) =>
		matchFilter(state, state.cards[iid]!, term, MATCH),
	)
}

/** The Market card the Bot gains or takes (rules/13 §13.10.1): the first ">"
 *  step with any match, its best card by value to the Bot — or, with no
 *  preference, the most valuable card in the Market. */
function marketPick(
	state: GameState,
	node: Node,
	ctx: EffectCtx,
): CardInstanceId | null {
	const offers = marketOffers(state)
	if (node.pref === undefined)
		return pickByValue(state, offers, ctx.actor, 'MOST')
	for (const step of node.pref) {
		const allowed = new Set<CardInstanceId>()
		for (const term of step)
			for (const iid of termCards(state, offers, term)) allowed.add(iid)
		const best = pickByValue(
			state,
			offers.filter((iid) => allowed.has(iid)),
			ctx.actor,
			'MOST',
		)
		if (best !== null) return best
	}
	return null
}

const DECK = { ENCOUNTER: 'ENCOUNTER_DECK', INCIDENT: 'INCIDENT_DECK' } as const

/** BOT_ACQUIRE — the Bot gains (→ its Discard pile) or takes (→ the top of its
 *  deck) a card: from the Market by preference (rules/13 §13.10.1), or the
 *  top card of the Encounter / Incident deck. A Market card's resource tokens
 *  go to the Bot and its slot refills. A gain raises CARD_GAINED; a take
 *  never does (docs/effect-dsl.md §6), but taking an ENCOUNTER / INCIDENT
 *  raises ENCOUNTER_TAKEN / INCIDENT_TAKEN like a player's. */
export const botAcquire: Primitive<Node> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const from = node.from ?? 'MARKET'
		if (from === 'MARKET') return marketPick(state, node, ctx) !== null
		return (state.zones[DECK[from]]?.length ?? 0) > 0
	},
	execute(state, node, ctx, _frame) {
		const bot = ctx.actor
		const from = node.from ?? 'MARKET'
		const iid =
			from === 'MARKET'
				? marketPick(state, node, ctx)
				: (state.zones[DECK[from]]?.[0] ?? null)
		if (iid === null) return state
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
		let next = state
		const suit = from === 'MARKET' ? suitOfOffer(next, iid) : undefined
		if (from === 'MARKET') {
			for (const [res, amt] of Object.entries(
				next.cards[iid]!.resourceTokens,
			)) {
				if (amt !== undefined && amt > 0)
					next = gainResource(next, bot, res as ResourceId, amt, {
						via: 'MARKET',
					})
			}
		}
		next = setOwner(next, iid, bot)
		next =
			node.mode === 'GAIN'
				? moveCard(next, iid, { k: 'DISCARD', seat: bot })
				: moveCard(next, iid, { k: 'DRAW', seat: bot }, { toTop: true })
		if (suit !== undefined) next = refillMarket(next, suit)
		next = addLog(next, {
			kind: 'EVENT',
			seat: bot,
			iid,
			message:
				node.mode === 'GAIN'
					? `gained ${iid} (to its Discard pile)`
					: `took ${iid} (onto its deck)`,
		})
		if (from === 'ENCOUNTER')
			next = emit(next, { k: 'ENCOUNTER_TAKEN', iid, seat: bot })
		if (from === 'INCIDENT')
			next = emit(next, { k: 'INCIDENT_TAKEN', iid, seat: bot })
		if (node.mode === 'GAIN' && from === 'MARKET')
			next = emit(next, {
				k: 'CARD_GAINED',
				iid,
				seat: bot,
				dest: 'DISCARD',
				seen: true,
			})
		return next
	},
}
