// Session layer core (docs/architecture.md §1/§2, docs/state-machine.md §7,
// todo/17). A Session is the whole game in a few KB:
//
//   { version, id, setup, log, meta }
//
//   setup: SetupConfig   — mode, decks + board sides, seed (all RNG)
//   log:   Intent[]      — the intent log, the real source of truth
//   meta:  SessionMeta   — browsable save-screen summary, not authoritative
//
// The GameState is NEVER stored: replay recomputes it, which is exactly why
// undo is trivial and saves are portable —
//
//   replay(session, catalog) = setup(session.setup, catalog) → reduce(each intent)
//
// This is sound only because of the engine's determinism invariant (§1:
// "same seed + same intent log ⇒ byte-identical state"). All card objects and
// instance references live in the recomputed state, never in the save.

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { reduce } from '../engine/intents'
import type { SetupConfig, CardCatalog } from '../engine/setup'
import { setup } from '../engine/setup'
import type { Seat } from '../engine/resolver/queries'
import { player } from '../engine/state'
import { cardDef } from '../engine/cards'
import { hiddenCards } from '../engine/projection'
import type { DeckId } from '../data/ids'
import type { CardDef } from '../data/schema'
import { cardName } from '../data/cardNames'
import { cardDataHash, cardDataHashCached } from '../data/cardDataHash'
import type { Opponents } from './opponents'

/** Moved to src/data/cardDataHash.ts (the house AI's learned value checks it
 *  too); re-exported so existing callers keep working. */
export { cardDataHash }

export const SESSION_VERSION = 2 as const

export type BoardSide = 'BASIC' | 'ADVANCED'

/** Per-seat, cheap, public-only running VP estimate for the save screen
 *  (todo/17 §6.2). Deliberately NOT final scoring: glory + specialty progress
 *  + printed VP of the seat's owned cards in public zones. Hidden zones
 *  (HAND, DRAW) and the Discard pile are ignored — this is an at-a-glance
 *  number, computed from what a load screen should know without a replay. */
export interface ScoreEstimate {
	seats: [number, number]
}

export interface SessionMeta {
	/** ISO timestamp of the last commit; the future UI debounces ~1 s autosaves
	 *  against this (todo/17 §1). */
	updatedAt: string
	/** ISO timestamp the session was created. */
	startedAt: string
	intentCount: number
	turnNumber: number
	activeSeat: Seat
	phase: string
	result: string | null
	deckNames: [string, string]
	boardSides: [BoardSide, BoardSide]
	scoreEstimate: [number, number]
	/** The final score once the game is over: each seat's total and the
	 *  winners (both on a tie, none for a Cadet Training loss). Absent while
	 *  the game runs and on saves from before it existed. */
	final?: { score: [number, number]; winners: Seat[] } | undefined
	/** Hash of the card data this session was played against. On load, a
	 *  mismatch warns that the saved log may replay differently (todo/17 §1). */
	cardDataHash: string
}

export interface Session {
	version: typeof SESSION_VERSION
	/** Stable game id — the IndexedDB key (persistence.ts). */
	id: string
	setup: SetupConfig
	log: Intent[]
	meta: SessionMeta
	/** The house-AI bot per seat (src/session/opponents.ts); absent seats are
	 *  humans, an absent field is a hot-seat game. Optional so saves from
	 *  before the house AI load unchanged (no version bump). The engine never
	 *  sees it: bots answer through ordinary intents in the log. */
	opponents?: Opponents | undefined
	/** The Five-Year Mission campaign this game belongs to
	 *  (src/session/campaign.ts); absent for any other game. */
	campaignId?: string | undefined
}

export interface CreateSessionOptions {
	id?: string | undefined
	now?: () => Date
	/** House-AI seats (see Session.opponents). */
	opponents?: Opponents | undefined
	/** The campaign the game belongs to (see Session.campaignId). */
	campaignId?: string | undefined
}

