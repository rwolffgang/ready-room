// The Automated Command cards in play (rules/13 §13.6): registered from the
// catalog at setup, like the card defs (cards.ts `registerCards`). Rows are
// addressed by `AcRowRef` and run as OPERATION frames (resolver/stack.ts), so
// their attacks and the opponent's REACTIONs work like any operation's.

import type { BotCard } from '../../data/schema'
import type { DeckId } from '../../data/ids'
import type { Operation } from '../resolver/nodes'
import type { AcRowRef } from '../state'

const registry = new Map<DeckId, BotCard>()

/** Register every crew's Automated Command cards (idempotent per deck). */
export function registerBots(bots: readonly BotCard[]): void {
	for (const bot of bots) registry.set(bot.deck, bot)
}

/** The Automated Command cards of `deck`, if that crew has a Bot. */
export function botCard(deck: DeckId): BotCard | undefined {
	return registry.get(deck)
}

/** The crews that can be played as the solo Bot. */
export function botDecks(): DeckId[] {
	return [...registry.keys()]
}

/** One row as an operation the stack machine can run (never an ATTACK as a
 *  whole — the red part is a scoped ATTACK node inside the effect). A SURPRISE
 *  ref is resolved from the card's own operation instead (stack.ts). */
export function acRowOperation(ref: AcRowRef): Operation {
	const bot = registry.get(ref.deck)
	if (bot === undefined)
		throw new Error(`no Automated Command cards for ${ref.deck}`)
	let effect
	if ('trait' in ref) effect = bot.traits[ref.trait]?.effect
	else if ('suit' in ref) {
		const row = bot.suits[ref.suit as keyof BotCard['suits']]
		effect = row === undefined ? undefined : ref.do ? row.do : row.noDo
	}
	if (effect === undefined)
		throw new Error(`no Automated Command row ${JSON.stringify(ref)}`)
	return { type: 'PLAY', costsAction: false, isAttack: false, effect }
}
