// The authoritative async game service (docs/ui-mobile.md §7, server/README.md).
//
// The server holds the seed and the full state; clients hold a seat token and
// only ever receive seat views (src/engine/seatView.ts). Every change goes
// through one per-game lock:
//
//   load the game document → authenticate the seat token → settle expired
//   interrupt deadlines → check the client's version → validate the intent
//   against the engine (legalIntents / validateChoice, and the deciding seat)
//   → reduce → append to the intent log → let standing orders answer any
//   interrupt they cover → record the pending interrupt + deadline → bump the
//   version → save atomically → push a `version` event to open streams.
//
// Undo: an intent is an undo floor when it drew randomness, revealed a card
// face to the acting seat, handed the turn over, raised an interrupt on the
// other seat, ended the game, or was not the mover's own decision (a
// standing-order answer, a timeout, the opening START). Undo pops the last
// intent only if it is the requesting seat's own non-floor intent on its own
// turn — so it can never cross a floor.
//
// Deadlines: an interrupt (a choice owed by the non-moving seat) gets
// `settings.deadlineMs` (12 h default). Expiry is applied on every read and
// write of the game and by a periodic timer; the default declines an optional
// reaction window / "you may", otherwise takes the engine's first legal
// selection, and the log records it as `by: 'timeout'`.
//
// Realtime: Server-Sent Events per game. Presence = the seats holding an open
// stream ("on the bridge").
//
// Invites: a game can also be created with only the host's captain (`host`
// instead of `players`). It is stored as an open document — no seed, no state
// — until the invite's seat answers with its own captain (join): then the
// seed is drawn, the guest takes seat 1 and the first turn (they are the one
// at the screen), and the document becomes an ordinary game under the same
// id. Every game route but lobby, join, summaries and events refuses an open
// game with NOT_STARTED.

import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CardCatalog, SetupConfig, SetupPlayer } from '../src/engine/setup'
import { setup } from '../src/engine/setup'
import type { GameState } from '../src/engine/state'
import type { Seat } from '../src/engine/resolver/queries'
import type { Intent } from '../src/engine/intents'
import { legalIntents, reduce, withCurrentRules } from '../src/engine/intents'
import { validateChoice } from '../src/engine/resolver/choices'
import { cardDef } from '../src/engine/cards'
import {
	maskValue,
	revealedCards,
	rngDraws,
	seatMask,
	seatView,
	unmaskValue,
} from '../src/engine/seatView'
import { cardDataHash, deckName, estimateScore } from '../src/session/log'
import {
	decisionSeat,
	interruptChoice,
	standingOrderAnswer,
	timeoutSelection,
} from '../src/session/interrupts'
import type {
	CreateGameResponse,
	ErrorCode,
	GameLobby,
	GameResultSummary,
	GameStreamEvent,
	GameSummary,
	GameView,
	JoinGameResponse,
	PendingDecision,
	Recap,
	SeatInfo,
	SeatCredentials,
	StandingPolicy,
	SubmittedBy,
	SummariesResponse,
	SummaryError,
} from '../src/session/protocol'
import type { DeckId } from '../src/data/ids'
import {
	FileGameStore,
	GAME_DOC_SCHEMA,
	isOpenDoc,
	validGameId,
	type GameDoc,
	type OpenGameDoc,
	type StoredGameDoc,
	type StoredPending,
} from './gameStore'
import { buildRecap } from './recap'
import { cardName } from '../src/data/cardNames'

export const DEFAULT_DEADLINE_MS = 12 * 60 * 60 * 1000
export const MIN_DEADLINE_MS = 60 * 1000
export const MAX_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_SUMMARY_GAMES = 100
const MAX_NAME_LENGTH = 40
/** Loop guard for server-side answering (standing orders, timeouts). */
const AUTO_GUARD = 500

/** A request the service refuses — mapped 1:1 to an HTTP error response. */
export class GameError extends Error {
	readonly status: number
	readonly code: ErrorCode
	readonly extra: Record<string, unknown>
	constructor(
		status: number,
		code: ErrorCode,
		message: string,
		extra: Record<string, unknown> = {},
	) {
		super(message)
		this.name = 'GameError'
		this.status = status
		this.code = code
		this.extra = extra
	}
}

export interface GameServiceOptions {
	/** directory of the game documents (one JSON file per game) */
	dir: string
	catalog: CardCatalog
	/** clock (ms since epoch) — injectable for deadline tests */
	now?: (() => number) | undefined
	/** seed source for new games — injectable for tests; never exposed */
	randomSeed?: (() => number) | undefined
	defaultDeadlineMs?: number | undefined
	/** how often the deadline timer runs; 0 disables it (default 60 s) */
	deadlineCheckMs?: number | undefined
	/** SSE keep-alive comment interval; 0 disables it (default 25 s) */
	heartbeatMs?: number | undefined
	/** replayed states kept in memory (default 64 games) */
	cacheSize?: number | undefined
	/** where background errors go (default console.error) */
	log?: ((message: string) => void) | undefined
}

interface Live {
	doc: GameDoc
	state: GameState
	seat: Seat
}

/** A seat of a stored game, open or started, authenticated under its lock. */
type Held =
	| { open: true; doc: OpenGameDoc; seat: Seat }
	| { open: false; doc: GameDoc; seat: Seat }

