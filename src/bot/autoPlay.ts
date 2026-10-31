// Headless game driver (todo/16 §3). `autoPlay(state, policy)` plays a game to
// completion from any state by always dispatching the FIRST legal option:
//
//   * a pending choice   → the policy's selection, validated with the engine's
//     pure `validateChoice` gate and (defence in depth) falling back to the
//     probed `firstLegalSelection` — so a naive pick can never break a game;
//   * otherwise           → the first intent `legalIntents` offers, deferring
//     the terminating intents (PASS / END_TURN) until nothing else is legal.
//
// The default policy is `firstLegalPolicy`, the deterministic
// first-legal-option script (todo/07 §6): decline everything optional, take
// the first/smallest legal alternative otherwise — the same spirit as
// `cadetChoice`. The engine validates a returned selection and falls back to
// the probed first legal selection if the naive pick is ever illegal.
//
// Loop until `result.mode === 'GAME_OVER'` (the engine runs the stack to a
// halt on every intent), the iteration cap trips, or no legal intent exists.
// AutoPlay never throws by construction: every intent it dispatches is one the
// engine's own legality gate sanctioned (or a validated choice), so `reduce`
// cannot reject it; the cap bounds any pathological game.

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { reduce, legalIntents, firstLegalSelection } from '../engine/intents'
import type { PendingChoice } from '../engine/resolver/choices'
import {
	checkSelection,
	declineSelection,
	validateChoice,
} from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import type { Bot } from './types'

/** The `(state, choice) => selection` contract (architecture §4, todo/07 §6):
 *  a deterministic answer to a published PendingChoice. */
export interface ChoicePolicy {
	(state: GameState, choice: PendingChoice): unknown
}

export type AutoPlayStop = 'GAME_OVER' | 'CYCLE' | 'CAP' | 'STALL'

export interface AutoPlayResult {
	state: GameState
	/** Every intent dispatched, in order — a usable session intent log. */
	intents: Intent[]
	/** Iterations (= intents dispatched) before stopping. */
	steps: number
	stopped: AutoPlayStop
	/** When stopped === 'CYCLE': the repeating intent window that looped, and
	 *  the step at which it was first seen. */
	cycle?: { startStep: number; length: number; sample: Intent[] } | undefined
}

/** How long can a game take in intents? A full two-player game with heavy card
 *  play is a few hundred intents; 5000 is a very generous ceiling that still
 *  trips loudly on a driver bug or an engine that never games over. */
export const ITERATION_CAP = 5000

/** Cycle detection: a genuinely-unbounded legal loop (e.g. a zero-cost
 *  activation that refreshes itself) produces an eventually-periodic intent
 *  stream. Track the last W intents' JSON; when the same W-window appears
 *  three times the game is looping — stop with 'CYCLE' instead of burning the
 *  whole cap. W is a least-common multiple of the common small periods (4, 6,
 *  8, 12); the hard cap remains the backstop for non-periodic pathology. The
 *  KEY folds in the turn/seat/phase the window ENDS in, so long but
 *  legitimately-progressing games (windows that repeat across different
 *  turns) are never flagged — only windows that repeat within one turn. */
export const CYCLE_WINDOW = 24
const CYCLE_SEEN = 3

/** Deterministic first-legal-option policy: decline everything optional, take
 *  the first/smallest legal alternative otherwise. Mirrors `cadetChoice`; the
 *  caller validates the result and probes a fallback if it is ever illegal.
 *  "Smallest" = fewest cards / lowest amount where the engine offers a range
 *  (choices advertise min..max). */
export function firstLegalPolicy(
	state: GameState,
	choice: PendingChoice,
): unknown {
	void state
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
				.filter((iid) => !disabled.has(iid))
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
			return choice.min
		case 'ORDER_OPERATIONS':
			return choice.pending as unknown
		case 'OPTIONAL_TRIGGERS':
			return []
		case 'CHOOSE_WITNESS':
			return choice.sets[0] as unknown
		case 'CHOOSE_WILDCARD_AS':
			return choice.traits[0] as string
		case 'ORDER_CARDS':
			return choice.cards as unknown
	}
}

