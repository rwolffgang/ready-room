// todo/09 — the event bus (docs/architecture.md §4, docs/state-machine.md §3,
// rules/08 → PASSIVE/REACTION, rules/12 §12.24–§12.25).
//
// After every primitive, `run()` calls `drainEvents`:
//   1. pops the queued GameEvents FIFO;
//   2. for each event, collects the matching PASSIVE operations on BOTH
//      players' in-play cards and pushes them (mandatory, no choice) — see
//      the deterministic ordering below;
//   3. collects the offerable REACTION operations (in play, unexhausted,
//      non-beamed, non-Staging, matching trigger, action cost payable) and
//      pushes a REACTION_WINDOW frame per reacting seat ABOVE the interrupted
//      operation, so chosen reactions resolve and the interrupted operation
//      resumes afterwards (§12.24). The player who caused the event gets their
//      window first (todo/09 §5).
//
// House rulings baked in here (documented in-app by the CHANGES log):
//   - PASSIVE ordering on one event: the active player's first, then the
//     inactive player's; within a side, Location → Fleet → Duty Officer →
//     Captain → Status, then Staging/Beamed; then by card instance id. The
//     rulebook doesn't specify a cross-player or cross-zone order (todo/09 §2).
//   - PASSIVEs apply from every in-play card — including exhausted, Staging
//     and beamed cards (§12.25 only carves out exhaustion explicitly).
//   - REACTION windows: the event's own player first, then the other player
//     (todo/09 §5). Chosen reactions run in the player's chosen order.
//   - Every event trigger defaults to the card owner's OWN action
//     (event.seat === owner). CARD_PLAYED, CARD_GAINED, PUT_INTO_PLAY,
//     CARD_DEPLOYED, CARD_LOGGED and SPECIALTY_ADVANCED take an explicit
//     `seat: 'OPPONENT' | 'ANY'` when the text says "your opponent" / "you or
//     your opponent"; LOCATION_CONTROLLED takes OPPONENT; ATTACKED
//     matches the victim (event.victim === owner) — a card reacting "when you
//     are attacked" belongs to the attacked player.
//   - RESOURCE_GAINED never fires for STEAL (rules/04 §4.3.3) — the steal
//     primitive emits no such event.
//
// assertSerialisable: every structure here stays plain JSON (frames carry
// OperationRef[] and string-keyed bindings; the loop guard is a string pair
// array). Nothing below captures closures or wall-clock time.

import type { GameState, GameEvent, OperationRef, Frame } from '../state'
import { player, otherSeat, inPlayCards, zoneProps } from '../state'
import { cardDef } from '../cards'
import type { TriggerSpec, TriggerSeat } from './nodes'
import type { Seat } from './queries'
import type { CardInstanceId } from '../ids'
import { matchFilter } from '../queries/resolveQuery'
import { addLog } from './runtime'
import { matchesWouldBeAttacked } from './replacement'
import { canResolveEffect } from './primitives'
import { probe } from './probe'
import { isSoloBot } from '../solo/seat'

/** Cap on nested REACTION_WINDOW frames (todo/09 §6): a genuine chain is 2–4
 *  deep; anything beyond this is a data bug. Throws a clear diagnostic. */
export const MAX_REACTION_DEPTH = 20

/** Parse-friendly key for an operation (used by the PASSIVE loop guard and the
 *  window's taken-tracking). */
export function opKey(ref: { card: CardInstanceId; opIndex: number }): string {
	return `${ref.card}#${ref.opIndex}`
}

/** A stable, deterministic identity for an event instance — the PASSIVE loop
 *  guard keys on it (todo/09 §2). Two events with the same key are the same
 *  "thing happened". */