type ParsedSeat = SetupPlayer & { name: string | null }

interface Stream {
	seat: Seat
	res: ServerResponse
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v)

function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Canonical JSON (sorted keys) — compares a submitted intent with the
 *  engine's legal ones regardless of key order. */
function canonical(value: unknown): string {
	const sort = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sort)
		if (isRecord(v)) {
			const out: Record<string, unknown> = {}
			for (const k of Object.keys(v).sort()) out[k] = sort(v[k])
			return out
		}
		return v
	}
	return JSON.stringify(sort(value))
}

function resultSummary(state: GameState): GameResultSummary | null {
	const r = state.result
	if (r === null) return null
	return {
		kind: r.kind,
		winners: r.kind === 'COMPLETE' ? r.scoreboard.winners : [],
	}
}

/** Why `seat` may not undo right now, or null when it may. */
export function undoRefusal(
	doc: GameDoc,
	state: GameState,
	seat: Seat,
): string | null {
	if (state.result !== null) return 'the game is over'
	if (state.activeSeat !== seat) return 'undo is only possible on your own turn'
	const last = doc.game.log[doc.game.log.length - 1]
	if (last === undefined) return 'nothing to undo'
	if (last.seat !== seat || last.by !== 'player')
		return 'the last decision was not yours'
	if (last.floor)
		return 'something was revealed or decided since — undo cannot go back past it'
	return null
}

export class GameService {
	readonly store: FileGameStore
	private readonly catalog: CardCatalog
	private readonly now: () => number
	private readonly randomSeed: () => number
	private readonly defaultDeadlineMs: number
	private readonly cacheSize: number
	private readonly log: (message: string) => void
	private readonly decks: Set<string>
	private readonly reactionDefs: Set<string>
	private readonly cache = new Map<
		string,
		{ version: number; state: GameState }
	>()
	private readonly locks = new Map<string, Promise<unknown>>()
	private readonly deadlines = new Map<string, number>()
	private readonly streams = new Map<string, Set<Stream>>()
	private readonly lastSeen = new Map<string, [string | null, string | null]>()
	private readonly timers: ReturnType<typeof setInterval>[] = []
	private checking = false
	private closed = false

	/** Prefer `GameService.open`, which also indexes stored deadlines and
	 *  starts the timers. */
	constructor(private readonly opts: GameServiceOptions) {
		this.store = new FileGameStore(opts.dir)
		this.catalog = opts.catalog
		this.now = opts.now ?? (() => Date.now())
		this.randomSeed = opts.randomSeed ?? (() => randomBytes(4).readUInt32BE(0))
		this.defaultDeadlineMs = opts.defaultDeadlineMs ?? DEFAULT_DEADLINE_MS
		this.cacheSize = opts.cacheSize ?? 64
		this.log = opts.log ?? ((m) => console.error(m))
		this.decks = new Set(
			opts.catalog.defs.filter((d) => d.suit === 'CAPTAIN').map((d) => d.deck),
		)
		this.reactionDefs = new Set(
			opts.catalog.defs
				.filter((d) => d.operations.some((op) => op.type === 'REACTION'))
				.map((d) => d.id),
		)
	}

	static async open(opts: GameServiceOptions): Promise<GameService> {
		const service = new GameService(opts)
		await service.indexDeadlines()
		service.startTimers()
		return service
	}

	// -------------------------------------------------------------------------
	// Public operations (one per route)
	// -------------------------------------------------------------------------

	/** POST /games — a new game; START is applied so the starting seat opens
	 *  on its turn. Returns both seat tokens (only their hashes are stored). */
	async create(body: unknown): Promise<CreateGameResponse> {
		if (isRecord(body) && body.host !== undefined) return this.createOpen(body)
		const { players, deadlineMs } = this.parseCreate(body)
		const id = `game-${randomUUID()}`
		const tokens: [string, string] = [
			randomBytes(32).toString('base64url'),
			randomBytes(32).toString('base64url'),
		]
		const setupPlayers: [SetupPlayer, SetupPlayer] = [
			{ deck: players[0].deck, boardSide: players[0].boardSide },
			{ deck: players[1].deck, boardSide: players[1].boardSide },
		]
		const config: SetupConfig = {
			mode: 'TWO_PLAYER',
			players: setupPlayers,
			seed: this.randomSeed(),
		}
		let state: GameState
		try {
			state = setup(config, this.catalog)
		} catch (err) {
			throw new GameError(
				400,
				'BAD_REQUEST',
				`setup failed: ${(err as Error).message}`,
			)
		}
		const at = this.iso()
		const doc: GameDoc = {
			schema: GAME_DOC_SCHEMA,
			game: {
				id,
				createdAt: at,
				updatedAt: at,
				version: 0,
				status: 'ACTIVE',
				mode: 'TWO_PLAYER',
				setupPlayers,
				players: [this.seatInfo(0, players[0]), this.seatInfo(1, players[1])],
				settings: { deadlineMs },
				pending: null,
				orders: [{}, {}],
				cardDataHash: cardDataHash(this.catalog),
				log: [],
			},
			secret: {
				seed: config.seed,
				tokenHashes: [hashToken(tokens[0]), hashToken(tokens[1])],
			},
		}
		await this.withLock(id, async () => {
			state = this.apply(doc, state, { t: 'START' }, state.activeSeat, 'server')
			state = this.runOrders(doc, state)
			this.refreshPending(doc, state)
			await this.commit(doc, state)
		})
		return { gameId: id, tokens, version: doc.game.version }
	}

