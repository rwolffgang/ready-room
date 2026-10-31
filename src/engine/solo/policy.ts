// How the official solo Bot answers a choice that lands on it (rules/13
// §13.9, rulings 055–057). Its own rows choose through their nodes and rarely
// ask; what reaches here are choices your cards force on it, and the few
// generic nodes its rows reuse (logging a controlled LOCATION, dismissing its
// own SHIP, putting a SHIP from its Discard pile on top of its deck …):
//
//   - an offered "may" is accepted, except returning an INCIDENT (declined);
//   - from its Discard pile it takes the topmost (most recent) card;
//   - giving up a deployed SHIP: the most recently deployed;
//   - giving up anything else of its own: the least valuable to itself;
//   - a Market card: the most valuable to itself;
//   - removing Away Teams: where it has the fewest tokens;
//   - everything else: the first listed option it legally can.
//
// The engine validates the answer and falls back to the first legal one
// (intents.ts pilot), so a policy gap can never break a game.

import type { PendingChoice } from '../resolver/choices'
import { declineSelection, SKIP_LOCATION } from '../resolver/choices'
import type { Effect } from '../resolver/nodes'
import type { GameState } from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'
import { tokensAt } from '../queries/board'
import { pickByValue } from './value'

/** The node that asked (the suspended EFFECT frame on top of the stack). */
function askingNode(state: GameState): Effect | null {
	const top = state.stack[state.stack.length - 1]
	return top?.k === 'EFFECT' ? top.node : null
}

function returnsIncident(node: Effect | null): boolean {
	if (node === null) return false
	if (node.k === 'RETURN_INCIDENT' || node.k === 'COST_RETURN_INCIDENT')
		return true
	if (node.k === 'MAY') return returnsIncident(node.body)
	return false
}

/** Order card candidates the Bot's way (best first). */
function rankCards(
	state: GameState,
	bot: Seat,
	cands: CardInstanceId[],
): CardInstanceId[] {
	const zones = cands.map((iid) => state.cards[iid]?.zone)
	const all = (k: string) =>
		zones.every((z) => z?.k === k && 'seat' in z && z.seat === bot)
	if (all('DISCARD') || all('FLEET')) {
		// topmost of its Discard pile / most recently deployed: the last in zone order
		const order = state.zones[`${zones[0]!.k}:${bot}`] ?? []
		return [...cands].sort((a, b) => order.indexOf(b) - order.indexOf(a))
	}
	const want =
		zones.every((z) => z?.k === 'MARKET_OFFER') ? 'MOST' : 'LEAST'
	const out: CardInstanceId[] = []
	const rest = [...cands]
	while (rest.length > 0) {
		const best = pickByValue(state, rest, bot, want)!
		out.push(best)
		rest.splice(rest.indexOf(best), 1)
	}
	return out
}

/** The Bot's answer to `choice` (it owns it: `choice.seat` is the Bot). */
export function soloChoice(state: GameState, choice: PendingChoice): unknown {
	const bot = choice.seat
	const node = askingNode(state)
	if (choice.mayDecline === true && returnsIncident(node))
		return declineSelection(choice)
	switch (choice.k) {
		case 'CONFIRM':
			return !returnsIncident(node)
		case 'CHOOSE_OPTION': {
			const enabled = choice.options.find((o) => o.enabled)
			return enabled === undefined ? null : { key: enabled.key }
		}
		case 'CHOOSE_CARDS': {
			const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
			const legal = choice.candidates.filter((iid) => !disabled.has(iid))
			const n = Math.max(choice.min, Math.min(1, choice.max))
			return rankCards(state, bot, legal).slice(0, n)
		}
		case 'CHOOSE_LOCATION': {
			const locs = choice.candidates.filter((c) => c !== SKIP_LOCATION)
			if (locs.length === 0) return SKIP_LOCATION
			// giving up Away Teams: where it has the fewest tokens, least valuable
			const fewest = Math.min(...locs.map((l) => tokensAt(state, l, bot)))
			return (
				pickByValue(
					state,
					locs.filter((l) => tokensAt(state, l, bot) === fewest),
					bot,
					'LEAST',
				) ?? locs[0]
			)
		}
		case 'CHOOSE_SUIT':
			return choice.suits[0]
		case 'CHOOSE_TRAIT':
			return choice.traits[0]
		case 'CHOOSE_SPECIALTY':
			return choice.specialties[0]
		case 'CHOOSE_DESTINATION':
			// a Bot gain goes to its Discard pile (rules/13 §13.10.1)
			return choice.options.includes('DISCARD') ? 'DISCARD' : choice.options[0]
		case 'CHOOSE_AMOUNT':
			return choice.min
		case 'ORDER_OPERATIONS':
			return choice.pending
		case 'OPTIONAL_TRIGGERS':
			// the Bot's cards are inert: it never takes a REACTION
			return []
		case 'CHOOSE_WITNESS':
			return choice.sets[0]
		case 'CHOOSE_WILDCARD_AS':
			return choice.traits[0]
		case 'ORDER_CARDS':
			return choice.cards
	}
}