export function canonicalEventKey(event: GameEvent): string {
	switch (event.k) {
		case 'CARD_PLAYED':
		case 'PUT_INTO_PLAY':
		case 'CARD_GAINED':
		case 'CARD_DEPLOYED':
		case 'CARD_DRAWN':
		case 'CARD_DISCARDED':
		case 'CARD_LOGGED':
		case 'CARD_DISMISSED':
		case 'CARD_DESTROYED':
		case 'CARD_RETURNED_INCIDENT':
		case 'INCIDENT_TAKEN':
		case 'ENCOUNTER_TAKEN':
			return `${event.k}:${event.seat}:${event.iid}`
		case 'RESOURCE_GAINED':
		case 'RESOURCE_SPENT':
			return `${event.k}:${event.seat}:${event.res}:${event.amount}`
		case 'ACTION_SPENT':
			return `${event.k}:${event.seat}`
		case 'ACTION_GAINED':
			return `${event.k}:${event.seat}:${event.amount}`
		case 'AWAY_TEAM_SENT':
		case 'AWAY_TEAM_REMOVED':
			return `${event.k}:${event.seat}:${event.location}:${event.count}`
		case 'LOCATION_CONTROLLED':
		case 'SHIP_WARPED':
			return `${event.k}:${event.seat}:${event.iid}`
		case 'SPECIALTY_ADVANCED':
			return `${event.k}:${event.seat}:${event.specialty}:${event.amount}`
		case 'MISSION_COMPLETED':
			return `${event.k}:${event.seat}:${event.index}`
		case 'ATTACKED':
			return `${event.k}:${event.seat}:${event.victim}`
		case 'WOULD_BE_ATTACKED':
			return `${event.k}:${event.pending}:${event.first}:${event.effects.join(',')}`
		case 'WOULD_GAIN_CARD':
			return `${event.k}:${event.pending}`
		case 'OPERATION_RESOLVED':
			return `${event.k}:${event.seat}:${event.iid}:${event.paid.join(',')}`
	}
}

/** The TriggerSpec.on a GameEvent can satisfy, or null if it cannot fire any
 *  trigger (CARD_DRAWN, RESOURCE_SPENT, … are not triggerable events). */
export function eventTriggerKind(event: GameEvent): TriggerSpec['on'] | null {
	switch (event.k) {
		case 'CARD_PLAYED':
			return 'CARD_PLAYED'
		case 'PUT_INTO_PLAY':
			return 'PUT_INTO_PLAY'
		case 'CARD_GAINED':
			return 'CARD_GAINED'
		case 'CARD_LOGGED':
			return 'CARD_LOGGED'
		case 'CARD_DEPLOYED':
			return 'CARD_DEPLOYED'
		case 'CARD_RETURNED_INCIDENT':
			return 'INCIDENT_RETURNED'
		case 'RESOURCE_GAINED':
			return 'RESOURCE_GAINED'
		case 'SPECIALTY_ADVANCED':
			return 'SPECIALTY_ADVANCED'
		case 'LOCATION_CONTROLLED':
			return 'LOCATION_CONTROLLED'
		case 'AWAY_TEAM_SENT':
			return 'AWAY_TEAM_SENT'
		case 'SHIP_WARPED':
			return 'SHIP_WARPED'
		case 'INCIDENT_TAKEN':
			return 'INCIDENT_TAKEN'
		case 'ENCOUNTER_TAKEN':
			return 'ENCOUNTER_TAKEN'
		case 'MISSION_COMPLETED':
			return 'MISSION_COMPLETED'
		case 'ATTACKED':
			return 'ATTACKED'
		case 'WOULD_BE_ATTACKED':
			return 'WOULD_BE_ATTACKED'
		case 'WOULD_GAIN_CARD':
			return 'WOULD_GAIN_CARD'
		case 'OPERATION_RESOLVED':
			return 'OPERATION_RESOLVED'
		default:
			return null
	}
}

/** The card an event points at, when it carries one (used as the window
 *  choice's sourceCard hint). */