	/** POST /games with `{ host }` — an invite. The host holds seat 0; the
	 *  second token is the invite's. Nothing is set up until the guest joins. */
	private async createOpen(
		body: Record<string, unknown>,
	): Promise<CreateGameResponse> {
		const host = this.parseSeat(body.host, 'host')
		const deadlineMs = this.parseDeadline(body.settings)
		const id = `game-${randomUUID()}`
		const tokens: [string, string] = [
			randomBytes(32).toString('base64url'),
			randomBytes(32).toString('base64url'),
		]
		const at = this.iso()
		const doc: OpenGameDoc = {
			schema: GAME_DOC_SCHEMA,
			open: {
				id,
				createdAt: at,
				updatedAt: at,
				status: 'OPEN',
				mode: 'TWO_PLAYER',
				host: { deck: host.deck, boardSide: host.boardSide },
				hostInfo: this.seatInfo(0, host),
				settings: { deadlineMs },
			},
			secret: {
				tokenHashes: [hashToken(tokens[0]), hashToken(tokens[1])],
			},
		}
		await this.withLock(id, () => this.store.save(doc))
		return { gameId: id, tokens, version: 0 }
	}

	/** GET /games/:id/lobby — open or started, for either seat. */
	lobby(id: string, token: string): Promise<GameLobby> {
		return this.hold(id, token, (held) => {
			if (held.open) return this.openLobby(held.doc, held.seat)
			const g = held.doc.game
			return {
				gameId: g.id,
				seat: held.seat,
				status: g.status,
				players: g.players,
				settings: g.settings,
				createdAt: g.createdAt,
				lastActivity: g.updatedAt,
				presence: this.presence(g.id),
			}
		})
	}

	/** POST /games/:id/join — the invite's seat picks its captain. Sets the
	 *  game up with the guest opening, applies START, and answers with a fresh
	 *  seat token (the invite's is retired: the host has seen it) and the
	 *  guest's view. */
	join(id: string, token: string, body: unknown): Promise<JoinGameResponse> {
		return this.hold(id, token, async (held) => {
			if (!held.open)
				throw new GameError(
					409,
					'ALREADY_STARTED',
					'this game has already started — open it instead',
				)
			const { doc: open, seat } = held
			if (seat !== 1)
				throw new GameError(
					403,
					'NOT_YOUR_DECISION',
					'the invite is for your opponent — send them the link',
				)
			const guest = this.parseSeat(body, 'guest')
			const fresh = randomBytes(32).toString('base64url')
			if (guest.deck === open.open.host.deck)
				throw new GameError(
					400,
					'BAD_REQUEST',
					'the two seats need different crews',
				)
			const setupPlayers: [SetupPlayer, SetupPlayer] = [
				open.open.host,
				{ deck: guest.deck, boardSide: guest.boardSide },
			]
			const config: SetupConfig = {
				mode: 'TWO_PLAYER',
				players: setupPlayers,
				seed: this.randomSeed(),
				startingSeat: 1,
			}
			let state: GameState
			try {
				state = setup(config, this.catalog)
			} catch (err) {
				throw new GameError(
					400,
					'BAD_REQUEST',
					`setup failed: ${(err as Error).message}`,
				)
			}
			const doc: GameDoc = {
				schema: GAME_DOC_SCHEMA,
				game: {
					id,
					createdAt: open.open.createdAt,
					updatedAt: this.iso(),
					version: 0,
					status: 'ACTIVE',
					mode: 'TWO_PLAYER',
					startingSeat: 1,
					setupPlayers,
					players: [open.open.hostInfo, this.seatInfo(1, guest)],
					settings: open.open.settings,
					pending: null,
					orders: [{}, {}],
					cardDataHash: cardDataHash(this.catalog),
					log: [],
				},
				secret: {
					seed: config.seed,
					tokenHashes: [open.secret.tokenHashes[0], hashToken(fresh)],
				},
			}
			state = this.apply(doc, state, { t: 'START' }, state.activeSeat, 'server')
			state = this.runOrders(doc, state)
			this.refreshPending(doc, state)
			await this.commit(doc, state)
			return { token: fresh, view: this.viewFor(doc, state, seat) }
		})
	}

	/** GET /games/:id */
	view(id: string, token: string): Promise<GameView> {
		return this.run(id, token, (g) => this.viewFor(g.doc, g.state, g.seat))
	}

