// Where the solo Bot puts its tokens (rules/13 §13.11): which neutral
// LOCATION it sends an Away Team to, which one a SHIP explores or engages,
// which one it pulls an Away Team back from, and which one it takes control
// of. Every pick is deterministic: a primary count, then the most (or least)
// valuable to the Bot, then the leftmost.

import { otherSeat, type GameState } from '../state'
import { isSecured, shipTokensAt, tokensAt } from '../queries/board'
import { blocksSendsTo } from '../modifiers'
import { matchTrait } from '../queries/traits'
import { pickByValue } from './value'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'
import type { TraitId } from '../../data/ids'

/** The Neutral Zone's LOCATIONs, left to right. */
export function neutralLocations(state: GameState): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const slot of [0, 1, 2]) out.push(...(state.zones[`NEUTRAL_ZONE:${slot}`] ?? []))
	return out
}

/** "More than enough to secure it": 4+ Bot tokens and 3+ more than the
 *  opponent — the Bot never adds tokens there (rules/13 §13.11.1). */
export function overSecured(
	state: GameState,
	loc: CardInstanceId,
	bot: Seat,
): boolean {
	const mine = tokensAt(state, loc, bot)
	return mine >= 4 && mine - tokensAt(state, loc, otherSeat(bot)) >= 3
}

/** Among `locs`, those with the highest `count`; null-safe on empty lists. */
function maxBy(
	locs: CardInstanceId[],
	count: (loc: CardInstanceId) => number,
): CardInstanceId[] {
	if (locs.length === 0) return []
	const best = Math.max(...locs.map(count))
	return locs.filter((loc) => count(loc) === best)
}

/** Where an Away Team goes (rules/13 §13.11.3): a legal neutral LOCATION —
 *  not over-secured, not one where the opponent has more Ship tokens (unless
 *  `ignoreShips`), not one whose own text forbids sends — preferring the
 *  traits in `prefer` in order, then the most Bot tokens, then the most
 *  valuable. Null when there is none. */
export function sendTarget(
	state: GameState,
	bot: Seat,
	opts: { prefer?: readonly TraitId[] | undefined; ignoreShips?: boolean | undefined } = {},
): CardInstanceId | null {
	const legal = neutralLocations(state).filter(
		(loc) =>
			!overSecured(state, loc, bot) &&
			!blocksSendsTo(state, loc) &&
			(opts.ignoreShips === true ||
				shipTokensAt(state, loc, otherSeat(bot)) <=
					shipTokensAt(state, loc, bot)),
	)
	const pick = (locs: CardInstanceId[]) =>
		pickByValue(
			state,
			maxBy(locs, (loc) => tokensAt(state, loc, bot)),
			bot,
			'MOST',
		)
	for (const trait of opts.prefer ?? []) {
		const withTrait = legal.filter((loc) =>
			matchTrait(state, loc, trait, {
				allowWildcard: false,
				actorMayOptIn: false,
			}),
		)
		if (withTrait.length > 0) return pick(withTrait)
	}
	return pick(legal)
}

/** "It explores": the neutral LOCATION with the fewest tokens in total;
 *  "it engages": the one where the opponent has the most tokens. Ties go to
 *  the most valuable (rules/13 §13.11.2). */
export function warpTarget(
	state: GameState,
	bot: Seat,
	how: 'EXPLORE' | 'ENGAGE',
): CardInstanceId | null {
	const opp = otherSeat(bot)
	const locs = neutralLocations(state).filter(
		(loc) => !overSecured(state, loc, bot),
	)
	const best =
		how === 'EXPLORE'
			? maxBy(locs, (loc) => -(tokensAt(state, loc, bot) + tokensAt(state, loc, opp)))
			: maxBy(locs, (loc) => tokensAt(state, loc, opp))
	return pickByValue(state, best, bot, 'MOST')
}

/** With no Away Team left on its Captain, the Bot pulls one back from the
 *  LOCATION where it has the fewest tokens (never the target); ties go to the
 *  least valuable to the Bot (rules/13 §13.11.3). */
export function pullSource(
	state: GameState,
	bot: Seat,
	target: CardInstanceId,
): CardInstanceId | null {
	const sources = Object.keys(state.awayTeamsAt).filter(
		(loc) =>
			loc !== target && (state.awayTeamsAt[loc]?.[bot] ?? 0) > 0,
	) as CardInstanceId[]
	return pickByValue(
		state,
		maxBy(sources, (loc) => -tokensAt(state, loc, bot)),
		bot,
		'LEAST',
	)
}

/** "Take control of the neutral LOCATION with most Bot tokens (minimum 1)";
 *  ties go to the most valuable. */
export function mostHeldLocation(
	state: GameState,
	bot: Seat,
): CardInstanceId | null {
	const held = neutralLocations(state).filter(
		(loc) => tokensAt(state, loc, bot) >= 1,
	)
	return pickByValue(
		state,
		maxBy(held, (loc) => tokensAt(state, loc, bot)),
		bot,
		'MOST',
	)
}

/** The neutral LOCATIONs the Bot has secured, the most valuable first — its
 *  Control step takes the first (rules/13 §13.4). */
export function securedByBot(
	state: GameState,
	bot: Seat,
): CardInstanceId | null {
	return pickByValue(
		state,
		neutralLocations(state).filter((loc) => isSecured(state, loc, bot)),
		bot,
		'MOST',
	)
}