export function eventCardOf(event: GameEvent): CardInstanceId | null {
	switch (event.k) {
		case 'CARD_PLAYED':
		case 'PUT_INTO_PLAY':
		case 'CARD_GAINED':
		case 'CARD_DEPLOYED':
		case 'CARD_DRAWN':
		case 'CARD_DISCARDED':
		case 'CARD_LOGGED':
		case 'CARD_DISMISSED':
		case 'CARD_DESTROYED':
		case 'CARD_RETURNED_INCIDENT':
		case 'INCIDENT_TAKEN':
		case 'ENCOUNTER_TAKEN':
		case 'LOCATION_CONTROLLED':
		case 'SHIP_WARPED':
			return event.iid
		default:
			return null
	}
}

/** Does `trigger` on a card owned by `ownerSeat` match `event`? Includes the
 *  seat-scoping and filter halves of the TriggerSpec (docs/effect-dsl.md §6). */
export function matchesTrigger(
	state: GameState,
	event: GameEvent,
	trigger: TriggerSpec,
	ownerSeat: Seat,
): boolean {
	switch (event.k) {
		case 'CARD_PLAYED': {
			if (trigger.on !== 'CARD_PLAYED') return false
			return (
				seatMatches(trigger.seat, event.seat, ownerSeat) &&
				filterMatches(state, event, trigger.filter)
			)
		}
		case 'CARD_GAINED': {
			if (trigger.on !== 'CARD_GAINED') return false
			// "After gaining a SHIP" is the owner's own gain (default SELF);
			// a deck-top-only gain trigger (1SHI06) adds `dest`.
			if (trigger.dest !== undefined && event.dest !== trigger.dest)
				return false
			return (
				seatMatches(trigger.seat, event.seat, ownerSeat) &&
				filterMatches(state, event, trigger.filter)
			)
		}
		case 'CARD_LOGGED':
			// "After logging a card" (1LOC14) — the owner's own log by default.
			if (trigger.on !== 'CARD_LOGGED') return false
			return (
				seatMatches(trigger.seat, event.seat, ownerSeat) &&
				filterMatches(state, event, trigger.filter)
			)
		case 'PUT_INTO_PLAY':
			// "After putting a CLOAK into play" (1SEL16) — the owner's own card.
			if (trigger.on !== 'PUT_INTO_PLAY') return false
			return (
				seatMatches(trigger.seat, event.seat, ownerSeat) &&
				filterMatches(state, event, trigger.filter)
			)
		case 'CARD_DEPLOYED':
			// "After deploying a SHIP without CLOAK" (1KOL03, 1CAR03).
			if (trigger.on !== 'CARD_DEPLOYED') return false
			return (
				seatMatches(trigger.seat, event.seat, ownerSeat) &&
				filterMatches(state, event, trigger.filter)
			)
		case 'RESOURCE_GAINED': {
			if (trigger.on !== 'RESOURCE_GAINED') return false
			if (trigger.res !== undefined && event.res !== trigger.res) return false
			// "when you gain a resource" — the card owner's own gain.
			return event.seat === ownerSeat
		}
		case 'SPECIALTY_ADVANCED': {
			if (trigger.on !== 'SPECIALTY_ADVANCED') return false
			if (
				trigger.specialty !== undefined &&
				event.specialty !== trigger.specialty
			)
				return false
			if (
				trigger.specialties !== undefined &&
				!trigger.specialties.includes(event.specialty)
			)
				return false
			// "after gaining at least 1" — a track already at 15 advances by 0.
			// Default the owner's own gain; 1SIS06 "after your opponent gains
			// INFLUENCE/MILITARY" uses seat OPPONENT.
			return (
				event.amount > 0 && seatMatches(trigger.seat, event.seat, ownerSeat)
			)
		}
		case 'ATTACKED':
			// stack.ts emits { seat: attacker, victim } — the victim's cards react
			// to "when you are attacked", the aggressor's to "after you attack".
			if (trigger.on === 'ATTACK_MADE') return event.seat === ownerSeat
			return trigger.on === 'ATTACKED' && event.victim === ownerSeat
		case 'WOULD_BE_ATTACKED':
			// "When you would be attacked" — the victim's cards (replacement.ts)
			return (
				trigger.on === 'WOULD_BE_ATTACKED' &&
				event.victim === ownerSeat &&
				matchesWouldBeAttacked(trigger, event)
			)
		case 'WOULD_GAIN_CARD':
			// "When you would gain a card" — the owner's own gain
			return trigger.on === 'WOULD_GAIN_CARD' && event.seat === ownerSeat
		case 'MISSION_COMPLETED':
			return trigger.on === 'MISSION_COMPLETED' && event.seat === ownerSeat
		case 'LOCATION_CONTROLLED': {
			if (trigger.on !== 'LOCATION_CONTROLLED') return false
			const expected =
				trigger.seat === 'OPPONENT' ? otherSeat(ownerSeat) : ownerSeat
			return event.seat === expected
		}
		case 'AWAY_TEAM_SENT': {
			if (trigger.on !== 'AWAY_TEAM_SENT' || event.seat !== ownerSeat)
				return false
			// "to a neutral LOCATION" (1PER18): the destination sits in a Neutral
			// Zone slot (events drain right after the send, before any control).
			if (trigger.neutral === true)
				return state.cards[event.location]?.zone.k === 'NEUTRAL_ZONE'
			return true
		}
		case 'SHIP_WARPED':
			return trigger.on === 'SHIP_WARPED' && event.seat === ownerSeat
		case 'INCIDENT_TAKEN':
			return trigger.on === 'INCIDENT_TAKEN' && event.seat === ownerSeat
		case 'CARD_RETURNED_INCIDENT':
			// "after returning an INCIDENT" / "whenever you take or return an
			// INCIDENT" (1PER22) — the owner's own return.
			if (event.seat !== ownerSeat) return false
			return (
				trigger.on === 'INCIDENT_RETURNED' ||
				(trigger.on === 'INCIDENT_TAKEN' && trigger.orReturned === true)
			)
		case 'ENCOUNTER_TAKEN':
			return trigger.on === 'ENCOUNTER_TAKEN' && event.seat === ownerSeat
		case 'OPERATION_RESOLVED': {
			if (trigger.on !== 'OPERATION_RESOLVED') return false
			if (trigger.paid !== undefined && !event.paid.includes(trigger.paid))
				return false
			// the owner's own operation (1SIS24 "after resolving …").
			return event.seat === ownerSeat
		}
		default:
			// CARD_DRAWN, RESOURCE_SPENT, ACTION_*, AWAY_TEAM_REMOVED, … can never
			// satisfy a trigger (docs/effect-dsl.md §6).
			return false
	}
}

