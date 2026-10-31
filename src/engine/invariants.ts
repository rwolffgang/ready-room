// Legal-state invariants (todo/16 §4). `assertInvariants(state, {since})`
// checks the global invariants the engine must maintain after every accepted
// intent (and, where `since` is given, across the intent — for the
// "awayTeamsTotal never decreases" claim). The fuzz suite asserts it after
// every intent; dev/test builds keep ASSERT_INVARIANTS on, and production
// builds flip it off (each check below early-returns).
//
// Every failure message names the violated invariant, the offending values and
// ideally the culprit card/zone, so a fuzz hit reads as a precise bug report.
//
// NOTE — the §4 action invariant "available + spent === 3 + gainedThisTurn"
// is NOT expressible from the state: spendAction moves one action from
// `available` to `spent` (the UI's used-action tray), gainAction increments
// `available`, but there is no per-turn gains counter on PlayerState. The
// checkable form is the floor the engine actually guarantees: a non-negative
// integer budget. This deviation is flagged in the todo/16 report.

import type { GameState } from './state'
import { zoneKey, zoneProps } from './state'
import { cardDef } from './cards'
import type { CardInstanceId } from './ids'

/** Dev/test gate: assert after every intent in the fuzz; off in production
 *  builds (todo/16 §4). */
export const ASSERT_INVARIANTS = true

/** The stack never legitimately grows near this deep — one `executeOne` may
 *  push at most MAX_PUSH_PER_STEP (600) frames, and real phases schedule a
 *  handful. A state bearing a larger stack means a runaway frame producer that
 *  somehow dodged the run-loop cap. */
const MAX_STACK_DEPTH = 600
/** REACTION_WINDOW frames are capped at MAX_REACTION_DEPTH (20) by
 *  drainEvents; mirror that constant here. */
const MAX_REACTION_WINDOWS = 20

export interface InvariantOptions {
	/** The pre-intent state, when known, for cross-boundary claims
	 *  ("awayTeamsTotal never decreases" per seat). */
	since?: GameState | undefined
}

export function assertInvariants(
	state: GameState,
	opts: InvariantOptions = {},
): void {
	if (ASSERT_INVARIANTS !== true) return
	assertCardConservation(state)
	assertAwayTeams(state, opts.since)
	assertShipTokens(state)
	assertActions(state)
	assertSpecialties(state)
	assertResources(state)
	assertBeamedCards(state)
	assertStack(state)
	assertSoloBot(state)
	assertStateSerialisable(state)
}

// ---------------------------------------------------------------------------
// The official solo Bot (rules/13): it never holds a hand, takes no action
// tokens, and its face-down Staging row exists only during its own turn.
// ---------------------------------------------------------------------------

function assertSoloBot(state: GameState): void {
	if (state.mode !== 'SOLO' || state.solo === undefined) return
	const bot = state.solo.bot
	if ((state.zones[`HAND:${bot}`]?.length ?? 0) > 0)
		throw new Error('solo Bot: it holds cards in hand')
	if (state.players[bot]!.actions.available !== 0)
		throw new Error('solo Bot: it has action tokens')
	if (state.phase.k !== 'BOT' && (state.zones[`BOT_ROW:${bot}`]?.length ?? 0) > 0)
		throw new Error('solo Bot: its Staging row outlived its turn')
}

// ---------------------------------------------------------------------------
// Card conservation — every CardInstanceId in exactly one zone; the total
// number of instances is constant (DESTROY → BOX is still a zone, never a
// deletion), and each card's own zone ref maps back to the zone that lists it.
// ---------------------------------------------------------------------------