/** A short, unique, storage-friendly game id (session layer only — the engine
 *  bans Math.random/Date, the session layer is UI-adjacent and may). */
export function newGameId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return `game-${crypto.randomUUID()}`
	}
	return `game-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x3fffffff).toString(36)}`
}

/** Create a fresh SETUP-phase session (log empty). The catalog is used only
 *  for the initial setup + the card-data hash; it is not part of the save. */
export function createSession(
	config: SetupConfig,
	catalog: CardCatalog,
	opts: CreateSessionOptions = {},
): Session {
	const id = opts.id ?? newGameId()
	const now = opts.now ?? (() => new Date())
	const state = setup(config, catalog)
	const t = now().toISOString()
	const meta: SessionMeta = {
		updatedAt: t,
		startedAt: t,
		intentCount: 0,
		turnNumber: state.turnNumber,
		activeSeat: state.activeSeat,
		phase: state.phase.k,
		result: null,
		deckNames: [
			deckName(catalog, config.players[0]!.deck),
			deckName(catalog, config.players[1]!.deck),
		],
		boardSides: [config.players[0]!.boardSide, config.players[1]!.boardSide],
		scoreEstimate: [estimateScore(state, 0), estimateScore(state, 1)],
		cardDataHash: cardDataHashCached(catalog),
	}
	const session: Session = {
		version: SESSION_VERSION,
		id,
		setup: config,
		log: [],
		meta,
	}
	if (opts.opponents !== undefined && Object.keys(opts.opponents).length > 0)
		session.opponents = { ...opts.opponents }
	if (opts.campaignId !== undefined) session.campaignId = opts.campaignId
	return session
}

export const sessionSeed = (session: Session): number => session.setup.seed

/** Append one intent to the log (returns a new array — the log is immutable
 *  data, the session's source of truth). */
export function append(log: Intent[], intent: Intent): Intent[] {
	return [...log, intent]
}

/** Undo: truncate the latest `n` intents. Because replay is byte-exact, the
 *  undone state is exactly the state before those intents ever ran — including
 *  back into a mid-effect PendingChoice. Any auto-resolutions (PASSIVEs) never
 *  entered the log, so there is nothing else to drop (todo/17 §2, "Measure
 *  first": a full game is a few hundred intents and replay is far under the
 *  50 ms snapshot threshold). */
export function undo(log: Intent[], n = 1): Intent[] {
	if (n <= 0) return log
	return log.slice(0, Math.max(0, log.length - n))
}

/** Recompute a GameState from a session (docs/state-machine.md §7):
 *  run setup (which consumes the seeded RNG) then reduce every intent in
 *  order. Deterministic: same session + same catalog ⇒ byte-identical state. */
export function replay(session: Session, catalog: CardCatalog): GameState {
	if (session.version !== SESSION_VERSION) {
		throw new Error(
			`replay: unsupported session version ${String(session.version)} (expected v${SESSION_VERSION})`,
		)
	}
	let state = setup(session.setup, catalog)
	for (const intent of session.log) {
		state = reduce(state, intent).state
	}
	return state
}

/** Pure "dispatch": append the intent, recompute the state from the log,
 *  refresh the meta. Handy for bots/tests; the live UI should use
 *  SessionAdapter, which replays once and reduces incrementally. */
export function commit(
	session: Session,
	intent: Intent,
	catalog: CardCatalog,
	now = (): Date => new Date(),
): Session {
	const log = append(session.log, intent)
	const state = reduce(replay(session, catalog), intent).state
	return { ...session, log, meta: metaFor(session, state, catalog, now) }
}

/** Refresh the volatile meta (turn count, phase, score estimate, timestamp)
 *  from a state — cheapest right after a live reduce. The stable fields
 *  (deck names, board sides, card-data hash) are recomputed from the setup +
 *  current catalog, so a session continued under a *newer* catalog takes the
 *  new hash (the old hash stays on saved files for drift detection). */