/** Trigger seat scoping: SELF (the default for every event trigger) = the
 *  card owner's own event, OPPONENT = the other player's, ANY = either. */
function seatMatches(
	seat: TriggerSeat | undefined,
	eventSeat: Seat,
	ownerSeat: Seat,
): boolean {
	switch (seat ?? 'SELF') {
		case 'SELF':
			return eventSeat === ownerSeat
		case 'OPPONENT':
			return eventSeat !== ownerSeat
		case 'ANY':
			return true
	}
}

type TriggerFilter = Extract<TriggerSpec, { on: 'CARD_PLAYED' }>['filter']

function filterMatches(
	state: GameState,
	event: GameEvent,
	filter: TriggerFilter,
): boolean {
	if (filter === undefined) return true
	const card = state.cards[(event as { iid?: CardInstanceId }).iid ?? '']
	if (card === undefined) return false
	return matchFilter(state, card, filter, {
		allowWildcard: true,
		actorMayOptIn: true,
	})
}

// ---------------------------------------------------------------------------
// PASSIVE collection (mandatory; deterministic order)
// ---------------------------------------------------------------------------

const PASSIVE_ZONE_ORDER: Record<string, number> = {
	LOCATION_AREA: 0,
	FLEET: 1,
	DUTY_OFFICER: 2,
	CAPTAIN: 3,
	STATUS: 4,
}