	/** POST /games/:id/intents — `{ intent, version }` */
	submit(id: string, token: string, body: unknown): Promise<GameView> {
		return this.run(id, token, async ({ doc, state, seat }) => {
			if (!isRecord(body) || !isRecord(body.intent))
				throw new GameError(
					400,
					'BAD_REQUEST',
					'body must be { intent, version }',
				)
			this.checkVersion(doc, body.version)
			if (state.result !== null)
				throw new GameError(422, 'GAME_OVER', 'the game is over')
			const decider = decisionSeat(state)
			if (decider !== seat)
				throw new GameError(
					403,
					'NOT_YOUR_DECISION',
					`seat ${decider ?? '-'} decides now, not seat ${seat}`,
				)
			const mask = seatMask(state, seat)
			let intent: Intent
			try {
				intent = this.legalize(state, unmaskValue(body.intent, mask))
			} catch (err) {
				// A refusal reason can quote the (unmasked) selection: name hidden
				// cards by the seat's own aliases again, never by their real ids.
				if (err instanceof GameError)
					throw new GameError(
						err.status,
						err.code,
						maskValue(err.message, mask, 'board'),
						err.extra,
					)
				throw err
			}
			const work = structuredClone(doc)
			let next = this.apply(work, state, intent, seat, 'player')
			next = this.runOrders(work, next)
			this.refreshPending(work, next)
			await this.commit(work, next)
			return this.viewFor(work, next, seat)
		})
	}

	/** POST /games/:id/undo — `{ version }` */
	undo(id: string, token: string, body: unknown): Promise<GameView> {
		return this.run(id, token, async ({ doc, state, seat }) => {
			if (!isRecord(body))
				throw new GameError(400, 'BAD_REQUEST', 'body must be { version }')
			this.checkVersion(doc, body.version)
			const refusal = undoRefusal(doc, state, seat)
			if (refusal !== null) throw new GameError(422, 'UNDO_REFUSED', refusal)
			const work = structuredClone(doc)
			work.game.log.pop()
			const next = this.replay(work)
			this.refreshPending(work, next)
			await this.commit(work, next)
			return this.viewFor(work, next, seat)
		})
	}

	/** PUT /games/:id/orders — `{ cardDef, policy }`. An order can answer the
	 *  interrupt this seat owes right now (then the version bumps). */
	setOrder(id: string, token: string, body: unknown): Promise<GameView> {
		return this.run(id, token, async ({ doc, state, seat }) => {
			if (!isRecord(body) || typeof body.cardDef !== 'string')
				throw new GameError(
					400,
					'BAD_REQUEST',
					'body must be { cardDef, policy }',
				)
			const policy = body.policy
			if (policy !== 'ask' && policy !== 'always' && policy !== 'never')
				throw new GameError(
					400,
					'BAD_REQUEST',
					'policy must be ask | always | never',
				)
			if (!this.reactionDefs.has(body.cardDef))
				throw new GameError(
					400,
					'BAD_REQUEST',
					`${body.cardDef} is not a card with a REACTION operation`,
				)
			const work = structuredClone(doc)
			const orders = work.game.orders[seat]
			if ((policy as StandingPolicy) === 'ask') delete orders[body.cardDef]
			else orders[body.cardDef] = policy
			const before = work.game.log.length
			const next = this.runOrders(work, state)
			if (work.game.log.length !== before) {
				this.refreshPending(work, next)
				await this.commit(work, next)
			} else {
				// orders only: private to the seat — no state change, no version
				// bump, no `lastActivity` the opponent could notice
				await this.store.save(work)
			}
			return this.viewFor(work, next, seat)
		})
	}

	/** GET /games/:id/recap[?since=seq] */
	recap(id: string, token: string, since?: number): Promise<Recap> {
		return this.run(id, token, ({ doc, seat }) =>
			buildRecap({
				gameId: doc.game.id,
				version: doc.game.version,
				config: this.config(doc),
				catalog: this.catalog,
				log: doc.game.log,
				seat,
				since,
			}),
		)
	}

	/** POST /games/summaries — `{ games: [{ gameId, token }] }`; each pair is
	 *  answered independently (a bad token only fails its own row). */
	async summaries(body: unknown): Promise<SummariesResponse> {
		if (!isRecord(body) || !Array.isArray(body.games))
			throw new GameError(
				400,
				'BAD_REQUEST',
				'body must be { games: [{ gameId, token }] }',
			)
		if (body.games.length > MAX_SUMMARY_GAMES)
			throw new GameError(
				400,
				'BAD_REQUEST',
				`at most ${MAX_SUMMARY_GAMES} games`,
			)
		const summaries: GameSummary[] = []
		const open: GameLobby[] = []
		const errors: SummaryError[] = []
		for (const raw of body.games as unknown[]) {
			const creds = raw as Partial<SeatCredentials>
			const gameId = typeof creds?.gameId === 'string' ? creds.gameId : ''
			try {
				if (typeof creds?.token !== 'string')
					throw new GameError(400, 'BAD_REQUEST', 'token missing')
				const row = await this.hold<GameLobby | GameSummary>(
					gameId,
					creds.token,
					(held) =>
						held.open
							? this.openLobby(held.doc, held.seat)
							: this.withState(held.doc, held.seat, (g) =>
									this.summaryFor(g.doc, g.state, g.seat),
								),
				)
				if (row.status === 'OPEN') open.push(row)
				else summaries.push(row as GameSummary)
			} catch (err) {
				if (!(err instanceof GameError)) throw err
				errors.push({
					gameId,
					status: err.status,
					code: err.code,
					error: err.message,
				})
			}
		}
		return { summaries, open, errors }
	}