export function refreshMeta(
	session: Session,
	state: GameState,
	catalog: CardCatalog,
	now = (): Date => new Date(),
): Session {
	return { ...session, meta: metaFor(session, state, catalog, now) }
}

/** Detect card-data drift (todo/17 §1): a saved session recording a card-data
 *  hash that no longer matches a catalog has to be replayed under a *different*
 *  rule set — warn instead of silently replaying wrong. */
export function checkCardData(
	session: Session,
	catalog: CardCatalog,
): { ok: boolean; stored: string; current: string } {
	const current = cardDataHashCached(catalog)
	return {
		ok: session.meta.cardDataHash === current,
		stored: session.meta.cardDataHash,
		current,
	}
}

/** Public, cheap per-seat VP estimate described on ScoreEstimate. With a
 *  `viewer`, cards whose face that seat cannot see (the opponent's Captain's
 *  Log, facedown Reserve decks) are left out too, so the online server can
 *  show the number to a seat without leaking a hidden card's printed VP. */
export function estimateScore(
	state: GameState,
	seat: Seat,
	viewer?: Seat,
): number {
	const p = player(state, seat)
	let total = p.resources.GLO
	total +=
		p.specialties.RESEARCH + p.specialties.INFLUENCE + p.specialties.MILITARY
	const hidden = viewer === undefined ? null : hiddenCards(state, viewer)
	for (const card of Object.values(state.cards)) {
		if (card.owner !== seat) continue
		if (
			card.zone.k === 'HAND' ||
			card.zone.k === 'DRAW' ||
			card.zone.k === 'DISCARD'
		)
			continue
		if (hidden?.has(card.iid) === true) continue
		total += cardDef(card.def).vp
	}
	return total
}

function metaFor(
	session: Session,
	state: GameState,
	catalog: CardCatalog,
	now: () => Date,
): SessionMeta {
	const config = session.setup
	const t = now().toISOString()
	return {
		updatedAt: t,
		startedAt: session.meta.startedAt,
		intentCount: session.log.length,
		turnNumber: state.turnNumber,
		activeSeat: state.activeSeat,
		phase: state.phase.k,
		result: state.result?.kind ?? null,
		deckNames: [
			deckName(catalog, config.players[0]!.deck),
			deckName(catalog, config.players[1]!.deck),
		],
		boardSides: [config.players[0]!.boardSide, config.players[1]!.boardSide],
		scoreEstimate: [estimateScore(state, 0), estimateScore(state, 1)],
		final: finalOf(state),
		cardDataHash: cardDataHashCached(catalog),
	}
}

function finalOf(state: GameState): SessionMeta['final'] {
	if (state.result?.kind !== 'COMPLETE') return undefined
	const { breakdown, winners } = state.result.scoreboard
	return { score: [breakdown[0].total, breakdown[1].total], winners }
}

/** A finished save from before `meta.final` existed gets its result from one
 *  replay; the rest of the meta (updatedAt included) stays as stored. The
 *  session comes back unchanged when there is nothing to fill in, when its
 *  card data drifted (a replay could reach a different result) or when the
 *  replay fails. */
export function backfillFinal(session: Session, catalog: CardCatalog): Session {
	if (session.meta.result !== 'COMPLETE' || session.meta.final !== undefined)
		return session
	if (!checkCardData(session, catalog).ok) return session
	try {
		const final = finalOf(replay(session, catalog))
		return final === undefined
			? session
			: { ...session, meta: { ...session.meta, final } }
	} catch {
		return session
	}
}

/** Human label for a deck on the save screen — the captain's name, falling
 *  back to the deck id (a deck always has exactly one CAPTAIN-suit card). */
export function deckName(catalog: CardCatalog, deck: DeckId): string {
	const captain = catalog.defs.find(
		(d): d is CardDef => d.deck === deck && d.suit === 'CAPTAIN',
	)
	return cardName(captain) ?? deck
}

export type { Intent, GameState, SetupConfig, CardCatalog }