/** The first legal intent, with PASS/END_TURN deferred until nothing else is
 *  legal — so the driver actually plays cards, completes missions and activates
 *  rather than passing every turn. SETUP/RESUPPLY/CONTROL keep their only
 *  (boundary) intent, and STALL is reported cleanly if ever empty. */
function preferActive(intent: Intent): boolean {
	return intent.t !== 'PASS' && intent.t !== 'END_TURN'
}

function selectIntent(legal: Intent[]): Intent | undefined {
	const preferred = legal.filter(preferActive)
	return (preferred.length > 0 ? preferred : legal)[0]
}

/** The intent this driver would dispatch next, from a state plus the intents
 *  legal in it — usable on a seat's wire view too (src/engine/seatView.ts),
 *  which carries only its own pending choice and cannot be probed: the policy's
 *  answer to a pending choice, falling back to the default selection the legal
 *  RESOLVE_CHOICE carries when that answer is invalid; otherwise the first
 *  legal intent with PASS/END_TURN deferred. */
export function nextAutoIntent(
	state: Pick<GameState, 'pendingChoice'>,
	legal: Intent[],
	policy: ChoicePolicy = firstLegalPolicy,
): Intent | undefined {
	const choice = state.pendingChoice
	if (choice === null) return selectIntent(legal)
	let selection = policy(state as GameState, choice)
	if (!checkSelection(choice, selection).ok) {
		const offered = legal.find(
			(i): i is Extract<Intent, { t: 'RESOLVE_CHOICE' }> =>
				i.t === 'RESOLVE_CHOICE',
		)
		if (offered === undefined) return undefined
		selection = offered.selection
	}
	return { t: 'RESOLVE_CHOICE', choiceId: choice.id, selection }
}

/** Drive a game (or any subgame) to completion. Returns a result, never
 *  throws, never hangs. `cap` bounds the intent count. */
export function autoPlay(
	state: GameState,
	policy: ChoicePolicy = firstLegalPolicy,
	cap: number = ITERATION_CAP,
	onStep:
		| ((state: GameState, intent: Intent, step: number) => void)
		| undefined = undefined,
): AutoPlayResult {
	let s = state
	const intents: Intent[] = []
	const windowPushes: string[] = []
	const seenWindows = new Map<string, number>()
	for (let steps = 0; steps < cap; steps++) {
		if (s.result !== null) {
			return { state: s, intents, steps, stopped: 'GAME_OVER' }
		}
		if (s.pendingChoice !== null) {
			let selection = policy(s, s.pendingChoice)
			if (!validateChoice(s, s.pendingChoice.id, selection).ok) {
				selection = firstLegalSelection(s)
				if (selection === null) {
					// The probe found no legal selection for a published choice — a
					// genuine engine defect (an unsatisfiable PendingChoice). Surfacing
					// it beats spinning against the cap.
					throw new Error(
						`autoPlay: no legal selection for pending ${s.pendingChoice.k} choice ('${s.pendingChoice.prompt}')`,
					)
				}
			}
			const intent: Intent = {
				t: 'RESOLVE_CHOICE',
				choiceId: s.pendingChoice.id,
				selection,
			}
			s = reduce(s, intent).state
			const cycleStart = noteIntent(
				s,
				intents,
				intent,
				windowPushes,
				seenWindows,
			)
			if (cycleStart !== undefined) {
				const length = intents.length - cycleStart
				return {
					state: s,
					intents,
					steps: steps + 1,
					stopped: 'CYCLE',
					cycle: {
						startStep: cycleStart,
						length,
						sample: intents.slice(Math.max(0, intents.length - length)),
					},
				}
			}
			onStep?.(s, intent, steps)
			continue
		}
		const legal = legalIntents(s)
		const intent = selectIntent(legal)
		if (intent === undefined) {
			return { state: s, intents, steps, stopped: 'STALL' }
		}
		s = reduce(s, intent).state
		const cycleStart = noteIntent(s, intents, intent, windowPushes, seenWindows)
		if (cycleStart !== undefined) {
			const length = intents.length - cycleStart
			return {
				state: s,
				intents,
				steps: steps + 1,
				stopped: 'CYCLE',
				cycle: {
					startStep: cycleStart,
					length,
					sample: intents.slice(Math.max(0, intents.length - length)),
				},
			}
		}
		onStep?.(s, intent, steps)
	}
	return { state: s, intents, steps: cap, stopped: 'CAP' }
}

