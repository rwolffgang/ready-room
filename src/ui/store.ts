// Zustand store for the game flow (todo/14 §1). Owns:
//   - the session adapter (SetupConfig + intent log + incremental GameState)
//   - the derived *projection* the components actually render (hot-seat)
//   - the legality snapshot (what the active player may do right now)
//   - cross-component interaction state (in-situ selection rings, detail
//     overlay, hover) and the UI shell flags (log filter, drawers).
//
// The UI never mutates GameState. Every state change goes through
// `SessionAdapter.dispatch`/`settle` (which validate against `legalIntents` /
// `validateChoice` and throw on illegal intents), then the store re-snapshots
// `projected` + `legal` for subscribers. The session log remains the source of
// truth for undo/save/load (todo/17 §1).

import { create } from 'zustand'
import { registerCards } from '../engine/cards'
import type { SeatCredentials, StandingPolicy } from '../session/online'
import type { GuideSection } from './guide/ShorthandGuide'
import type { ReferenceTab } from './ReferenceTabs'
import { createOnlineController, type OnlineState } from './online/controller'

import type { BotBeat, GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import type { PendingChoice } from '../engine/resolver/choices'
import type { CardInstanceId } from '../engine/ids'
import type { Seat } from '../engine/resolver/queries'
import { createSession, checkCardData, type Session } from '../session/log'
import { SessionAdapter, IllegalIntentError } from '../session/adapter'
import {
	botFor,
	botLabel,
	decidersOf,
	hasBots,
	humanSeats,
	isSpectator,
	type Opponents,
} from '../session/opponents'
import { decisionSeat } from '../session/interrupts'
import type { BotId } from '../bot/types'
import { firstLegalPolicy, nextAutoIntent } from '../bot/autoPlay'
import {
	validateChoice,
	IllegalSelectionError,
} from '../engine/resolver/choices'
import {
	createInThreadRunner,
	decideWithInfo,
	isAbortError,
	type BotRunner,
} from './botRunner'
import { ruleInfo, type DecisionInfo } from '../bot/explain'
import {
	addBotIntent,
	botTurns,
	emptyBotLog,
	humanDecided,
	lastBotTurn,
	trimBotLog,
	type BotMoveLog,
	type Viewer,
} from './botMoves'
import { project, HIDDEN_DEF, type ProjectedState } from './projection'
import { poolDiff } from '../engine/fx'
import { residualChanges, type Motion } from './flow'
import { loadBrowserCatalog } from './browserCatalog'
import { getSessionStore, mirrorToDevServer } from './persistence'
import {
	singleLegalAction,
	type SingleLegalAction,
} from '../engine/queries/legality'

export type LogFilter = 'ALL' | 'MINE' | 'THEIRS'

/** Autosave cadence (todo/17 §1): save ~1 s after the last intent settles. */
export const AUTOSAVE_DEBOUNCE_MS = 1000

// ---------------------------------------------------------------------------
// Undo policy (todo/17 §2, choice (a)). Solo (CADET) undoes freely; hot-seat
// (TWO_PLAYER) limits take-backs to the active player's own turn — the undo
// button is disabled the moment the *last committed intent is a turn boundary*
// (START / PASS / END_TURN), so an opponent's turn (or a completed turn) is
// never rewound with the information it revealed. The adapter itself remains
// unrestricted (byte-exact truncate + replay); this is purely the UI gate.
// ---------------------------------------------------------------------------

export interface UndoPolicy {
	allowed: boolean
	reason: string | null
	/** How many logged intents one Undo truncates (1 except in a game against
	 *  the house AI, where it also takes back the bot's replies). */
	count: number
}

const isBoundary = (intent: Intent): boolean =>
	intent.t === 'START' || intent.t === 'PASS' || intent.t === 'END_TURN'

/**
 * The undo gate. `deciders[i]` is the seat that decided `session.log[i]`
 * (the store keeps it in step with the log); it only matters in a game
 * against the house AI (`session.opponents`):
 *
 *   - spectator (both seats bots): undo is off;
 *   - one human: Undo takes back the human's previous decision together with
 *     every bot intent after it (a bot's reaction, or the bot's whole turn
 *     after the human's clean-up choice), landing on that decision, so the
 *     bot does not simply replay. The hot-seat spirit holds: the human's own
 *     turn boundary (START / PASS / END_TURN) is never taken back.
 */
export function undoPolicy(
	session: Session | null,
	deciders?: readonly Seat[],
): UndoPolicy {
	if (session === null)
		return { allowed: false, reason: 'No game in progress.', count: 0 }
	const last = session.log[session.log.length - 1]
	if (last === undefined)
		return { allowed: false, reason: 'Nothing to undo yet.', count: 0 }
	if (session.setup.mode === 'CADET') {
		return {
			allowed: true,
			reason: 'Solo — take-backs enabled, undo freely.',
			count: 1,
		}
	}
	// the official solo Bot replies like the house AI: take back your last
	// decision and its steps after it, never past your turn's end
	if (session.setup.mode === 'SOLO' && deciders !== undefined)
		return botUndoPolicy(session, deciders, 0)
	if (hasBots(session.opponents) && deciders !== undefined)
		return botUndoPolicy(session, deciders)
	if (isBoundary(last)) {
		return {
			allowed: false,
			reason:
				"Hot-seat take-backs stop at your turn's end — the opponent's turn is never rewound.",
			count: 0,
		}
	}
	return {
		allowed: true,
		reason: 'Take-backs enabled within your own turn.',
		count: 1,
	}
}

function botUndoPolicy(
	session: Session,
	deciders: readonly Seat[],
	onlyHuman?: Seat,
): UndoPolicy {
	const humans =
		onlyHuman !== undefined ? [onlyHuman] : humanSeats(session.opponents)
	if (humans.length === 0)
		return {
			allowed: false,
			reason: 'Spectator game — undo is off.',
			count: 0,
		}
	const human = humans[0]!
	let i = Math.min(deciders.length, session.log.length) - 1
	while (i >= 0 && deciders[i] !== human) i--
	if (i < 0)
		return { allowed: false, reason: 'Nothing of yours to undo yet.', count: 0 }
	if (isBoundary(session.log[i]!))
		return {
			allowed: false,
			reason: "Take-backs stop at your turn's end — it is never rewound.",
			count: 0,
		}
	return {
		allowed: true,
		reason:
			onlyHuman !== undefined
				? 'Takes back your last decision and the Bot’s steps after it.'
				: 'Takes back your last decision and the House AI replies after it.',
		count: session.log.length - i,
	}
}

/** Short label shown next to the Undo control (todo/17 §2 "state it in the UI"). */
export function undoPolicyLabel(
	mode: Session['setup']['mode'] | undefined,
	opponents?: Opponents,
): string {
	if (mode === 'CADET') return 'Take-backs enabled — free undo (solo).'
	if (mode === 'SOLO')
		return 'Take-backs: undo your last decision and the Bot’s steps — stops at your turn’s end.'
	if (isSpectator(opponents)) return 'Spectator game — undo is off.'
	if (hasBots(opponents))
		return "Take-backs: undo your last decision and the House AI's replies — stops at your turn's end."
	return 'Take-backs: undo within your own turn — stops at a turn boundary.'
}

/** The single live adapter (one game at a time). Kept out of the store object
 *  so only the derived snapshots drive React renders; the adapter itself is
 *  mutable and owns the incremental state. */
let adapter: SessionAdapter | null = null

/** `deciders[i]` = the seat that decided `adapter.session.log[i]` (the undo
 *  gate of a game against the house AI needs it). Kept in step with the log
 *  by every commit / undo / start / resume. */
let deciders: Seat[] = []

// ---------------------------------------------------------------------------
// House AI driver (todo/15 §4). After every local commit the store "pumps":
// when the seat the game waits on (`decisionSeat`) is a bot in
// `session.opponents`, it asks the BotRunner for that bot's intent, waits a
// visible delay and commits the answer through the same path a human intent
// takes (motion snapshot, autosave, log), then pumps again — until a human
// seat must decide, the game is over, or a spectator game is paused.
//
// Cancellation: every lifecycle change (undo, new game, start, resume, leaving
// for an online game, swapping the runner) bumps `botGen` and aborts the
// in-flight request; an answer from an older generation, or for a state that
// is no longer the adapter's, is dropped, never dispatched.
// ---------------------------------------------------------------------------

export type BotSpeed = 'slow' | 'normal' | 'fast' | 'instant'

export const BOT_SPEEDS: readonly BotSpeed[] = [
	'slow',
	'normal',
	'fast',
	'instant',
]

/** The visible pause before a bot's move lands, per speed. A forced move
 *  (the only legal intent, e.g. Continue through an empty phase) takes a
 *  quarter of it. Thinking time counts against the delay. */
export const BOT_SPEED_MS: Record<BotSpeed, number> = {
	slow: 1400,
	normal: 600,
	fast: 200,
	instant: 0,
}

export function botDelay(speed: BotSpeed, forced: boolean): number {
	const ms = BOT_SPEED_MS[speed]
	return forced ? Math.round(ms / 4) : ms
}

const BOT_SPEED_KEY = 'ready-room:bot-speed'

function loadBotSpeed(): BotSpeed {
	try {
		const v = globalThis.localStorage?.getItem(BOT_SPEED_KEY)
		return BOT_SPEEDS.includes(v as BotSpeed) ? (v as BotSpeed) : 'normal'
	} catch {
		return 'normal'
	}
}

/** When the AI's turn opens by itself once yours begins: when it did
 *  something to you (default), after every AI turn, or only on request. */
export type BotRecap = 'hit' | 'always' | 'never'

export const BOT_RECAPS: readonly BotRecap[] = ['hit', 'always', 'never']

const BOT_RECAP_KEY = 'ready-room:bot-recap'

function loadBotRecap(): BotRecap {
	try {
		const v = globalThis.localStorage?.getItem(BOT_RECAP_KEY)
		return BOT_RECAPS.includes(v as BotRecap) ? (v as BotRecap) : 'hit'
	} catch {
		return 'hit'
	}
}

/** The turn whose recap last opened by itself (once per AI turn). */
let recapShownTurn: number | null = null

let botRunner: BotRunner = createInThreadRunner()
let botGen = 0
let botAbort: AbortController | null = null
let botTimer: ReturnType<typeof setTimeout> | null = null
let botBusy = false
/** One bot intent may run while a spectator game is paused (Step). */
let botStep = false

/** Swap where the house AI thinks (e.g. a Web Worker runner). The previous
 *  runner is disposed and any in-flight decision dropped; a bot that must
 *  move is asked again on the new runner. */
export function setBotRunner(runner: BotRunner): void {
	cancelBot()
	const old = botRunner
	botRunner = runner
	if (old !== runner) old.dispose()
	pumpBot()
}

export function getBotRunner(): BotRunner {
	return botRunner
}

/** Drop any in-flight bot decision (it will never be dispatched). */
function cancelBot(): void {
	botGen++
	botAbort?.abort()
	botAbort = null
	if (botTimer !== null) clearTimeout(botTimer)
	botTimer = null
	botBusy = false
	botStep = false
	if (useGameStore.getState().botThinking !== null)
		useGameStore.setState({ botThinking: null })
}

/** Stop the house AI (tests / teardown): cancels the in-flight decision. */
export function stopBots(): void {
	cancelBot()
}

/** The bot the game waits on right now (local play only), or null. */
function botToMove(): BotId | null {
	if (adapter === null || onlineController.active()) return null
	const seat = decisionSeat(adapter.state)
	if (seat === null) return null
	return botFor(adapter.session.opponents, seat) ?? null
}

/** Is `intent` a legal answer in `state`? A RESOLVE_CHOICE must answer the
 *  open choice (same choiceId) with a valid selection; anything else must be
 *  one of `legal` (structurally). */
function acceptable(
	state: GameState,
	legal: Intent[],
	intent: Intent,
): boolean {
	if (typeof intent !== 'object' || intent === null) return false
	const choice = state.pendingChoice
	if (intent.t === 'RESOLVE_CHOICE')
		return (
			choice !== null &&
			intent.choiceId === choice.id &&
			validateChoice(state, intent.choiceId, intent.selection).ok
		)
	if (choice !== null) return false
	const key = JSON.stringify(intent)
	return legal.some((l) => JSON.stringify(l) === key)
}

/** Commit an intent to the live adapter and re-snapshot (the shared path of
 *  human and bot intents). Throws when the adapter rejects it. */
function commit(intent: Intent, decider: Seat): void {
	const a = adapter!
	const viewerSeat = useGameStore.getState().viewerSeat
	const before = a.state
	a.dispatch(intent)
	deciders.length = Math.min(deciders.length, a.session.log.length - 1)
	deciders.push(decider)
	const snap = snapshot(viewerSeat)
	useGameStore.setState({
		...snap,
		motion: motionOf(before, a.state, snap.projected),
		...(intent.t === 'RESOLVE_CHOICE' || isBoundary(intent)
			? { selected: [] }
			: {}),
	})
}

/** Ask the bot that must move (if any) for its intent and commit it after the
 *  visible delay; then pump again. A no-op while a decision is in flight. */
function pumpBot(): void {
	if (botBusy) return
	if (pumpSoloBot()) return
	const botId = botToMove()
	const st = useGameStore.getState()
	if (adapter === null || botId === null || (st.botPaused && !botStep)) {
		if (st.botThinking !== null) useGameStore.setState({ botThinking: null })
		if (botId === null) showBotRecap()
		return
	}
	const stepping = botStep
	botStep = false
	const state = adapter.state
	const seat = decisionSeat(state)!
	const legal = adapter.legalIntents
	if (legal.length === 0) {
		useGameStore.setState({ botThinking: null })
		return
	}
	const gen = botGen
	const ctrl = new AbortController()
	botAbort = ctrl
	botBusy = true
	const started = performance.now()
	const forced = state.pendingChoice === null && legal.length === 1
	const delay = stepping ? 0 : botDelay(st.botSpeed, forced)
	useGameStore.setState({ botThinking: { seat, botId } })

	const stale = () =>
		gen !== botGen || ctrl.signal.aborted || adapter?.state !== state

	let asked: Promise<{ intent: Intent; info?: DecisionInfo | undefined }>
	try {
		asked = decideWithInfo(botRunner, state, seat, legal, botId, ctrl.signal)
	} catch (e) {
		asked = Promise.reject(e)
	}
	void asked
		.then(
			({ intent, info }) => ({ intent, info, failed: false }),
			(e: unknown) => ({
				intent: undefined,
				info: undefined,
				failed: !isAbortError(e),
			}),
		)
		.then(({ intent, info, failed }) => {
			if (stale()) {
				// a superseded generation was already reset by cancelBot; a state
				// that moved on without one is re-pumped from where it is now
				if (gen === botGen) {
					botBusy = false
					botAbort = null
					pumpBot()
				}
				return
			}
			let chosen =
				intent !== undefined && acceptable(state, legal, intent)
					? intent
					: undefined
			let warning: string | null = null
			if (chosen === undefined) {
				chosen = nextAutoIntent(state, legal, firstLegalPolicy)
				warning = `${botLabel(botId)} ${failed || intent === undefined ? 'failed to decide' : 'chose an illegal move'} — it played the first legal option instead.`
			}
			const wait = Math.max(0, delay - (performance.now() - started))
			botTimer = setTimeout(() => {
				botTimer = null
				if (stale()) return
				botBusy = false
				botAbort = null
				if (warning !== null) useGameStore.setState({ warning })
				const explained =
					warning === null
						? (info ?? null)
						: ruleInfo(botId, 'rule', 'fell back to the first legal option')
				if (!commitBot(chosen, seat, state, legal, botId, explained)) return
				pumpBot()
			}, wait)
		})
}

/** How long each beat of the official solo Bot's turn stays on screen, as a
 *  multiple of the bot speed: a resolved card and its row stay longest, long
 *  enough to read the row. */
const BEAT_PACE: Record<BotBeat, number> = {
	CONTROL: 1.5,
	DRAW: 1.5,
	RESOLVE: 4,
	STARDATE: 1.5,
	CLEANUP: 1.5,
}

/** The official solo Bot's turn (rules/13 §13.4): when its next beat is the
 *  only legal move, commit a BOT_STEP after the beat's delay, then pump again.
 *  It never decides anything — the engine plays its rows — so no runner is
 *  asked. True when it has (or will have) moved, so the house-AI pump stays
 *  out of it. */
function pumpSoloBot(): boolean {
	if (adapter === null || onlineController.active()) return false
	const state = adapter.state
	if (state.mode !== 'SOLO' || state.result !== null) return false
	const legal = adapter.legalIntents
	if (legal.length !== 1 || legal[0]!.t !== 'BOT_STEP') return false
	const st = useGameStore.getState()
	if (st.botPaused && !botStep) return true
	const stepping = botStep
	botStep = false
	// the beat on screen (the one just narrated) sets how long it stays
	const beat =
		state.solo?.beat?.beat ??
		(state.phase.k === 'BOT' ? state.phase.beat : 'CONTROL')
	const delay = stepping
		? 0
		: Math.round(botDelay(st.botSpeed, false) * BEAT_PACE[beat])
	const gen = botGen
	botBusy = true
	botTimer = setTimeout(() => {
		botTimer = null
		botBusy = false
		if (gen !== botGen || adapter?.state !== state) {
			pumpBot()
			return
		}
		try {
			commit(legal[0]!, state.solo?.bot ?? 1)
		} catch (e) {
			useGameStore.setState({
				botPaused: true,
				error: `The Bot could not take its step: ${e instanceof Error ? e.message : String(e)}`,
			})
			return
		}
		pumpBot()
	}, delay)
	return true
}

/** Commit a bot's (validated) intent; on an engine rejection fall back to the
 *  first legal option once, and stop the bots if even that fails. */
function commitBot(
	intent: Intent | undefined,
	seat: Seat,
	state: GameState,
	legal: Intent[],
	botId: BotId,
	info: DecisionInfo | null,
): boolean {
	const attempts: (Intent | undefined)[] = [
		intent,
		nextAutoIntent(state, legal, firstLegalPolicy),
	]
	for (let i = 0; i < attempts.length; i++) {
		const attempt = attempts[i]
		if (attempt === undefined) continue
		try {
			commit(attempt, seat)
		} catch {
			continue // try the fallback
		}
		recordBotMove(
			attempt,
			seat,
			botId,
			state,
			i === 0
				? info
				: ruleInfo(botId, 'rule', 'fell back to the first legal option'),
		)
		return true
	}
	useGameStore.setState({
		botThinking: null,
		botPaused: true,
		error: 'The House AI could not find a legal move — the bots are paused.',
	})
	return false
}

/** Who the bot-move history is recorded for: the one human (masked), or
 *  nobody in a spectator game (botMoves.ts). */
function moveViewer(): Viewer {
	const humans = humanSeats(adapter?.session.opponents)
	return { seat: humans.length === 0 ? null : humans[0]! }
}

/** Add a just-committed bot intent to the move history (botMoves.ts). */
function recordBotMove(
	intent: Intent,
	seat: Seat,
	botId: BotId,
	before: GameState,
	info: DecisionInfo | null,
): void {
	const a = adapter
	if (a === null) return
	try {
		const botLog = addBotIntent(
			useGameStore.getState().botLog,
			{
				seat,
				botId,
				intent,
				info,
				before,
				after: a.state,
				logIndex: a.session.log.length - 1,
			},
			moveViewer(),
		)
		useGameStore.setState({ botLog })
	} catch {
		// the history is a convenience: never let it break play
	}
}

/** A fresh history (new game, resume, online), keeping ids increasing. */
function resetBotLog(): BotMoveLog {
	recapShownTurn = null
	return { ...emptyBotLog(), nextId: useGameStore.getState().botLog.nextId }
}

/** Your turn has begun after an AI turn: open that turn's recap (the move
 *  history) once, if the setting asks for it. */
function showBotRecap(): void {
	const st = useGameStore.getState()
	const viewer = moveViewer().seat
	if (
		adapter === null ||
		viewer === null ||
		st.botRecap === 'never' ||
		st.botHistoryOpen ||
		adapter.state.activeSeat !== viewer ||
		decisionSeat(adapter.state) !== viewer
	)
		return
	const turn = lastBotTurn(botTurns(st.botLog.moves, viewer))
	if (turn === undefined || turn.turn === recapShownTurn) return
	if (st.botRecap === 'hit' && turn.hits.length === 0) return
	recapShownTurn = turn.turn
	useGameStore.setState({ botHistoryOpen: true, whyMove: null })
}

/** A human decided: the AI's running burst of moves is over. */
function noteHumanDecision(): void {
	const log = useGameStore.getState().botLog
	const next = humanDecided(log)
	if (next !== log) useGameStore.setState({ botLog: next })
}

/**
 * Click vs double-click disambiguation for cards. A plain single click opens
 * the card detail view; a double-click is the fast path that runs a card's
 * one legal action. A single click must not open the detail before a possible
 * second click (the modal backdrop would swallow it), so the detail-open is
 * deferred by this window when the card currently has a single legal action —
 * a second click on the same card within the window cancels the pending open
 * and runs the action instead.
 */
export const DETAIL_CLICK_WINDOW_MS = 300

let pendingDetail: {
	iid: CardInstanceId
	timer: ReturnType<typeof setTimeout>
} | null = null

function cancelPendingDetail(): void {
	if (pendingDetail !== null) {
		clearTimeout(pendingDetail.timer)
		pendingDetail = null
	}
}

/** Schedule the detail view to open for `iid` once the double-click window
 *  has passed (i.e. the click really was a single click). */
function scheduleDetailOpen(iid: CardInstanceId): void {
	pendingDetail = {
		iid,
		timer: setTimeout(() => {
			pendingDetail = null
			const st = useGameStore.getState()
			// Guard against the window spanning a game/lifecycle transition.
			if (st.state === null) return
			if (st.state.cards[iid] === undefined) return
			if (st.state.pendingChoice !== null) return
			st.setDetail(iid)
		}, DETAIL_CLICK_WINDOW_MS),
	}
}

/** Dispatch the card's single legal action, but only if the store's legality
 *  snapshot still offers it (mirrors the same gate the detail row uses, so a
 *  stale probe can never flash an error). */
function runSingleAction(iid: CardInstanceId, action: SingleLegalAction): void {
	const s = useGameStore.getState()
	const intent: Intent =
		action.kind === 'PLAY'
			? { t: 'PLAY_CARD', iid, operationIndex: action.operationIndex }
			: { t: 'ACTIVATE', iid, operationIndex: action.operationIndex }
	const isLegal = s.legal.some(
		(it) =>
			it.t === intent.t &&
			it.iid === iid &&
			'operationIndex' in it &&
			it.operationIndex === intent.operationIndex,
	)
	if (!isLegal) return
	s.dispatch(intent)
}

export interface GameStore {
	catalog: CardCatalog | null
	session: Session | null
	/** Raw immutable GameState kept for legality/pending-choice logic — the
	 *  components must NOT read this directly; render through `projected`. */
	state: GameState | null
	projected: ProjectedState | null
	legal: Intent[]
	pendingChoice: PendingChoice | null
	viewerSeat: Seat
	// interaction
	selected: CardInstanceId[] // current choice's in-progress selection (in-situ rings)
	detailIid: CardInstanceId | null
	hoverIid: CardInstanceId | null
	/** Option/Alt is down: hovering a card zooms it centre stage. Held-key
	 *  state, not a toggle — released or blurred, it is false. */
	zoomHeld: boolean
	/** A card zoomed without Option (console/longPress.ts): held under a
	 *  finger until it lifts — the touch twin of Option-hover — or, when
	 *  `zoomPinned`, opened by a right click until a click or Esc closes it. */
	zoomIid: CardInstanceId | null
	zoomPinned: boolean
	destinationDefault: 'DECK_TOP' | 'DISCARD' | null
	// shell flags
	rulesOpen: boolean
	cardListOpen: boolean
	deckReviewOpen: boolean
	/** The reference menu's last tab: its one button reopens it there. */
	referenceTab: ReferenceTab
	/** The settings drawer (layout, theme, House AI speed, card faces). */
	settingsOpen: boolean
	logFilter: LogFilter
	error: string | null
	/** Dismissible informational notice (resume card-data drift, undo refusal,
	 *  autosave failure) — distinct from `error`, which is reserved for real
	 *  failures that block the current action. */
	warning: string | null
	/** Whether the undo button may act right now (undoPolicy). */
	canUndo: boolean
	/** The house-AI level the game waits on right now (local play), or null
	 *  when a human (or nobody) must decide. While set, `legal` is empty: no
	 *  human input is accepted. */
	botToMove: BotId | null
	/** A bot decision in flight (the "thinking" indicator), or null. */
	botThinking: { seat: Seat; botId: BotId } | null
	/** Spectator controls: the bots stop before their next intent. */
	botPaused: boolean
	/** How long a bot's move stays visible (BOT_SPEED_MS); per device. */
	botSpeed: BotSpeed
	/** When the AI's turn opens by itself once yours begins; per device. */
	botRecap: BotRecap
	/** The house AI's recent moves (botMoves.ts): the ticker, the move
	 *  history and the "Why?" panel read it. Cleared on a new game / resume,
	 *  trimmed on undo. */
	botLog: BotMoveLog
	/** The AI move history is open; `whyMove` is the move whose "Why?" panel
	 *  is expanded in it (or null). */
	botHistoryOpen: boolean
	whyMove: number | null
	/** Token movement of the last dispatch/settle, for the flight layer and
	 *  delta badges (flow.ts). Null after anything that is not play — undo,
	 *  passing the device, loading — so those never animate. */
	motion: Motion | null
	/** Debug escape hatch (todo/15 §2): when on, the projection shows every
	 *  card — no hiding. Behind a DEV flag in the UI. */
	revealAll: boolean
	/** The open online game (docs/ui-mobile.md §7), or null for local play.
	 *  While set, `projected` / `legal` / `pendingChoice` / `viewerSeat` /
	 *  `canUndo` come from the server's seat view and `state` / `session` stay
	 *  null: there is no local engine state to read. */
	online: OnlineState | null
	/** The Shorthand guide's open section, or null (src/ui/guide). */
	guide: GuideSection | null
	/** the Five-Year Mission whose logbook is open, between its games */
	campaignOpen: string | null
	/** Phase B: when off (default), cards show their printed card art; when
	 *  on, they render the full text card (name/traits/ops). In-memory only —
	 *  a deliberate preference, not part of a save. */
	showCardDetails: boolean
	// actions
	loadCatalog: () => void
	newGame: () => void
	/** `opponents`: the house-AI seats (absent = hot-seat); `campaignId`: the
	 *  Five-Year Mission the game belongs to. */
	startGame: (
		config: SetupConfig,
		opponents?: Opponents,
		opts?: { campaignId?: string | undefined },
	) => void
	resumeGame: (session: Session) => void
	dispatch: (intent: Intent) => void
	settle: (selection: unknown) => void
	undo: () => void
	setViewer: (seat: Seat) => void
	setBotPaused: (paused: boolean) => void
	/** Paused spectator game: let exactly one bot intent run. */
	stepBot: () => void
	setBotSpeed: (speed: BotSpeed) => void
	setBotRecap: (recap: BotRecap) => void
	/** Open / close the AI move history, optionally on one move's "Why?". */
	openBotHistory: (whyMove?: number | null) => void
	closeBotHistory: () => void
	cardClicked: (iid: CardInstanceId) => void
	setSelected: (iids: CardInstanceId[]) => void
	clearSelection: () => void
	setDetail: (iid: CardInstanceId | null) => void
	setHoverIid: (iid: CardInstanceId | null) => void
	setZoomHeld: (held: boolean) => void
	setZoomIid: (iid: CardInstanceId | null, pinned?: boolean) => void
	setDestinationDefault: (d: 'DECK_TOP' | 'DISCARD') => void
	setRulesOpen: (b: boolean) => void
	setCardListOpen: (b: boolean) => void
	setDeckReviewOpen: (b: boolean) => void
	/** Open the reference menu on `tab` (default: the last one); its panels
	 *  are exclusive, so this closes the others. */
	openReference: (tab?: ReferenceTab) => void
	setSettingsOpen: (b: boolean) => void
	setLogFilter: (f: LogFilter) => void
	setRevealAll: (b: boolean) => void
	setShowCardDetails: (b: boolean) => void
	clearError: () => void
	clearWarning: () => void
	openGuide: (section?: GuideSection) => void
	closeGuide: () => void
	openCampaign: (id: string | null) => void
	// online play (src/ui/online/controller.ts)
	openOnline: (creds: SeatCredentials) => void
	closeOnline: () => void
	setStandingOrder: (cardDef: string, policy: StandingPolicy) => void
	showRecap: () => void
	dismissRecap: () => void
}

type SnapshotFields = Pick<
	GameStore,
	| 'state'
	| 'session'
	| 'projected'
	| 'legal'
	| 'pendingChoice'
	| 'canUndo'
	| 'motion'
	| 'botToMove'
>

/** Re-derive the projection + legality + undo gate from the adapter (cheap:
 *  one deep copy + the legality probe + the undo policy). Components only ever
 *  subscribe to these. */
function snapshot(viewerSeat: Seat): SnapshotFields {
	if (adapter === null) {
		return {
			state: null,
			session: null,
			projected: null,
			legal: [],
			pendingChoice: null,
			canUndo: false,
			motion: null,
			botToMove: null,
		}
	}
	const revealAll = useGameStore.getState().revealAll
	const bot = botToMove()
	return {
		state: adapter.state,
		session: adapter.session,
		projected: project(adapter.state, viewerSeat, revealAll),
		legal: bot !== null ? [] : adapter.legalIntents,
		pendingChoice: adapter.state.pendingChoice,
		canUndo: undoPolicy(adapter.session, deciders).allowed,
		motion: null,
		botToMove: bot,
	}
}

let motionSeq = 0

/** What one dispatch moved: the fx entries it appended (a source card hidden
 *  from the viewer is redacted to null) and the phase bookkeeping no entry
 *  explains. Null when nothing moved. */
function motionOf(
	before: GameState,
	after: GameState,
	projected: ProjectedState | null,
): Motion | null {
	if (before === after) return null
	const hidden = (iid: string) => projected?.cards[iid]?.def === HIDDEN_DEF
	const fx = after.fx.slice(before.fx.length).map((e) => ({
		source: e.source !== null && hidden(e.source) ? null : e.source,
		changes: e.changes.filter(
			(c) => c.pool.k !== 'CARD' || !hidden(c.pool.iid),
		),
	}))
	const residual = residualChanges(poolDiff(before, after), fx).filter(
		(c) => c.pool.k !== 'CARD' || !hidden(c.pool.iid),
	)
	if (fx.every((e) => e.changes.length === 0) && residual.length === 0)
		return null
	return {
		seq: ++motionSeq,
		fx,
		residual,
		logFrom: before.log.length,
	}
}

/** Autosave hook (todo/17 §1): a rejected save must never crash the game or
 *  leave an unhandled rejection — surface it as a dismissible notice instead. */
function saveQuiet(session: Session): void {
	mirrorToDevServer(session)
	void getSessionStore()
		.save(session)
		.catch(() => {
			useGameStore.setState((prev) =>
				prev.warning === null
					? { warning: 'Autosave failed — this game is not being persisted.' }
					: {},
			)
		})
}

/** Build the adapter wired for autosave. Persists immediately (so a fresh game
 *  shows in the load list right away) and debounced after every commit via the
 *  adapter's own timer. */
function makeAdapter(session: Session, catalog: CardCatalog): SessionAdapter {
	return new SessionAdapter({
		session,
		catalog,
		persist: (s) => saveQuiet(s),
		autosaveDebounceMs: AUTOSAVE_DEBOUNCE_MS,
	})
}

/** Where the device's view sits at the start of a game: pinned to the one
 *  human against the house AI, seat 0 for a spectator game, else `hotSeat`
 *  (whoever moves, in hot-seat). */
function initialViewer(
	opponents: Opponents | undefined,
	hotSeat: Seat,
	mode?: GameState['mode'],
): Seat {
	// against the official solo Bot the device is the human's (seat 0)
	if (mode === 'SOLO') return 0
	const humans = humanSeats(opponents)
	if (humans.length === 1) return humans[0]!
	if (humans.length === 0) return 0
	return hotSeat
}

export const useGameStore = create<GameStore>((set) => ({
	catalog: null,
	session: null,
	state: null,
	projected: null,
	legal: [],
	pendingChoice: null,
	viewerSeat: 0,
	selected: [],
	detailIid: null,
	hoverIid: null,
	zoomHeld: false,
	zoomIid: null,
	zoomPinned: false,
	destinationDefault: null,
	rulesOpen: false,
	cardListOpen: false,
	deckReviewOpen: false,
	referenceTab: 'rules',
	settingsOpen: false,
	logFilter: 'ALL',
	error: null,
	warning: null,
	canUndo: false,
	motion: null,
	botToMove: null,
	botThinking: null,
	botPaused: false,
	botSpeed: loadBotSpeed(),
	botRecap: loadBotRecap(),
	botLog: emptyBotLog(),
	botHistoryOpen: false,
	whyMove: null,
	revealAll: false,
	showCardDetails: false,
	online: null,
	guide: null,
	campaignOpen: null,

	loadCatalog: () => {
		if (useGameStore.getState().catalog !== null) return
		try {
			const catalog = loadBrowserCatalog()
			set({ catalog })
		} catch (e) {
			set({ error: (e as Error).message })
		}
	},

	newGame: () => {
		cancelPendingDetail()
		cancelBot()
		onlineController.close()
		adapter?.dispose()
		adapter = null
		deciders = []
		set({
			botToMove: null,
			botPaused: false,
			botLog: resetBotLog(),
			botHistoryOpen: false,
			whyMove: null,
			online: null,
			session: null,
			state: null,
			projected: null,
			legal: [],
			pendingChoice: null,
			canUndo: false,
			motion: null,
			selected: [],
			detailIid: null,
			hoverIid: null,
			zoomIid: null,
			zoomPinned: false,
			rulesOpen: false,
			cardListOpen: false,
			deckReviewOpen: false,
			settingsOpen: false,
			error: null,
			warning: null,
		})
	},

	startGame: (config, opponents, opts) => {
		cancelPendingDetail()
		cancelBot()
		onlineController.close()
		set({ online: null })
		try {
			let catalog = useGameStore.getState().catalog
			if (catalog === null) {
				catalog = loadBrowserCatalog()
			}
			const session = createSession(config, catalog, {
				opponents,
				campaignId: opts?.campaignId,
			})
			adapter?.dispose()
			adapter = makeAdapter(session, catalog)
			deciders = []
			// A new game opens on its first turn: SETUP → RESUPPLY has nothing to
			// decide, so the device takes the START step instead of asking for a
			// second "Start game" click.
			if (adapter.state.phase.k === 'SETUP') {
				deciders.push(decisionSeat(adapter.state) ?? adapter.state.activeSeat)
				adapter.dispatch({ t: 'START' })
			}
			// The device starts with whoever goes first (hot-seat "pass the device"
			// flow; docs/ui-spec.md §1) — against the house AI it stays with the
			// human for the whole game.
			const viewerSeat: Seat = initialViewer(
				session.opponents,
				adapter.state.startingSeat,
				session.setup.mode,
			)
			set({
				botPaused: false,
				botLog: resetBotLog(),
				botHistoryOpen: false,
				whyMove: null,
				catalog,
				viewerSeat,
				selected: [],
				detailIid: null,
				hoverIid: null,
				zoomIid: null,
				zoomPinned: false,
				destinationDefault: null,
				error: null,
				warning: null,
				...snapshot(viewerSeat),
			})
			// Persist right away so the session is on the load list even before the
			// player's first intent (todo/17 §1 "the load screen is browsable").
			saveQuiet(adapter.session)
			pumpBot()
		} catch (e) {
			set({ error: (e as Error).message })
		}
	},

	resumeGame: (session) => {
		cancelPendingDetail()
		cancelBot()
		onlineController.close()
		set({ online: null })
		try {
			let catalog = useGameStore.getState().catalog
			if (catalog === null) {
				catalog = loadBrowserCatalog()
			}
			adapter?.dispose()
			adapter = makeAdapter(session, catalog)
			deciders = decidersOf(session.setup, session.log, catalog)
			// Continue wherever the save left off (hot-seat: the viewer follows the
			// active seat; docs/ui-spec.md §1; against the house AI: the human).
			const viewerSeat: Seat = initialViewer(
				session.opponents,
				adapter.state.activeSeat,
				session.setup.mode,
			)
			let warning: string | null = null
			const drift = checkCardData(session, catalog)
			if (!drift.ok) {
				warning =
					'Card data has changed since this save was made — the log may replay differently than the original game.'
			}
			set({
				catalog,
				viewerSeat,
				botPaused: false,
				botLog: resetBotLog(),
				botHistoryOpen: false,
				whyMove: null,
				selected: [],
				detailIid: null,
				hoverIid: null,
				zoomIid: null,
				zoomPinned: false,
				destinationDefault: null,
				error: null,
				warning,
				...snapshot(viewerSeat),
			})
			saveQuiet(adapter.session)
			pumpBot()
		} catch (e) {
			set({ warning: null, error: (e as Error).message })
		}
	},

	dispatch: (intent) => {
		if (onlineController.active()) {
			onlineController.submit(intent)
			if (intent.t !== 'PLAY_CARD' && intent.t !== 'ACTIVATE')
				set({ selected: [] })
			return
		}
		if (adapter === null) return
		// the house AI is to move: no human input is taken (the UI is dark)
		if (botToMove() !== null) return
		try {
			const decider = decisionSeat(adapter.state) ?? adapter.state.activeSeat
			commit(intent, decider)
		} catch (e) {
			set({ error: (e as Error).message })
			return
		}
		noteHumanDecision()
		pumpBot()
	},

	settle: (selection) => {
		if (onlineController.active()) {
			onlineController.settle(selection)
			set({ selected: [] })
			return
		}
		if (adapter === null) return
		if (botToMove() !== null) return
		const choice = adapter.state.pendingChoice
		try {
			if (choice === null)
				throw new IllegalIntentError('nothing to settle — no PendingChoice')
			const v = validateChoice(adapter.state, choice.id, selection)
			if (!v.ok) throw new IllegalSelectionError(v.reason)
			commit(
				{ t: 'RESOLVE_CHOICE', choiceId: choice.id, selection },
				choice.seat,
			)
		} catch (e) {
			set({ error: (e as Error).message })
			return
		}
		noteHumanDecision()
		pumpBot()
	},

	undo: () => {
		if (onlineController.active()) {
			onlineController.undo()
			set({ selected: [], detailIid: null })
			return
		}
		if (adapter === null) return
		const viewerSeat = useGameStore.getState().viewerSeat
		const policy = undoPolicy(adapter.session, deciders)
		if (!policy.allowed) {
			// The button is disabled when !canUndo, so this is a programmatic guard
			// (keyboard / test) — reflect the refusal instead of silently no-op'ing.
			set({ warning: policy.reason })
			return
		}
		// a bot decision in flight belongs to the state being taken back
		cancelBot()
		if (!adapter.undo(policy.count)) return
		deciders = deciders.slice(0, adapter.session.log.length)
		set({
			botLog: trimBotLog(
				useGameStore.getState().botLog,
				adapter.session.log.length,
			),
			whyMove: null,
			...snapshot(viewerSeat),
			selected: [],
			detailIid: null,
			error: null,
			warning: null,
		})
		// Against the house AI the undo lands on the human's own decision, so
		// this is a no-op there (the bot must not simply replay its move); it
		// only runs a bot that is genuinely the one to decide.
		pumpBot()
	},

	setViewer: (seat) => {
		cancelPendingDetail()
		// online, this device is its seat
		if (adapter === null || onlineController.active()) return
		// against the house AI or the official solo Bot the device belongs to
		// the one human
		if (
			humanSeats(adapter.session.opponents).length === 1 ||
			adapter.session.setup.mode === 'SOLO'
		)
			return
		set({ viewerSeat: seat, selected: [], detailIid: null, ...snapshot(seat) })
	},

	setBotPaused: (paused) => {
		if (paused) {
			// the decision in flight is dropped; Resume asks again
			cancelBot()
			set({ botPaused: true, botThinking: null })
			return
		}
		set({ botPaused: false })
		pumpBot()
	},

	stepBot: () => {
		if (!useGameStore.getState().botPaused || botBusy) return
		botStep = true
		pumpBot()
		// nothing to step (a human or nobody must move)
		if (!botBusy) botStep = false
	},

	setBotSpeed: (speed) => {
		try {
			globalThis.localStorage?.setItem(BOT_SPEED_KEY, speed)
		} catch {
			// per-device convenience only
		}
		set({ botSpeed: speed })
	},

	setBotRecap: (recap) => {
		try {
			globalThis.localStorage?.setItem(BOT_RECAP_KEY, recap)
		} catch {
			// per-device convenience only
		}
		set({ botRecap: recap })
	},

	openBotHistory: (whyMove = null) => set({ botHistoryOpen: true, whyMove }),
	closeBotHistory: () => set({ botHistoryOpen: false, whyMove: null }),

	cardClicked: (iid) => {
		const { selected, state, viewerSeat, pendingChoice, botToMove } =
			useGameStore.getState()
		// the house AI is deciding: a click only inspects the card
		if (botToMove !== null) {
			cancelPendingDetail()
			set({ detailIid: iid })
			return
		}
		const choice: PendingChoice | null = pendingChoice
		if (choice !== null) {
			switch (choice.k) {
				case 'CHOOSE_CARDS':
					if (choice.candidates.includes(iid)) {
						const max = choice.max
						const next = selected.includes(iid)
							? selected.filter((c) => c !== iid)
							: max === 1
								? [iid]
								: selected.length < max
									? [...selected, iid]
									: selected
						set({ selected: next })
					}
					break
				case 'CHOOSE_LOCATION':
					if (choice.candidates.includes(iid)) set({ selected: [iid] })
					break
				default:
					set({ detailIid: iid })
			}
			return
		}
		// online there is no engine state to probe: a click opens the detail
		if (state === null) {
			set({ detailIid: iid })
			return
		}
		// No pending choice. A plain single click opens the detail view; the
		// second click of a double-click runs the card's *single* legal action.
		// Only disambiguate when the card actually has a single legal action for
		// the viewer's turn right now — everything else (blocked, multi-route,
		// not your turn) opens the detail immediately, no delay.
		const actionable =
			state.phase.k === 'ACTION' && state.activeSeat === viewerSeat
		const unique = actionable ? singleLegalAction(state, viewerSeat, iid) : null
		if (unique === null) {
			cancelPendingDetail()
			set({ detailIid: iid })
			return
		}
		if (pendingDetail !== null && pendingDetail.iid === iid) {
			// Second click inside the double-click window → run the one action.
			cancelPendingDetail()
			runSingleAction(iid, unique)
			return
		}
		cancelPendingDetail()
		scheduleDetailOpen(iid)
	},

	setSelected: (iids) => set({ selected: iids }),
	clearSelection: () => set({ selected: [] }),
	setDetail: (iid) => set({ detailIid: iid }),
	setHoverIid: (iid) => set({ hoverIid: iid }),
	setZoomHeld: (held) => set({ zoomHeld: held }),
	setZoomIid: (iid, pinned = false) =>
		set({ zoomIid: iid, zoomPinned: iid !== null && pinned }),
	setDestinationDefault: (d) => set({ destinationDefault: d }),
	setRulesOpen: (b) =>
		b ? useGameStore.getState().openReference('rules') : set({ rulesOpen: b }),
	setCardListOpen: (b) =>
		b
			? useGameStore.getState().openReference('cards')
			: set({ cardListOpen: b }),
	setDeckReviewOpen: (b) =>
		b
			? useGameStore.getState().openReference('decks')
			: set({ deckReviewOpen: b }),
	openReference: (tab) => {
		const s = useGameStore.getState()
		const t = tab ?? s.referenceTab
		if (t !== 'rules') s.loadCatalog()
		set({
			referenceTab: t,
			settingsOpen: false,
			rulesOpen: t === 'rules',
			cardListOpen: t === 'cards',
			deckReviewOpen: t === 'decks',
			guide: t === 'shorthand' ? (s.guide ?? 'learn') : null,
		})
	},
	setSettingsOpen: (b) => set({ settingsOpen: b }),
	setLogFilter: (f) => set({ logFilter: f }),
	setRevealAll: (b) => {
		const viewerSeat = useGameStore.getState().viewerSeat
		set({ revealAll: b, ...snapshot(viewerSeat) })
	},
	setShowCardDetails: (b) => set({ showCardDetails: b }),
	clearError: () => set({ error: null }),
	clearWarning: () => set({ warning: null }),

	openGuide: (section = 'learn') => {
		useGameStore.getState().openReference('shorthand')
		set({ guide: section })
	},
	closeGuide: () => set({ guide: null }),
	openCampaign: (id) => set({ campaignOpen: id }),

	openOnline: (creds) => {
		cancelPendingDetail()
		cancelBot()
		adapter?.dispose()
		adapter = null
		deciders = []
		set({ botLog: resetBotLog(), botHistoryOpen: false, whyMove: null })
		// engine helpers (scoring, tile legality, describe) look cards up in the
		// engine registry, which local play fills in setup(); online there is
		// no local setup, so register the catalogue here (idempotent per id)
		let catalog = useGameStore.getState().catalog
		try {
			if (catalog === null) {
				catalog = loadBrowserCatalog()
				set({ catalog })
			}
			registerCards([...catalog.defs, ...catalog.stardates.map((st) => st.def)])
		} catch (e) {
			set({ error: (e as Error).message })
			return
		}
		set({
			detailIid: null,
			hoverIid: null,
			zoomIid: null,
			zoomPinned: false,
			destinationDefault: null,
		})
		onlineController.open(creds)
	},
	closeOnline: () => useGameStore.getState().newGame(),
	setStandingOrder: (cardDef, policy) =>
		onlineController.setStandingOrder(cardDef, policy),
	showRecap: () => onlineController.refreshRecap(),
	dismissRecap: () => onlineController.dismissRecap(),
}))

/** The online half of the store: it writes the seat view into the same fields
 *  local play fills (src/ui/online/controller.ts). */
const onlineController = createOnlineController({
	set: (patch) => useGameStore.setState(patch as Partial<GameStore>),
	online: () => useGameStore.getState().online,
	pendingChoice: () => useGameStore.getState().pendingChoice,
})

// ---------------------------------------------------------------------------
// Component hooks
// ---------------------------------------------------------------------------

/** The projected state for the current viewer — the ONLY thing components
 *  render. Stable reference between actions (zustand selector safety). */
export function useProjected(): ProjectedState | null {
	return useGameStore((s) => s.projected)
}

/** The real (un-projected) engine state — for legality queries (canPlay /
 *  canActivate) that must see every card def, never the hidden-info view.
 *  The projection is for rendering only (src/ui/projection.ts). */
export function useRealState(): GameState | null {
	return useGameStore((s) => s.state)
}

export function usePendingChoice(): PendingChoice | null {
	return useGameStore((s) => s.pendingChoice)
}

export function useLegal(): Intent[] {
	return useGameStore((s) => s.legal)
}

export function useSession(): Session | null {
	return useGameStore((s) => s.session)
}

export function useCatalog(): CardCatalog | null {
	return useGameStore((s) => s.catalog)
}

export function useViewerSeat(): Seat {
	return useGameStore((s) => s.viewerSeat)
}

export function useSelected(): CardInstanceId[] {
	return useGameStore((s) => s.selected)
}

/** The iid whose def + instance the detail overlay should show. */
export function useDetailIid(): CardInstanceId | null {
	return useGameStore((s) => s.detailIid)
}

export function useHoverIid(): CardInstanceId | null {
	return useGameStore((s) => s.hoverIid)
}

export function useZoomHeld(): boolean {
	return useGameStore((s) => s.zoomHeld)
}

/** Named export for module-level callers (cards.tsx CardDetailHost). */
export function setDetail(iid: CardInstanceId | null): void {
	useGameStore.getState().setDetail(iid)
}

/** Resolve + dispatch a choice with the current store selection. */
export function confirmChoice(selection: unknown): void {
	const choice = useGameStore.getState().pendingChoice
	if (choice === null) return
	useGameStore.getState().settle(selection)
}
