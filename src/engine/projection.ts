// Projection for hot-seat hidden information (todo/14 §1, docs/architecture.md
// §5). The engine keeps hidden information in the state; the UI never sees the
// raw state — every component reads `project(state, viewerSeat)` (via the
// store's `useProjected`). It lives in the engine (DOM-free) so the online
// server can run it too; src/ui/projection.ts re-exports it. The wire view the
// server actually sends (seat-masked iids, no RNG, no stack) is built on top
// of this in src/engine/seatView.ts.
//
// What is hidden:
//   - facedown decks (DRAW / RESERVE of both players, plus the shared
//     MARKET_DECK / ENCOUNTER_DECK / INCIDENT_DECK / LOCATION_DECK) — the
//     zone-properties table marks these visibleTo 'NONE' (even their owner
//     does not know the order);
//   - a player's HAND / LOG is visibleTo 'OWNER', so the opponent's hand and
//     Captain's Log collapse to face-down cards (count preserved).
//
// `project` returns a deep copy: mutating the projection can never reach the
// real game state. Hidden cards keep their iid + zone + owner (so counts and
// zone layout still work) but their def (and any leaked card state) is
// replaced by the HIDDEN_DEF sentinel, which the renderer draws as a card back.

import type { GameState } from './state'
import { zoneProps } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'
import type { CardInstance } from './state'

/** Sentinel def id for a face-down card. */
export const HIDDEN_DEF = '__HIDDEN__'

/** Deep-readonly that distributes over unions and preserves tuples. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
	? T
	: T extends string | number | boolean | bigint | symbol
		? T
		: T extends readonly [unknown, ...unknown[]]
			? { readonly [K in keyof T]: DeepReadonly<T[K]> }
			: T extends readonly (infer U)[]
				? readonly DeepReadonly<U>[]
				: T extends object
					? { readonly [K in keyof T]: DeepReadonly<T[K]> }
					: T

export type ProjectedState = DeepReadonly<GameState>

function isHiddenTo(instance: CardInstance, viewerSeat: Seat): boolean {
	const visibility = zoneProps(instance.zone).visibleTo
	if (visibility === 'ALL') return false
	if (visibility === 'NONE') return true
	// visibleTo 'OWNER'
	return instance.owner !== viewerSeat
}

/** A face-down copy of a card: only iid / zone / owner survive. */
function hideCard(card: CardInstance, iid: CardInstanceId): CardInstance {
	return {
		iid,
		def: HIDDEN_DEF,
		owner: card.owner,
		zone: card.zone,
		exhausted: false,
		actionTokens: 0,
		beamedTo: null,
		resourceTokens: {},
		shipTokenAt: null,
		wildcardAs: null,
	}
}

/** Cards the pending choice puts in front of `viewerSeat` — "look at the top
 *  N" / scan reveals (SCAN_N, ARRANGE_DECK, TAKE look) choose among or order
 *  cards that still sit in a face-down deck, and the chooser has to see them.
 *  Candidates the engine flags `hidden` (a blind deck-top gain) stay down. */
function shownByChoice(state: GameState, viewerSeat: Seat): Set<string> {
	const choice = state.pendingChoice
	if (choice === null || choice.seat !== viewerSeat) return new Set()
	switch (choice.k) {
		case 'CHOOSE_CARDS': {
			const hidden = new Set<string>(choice.hidden ?? [])
			return new Set(
				[
					...choice.candidates,
					...(choice.disabled ?? []).map((d) => d.iid),
				].filter((iid) => !hidden.has(iid)),
			)
		}
		case 'ORDER_CARDS':
			return new Set(choice.cards)
		// "you may beam …": the cards the follow-up choice would show — when
		// there is only one, that choice never comes
		case 'CONFIRM':
			return new Set([
				...(choice.preview?.cards ?? []),
				...(choice.preview?.onto ?? []),
			])
		default:
			return new Set()
	}
}

/** Build the viewer's view of the state (deep copy, hidden info stripped).
 *  `revealAll` is the dev/debug escape hatch (todo/15 §2 last bullet): it
 *  skips every hide so a hot-seat dev can see both hands at once. Kept off by
 *  default; the whole projection stays untouched when it's false. */
export function project(
	state: GameState,
	viewerSeat: Seat,
	revealAll = false,
): ProjectedState {
	const root = structuredClone(state) as unknown as GameState
	if (!revealAll) {
		const shown = shownByChoice(state, viewerSeat)
		for (const [iid, card] of Object.entries(root.cards)) {
			if (isHiddenTo(card, viewerSeat) && !shown.has(iid)) {
				root.cards[iid] = hideCard(card, iid as CardInstanceId)
			}
		}
	}
	return root as ProjectedState
}

/** Is `iid`'s card face hidden from `viewerSeat` right now? Used to draw card
 *  backs even over the *raw* state browse paths (defensive — most callers pass
 *  the projection and rely on HIDDEN_DEF). */
export function isHidden(
	state: GameState,
	iid: string,
	viewerSeat: Seat,
): boolean {
	const card = state.cards[iid]
	return (
		card !== undefined &&
		isHiddenTo(card, viewerSeat) &&
		!shownByChoice(state, viewerSeat).has(iid)
	)
}

/** Every card whose face `viewerSeat` cannot see right now — exactly the set
 *  `project` replaces with HIDDEN_DEF (the pending choice's own shown cards
 *  excluded). The online server masks these ids and diffs the set before/after
 *  an intent to detect reveals (src/engine/seatView.ts). */
export function hiddenCards(
	state: GameState,
	viewerSeat: Seat,
): Set<CardInstanceId> {
	const shown = shownByChoice(state, viewerSeat)
	const out = new Set<CardInstanceId>()
	for (const [iid, card] of Object.entries(state.cards)) {
		if (isHiddenTo(card, viewerSeat) && !shown.has(iid))
			out.add(iid as CardInstanceId)
	}
	return out
}