function assertCardConservation(state: GameState): void {
	const seen = new Set<string>()
	let zoned = 0
	for (const [key, iids] of Object.entries(state.zones)) {
		for (const iid of iids) {
			const card = state.cards[iid]
			if (card === undefined) {
				throw new Error(
					`card conservation: ${iid} is listed in zone ${key} but has no CardInstance`,
				)
			}
			if (seen.has(iid)) {
				throw new Error(`card conservation: ${iid} sits in two zones (${key})`)
			}
			seen.add(iid)
			zoned++
		}
	}
	for (const [iid, card] of Object.entries(state.cards)) {
		if (!seen.has(iid)) {
			throw new Error(
				`card conservation: ${iid} (${card.def}) is in state.cards but in no zone`,
			)
		}
		const expectedKey = zoneKey(card.zone)
		if (
			expectedKey !== undefined &&
			(state.zones[expectedKey] ?? []).indexOf(iid as CardInstanceId) === -1
		) {
			throw new Error(
				`card conservation: ${iid} claims zone ${JSON.stringify(card.zone)} (key ${expectedKey}) but is not listed there`,
			)
		}
	}
	if (zoned !== Object.keys(state.cards).length) {
		throw new Error(
			`card conservation: ${zoned} zone entries for ${Object.keys(state.cards).length} instances`,
		)
	}
}

// ---------------------------------------------------------------------------
// Away Teams — pool + all Locations for a seat === that seat's awayTeamsTotal,
// which never decreases (rules/08 → send/remove; tokens only move between the
// Captain card and Locations). The resolver asserts the global sum per
// primitive; this is the per-seat, per-intent form.
// ---------------------------------------------------------------------------