	/** GET /games/:id/events?token=… — Server-Sent Events: `hello` on
	 *  connect, `version` on every change, `presence` when a seat's stream
	 *  opens or closes. */
	async openStream(
		id: string,
		token: string,
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		const { version, seat } = await this.hold(id, token, (held) =>
			held.open
				? { version: 0, seat: held.seat }
				: this.withState(held.doc, held.seat, (g) => ({
						version: g.doc.game.version,
						seat: g.seat,
					})),
		)
		if (this.closed) throw new GameError(503, 'INTERNAL', 'shutting down')
		res.writeHead(200, {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no',
		})
		res.write('retry: 3000\n\n')
		const stream: Stream = { seat, res }
		let set = this.streams.get(id)
		if (set === undefined) {
			set = new Set()
			this.streams.set(id, set)
		}
		set.add(stream)
		sseWrite(res, {
			type: 'hello',
			gameId: id,
			seat,
			version,
			presence: this.presence(id),
		})
		this.broadcastPresence(id)
		const done = (): void => {
			const current = this.streams.get(id)
			if (current === undefined || !current.delete(stream)) return
			if (current.size === 0) this.streams.delete(id)
			this.touch(id, seat)
			this.broadcastPresence(id)
		}
		req.on('close', done)
		res.on('close', done)
	}

	/** Apply every due interrupt deadline (the timer's job; reads and writes
	 *  of a game also settle it). */
	async checkDeadlines(): Promise<void> {
		if (this.checking) return
		this.checking = true
		try {
			const now = this.now()
			const due = [...this.deadlines].filter(([, t]) => t <= now)
			for (const [id] of due) {
				try {
					await this.withLock(id, async () => {
						const doc = await this.store.get(id)
						if (doc === null || isOpenDoc(doc)) this.deadlines.delete(id)
						else await this.settle(doc)
					})
				} catch (err) {
					this.log(`deadline check ${id}: ${(err as Error).message}`)
				}
			}
		} finally {
			this.checking = false
		}
	}

	/** Debug/test hook — the raw document and state. Never routed. */
	async inspect(id: string): Promise<{ doc: GameDoc; state: GameState }> {
		const doc = await this.store.get(id)
		if (doc === null) throw new GameError(404, 'NOT_FOUND', `no game "${id}"`)
		if (isOpenDoc(doc))
			throw new GameError(409, 'NOT_STARTED', `game "${id}" is an open invite`)
		return { doc, state: this.stateOf(doc) }
	}

	/** Stop the timers and end every open stream. */
	close(): void {
		this.closed = true
		for (const t of this.timers) clearInterval(t)
		this.timers.length = 0
		for (const set of this.streams.values()) for (const s of set) s.res.end()
		this.streams.clear()
	}

	// -------------------------------------------------------------------------
	// Engine plumbing
	// -------------------------------------------------------------------------

	private config(doc: GameDoc): SetupConfig {
		return {
			mode: doc.game.mode,
			players: [...doc.game.setupPlayers],
			seed: doc.secret.seed,
			...(doc.game.startingSeat === undefined
				? {}
				: { startingSeat: doc.game.startingSeat }),
		}
	}

	private replay(doc: GameDoc): GameState {
		let state = setup(this.config(doc), this.catalog)
		for (const entry of doc.game.log) state = reduce(state, entry.intent).state
		return state
	}

	private stateOf(doc: GameDoc): GameState {
		const hit = this.cache.get(doc.game.id)
		if (hit !== undefined && hit.version === doc.game.version) {
			// refresh LRU position
			this.cache.delete(doc.game.id)
			this.cache.set(doc.game.id, hit)
			return hit.state
		}
		const state = this.replay(doc)
		this.remember(doc.game.id, doc.game.version, state)
		return state
	}

	private remember(id: string, version: number, state: GameState): void {
		this.cache.delete(id)
		this.cache.set(id, { version, state })
		while (this.cache.size > this.cacheSize) {
			const oldest = this.cache.keys().next().value
			if (oldest === undefined) break
			this.cache.delete(oldest)
		}
	}

	/** Reduce one intent into the working document's log. */
	private apply(
		doc: GameDoc,
		before: GameState,
		intent: Intent,
		seat: Seat,
		by: SubmittedBy,
	): GameState {
		intent = withCurrentRules(before, intent)
		const after = reduce(before, intent).state
		const floor =
			by !== 'player' ||
			seat !== before.activeSeat ||
			rngDraws(before, after) > 0 ||
			revealedCards(before, after, seat).length > 0 ||
			after.activeSeat !== before.activeSeat ||
			after.turnNumber !== before.turnNumber ||
			interruptChoice(after) !== null ||
			after.result !== null
		doc.game.log.push({
			seq: doc.game.log.length + 1,
			seat,
			by,
			at: this.iso(),
			turn: before.turnNumber,
			active: before.activeSeat,
			floor,
			intent,
		})
		return after
	}

	/** Let standing orders answer every interrupt they cover. */
	private runOrders(doc: GameDoc, state: GameState): GameState {
		let s = state
		for (let guard = 0; guard < AUTO_GUARD; guard++) {
			const answer = standingOrderAnswer(s, doc.game.orders)
			const choice = s.pendingChoice
			if (answer === undefined || choice === null) break
			s = this.apply(
				doc,
				s,
				{
					t: 'RESOLVE_CHOICE',
					choiceId: choice.id,
					selection: answer.selection,
				},
				choice.seat,
				'order',
			)
		}
		return s
	}

