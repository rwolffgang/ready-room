// The card a Bot node acts on (`BOT_DEPLOY` / `BOT_PROMOTE` target): "this
// card" while it is still being resolved, the topmost card of a suit in the
// Bot Discard pile (rules/13 §13.8), or a card an earlier step bound ("the
// gained SHIP").

import { cardDef } from '../cards'
import type { EffectCtx, GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { Suit } from '../../data/ids'

export type BotTarget = 'THIS' | 'DISCARD' | { bound: string }

export function botTargetCard(
	state: GameState,
	target: BotTarget,
	ctx: EffectCtx,
	suit: Suit,
): CardInstanceId | null {
	const bot = ctx.actor
	const isSuit = (iid: CardInstanceId) =>
		state.cards[iid] !== undefined && cardDef(state.cards[iid]!.def).suit === suit
	if (target === 'THIS') {
		const iid = ctx.source
		const zone = state.cards[iid]?.zone
		return zone?.k === 'STAGING' && zone.seat === bot && isSuit(iid)
			? iid
			: null
	}
	if (target === 'DISCARD') {
		const pile = state.zones[`DISCARD:${bot}`] ?? []
		for (let i = pile.length - 1; i >= 0; i--)
			if (isSuit(pile[i]!)) return pile[i]!
		return null
	}
	const bound = ctx.bindings[target.bound]
	if (typeof bound !== 'string') return null
	const iid = bound as CardInstanceId
	return state.cards[iid]?.owner === bot && isSuit(iid) ? iid : null
}
