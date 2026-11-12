// The GameAdapter the UI (built in parallel) drives: a headless, no-React seam
// over the session layer (docs/architecture.md §1). It owns a Session (the
// source of truth) and a live GameState; dispatch appends an intent + reduces,
// undo truncates the log + replays. Everything here runs in node/headless too.
//
// Autosave (todo/17 §1): pass `persist` (+ an optional `autosaveDebounceMs`)
// to get the ~1 s debounced save-after-every-intent without the UI caring.

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { reduce, legalIntents, withCurrentRules } from '../engine/intents'
import type { PendingChoice } from '../engine/resolver/choices'
import {
	validateChoice,
	IllegalSelectionError,
} from '../engine/resolver/choices'
import type { CardCatalog } from '../engine/setup'
import type { Session } from './log'
import { append, replay, refreshMeta } from './log'

/** An intent that is not legal in the current state (the engine would throw on
 *  it too — this surfaces the same thing earlier, with the intent attached). */
export class IllegalIntentError extends Error {}

export interface SessionAdapterOptions {
	session: Session
	catalog: CardCatalog
	/** Autosave hook (todo/17 §1): called with the updated session after each
	 *  accepted commit, debounced when `autosaveDebounceMs` is set. */
	persist?: ((session: Session) => void | Promise<void>) | undefined
	autosaveDebounceMs?: number | undefined
	/** Change listener — a React layer re-renders from `adapter.state`. */
	onChange?: ((adapter: SessionAdapter) => void) | undefined
	/** Injectable clock (tests use a fixed time; the `updatedAt` meta is only
	 *  for the save screen, never part of replay). */
	now?: (() => Date) | undefined
}

export class SessionAdapter {
	readonly catalog: CardCatalog

	private _session: Session
	private _state: GameState
	private readonly persist:
		((session: Session) => void | Promise<void>) | undefined
	private readonly autosaveDebounceMs: number | undefined
	private readonly onChange: ((adapter: SessionAdapter) => void) | undefined
	private readonly now: () => Date
	private autosaveTimer: ReturnType<typeof setTimeout> | null = null

	constructor(opts: SessionAdapterOptions) {
		this.catalog = opts.catalog
		this._session = opts.session
		this._state = replay(opts.session, opts.catalog)
		this.persist = opts.persist
		this.autosaveDebounceMs = opts.autosaveDebounceMs
		this.onChange = opts.onChange
		this.now = opts.now ?? (() => new Date())
	}

	get session(): Session {
		return this._session
	}

	get state(): GameState {
		return this._state
	}

	get pendingChoice(): PendingChoice | null {
		return this._state.pendingChoice
	}

	/** What the UI may offer right now. */
	get legalIntents(): Intent[] {
		return legalIntents(this._state)
	}

	/** Validate + commit an intent. Illegal intents (including an illegal
	 *  RESOLVE_CHOICE selection) throw and leave the session untouched. */
	dispatch(intent: Intent): GameState {
		this.assertLegal(intent)
		intent = withCurrentRules(this._state, intent)
		this._state = reduce(this._state, intent).state
		this._session = refreshMeta(
			{ ...this._session, log: append(this._session.log, intent) },
			this._state,
			this.catalog,
			this.now,
		)
		this.afterCommit()
		return this._state
	}

	/** Convenience for the common "answer the pending choice" path. */
	settle(selection: unknown): GameState {
		const choice = this._state.pendingChoice
		if (choice === null)
			throw new IllegalIntentError('nothing to settle — no PendingChoice')
		const v = validateChoice(this._state, choice.id, selection)
		if (!v.ok) throw new IllegalSelectionError(v.reason)
		return this.dispatch({
			t: 'RESOLVE_CHOICE',
			choiceId: choice.id,
			selection,
		})
	}

	/** Undo the latest `n` (default 1) player-visible intents by truncating
	 *  the log and replaying once — identical to those intents never having
	 *  run (todo/17 §2;
	 *  in solo, undo freely; in hot-seat, the UI applies policy (a): only within
	 *  your own turn before any reveal — see docs/notes/session-layer.md). */
	undo(n = 1): boolean {
		if (this._session.log.length === 0 || n <= 0) return false
		const keep = Math.max(0, this._session.log.length - n)
		this._session = { ...this._session, log: this._session.log.slice(0, keep) }
		this._state = replay(this._session, this.catalog)
		this._session = refreshMeta(
			this._session,
			this._state,
			this.catalog,
			this.now,
		)
		this.afterCommit()
		return true
	}

	/** Rewind to the SETUP-phase session (empty log). */
	reset(): boolean {
		if (this._session.log.length === 0) return false
		this._session = { ...this._session, log: [] }
		this._state = replay(this._session, this.catalog)
		this._session = refreshMeta(
			this._session,
			this._state,
			this.catalog,
			this.now,
		)
		this.afterCommit()
		return true
	}

	/** Cancel any pending debounced autosave (e.g. before navigating away). */
	dispose(): void {
		if (this.autosaveTimer !== null) {
			clearTimeout(this.autosaveTimer)
			this.autosaveTimer = null
		}
	}

	/** Engine contract (docs/state-machine.md §2): never dispatch an intent the
	 *  engine would throw on. Choices are re-validated with validateChoice. */
	private assertLegal(intent: Intent): void {
		const pending = this._state.pendingChoice
		if (pending !== null) {
			if (intent.t !== 'RESOLVE_CHOICE' || intent.choiceId !== pending.id) {
				throw new IllegalIntentError(
					`a choice is pending (${pending.id}) — only RESOLVE_CHOICE is legal`,
				)
			}
			const v = validateChoice(this._state, intent.choiceId, intent.selection)
			if (!v.ok) throw new IllegalSelectionError(v.reason)
			return
		}
		const legal = legalIntents(this._state).some(
			(i) => JSON.stringify(i) === JSON.stringify(intent),
		)
		if (!legal)
			throw new IllegalIntentError(
				`intent is not legal now: ${JSON.stringify(intent)}`,
			)
	}

	private afterCommit(): void {
		if (this.persist !== undefined) {
			if (this.autosaveDebounceMs === undefined) {
				void this.persist(this._session)
			} else {
				if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer)
				this.autosaveTimer = setTimeout(() => {
					this.autosaveTimer = null
					if (this.persist !== undefined) void this.persist(this._session)
				}, this.autosaveDebounceMs)
			}
		}
		this.onChange?.(this)
	}
}