	/** Record the open interrupt (or clear it). A choice already recorded keeps
	 *  its deadline; `inherit` passes an expired interrupt's deadline on to the
	 *  next one owed by the same seat (an absent seat times out the chain). */
	private refreshPending(
		doc: GameDoc,
		state: GameState,
		inherit?: StoredPending,
	): void {
		const choice = interruptChoice(state)
		if (choice === null) {
			doc.game.pending = null
			return
		}
		if (doc.game.pending?.choiceId === choice.id) return
		const now = this.now()
		const source = choice.sourceCard
		doc.game.pending = {
			seat: choice.seat,
			kind: choice.k,
			choiceId: choice.id,
			prompt: choice.prompt,
			sourceCard: source,
			sourceDef:
				choice.sourceDef ??
				(source === null ? null : (state.cards[source]?.def ?? null)),
			since: new Date(now).toISOString(),
			deadline:
				inherit !== undefined && inherit.seat === choice.seat
					? inherit.deadline
					: new Date(now + doc.game.settings.deadlineMs).toISOString(),
		}
	}

	/** Apply every expired deadline of a (committed) document; commits when
	 *  anything changed. Runs inside the game's lock. */
	private async settle(
		doc: GameDoc,
	): Promise<{ doc: GameDoc; state: GameState }> {
		const state = this.stateOf(doc)
		const first = doc.game.pending
		if (first === null || Date.parse(first.deadline) > this.now())
			return { doc, state }
		const work = structuredClone(doc)
		let s = state
		for (let guard = 0; guard < AUTO_GUARD; guard++) {
			const due = work.game.pending
			if (due === null || Date.parse(due.deadline) > this.now()) break
			const choice = s.pendingChoice
			if (choice === null || choice.id !== due.choiceId) {
				// stale record — re-derive it (fresh deadline)
				work.game.pending = null
				this.refreshPending(work, s)
				continue
			}
			s = this.apply(
				work,
				s,
				{
					t: 'RESOLVE_CHOICE',
					choiceId: choice.id,
					selection: timeoutSelection(s),
				},
				choice.seat,
				'timeout',
			)
			s = this.runOrders(work, s)
			this.refreshPending(work, s, due)
		}
		await this.commit(work, s)
		return { doc: work, state: s }
	}

	private async commit(doc: GameDoc, state: GameState): Promise<void> {
		doc.game.status = state.result === null ? 'ACTIVE' : 'COMPLETE'
		doc.game.version += 1
		doc.game.updatedAt = this.iso()
		await this.store.save(doc)
		this.remember(doc.game.id, doc.game.version, state)
		this.indexDeadline(doc)
		this.broadcastVersion(doc, state)
	}

	/** The engine's legality gate for a (real-id) submission: the pending
	 *  choice's RESOLVE_CHOICE with a valid selection, or one of the intents
	 *  `legalIntents` offers. Returns the intent to apply. */
	private legalize(state: GameState, raw: unknown): Intent {
		if (!isRecord(raw) || typeof raw.t !== 'string')
			throw new GameError(
				400,
				'BAD_REQUEST',
				'intent must be an object with a "t"',
			)
		const choice = state.pendingChoice
		if (choice !== null) {
			if (raw.t !== 'RESOLVE_CHOICE' || raw.choiceId !== choice.id)
				throw new GameError(
					422,
					'ILLEGAL_INTENT',
					`a ${choice.k} choice (${choice.id}) is pending — answer it first`,
				)
			const v = validateChoice(state, choice.id, raw.selection)
			if (!v.ok) throw new GameError(422, 'ILLEGAL_INTENT', v.reason)
			return { t: 'RESOLVE_CHOICE', choiceId: choice.id, selection: v.value }
		}
		const key = canonical(raw)
		const legal = legalIntents(state).find((i) => canonical(i) === key)
		if (legal === undefined)
			throw new GameError(
				422,
				'ILLEGAL_INTENT',
				`intent is not legal now: ${JSON.stringify(raw)}`,
			)
		return legal
	}

	// -------------------------------------------------------------------------
	// Views
	// -------------------------------------------------------------------------

	private viewFor(doc: GameDoc, state: GameState, seat: Seat): GameView {
		const mask = seatMask(state, seat)
		const toMove = decisionSeat(state)
		const yourMove = toMove === seat
		return {
			gameId: doc.game.id,
			seat,
			version: doc.game.version,
			status: doc.game.status,
			players: doc.game.players,
			settings: doc.game.settings,
			state: seatView(state, seat, mask),
			toMove,
			yourMove,
			legalIntents: yourMove
				? maskValue(legalIntents(state), mask, 'board')
				: [],
			pending: this.pendingFor(doc, state, seat),
			canUndo: undoRefusal(doc, state, seat) === null,
			orders: { ...doc.game.orders[seat] },
			presence: this.presence(doc.game.id),
			intentCount: doc.game.log.length,
			lastActivity: doc.game.updatedAt,
			result: resultSummary(state),
		}
	}