function assertAwayTeams(state: GameState, since: GameState | undefined): void {
	for (const pl of state.players) {
		const seat = pl.seat
		let atSeat = 0
		for (const counts of Object.values(state.awayTeamsAt)) {
			atSeat += counts[seat] ?? 0
		}
		if (atSeat < 0 || pl.awayTeamsInPool < 0 || pl.awayTeamsTotal < 0) {
			throw new Error(
				`away-team invariant: negative token count for seat ${seat} (pool ${pl.awayTeamsInPool}, locations ${atSeat})`,
			)
		}
		if (pl.awayTeamsInPool + atSeat !== pl.awayTeamsTotal) {
			throw new Error(
				`away-team conservation for seat ${seat}: pool ${pl.awayTeamsInPool} + locations ${atSeat} = ${pl.awayTeamsInPool + atSeat}, awayTeamsTotal ${pl.awayTeamsTotal}`,
			)
		}
		if (since !== undefined) {
			const before = since.players[seat]?.awayTeamsTotal ?? pl.awayTeamsTotal
			if (pl.awayTeamsTotal < before) {
				throw new Error(
					`away-team invariant: awayTeamsTotal for seat ${seat} fell from ${before} to ${pl.awayTeamsTotal}`,
				)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Ship tokens — each deployed SHIP's token is in exactly one place: on its
// card (null), at a Location, or in the supply ('SUPPLY'); never two. A token
// parked at a Location must point at an in-play Location while the ship is
// deployed; a deployed ship's token is never in the supply.
// ---------------------------------------------------------------------------

function assertShipTokens(state: GameState): void {
	for (const [iid, card] of Object.entries(state.cards)) {
		if (cardDef(card.def).suit !== 'SHIP') continue
		const tok = card.shipTokenAt
		const iidStr = iid as CardInstanceId
		if (tok === 'SUPPLY') {
			if (card.zone.k === 'FLEET') {
				throw new Error(
					`ship-token invariant: deployed ship ${iidStr} has its token in the supply`,
				)
			}
			continue
		}
		if (tok === null || tok === iidStr) continue // null = on the card; self refs tolerated for raw test states
		const loc = state.cards[tok]
		if (loc === undefined) {
			throw new Error(
				`ship-token invariant: ${iidStr} has its token at missing card ${tok}`,
			)
		}
		const zone = loc.zone
		if (zone.k !== 'NEUTRAL_ZONE' && zone.k !== 'LOCATION_AREA') {
			throw new Error(
				`ship-token invariant: ${iidStr} has its token at ${tok}, which is in ${zone.k}, not a Location`,
			)
		}
		if (card.zone.k !== 'FLEET') {
			throw new Error(
				`ship-token invariant: non-deployed ship ${iidStr} has its token at a Location`,
			)
		}
	}
}

// ---------------------------------------------------------------------------
// Actions — the budget fields are never negative integers. (The literal §4
// "available + spent === 3 + gainedThisTurn" is uncheckable as written — see
// the module note: spent is never incremented by the engine.)
// ---------------------------------------------------------------------------

function assertActions(state: GameState): void {
	for (const pl of state.players) {
		const { available, spent } = pl.actions
		if (
			available < 0 ||
			!Number.isInteger(available) ||
			spent < 0 ||
			!Number.isInteger(spent)
		) {
			throw new Error(
				`actions invariant: seat ${pl.seat} budget (available ${available}, spent ${spent}) is negative or non-integer`,
			)
		}
	}
}

// ---------------------------------------------------------------------------
// Specialty tracks — 0..15 (rules/07 §7.1, advanceSpecialty clamps at 15).
// ---------------------------------------------------------------------------

function assertSpecialties(state: GameState): void {
	for (const pl of state.players) {
		for (const name of ['RESEARCH', 'INFLUENCE', 'MILITARY'] as const) {
			const v = pl.specialties[name]
			if (!Number.isInteger(v) || v < 0 || v > 15) {
				throw new Error(
					`specialty invariant: seat ${pl.seat} ${name} = ${v}, outside 0..15`,
				)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Resources — never negative (payResource guards spends).
// ---------------------------------------------------------------------------

function assertResources(state: GameState): void {
	for (const pl of state.players) {
		for (const name of ['DIL', 'LAT', 'GLO'] as const) {
			const v = pl.resources[name]
			if (!Number.isInteger(v) || v < 0) {
				throw new Error(
					`resource invariant: seat ${pl.seat} ${name} = ${v}, never negative`,
				)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Beamed cards — a beamed card's beamedTo points at its zone host, the host
// exists and is in play, and host chains are acyclic. A non-beamed card never
// carries a beamedTo pointer.
// ---------------------------------------------------------------------------

function assertBeamedCards(state: GameState): void {
	for (const [iid, card] of Object.entries(state.cards)) {
		const iidStr = iid as CardInstanceId
		if (card.zone.k === 'BEAMED') {
			const host = card.beamedTo
			if (host !== card.zone.host) {
				throw new Error(
					`beamed invariant: ${iidStr} zone host is '${card.zone.host}' but beamedTo is '${String(host)}'`,
				)
			}
			if (host === iidStr) {
				throw new Error(`beamed invariant: ${iidStr} is beamed to itself`)
			}
			const hostCard = state.cards[host]
			if (hostCard === undefined) {
				throw new Error(
					`beamed invariant: ${iidStr} is beamed to missing host '${host}'`,
				)
			}
			if (!zoneProps(hostCard.zone).inPlay) {
				throw new Error(
					`beamed invariant: ${iidStr} is beamed to non-in-play host '${host}'`,
				)
			}
		} else if (card.beamedTo !== null) {
			throw new Error(
				`beamed invariant: ${iidStr} is in ${card.zone.k} but carries beamedTo '${card.beamedTo}'`,
			)
		}
	}
	// Acyclicity: walk each beamed card up its host chain; a repeat visit inside
	// one walk is a cycle. Hosts cite by CardInstanceId and a card can be beamed
	// at most once, so a finite visited set per walk bounds this tightly.
	for (const start of Object.keys(state.cards)) {
		const visiting = new Set<CardInstanceId>()
		let next: string | undefined = start
		while (next !== undefined) {
			const card: GameState['cards'][string] | undefined = state.cards[next]
			if (card === undefined || card.zone.k !== 'BEAMED') break
			if (visiting.has(next as CardInstanceId)) {
				throw new Error(
					`beamed invariant: cycle at ${next} while walking from ${start}`,
				)
			}
			visiting.add(next as CardInstanceId)
			next = card.zone.host
		}
	}
}

// ---------------------------------------------------------------------------
// The stack — never deeper than the nesting cap and never non-empty while a
// phase is idle (no pending choice, no result). runCollecting halts only on an
// empty stack, a pending choice or a result, so any post-intent state with
// pendingChoice === null and result === null necessarily has an empty stack.
// ---------------------------------------------------------------------------

function assertStack(state: GameState): void {
	if (state.stack.length > MAX_STACK_DEPTH) {
		throw new Error(
			`stack invariant: depth ${state.stack.length} exceeds ${MAX_STACK_DEPTH}`,
		)
	}
	const windows = state.stack.filter((f) => f.k === 'REACTION_WINDOW')
	if (windows.length > MAX_REACTION_WINDOWS) {
		throw new Error(
			`stack invariant: ${windows.length} REACTION_WINDOW frames exceed ${MAX_REACTION_WINDOWS}`,
		)
	}
	if (
		state.result === null &&
		state.pendingChoice === null &&
		state.stack.length > 0
	) {
		throw new Error(
			`stack invariant: ${state.stack.length} frames on the stack while idle (no pending choice, no result)`,
		)
	}
}

// ---------------------------------------------------------------------------
// Serialisability — the state survives a JSON round-trip. assertSerialisable's
// WeakSet flags SHARED references as "cycles", and the resolver legitimately
// shares ctx/ref objects and effect node trees across sibling stack frames (a
// DAG, not a cycle — phases.ts scheduleOperations reuses one ctx for a whole
// phase), so a cycle report rooted inside `$.stack` falls back to a true
// JSON.stringify+parse check; a shared-ref hazard anywhere else still fails.
// ---------------------------------------------------------------------------

function assertStateSerialisable(state: GameState): void {
	try {
		assertSerialisable(state)
	} catch (err) {
		const msg = (err as Error).message
		// Tolerated shared-reference roots: the stack and the published choice are
		// transient resolver bookkeeping, and both legitimately alias (resolver
		// frames share ctx/node trees; scanForTrait's CHOOSE_SUIT reuses the
		// remaining-suits binding array). Any alias in a PERSISTENT structure
		// (cards/zones/players/awayTeamsAt/stardates, ...) is a hard failure.
		const tolerated =
			msg.startsWith('cycle at $.stack') ||
			msg.startsWith('cycle at $.pendingChoice')
		if (!tolerated) throw err // some other serialisation hazard
		const text = JSON.stringify(state)
		if (text === undefined)
			throw new Error('serialisability: state is not JSON-serialisable')
		JSON.parse(text)
	}
}

/**
 * Walk every value in `v`, rejecting functions, bigint/symbol, Map/Set/Date
 * and reference cycles (a value reachable by two paths). GameState must remain
 * plain JSON — `assertSerialisable` runs over every state a test or a reducer
 * produces.
 */
export function assertSerialisable(state: unknown): void {
	const seen = new WeakSet()
	;(function walk(v: unknown, path: string): void {
		if (v === null || typeof v !== 'object') {
			if (typeof v === 'function') throw new Error(`function at ${path}`)
			if (typeof v === 'bigint' || typeof v === 'symbol')
				throw new Error(`${typeof v} at ${path}`)
			return
		}
		if (v instanceof Map || v instanceof Set)
			throw new Error(`Map/Set at ${path}`)
		if (v instanceof Date) throw new Error(`Date at ${path}`)
		if (seen.has(v as object)) throw new Error(`cycle at ${path}`)
		seen.add(v as object)
		for (const [k, child] of Object.entries(v)) walk(child, `${path}.${k}`)
	})(state, '$')
}