// ---------------------------------------------------------------------------
// Bot-vs-bot driver
// ---------------------------------------------------------------------------

export interface PlayBotsOptions {
	/** Iteration cap (default ITERATION_CAP). */
	cap?: number | undefined
	/** Called after every accepted intent, like autoPlay's onStep; `seat` is
	 *  the seat that decided it, `fallback` whether its bot's answer was
	 *  replaced. */
	onStep?:
		| ((
				state: GameState,
				intent: Intent,
				step: number,
				info: { seat: Seat; fallback: boolean },
		  ) => void)
		| undefined
	/** Clock for the decision timing (ms). Defaults to performance.now();
	 *  timing is reported only and never affects play. */
	clock?: (() => number) | undefined
}

export interface PlayBotsResult extends AutoPlayResult {
	/** Bot answers that were illegal (or threw) and were replaced by the
	 *  first-legal fallback, in total and per seat. */
	fallbacks: number
	fallbacksBySeat: [number, number]
	/** Decisions taken and total `decide` time (ms) per seat. */
	timing: { decisions: [number, number]; ms: [number, number] }
}

/** Is `intent` one of `legal` (structurally; RESOLVE_CHOICE is checked with
 *  validateChoice instead)? */
function isAccepted(
	state: GameState,
	legal: Intent[],
	intent: Intent,
): boolean {
	if (intent.t === 'RESOLVE_CHOICE') {
		return (
			state.pendingChoice !== null &&
			validateChoice(state, intent.choiceId, intent.selection).ok
		)
	}
	if (state.pendingChoice !== null) return false
	const key = JSON.stringify(intent)
	return legal.some((l) => JSON.stringify(l) === key)
}

/**
 * Drive a game with one bot per seat. Each step the deciding seat is
 * `state.pendingChoice?.seat ?? state.activeSeat` (a pending choice may
 * belong to the non-active seat: an interrupt such as a REACTION window,
 * src/session/interrupts.ts). `legalIntents` offers that choice whoever owns
 * it. The seat's bot gets `(state, seat, legal)`; its answer is validated
 * and, when illegal (or when `decide` or `reduce` throws), replaced by
 * the first-legal answer exactly as `autoPlay` would pick it, and counted as
 * a fallback. Same stop conditions as autoPlay (game over, cycle, cap,
 * stall). Two first-legal bots replay `autoPlay` intent for intent.
 */