	/** The stored interrupt as `seat` may see it. */
	private pendingFor(
		doc: GameDoc,
		state: GameState,
		seat: Seat,
	): PendingDecision | null {
		const p = doc.game.pending
		if (p === null) return null
		const mask = seatMask(state, seat)
		const sourceHidden = p.sourceCard !== null && mask.toAlias.has(p.sourceCard)
		return {
			seat: p.seat,
			kind: p.kind,
			choiceId: p.choiceId,
			prompt: maskValue(p.prompt, mask, 'history'),
			sourceDef: sourceHidden ? null : p.sourceDef,
			since: p.since,
			deadline: p.deadline,
		}
	}

	private summaryFor(doc: GameDoc, state: GameState, seat: Seat): GameSummary {
		const toMove = decisionSeat(state)
		const pending = this.pendingFor(doc, state, seat)
		const top = state.stardates.pile[0]
		const topDef = top === undefined ? null : (state.cards[top]?.def ?? null)
		return {
			gameId: doc.game.id,
			seat,
			version: doc.game.version,
			status: doc.game.status,
			players: doc.game.players,
			toMove,
			yourMove: toMove === seat,
			activeSeat: state.activeSeat,
			pendingOnYou: pending !== null && pending.seat === seat ? pending : null,
			pending,
			score: [estimateScore(state, 0, seat), estimateScore(state, 1, seat)],
			turn: state.turnNumber,
			phase: state.phase.k,
			stardate: {
				def: topDef,
				name: topDef === null ? null : cardName(cardDef(topDef)),
				remaining: state.stardates.pile.length,
			},
			result: resultSummary(state),
			lastActivity: doc.game.updatedAt,
			presence: this.presence(doc.game.id),
			lastSeen: [...(this.lastSeen.get(doc.game.id) ?? [null, null])] as [
				string | null,
				string | null,
			],
		}
	}

	// -------------------------------------------------------------------------
	// Seats, locks, streams, timers
	// -------------------------------------------------------------------------

	/** Load, authenticate and settle a game under its lock, then run `fn`. */
	private run<T>(
		id: string,
		token: string,
		fn: (live: Live) => T | Promise<T>,
	): Promise<T> {
		return this.hold(id, token, (held) => {
			if (held.open)
				throw new GameError(
					409,
					'NOT_STARTED',
					'your opponent has not picked a captain yet',
				)
			return this.withState(held.doc, held.seat, fn)
		})
	}

	/** Settle a started game's deadlines and hand it on with its state. */
	private async withState<T>(
		stored: GameDoc,
		seat: Seat,
		fn: (live: Live) => T | Promise<T>,
	): Promise<T> {
		const { doc, state } = await this.settle(stored)
		return fn({ doc, state, seat })
	}

	/** Load and authenticate a stored game — open or started — under its lock. */
	private hold<T>(
		id: string,
		token: string,
		fn: (held: Held) => T | Promise<T>,
	): Promise<T> {
		if (!validGameId(id))
			return Promise.reject(new GameError(404, 'NOT_FOUND', `no game "${id}"`))
		return this.withLock(id, async () => {
			const stored = await this.store.get(id)
			if (stored === null)
				throw new GameError(404, 'NOT_FOUND', `no game "${id}"`)
			const seat = this.authenticate(stored, token)
			this.touch(id, seat)
			return fn(
				isOpenDoc(stored)
					? { open: true, doc: stored, seat }
					: { open: false, doc: stored, seat },
			)
		})
	}

	private openLobby(doc: OpenGameDoc, seat: Seat): GameLobby {
		const o = doc.open
		return {
			gameId: o.id,
			seat,
			status: 'OPEN',
			players: [o.hostInfo, null],
			settings: o.settings,
			createdAt: o.createdAt,
			lastActivity: o.updatedAt,
			presence: this.presence(o.id),
		}
	}

	private seatInfo(seat: Seat, p: ParsedSeat): SeatInfo {
		return {
			seat,
			deck: p.deck,
			deckName: deckName(this.catalog, p.deck),
			boardSide: p.boardSide,
			name: p.name,
		}
	}

	private authenticate(doc: StoredGameDoc, token: string): Seat {
		if (token === '')
			throw new GameError(401, 'UNAUTHORIZED', 'a seat token is required')
		const given = Buffer.from(hashToken(token), 'hex')
		for (const seat of [0, 1] as const) {
			const stored = Buffer.from(doc.secret.tokenHashes[seat], 'hex')
			if (stored.length === given.length && timingSafeEqual(stored, given))
				return seat
		}
		throw new GameError(
			401,
			'UNAUTHORIZED',
			'this token holds no seat in this game',
		)
	}

	private checkVersion(doc: GameDoc, version: unknown): void {
		if (typeof version !== 'number')
			throw new GameError(400, 'BAD_REQUEST', 'version must be a number')
		if (version !== doc.game.version)
			throw new GameError(
				409,
				'STALE_VERSION',
				`stale version ${version} (current ${doc.game.version}) — refetch the game`,
				{ version: doc.game.version },
			)
	}