function passiveZoneOrder(state: GameState, iid: CardInstanceId): number {
	return PASSIVE_ZONE_ORDER[state.cards[iid]!.zone.k] ?? 5
}

/** All PASSIVE operations matching `event`: the active player's first, then
 *  the inactive player's; within a side, Location → Fleet → Duty Officer →
 *  Captain → Status (then Staging/Beamed), then by card instance id. */
export function collectPassiveOps(
	state: GameState,
	event: GameEvent,
): OperationRef[] {
	const out: OperationRef[] = []
	const order = [state.activeSeat, otherSeat(state.activeSeat)]
	for (const seat of order) {
		// the official solo Bot ignores the text of its cards (rules/13 §13.1)
		if (isSoloBot(state, seat)) continue
		const side: OperationRef[] = []
		for (const iid of inPlayCards(state, seat)) {
			const card = state.cards[iid]!
			cardDef(card.def).operations.forEach((op, opIndex) => {
				if (op.type !== 'PASSIVE' || op.trigger === undefined) return
				if (!matchesTrigger(state, event, op.trigger, seat)) return
				side.push({ card: iid, opIndex, seat })
			})
		}
		side.sort((a, b) => {
			const za = passiveZoneOrder(state, a.card)
			const zb = passiveZoneOrder(state, b.card)
			if (za !== zb) return za - zb
			if (a.card !== b.card) return a.card < b.card ? -1 : 1
			return a.opIndex - b.opIndex
		})
		out.push(...side)
	}
	// A SPECIAL that fires whenever this card is logged (1SHR06): the
	// logged card's own SPECIAL with a CARD_LOGGED trigger fires for the player
	// who logged it — the card has already left play, so it is not in the scan
	// above.
	if (event.k === 'CARD_LOGGED' && !isSoloBot(state, event.seat)) {
		const card = state.cards[event.iid]
		if (card !== undefined) {
			cardDef(card.def).operations.forEach((op, opIndex) => {
				if (op.type !== 'SPECIAL' || op.trigger?.on !== 'CARD_LOGGED') return
				if (op.trigger.beforeLeaving === true && event.specialsRan === true)
					return
				out.push({ card: event.iid, opIndex, seat: event.seat })
			})
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// REACTION collection (offerable candidates)
// ---------------------------------------------------------------------------

/** Is a REACTION operation offerable right now? (todo/09 §3 candidate filter):
 *  in play, not exhausted, not beamed, not in the Staging Area, its trigger
 *  matches `event` (incl. seat scoping), and it can pay any action cost. */
export function reactionLegal(state: GameState, ref: OperationRef): boolean {
	const card = state.cards[ref.card]
	if (card === undefined) return false
	if (!zoneProps(card.zone).inPlay) return false
	if (card.zone.k === 'BEAMED' || card.zone.k === 'STAGING') return false
	if (card.exhausted) return false
	const op = cardDef(card.def).operations[ref.opIndex]
	if (op === undefined || op.type !== 'REACTION' || op.trigger === undefined)
		return false
	if (op.costsAction && player(state, ref.seat).actions.available <= 0)
		return false
	return true
}

/** Can the REACTION `ref` actually be taken for `event`? (rules/12 §12.1: a
 *  cost you cannot pay cannot be chosen.) Its `requires` threshold must be
 *  met and the operation, probed with the bindings the chosen reaction would
 *  start with, must not fail — an unpayable mandatory cost (PAY_THEN / a bare
 *  cost leaf) fails it. A "would" window additionally only offers a
 *  replacement that can fully resolve (1BUR15 with nothing beamed to it,
 *  1PER19 with an empty hand). Re-checked whenever a window is (re)offered. */
export function reactionPayable(
	state: GameState,
	ref: OperationRef,
	event: GameEvent,
): boolean {
	const card = state.cards[ref.card]
	if (card === undefined) return false
	const op = cardDef(card.def).operations[ref.opIndex]
	if (op === undefined) return false
	if (op.costsAction && player(state, ref.seat).actions.available <= 0)
		return false
	if (
		op.requires !== undefined &&
		player(state, ref.seat).specialties[op.requires.specialty] < op.requires.min
	)
		return false
	const ctx = {
		actor: ref.seat,
		source: ref.card,
		bindings: passiveBindings(event),
	}
	if ('pending' in event && !canResolveEffect(state, op.effect, ctx))
		return false
	return probe(state, op.effect, ctx)
}

export interface ReactionGroup {
	seat: Seat
	refs: OperationRef[]
}

/** Offerable REACTIONs for each reacting seat, ordered so the player who
 *  caused the event gets their window first, then the other player (todo/09
 *  §5). Within a seat the order is by card instance id then op index —
 *  deterministic for replays; the player re-orders via the window itself. */
export function collectReactionGroups(
	state: GameState,
	event: GameEvent,
): ReactionGroup[] {
	const groups = new Map<Seat, OperationRef[]>()
	const seats = [
		event.seat ?? state.activeSeat,
		otherSeat(event.seat ?? state.activeSeat),
	]
	for (const set of [0, 1] as const) {
		const seat = seats[set]!
		if (isSoloBot(state, seat)) continue // its cards are inert (rules/13 §13.1)
		const side: OperationRef[] = []
		for (const iid of inPlayCards(state, seat)) {
			cardDef(state.cards[iid]!.def).operations.forEach((op, opIndex) => {
				if (op.type !== 'REACTION' || op.trigger === undefined) return
				const ref: OperationRef = { card: iid, opIndex, seat }
				if (!reactionLegal(state, ref)) return
				if (!matchesTrigger(state, event, op.trigger, seat)) return
				if (!reactionPayable(state, ref, event)) return
				side.push(ref)
			})
		}
		side.sort((a, b) =>
			a.card === b.card ? a.opIndex - b.opIndex : a.card < b.card ? -1 : 1,
		)
		if (side.length > 0) groups.set(seat, side)
	}
	const out: ReactionGroup[] = []
	for (const seat of seats) {
		const refs = groups.get(seat)
		if (refs !== undefined) out.push({ seat, refs })
	}
	return out
}

/** Bindings a triggered PASSIVE starts with: the event's card, if any. */
function passiveBindings(event: GameEvent): Record<string, string> {
	const card = eventCardOf(event)
	const out: Record<string, string> =
		card === null ? {} : { '$event.card': card }
	// a WOULD_* window: IGNORE_ATTACK / REPLACE_GAIN write to this record
	if ('pending' in event) out['$event.pending'] = event.pending
	return out
}

// ---------------------------------------------------------------------------
// PASSIVE feedback-loop guard (todo/09 §2)
// ---------------------------------------------------------------------------

function isOpOnStack(state: GameState, keyOf: string): boolean {
	for (const f of state.stack) {
		if (f.k === 'OPERATION' && opKey(f) === keyOf) return true
	}
	return false
}

/** Register a PASSIVE fire and check for a self-retrigger loop. The causal
 *  event key is recorded when we schedule the op; while that op's OPERATION
 *  frame is still on the stack, re-draining the same canonical event is
 *  refused — the passive's own emission feeding back into itself. The guard
 *  entry is pruned once the op's frame leaves the stack, so independent
 *  repeated events still fire each time (rules/12 §12.25). */
function guardPassive(
	state: GameState,
	ref: OperationRef,
	eventKey: string,
): { allow: boolean; state: GameState } {
	const key = opKey(ref)
	const passives = state.triggerGuard.passives
	const hit = passives.find((e) => e.op === key)
	if (hit !== undefined && hit.eventKey === eventKey) {
		return { allow: false, state }
	}
	const updated =
		hit === undefined
			? [...passives, { op: key, eventKey }]
			: passives.map((e) => (e.op === key ? { ...e, eventKey } : e))
	return {
		allow: true,
		state: { ...state, triggerGuard: { passives: updated } },
	}
}

// ---------------------------------------------------------------------------
// drainEvents — the actual drain (wired into runCollecting)
// ---------------------------------------------------------------------------

export interface DrainResult {
	state: GameState
	drained: GameEvent[]
}

/** Pop every queued event and, for each, push PASSIVEs (mandatory) and a
 *  REACTION_WINDOW per reacting seat. Probe mode and an empty queue no-op.
 *  Events are processed FIFO; on a LIFO stack that means pushing the LAST
 *  event's frames first. */
export function drainEvents(state: GameState): DrainResult {
	if (state.probe === true || state.eventQueue.length === 0) {
		return { state, drained: [] }
	}
	// Prune guard entries whose PASSIVE has fully left the stack — the op is no
	// longer resolving, so an independent later event may re-fire it (§12.25).
	// Pruned at the START because the op's phase-1 frame is still on the stack
	// while its own feedback event is being drained (that feedback MUST keep
	// being blocked).
	const pruned = state.triggerGuard.passives.filter((e) =>
		isOpOnStack(state, e.op),
	)
	const base: GameState =
		pruned.length !== state.triggerGuard.passives.length
			? { ...state, triggerGuard: { passives: pruned } }
			: state
	const events = [...state.eventQueue]
	let next: GameState = { ...base, eventQueue: [] }
	const drained: GameEvent[] = []
	// The drained report keeps FIFO order (earliest first) for callers; the
	// frames themselves must be pushed in reverse so the LIFO stack pops the
	// earliest event's reactions/passives first.
	for (const event of events) drained.push(event)

	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i]!

		// REACTION windows: push other-player's first so the event's own player's
		// window sits on top and is offered first.
		const groups = collectReactionGroups(next, event)
		for (let gi = groups.length - 1; gi >= 0; gi--) {
			const group = groups[gi]!
			const depth = next.stack.filter((f) => f.k === 'REACTION_WINDOW').length
			if (depth >= MAX_REACTION_DEPTH) {
				throw new Error(
					`drainEvents: REACTION_WINDOW nesting exceeds ${MAX_REACTION_DEPTH} — ` +
						`a genuine chain is 2–4 deep (rules/12 §12.24); this is a data bug`,
				)
			}
			// Clone the event per frame: two reacting seats each get their own
			// window, and assertSerialisable treats a shared object reference across
			// frames as a cycle.
			const frame: Frame = {
				k: 'REACTION_WINDOW',
				event: { ...event },
				offered: group.refs,
				seat: group.seat,
			}
			next = { ...next, stack: [...next.stack, frame] }
		}

		// PASSIVEs go ABOVE the windows so they resolve before any window is
		// offered for the same event (mandatory-first, todo/09 §2). Push in
		// REVERSE: the collector hands the desired order (first = resolve first),
		// and a LIFO stack pops the last-pushed first.
		const passiveOps = collectPassiveOps(next, event)
		for (let pi = passiveOps.length - 1; pi >= 0; pi--) {
			const ref = passiveOps[pi]!
			const g = guardPassive(next, ref, canonicalEventKey(event))
			if (!g.allow) {
				next = addLog(next, {
					kind: 'INFO',
					seat: ref.seat,
					message: `PASSIVE loop guard: ${opKey(ref)} re-fired on ${canonicalEventKey(event)} — refusing to re-fire`,
				})
				continue
			}
			next = g.state
			next = {
				...next,
				stack: [
					...next.stack,
					{
						k: 'OPERATION',
						card: ref.card,
						opIndex: ref.opIndex,
						// `$event.card` like a chosen REACTION (stack.ts eventBindings)
						ctx: {
							actor: ref.seat,
							source: ref.card,
							bindings: passiveBindings(event),
						},
						phase: 0,
					},
				],
			}
		}
	}
	return { state: next, drained }
}
