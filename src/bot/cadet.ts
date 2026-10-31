// The virtual-opponent interceptor + choice policy for Cadet Training
// (rules/10, todo/15 §1). Cadet Training is a SOLO mode: the virtual opponent
// (seat 1) never takes a turn and never owns real cards, so every rule about
// the opponent is answered by THIS module instead of the state.
//
//   * rules/10 §10.2 #3 — the opponent permanently has "one of everything":
//     `opponentResource` / `opponentAwayTeamsAt` / `opponentCardsInPlay` /
//     `opponentHandSize` all answer 1; `opponentShipTokensAt` is the one
//     explicit exception (0). The engine clamps amounts against these, so
//     "steal 3 DIL" steals exactly 1 and "remove up to 2 Away Teams" removes 1.
//   * rules/10 §10.4 — the Cadet's own choices (only reachable when an effect
//     FORCEs seat 1 mid-step) decline everything optional and pick the first
//     legal alternative otherwise: a simple, defensible script — extremes are
//     fine, the rulebook needs no opponent intelligence.
//
// This module deliberately imports engine TYPES only (no values), so the
// engine can import it at runtime without a module cycle: `import type` lines
// are erased at compile time. The cadet pilot in src/engine/intents.ts is the
// runtime consumer, in the spirit of architecture §4's
// `(state, pendingChoice) => selection`.

import type { GameState } from '../engine/state'
import type { PendingChoice } from '../engine/resolver/choices'
import { declineSelection } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import type { ResourceId } from '../data/ids'
import type { CardFilter } from '../engine/resolver/queries'
import type { CardInstanceId } from '../engine/ids'

/** The virtual opponent occupies seat 1; the human is always seat 0 (the cadet
 *  never becomes active — see handOffTurn in phases.ts). */
export const CADET_SEAT = 1 as Seat

/** Is `seat` the virtual opponent in a Cadet Training game? */
export function isCadetOpponent(mode: GameState['mode'], seat: Seat): boolean {
	return mode === 'CADET' && seat === CADET_SEAT
}

// ---------------------------------------------------------------------------
// The query interceptor (rules/10 §10.2 #3) — clamped answer per quantity
// ---------------------------------------------------------------------------

/** The opponent has 1 of every resource. */
export function opponentResource(_res: ResourceId): number {
	return 1
}

/** The opponent has 1 Away Team at *any* Location (rules/10 §10.2 #3). */
export function opponentAwayTeamsAt(_location: string): number {
	return 1
}

/** The one explicit exception: no Ship tokens at any neutral Location. */
export function opponentShipTokensAt(_location: string): number {
	return 0
}

/** The opponent has "one of everything" in play — any card query answers 1.
 *  Extremes are fine here: a Cadet game never inspects the opponent's actual
 *  (empty) cards, only quantities (todo/15 §1). */
export function opponentCardsInPlay(_filter?: CardFilter): number {
	return 1
}

/** The opponent's hand always answers 1. */
export function opponentHandSize(): number {
	return 1
}

// ---------------------------------------------------------------------------
// The Cadet choice policy (the `(state, choice) => selection` spirit)
// ---------------------------------------------------------------------------

/** Deterministic policy for a PendingChoice owned by the Cadet: decline
 *  everything optional, take the FIRST legal alternative otherwise. The engine
 *  validates the result and, if it is ever illegal (defence in depth), falls
 *  back to the probed first legal selection — so a naive pick can never break
 *  a game. */
export function cadetChoice(choice: PendingChoice): unknown {
	// a "you may" asked without a CONFIRM: its decline, like the CONFIRM's No
	const decline = declineSelection(choice)
	if (decline !== undefined) return decline
	switch (choice.k) {
		case 'CONFIRM':
			return false
		case 'CHOOSE_OPTION': {
			const enabled = choice.options.find((o) => o.enabled) ?? choice.options[0]
			if (enabled === undefined) return null
			return { key: enabled.key }
		}
		case 'CHOOSE_CARDS': {
			const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
			return choice.candidates
				.filter((iid: CardInstanceId) => !disabled.has(iid))
				.slice(0, choice.min) as unknown
		}
		case 'CHOOSE_LOCATION':
			return choice.candidates[0] as string
		case 'CHOOSE_SUIT':
			return choice.suits[0] as string
		case 'CHOOSE_TRAIT':
			return choice.traits[0] as string
		case 'CHOOSE_SPECIALTY':
			return choice.specialties[0] as string
		case 'CHOOSE_DESTINATION':
			return (choice.options[0] ?? 'DECK_TOP') as string
		case 'CHOOSE_AMOUNT':
			// Frugal: the virtual opponent does the minimum when it must choose.
			return choice.min
		case 'ORDER_OPERATIONS':
			return choice.pending as unknown
		case 'OPTIONAL_TRIGGERS':
			// The virtual opponent never takes REACTIONs (it has no cards in play).
			return []
		case 'CHOOSE_WITNESS':
			return choice.sets[0] as unknown
		case 'CHOOSE_WILDCARD_AS':
			return choice.traits[0] as string
		case 'ORDER_CARDS':
			return choice.cards as unknown
	}
}