	private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.locks.get(id) ?? Promise.resolve()
		const run = prev.then(fn, fn)
		const tail = run.then(
			() => undefined,
			() => undefined,
		)
		this.locks.set(id, tail)
		void tail.then(() => {
			if (this.locks.get(id) === tail) this.locks.delete(id)
		})
		return run
	}

	private parseCreate(body: unknown): {
		players: [ParsedSeat, ParsedSeat]
		deadlineMs: number
	} {
		if (
			!isRecord(body) ||
			!Array.isArray(body.players) ||
			body.players.length !== 2
		)
			throw new GameError(
				400,
				'BAD_REQUEST',
				'body must be { players: [seat0, seat1] } or { host }',
			)
		const players: [ParsedSeat, ParsedSeat] = [
			this.parseSeat(body.players[0], 'players[0]'),
			this.parseSeat(body.players[1], 'players[1]'),
		]
		if (players[0].deck === players[1].deck)
			throw new GameError(
				400,
				'BAD_REQUEST',
				'the two seats need different crews',
			)
		return { players, deadlineMs: this.parseDeadline(body.settings) }
	}

	private parseSeat(raw: unknown, label: string): ParsedSeat {
		if (!isRecord(raw))
			throw new GameError(400, 'BAD_REQUEST', `${label} must be an object`)
		if (typeof raw.deck !== 'string' || !this.decks.has(raw.deck))
			throw new GameError(
				400,
				'BAD_REQUEST',
				`${label}.deck is not a known crew`,
			)
		if (raw.boardSide !== 'BASIC' && raw.boardSide !== 'ADVANCED')
			throw new GameError(
				400,
				'BAD_REQUEST',
				`${label}.boardSide must be BASIC | ADVANCED`,
			)
		let name: string | null = null
		if (raw.name !== undefined && raw.name !== null) {
			if (typeof raw.name !== 'string')
				throw new GameError(
					400,
					'BAD_REQUEST',
					`${label}.name must be a string`,
				)
			name = raw.name.trim().slice(0, MAX_NAME_LENGTH) || null
		}
		return { deck: raw.deck as DeckId, boardSide: raw.boardSide, name }
	}

	private parseDeadline(settings: unknown): number {
		if (settings === undefined) return this.defaultDeadlineMs
		if (!isRecord(settings))
			throw new GameError(400, 'BAD_REQUEST', 'settings must be an object')
		const d = settings.deadlineMs
		if (d === undefined) return this.defaultDeadlineMs
		if (
			typeof d !== 'number' ||
			!Number.isInteger(d) ||
			d < MIN_DEADLINE_MS ||
			d > MAX_DEADLINE_MS
		)
			throw new GameError(
				400,
				'BAD_REQUEST',
				`settings.deadlineMs must be an integer in ${MIN_DEADLINE_MS}..${MAX_DEADLINE_MS}`,
			)
		return d
	}

	private presence(id: string): [boolean, boolean] {
		const out: [boolean, boolean] = [false, false]
		for (const s of this.streams.get(id) ?? []) out[s.seat] = true
		return out
	}

	private touch(id: string, seat: Seat): void {
		const seen = this.lastSeen.get(id) ?? [null, null]
		seen[seat] = this.iso()
		this.lastSeen.set(id, seen)
	}

	private broadcast(
		id: string,
		event: (seat: Seat) => GameStreamEvent,
		eventId?: number,
	): void {
		for (const s of this.streams.get(id) ?? [])
			sseWrite(s.res, event(s.seat), eventId)
	}

	private broadcastVersion(doc: GameDoc, state: GameState): void {
		if (!this.streams.has(doc.game.id)) return
		this.broadcast(
			doc.game.id,
			(seat) => ({
				type: 'version',
				gameId: doc.game.id,
				version: doc.game.version,
				toMove: decisionSeat(state),
				activeSeat: state.activeSeat,
				pending: this.pendingFor(doc, state, seat),
				status: doc.game.status,
				lastActivity: doc.game.updatedAt,
			}),
			doc.game.version,
		)
	}

	private broadcastPresence(id: string): void {
		const presence = this.presence(id)
		this.broadcast(id, () => ({ type: 'presence', gameId: id, presence }))
	}

	private indexDeadline(doc: GameDoc): void {
		const p = doc.game.pending
		if (p === null) this.deadlines.delete(doc.game.id)
		else this.deadlines.set(doc.game.id, Date.parse(p.deadline))
	}

	private async indexDeadlines(): Promise<void> {
		for (const id of await this.store.ids()) {
			try {
				const doc = await this.store.get(id)
				if (doc !== null && !isOpenDoc(doc)) this.indexDeadline(doc)
			} catch (err) {
				this.log(`index ${id}: ${(err as Error).message}`)
			}
		}
	}

	private startTimers(): void {
		const every = this.opts.deadlineCheckMs ?? 60_000
		if (every > 0) {
			const t = setInterval(() => void this.checkDeadlines(), every)
			t.unref()
			this.timers.push(t)
		}
		const beat = this.opts.heartbeatMs ?? 25_000
		if (beat > 0) {
			const t = setInterval(() => {
				for (const set of this.streams.values())
					for (const s of set)
						if (!s.res.writableEnded) s.res.write(': keep-alive\n\n')
			}, beat)
			t.unref()
			this.timers.push(t)
		}
	}

	private iso(): string {
		return new Date(this.now()).toISOString()
	}
}

function sseWrite(
	res: ServerResponse,
	event: GameStreamEvent,
	id?: number,
): void {
	if (res.writableEnded || res.destroyed) return
	const idLine = id === undefined ? '' : `id: ${id}\n`
	res.write(`event: ${event.type}\n${idLine}data: ${JSON.stringify(event)}\n\n`)
}
