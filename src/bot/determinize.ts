// Determinization for imperfect-information search (house AI, todo/15 §4).
//
// A bot simulates on a FULL state, because the engine needs the stack and the
// rng. Simulating on the true state would let it read the opponent's hand or
// the next card of a deck. `determinize(state, seat, rng)` therefore returns a
// full, valid state that is consistent with what `seat` can observe, with
// every hidden fact resampled:
//
//   * every card hidden from `seat` (src/engine/projection.ts `hiddenCards`,
//     the same set seatView masks) is shuffled into a random slot of its POOL.
//     A pool is the set of hidden slots its card could equally be in, from
//     `seat`'s point of view:
//       - `P:<owner>`: a player's hand, Draw deck and Captain's Log. For the
//         opponent that is all three, so their hand and Log are sampled from
//         their unseen cards. For `seat` itself only its own Draw deck is
//         hidden, so this just reshuffles its deck order;
//       - `RESERVE:<owner>`: a Reserve deck only holds the setup Reserve cards,
//         so it is a pool of its own (so is the solo Bot's `SUPPLEMENT`, while
//         its face-down `BOT_ROW` joins its `P:` pool);
//       - every shared face-down deck (`MARKET_DECK:<suit>`, ENCOUNTER_DECK,
//         INCIDENT_DECK, LOCATION_DECK) is its own pool, so its order is
//         reshuffled.
//     Zone sizes, card owners and every visible zone stay exactly as they were;
//   * cards referenced by the effect stack, the pending choice, the event
//     queue or a pending replacement stay put: the engine is in the middle of
//     using them, so they count as revealed. (A blind "top of the deck" gain
//     candidate therefore keeps its true face; this is the one known leak.)
//   * `state.rng.seed` is replaced from the sampler, so draws and shuffles
//     after this point are not the true future. `rng.counter` is kept, because
//     choice ids are derived from it.
//
// The bot has no memory: cards it saw earlier (a revealed card, the opponent's
// logged cards, which passed through play) are resampled like any other hidden
// card. The output depends only on the seat's information set plus the
// sampler rng: pool members are sorted by instance id before shuffling and
// slots are filled in a canonical (zone key, index) order, so two states that
// differ only in the hidden arrangement determinize identically.

import type { CardInstanceId } from '../engine/ids'
import type { CardInstance, GameState } from '../engine/state'
import { zoneKey } from '../engine/state'
import type { Seat } from '../engine/resolver/queries'
import { hiddenCards } from '../engine/projection'
import { IID_TOKEN, seatView } from '../engine/seatView'
import { next, shuffle, type Rng } from '../engine/rng'

/** The pool a hidden card is resampled within (see the header). */
export function poolKey(card: CardInstance): string {
	switch (card.zone.k) {
		case 'HAND':
		case 'DRAW':
		case 'LOG':
		// the official solo Bot's face-down Staging row: unknown cards that
		// came off its deck (rules/13 §13.4)
		case 'BOT_ROW':
			return `P:${card.owner ?? 'none'}`
		default:
			return zoneKey(card.zone)
	}
}

/** Card instance ids the engine is currently working with (stack frames,
 *  the pending choice, the event queue and pending replacement records). */
export function referencedCards(state: GameState): Set<string> {
	const json = JSON.stringify([
		state.stack,
		state.pendingChoice,
		state.eventQueue,
		state.pending ?? null,
	])
	return new Set(json.match(IID_TOKEN) ?? [])
}

/** One pool: its member cards (sorted by id) and the slots they occupy, in
 *  canonical (zone key, index) order. */
export interface HiddenPool {
	key: string
	iids: CardInstanceId[]
	slots: { zone: string; index: number }[]
}

/** Every resamplable pool for `seat`, sorted by pool key. Exposed for search
 *  code that wants to reason about hidden zones (e.g. ISMCTS). */
export function hiddenPools(state: GameState, seat: Seat): HiddenPool[] {
	const hidden = hiddenCards(state, seat)
	const pinned = referencedCards(state)
	const pools = new Map<string, HiddenPool>()
	for (const iid of hidden) {
		if (pinned.has(iid)) continue
		const card = state.cards[iid]!
		const key = poolKey(card)
		const zone = zoneKey(card.zone)
		const index = state.zones[zone]?.indexOf(iid) ?? -1
		if (index < 0) continue // not in its zone array: leave it alone
		let pool = pools.get(key)
		if (pool === undefined) {
			pool = { key, iids: [], slots: [] }
			pools.set(key, pool)
		}
		pool.iids.push(iid)
		pool.slots.push({ zone, index })
	}
	const out = [...pools.values()].sort((a, b) => cmp(a.key, b.key))
	for (const pool of out) {
		pool.iids.sort(cmp)
		pool.slots.sort((a, b) => cmp(a.zone, b.zone) || a.index - b.index)
	}
	return out
}

