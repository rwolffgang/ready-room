// Which Automated Command row resolves a card (rules/13 §13.6.1): its own
// SURPRISE operation if it has the SURPRISE trait; otherwise the first TRAITS
// row naming one of its traits (a WILDCARD card takes the first row);
// otherwise the SUITS row for its printed suit, on the side the Bot's Duty
// Officer decides. The Bot ignores card text, so printed suit and printed
// traits are all that count (ruling 057) — plus traits granted by an
// attached layer, which are the board's doing, not the card's.

import { cardDef } from '../cards'
import { effectiveTraits } from '../queries/traits'
import { botCard } from './acRegistry'
import type { AcRowRef, GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'

/** The row `iid` resolves for the Bot at `bot`, or null when the crew has no
 *  Automated Command cards or the card fits no row. */
export function classify(
	state: GameState,
	iid: CardInstanceId,
	bot: Seat,
): AcRowRef | null {
	const crew = state.solo?.crew
	const card = state.cards[iid]
	if (crew === undefined || card === undefined) return null
	const def = cardDef(card.def)
	if (def.traits.includes('SURPRISE')) {
		const op = def.operations.findIndex((o) => o.type === 'SURPRISE')
		if (op >= 0) return { deck: crew, surprise: true }
	}
	const ac = botCard(crew)
	if (ac === undefined) return null
	const traits = effectiveTraits(state, iid)
	if (traits.includes('WILDCARD')) return { deck: crew, trait: 0 }
	const trait = ac.traits.findIndex((row) =>
		row.match.some((t) => traits.includes(t)),
	)
	if (trait >= 0) return { deck: crew, trait }
	if (!(def.suit in ac.suits)) return null
	const hasDo = (state.zones[`DUTY_OFFICER:${bot}`]?.length ?? 0) > 0
	return { deck: crew, suit: def.suit, do: hasDo }
}