export function playBots(
	state: GameState,
	bots: readonly [Bot, Bot],
	opts: PlayBotsOptions = {},
): PlayBotsResult {
	const cap = opts.cap ?? ITERATION_CAP
	const clock = opts.clock ?? (() => performance.now())
	let s = state
	const intents: Intent[] = []
	const windowPushes: string[] = []
	const seenWindows = new Map<string, number>()
	const fallbacksBySeat: [number, number] = [0, 0]
	const decisions: [number, number] = [0, 0]
	const ms: [number, number] = [0, 0]
	const result = (
		steps: number,
		stopped: AutoPlayStop,
		cycle?: AutoPlayResult['cycle'],
	): PlayBotsResult => ({
		state: s,
		intents,
		steps,
		stopped,
		...(cycle !== undefined ? { cycle } : {}),
		fallbacks: fallbacksBySeat[0] + fallbacksBySeat[1],
		fallbacksBySeat,
		timing: { decisions, ms },
	})
	for (let steps = 0; steps < cap; steps++) {
		if (s.result !== null) return result(steps, 'GAME_OVER')
		const seat: Seat = s.pendingChoice?.seat ?? s.activeSeat
		const legal = legalIntents(s)
		if (legal.length === 0) return result(steps, 'STALL')
		// the official solo Bot's turn is rules, not a decision: its beats run
		// without asking the seat's bot (rules/13 §13.4)
		if (legal.length === 1 && legal[0]!.t === 'BOT_STEP') {
			s = reduce(s, legal[0]!).state
			const cycleStart = noteIntent(s, intents, legal[0]!, windowPushes, seenWindows)
			if (cycleStart !== undefined) {
				const length = intents.length - cycleStart
				return result(steps + 1, 'CYCLE', {
					startStep: cycleStart,
					length,
					sample: intents.slice(Math.max(0, intents.length - length)),
				})
			}
			opts.onStep?.(s, legal[0]!, steps, { seat, fallback: false })
			continue
		}
		const t0 = clock()
		let intent: Intent | undefined
		try {
			intent = bots[seat].decide(s, seat, legal)
		} catch {
			intent = undefined
		}
		ms[seat] += clock() - t0
		decisions[seat]++
		let fallback = intent === undefined || !isAccepted(s, legal, intent)
		let next: GameState | undefined
		if (!fallback) {
			try {
				next = reduce(s, intent!).state
			} catch {
				fallback = true
			}
		}
		if (fallback) {
			fallbacksBySeat[seat]++
			intent = fallbackIntent(s, legal)
			if (intent === undefined) return result(steps, 'STALL')
			next = reduce(s, intent).state
		}
		s = next!
		const cycleStart = noteIntent(
			s,
			intents,
			intent!,
			windowPushes,
			seenWindows,
		)
		if (cycleStart !== undefined) {
			const length = intents.length - cycleStart
			return result(steps + 1, 'CYCLE', {
				startStep: cycleStart,
				length,
				sample: intents.slice(Math.max(0, intents.length - length)),
			})
		}
		opts.onStep?.(s, intent!, steps, { seat, fallback })
	}
	return result(cap, 'CAP')
}

/** The answer `autoPlay` would give: the first-legal policy's selection
 *  (validated, else the engine's probed first legal selection), or the first
 *  legal intent with PASS/END_TURN deferred. */
function fallbackIntent(state: GameState, legal: Intent[]): Intent | undefined {
	const choice = state.pendingChoice
	if (choice === null) return selectIntent(legal)
	let selection = firstLegalPolicy(state, choice)
	if (!validateChoice(state, choice.id, selection).ok) {
		selection = firstLegalSelection(state)
		if (selection === null) return undefined
	}
	return { t: 'RESOLVE_CHOICE', choiceId: choice.id, selection }
}

/** Push an intent into the sliding cycle-detection window; returns the step at
 *  which the now-complete repeating window was first seen when this window has
 *  appeared CYCLE_SEEN times, or undefined while the game is progressing. */
function noteIntent(
	state: GameState,
	intents: Intent[],
	intent: Intent,
	pushes: string[],
	seen: Map<string, number>,
): number | undefined {
	intents.push(intent)
	// Choice ids are RNG-derived timestamps that change on every resolution, so
	// they must be normalised out of the fingerprint: a genuine loop repeats the
	// same DECISION stream, only with fresh choice ids each pass.
	const json = cycleFingerprint(intent)
	pushes.push(json)
	if (pushes.length > CYCLE_WINDOW) pushes.shift()
	if (pushes.length < CYCLE_WINDOW) return undefined
	// Only consider windows whose content aligns with a period: contiguous
	// non-overlapping window starts (step % CYCLE_WINDOW === 0) are compared so a
	// period that divides CYCLE_WINDOW is caught without sliding overlap noise.
	if (intents.length % CYCLE_WINDOW === 0) {
		const signature = `${state.turnNumber}|${state.activeSeat}|${state.phase.k}`
		const hash = `${signature}::${pushes.join('|')}`
		const count = (seen.get(hash) ?? 0) + 1
		seen.set(hash, count)
		if (count >= CYCLE_SEEN) {
			return intents.length - CYCLE_WINDOW
		}
	}
	return undefined
}

/** A structural fingerprint of one intent, with the (never-repeating)
 *  RESOLVE_CHOICE choice id normalised to a constant. */
function cycleFingerprint(intent: Intent): string {
	if (intent.t !== 'RESOLVE_CHOICE') return JSON.stringify(intent)
	return `RESOLVE_CHOICE:$choiceId${JSON.stringify(intent.selection)}`
}