function cmp(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/** `determinize` that also returns the advanced sampler rng, for callers that
 *  draw several samples in a row. */
export function determinizeWith(
	state: GameState,
	seat: Seat,
	rng: Rng,
): [GameState, Rng] {
	let r = rng
	const zones: GameState['zones'] = { ...state.zones }
	const cards: GameState['cards'] = { ...state.cards }
	const copied = new Set<string>()
	for (const pool of hiddenPools(state, seat)) {
		const [order, nextR] = shuffle(pool.iids, r)
		r = nextR
		pool.slots.forEach((slot, i) => {
			const iid = order[i]!
			if (!copied.has(slot.zone)) {
				zones[slot.zone] = [...(zones[slot.zone] ?? [])]
				copied.add(slot.zone)
			}
			zones[slot.zone]![slot.index] = iid
			// the slot's zone ref, taken from the card that truly sits there
			const occupant = state.zones[slot.zone]![slot.index]!
			const ref = state.cards[occupant]!.zone
			cards[iid] = { ...state.cards[iid]!, zone: { ...ref } }
		})
	}
	const [u, afterSeed] = next(r)
	const seed = Math.floor(u * 4294967296) >>> 0
	const out: GameState = {
		...state,
		cards,
		zones,
		rng: { seed, counter: state.rng.counter },
		// the stack is shared with `state`; fork it so the engine's in-place
		// ctx.bindings writes never reach the caller's state
		stack: state.stack.length === 0 ? [] : structuredClone(state.stack),
	}
	return [out, afterSeed]
}

/** A full, valid state consistent with what `seat` observes, hidden
 *  information resampled with `rng` (see the header). Pure. */
export function determinize(state: GameState, seat: Seat, rng: Rng): GameState {
	return determinizeWith(state, seat, rng)[0]
}

/** 32-bit FNV-1a over a string. */
export function fnv1a(text: string): number {
	let h = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

/** A stable seed derived only from what `seat` can see. Seed a bot's sampler
 *  with it, so the bot is deterministic yet independent of the hidden truth.
 *
 *  It hashes a digest of the public board plus `seat`'s own hidden-from-the-
 *  opponent cards: every zone with the hidden positions blanked to `?`, every
 *  visible card's instance state, both player boards, the Stardate pile, Away
 *  Teams, the turn and phase, and `seat`'s own pending choice. That is the
 *  same information `seatView` carries (it is a cheaper stand-in: seatView
 *  costs ~3 ms per call mid-game, this ~0.1 ms). The rng, the stack and the
 *  log are left out. */
export function seedFromView(state: GameState, seat: Seat): number {
	const hidden = hiddenCards(state, seat)
	const parts: string[] = [
		`${seat}|${state.mode}|${state.turnNumber}|${state.activeSeat}|${state.startingSeat}`,
		JSON.stringify(state.phase),
		JSON.stringify(state.turnsTaken),
		JSON.stringify(state.players),
		JSON.stringify(state.stardates),
		JSON.stringify(state.awayTeamsAt),
		`${state.resolutionTriggered}|${state.turnsAfterResolution}`,
		state.result === null ? '-' : state.result.kind,
		state.pendingChoice !== null && state.pendingChoice.seat === seat
			? JSON.stringify(state.pendingChoice)
			: state.pendingChoice === null
				? 'none'
				: 'other',
	]
	for (const key of Object.keys(state.zones).sort()) {
		const ids = state.zones[key]!
		if (ids.length === 0) continue
		let line = key + ':'
		for (const iid of ids) {
			if (hidden.has(iid)) {
				line += '?,'
				continue
			}
			const c = state.cards[iid]!
			line += `${iid}=${c.def}/${c.exhausted ? 1 : 0}/${c.actionTokens}/${c.beamedTo ?? ''}/${c.shipTokenAt ?? ''}/${c.wildcardAs ?? ''}/${JSON.stringify(c.resourceTokens)},`
		}
		parts.push(line)
	}
	return fnv1a(parts.join('\n'))
}

/** The exact (slow, ~3 ms) variant: a hash of `JSON.stringify(seatView)`.
 *  Kept for tests and tools that want the wire view as the reference. */
export function seedFromSeatView(state: GameState, seat: Seat): number {
	return fnv1a(JSON.stringify(seatView(state, seat)))
}
