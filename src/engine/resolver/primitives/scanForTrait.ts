import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { suspend, answered, answer, gainResource } from '../runtime'
import { matchTrait } from '../../queries/traits'
import { zonesOf, moveCard } from '../../state'
import { shuffle } from '../../rng'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { MarketSuit, TraitId } from '../../../data/ids'
import { finish as gainFinish } from './gainCard'
import { MARKET_SUITS_FOUR } from '../../market'

/** SCAN_FOR_TRAIT — four-step search (rules/05 §5.4.3, rules/08 → scan):
 *  1. any faceup Market card with the trait → gain one, done;
 *  2. (includeJunk only) the Junk pile, *after* the Market but *before* the
 *     decks — optional; declining proceeds;
 *  3. CHOOSE_SUIT, then reveal from that deck's top until a match is found:
 *     → gain it and shuffle the other revealed cards back into the deck;
 *     → deck exhausted → those cards go back (shuffled) and another of the
 *       remaining suits is searched;
 *  4. nothing found in any of the four → gain 2 Glory instead.
 * The trait is fixed by CHOOSE_TRAIT issued once up front — you cannot change
 * which trait you scan for once you start looking through a deck
 * (rules/05 §5.4.3). The match uses allowWildcard: true (it is a benefit).
 *
 * Ruling on "shuffle the other revealed cards back into the deck": the
 * revealed-but-unmatched cards of the searched deck are shuffled (deterministic
 * rng) and placed back on top of that deck; the deck's unsearched remainder is
 * untouched (the printed steps don't say where they land — rules/05 §5.4.3). */
export const scanForTrait: Primitive<Extract<Effect, { k: 'SCAN_FOR_TRAIT' }>> =
	{
		isCost: false,
		canResolve: () => true, // the 2-Glory consolation means it can always resolve
		execute(state, node, ctx, _frame) {
			const destKey = 'scanForTrait.dest'
			const traitKey = 'scanForTrait.trait'
			const marketKey = 'scanForTrait.market'
			const junkKey = 'scanForTrait.junk'
			const suitKey = 'scanForTrait.suit'

			// (0) destination answered → place the scanned card there (rules/05 §5.4.3:
			//     deck top OR Discard).
			if (answered(ctx, destKey)) {
				const picked = ctx.bindings['$scanForTrait.picked']
				if (typeof picked !== 'string')
					throw new Error(
						'SCAN_FOR_TRAIT: destination answered without a picked card',
					)
				return gainFinish(
					state,
					ctx.actor,
					picked as CardInstanceId,
					answer<'DECK_TOP' | 'DISCARD'>(ctx, destKey),
				)
			}

			// (a) pick the trait once, up front.
			const traits = [...new Set(node.traits)]
			if (traits.length > 1 && !answered(ctx, traitKey)) {
				return suspend(state, node, ctx, traitKey, {
					k: 'CHOOSE_TRAIT',
					traits,
					prompt: 'Scan for which trait?',
				})
			}
			const trait =
				traits.length > 1 ? answer<TraitId>(ctx, traitKey) : traits[0]!

			// (b) step 1 — faceup Market card with the trait: gain one, done.
			const market = marketMatches(state, trait)
			if (market.length > 0) {
				const got = gainOne(
					state,
					node,
					ctx,
					marketKey,
					'Gain a matching Market card?',
					market,
					1,
				)
				if (typeof got === 'object') return got // published choice
				if (got === 'DECLINED') return state
				return placeOrAsk(state, node, ctx, got)
			}

			// (c) step 2 (includeJunk only) — the Junk pile, optional: an empty
			//     selection is the legal "decline, proceed to the decks".
			if (node.includeJunk === true) {
				const junk = junkMatchesOf(state, trait)
				const got = gainOne(
					state,
					node,
					ctx,
					junkKey,
					'Gain a matching card from the Junk pile?',
					junk,
					0,
				)
				if (typeof got === 'object') return got
				if (got !== 'DECLINED') {
					return placeOrAsk(state, node, ctx, got)
				}
			}

			// (d) step 3 — search the four decks, one suit at a time (player's order).
			const remaining: MarketSuit[] = (ctx.bindings['$scanTrait.remaining'] as
				MarketSuit[] | undefined) ?? [...MARKET_SUITS_FOUR]
			if (answered(ctx, suitKey)) {
				const suit = answer<MarketSuit>(ctx, suitKey)
				const search = scanDeck(state, ctx, suit, trait)
				if (search.found)
					return placeOrAsk(search.state, node, ctx, search.picked!)
				const rest = remaining.filter((s) => s !== suit)
				if (rest.length === 0)
					return gainResource(search.state, ctx.actor, 'GLO', 2)
				return suspend(
					search.state,
					node,
					ctx,
					suitKey,
					{
						k: 'CHOOSE_SUIT',
						suits: rest,
						prompt: 'Scan which deck next?',
					},
					{ '$scanTrait.remaining': rest },
				)
			}
			if (remaining.length === 0)
				return gainResource(state, ctx.actor, 'GLO', 2)
			return suspend(
				state,
				node,
				ctx,
				suitKey,
				{
					k: 'CHOOSE_SUIT',
					suits: remaining,
					prompt: 'Scan which deck?',
				},
				{ '$scanTrait.remaining': remaining },
			)
		},
	}

/** Gain the scanned card, letting the player choose where it goes: the deck
 *  top or the Discard pile unless the effect narrows it to one (rules/05
 *  §5.4.3, §5.4.5). The CHOOSE_DESTINATION is also where the player sees the
 *  card they scanned out of a face-down deck. The picked card is stored on the
 *  shared ctx so the resume knows what moved. */
function placeOrAsk(
	state: GameState,
	node: Effect & { k: 'SCAN_FOR_TRAIT' },
	ctx: EffectCtx,
	picked: CardInstanceId,
): GameState {
	if (node.bind !== undefined) ctx.bindings[node.bind] = picked
	const dests = node.to ?? ['DECK_TOP', 'DISCARD']
	if (dests.length <= 1)
		return gainFinish(state, ctx.actor, picked, dests[0] ?? 'DECK_TOP')
	return suspend(
		state,
		node,
		ctx,
		'scanForTrait.dest',
		{
			k: 'CHOOSE_DESTINATION',
			prompt: 'Place the scanned card?',
			card: picked,
			options: dests,
		},
		{ '$scanForTrait.picked': picked },
	)
}

/** Publish a CHOOSE_CARDS for one card (min 0 or 1). Returns:
 *  - a GameState = a choice was just published (the caller MUST return it);
 *  - a CardInstanceId = the picked card (auto-selected);
 *  - 'DECLINED' = no candidates, or the player later answered empty. On a
 *    resumed selection this key is answered, so a later execute handles it. */
function gainOne(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	key: string,
	prompt: string,
	candidates: CardInstanceId[],
	min: number,
): GameState | CardInstanceId | 'DECLINED' {
	if (answered(ctx, key)) {
		const sel = answer<CardInstanceId[]>(ctx, key)
		if (sel.length === 0) return 'DECLINED'
		return sel[0] ?? 'DECLINED'
	}
	if (candidates.length === 0) return 'DECLINED'
	if (candidates.length === 1 && min === 1) return candidates[0]!
	return suspend(state, node, ctx, key, {
		k: 'CHOOSE_CARDS',
		prompt,
		candidates,
		min,
		max: 1,
		from: 'MARKET',
	})
}

function marketMatches(state: GameState, trait: TraitId): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const suit of MARKET_SUITS_FOUR) {
		for (const iid of zonesOf(state, { k: 'MARKET_OFFER', suit })) {
			if (
				matchTrait(state, iid, trait, {
					allowWildcard: true,
					actorMayOptIn: true,
				})
			)
				out.push(iid)
		}
	}
	return out
}

function junkMatchesOf(state: GameState, trait: TraitId): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const iid of zonesOf(state, { k: 'JUNK' })) {
		if (
			matchTrait(state, iid, trait, {
				allowWildcard: true,
				actorMayOptIn: true,
			})
		)
			out.push(iid)
	}
	return out
}

/** Search `suit`'s deck top-down for the first card with the trait. The
 *  unmatched revealed cards are shuffled back on top; a deck with no match has
 *  its whole revealed face shuffled back on top. `found` reports whether a
 *  match exists and `picked` is that card — NOT yet gained, so the caller can
 *  offer the §5.4.3 destination before placement. */
function scanDeck(
	state: GameState,
	_ctx: EffectCtx,
	suit: MarketSuit,
	trait: TraitId,
): { state: GameState; found: boolean; picked?: CardInstanceId | undefined } {
	const deck = zonesOf(state, { k: 'MARKET_DECK', suit })
	const matchedIndex = deck.findIndex((iid) =>
		matchTrait(state, iid, trait, { allowWildcard: true, actorMayOptIn: true }),
	)
	const unmatched = matchedIndex === -1 ? deck : deck.slice(0, matchedIndex)
	let next = state
	if (unmatched.length > 0) {
		const [shuffled, rng] = shuffle(unmatched, next.rng)
		next = { ...next, rng }
		for (let i = shuffled.length - 1; i >= 0; i--) {
			next = moveCard(
				next,
				shuffled[i]!,
				{ k: 'MARKET_DECK', suit },
				{ toTop: true },
			)
		}
	}
	return {
		state: next,
		found: matchedIndex !== -1,
		picked: matchedIndex === -1 ? undefined : deck[matchedIndex],
	}
}
