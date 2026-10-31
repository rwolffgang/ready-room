// The Intent union + reduce (docs/state-machine.md §2, todo/06 §2.5).
//
// `reduce(state, intent) -> { state, events }` validates the intent against
// the current phase and legality queries (illegal intents throw — the UI should
// only ever dispatch ones `legalIntents` offers), pushes the corresponding work
// onto the SAME effect stack, and runs it to a halt (empty stack, a pending
// choice, or game over). Events emitted along the way are surfaced to the
// caller so todo/09 can feed PASSIVE/REACTION collection.
//
// The union is deliberately minimal for todo/06 — START, PASS, PLAY_CARD,
// ACTIVATE, RESOLVE_CHOICE, END_TURN — but structured so todo/07 (choice
// system) and todo/08 (market/locations: TAKE_CONTROL, COMPLETE_MISSION,
// DISCARD_FROM_HAND) extend it without reworking the dispatch.

import type { CardInstanceId } from './ids'
import type { GameState, GameEvent } from './state'
import { forkState, moveCard, zoneProps } from './state'
import { cardDef } from './cards'
import { canPlay, canActivate, completableMissions } from './queries/legality'
import type { AltPlayRef } from './altPlay'
import {
	applyChoice,
	probeFirstChoice,
	validateChoice,
	IllegalSelectionError,
} from './resolver/choices'
import { runCollecting, pushOperation } from './resolver/stack'
import { finalizeGame } from './scoring'
import { advancePhaseStep, beginTurnStep } from './phases'
import { pushCampaignStart } from './solo/campaign'
import { cadetChoice, CADET_SEAT } from '../bot/cadet'
import type { PendingChoice } from './resolver/choices'
import { isSoloBot } from './solo/seat'
import { soloChoice } from './solo/policy'
import { pushBotStep } from './solo/turn'

export type Intent =
	| { t: 'START' } // SETUP -> the starting player's RESUPPLY
	| { t: 'PASS' } // phase boundary: RESUPPLY->CONTROL, CONTROL->ACTION, ACTION->CLEANUP
	| {
			t: 'PLAY_CARD'
			iid: CardInstanceId
			operationIndex: number
			/** "Treat" printed PLAY op #operationIndex as the operation granted by
			 *  this ALT_PLAY PASSIVE instead (1PIC08). */
			via?: AltPlayRef | undefined
	  } // ACTION
	| { t: 'ACTIVATE'; iid: CardInstanceId; operationIndex: number } // ACTION
	| { t: 'RESOLVE_CHOICE'; choiceId: string; selection: unknown } // any phase
	| { t: 'END_TURN' } // ACTION -> CLEANUP (rules/03 §3.5 / END_ACTION_STEP)
	| { t: 'COMPLETE_MISSION'; index: number } // ACTION — no action cost (rules/03 §3.5.7)
	| { t: 'BOT_STEP' } // BOT — the official solo Bot's next beat (rules/13 §13.4)

export interface ReduceResult {
	state: GameState
	events: GameEvent[]
}

function requirePhase(
	state: GameState,
	...allowed: GameState['phase']['k'][]
): void {
	if (state.result !== null)
		throw new Error(`intent not legal: game is over (${state.result.kind})`)
	if (!allowed.includes(state.phase.k)) {
		throw new Error(
			`intent not legal in phase ${state.phase.k} (expected ${allowed.join('/')})`,
		)
	}
}

function requireNoChoice(state: GameState): void {
	if (state.pendingChoice !== null)
		throw new Error('a choice is pending — RESOLVE_CHOICE first')
}

export function reduce(state: GameState, intent: Intent): ReduceResult {
	return pilotVirtualSeat(reduceCore(state, intent))
}

/** START: the starting player's first RESUPPLY step — beneath a campaign
 *  game's boosts, which resolve first (rules/14 §14.3). */
function startStep(state: GameState): GameState {
	return pushCampaignStart(beginTurnStep(state))
}

/** The Intent switch, unpiloted (the cadet pilot wraps it — see below). */
export function reduceCore(state: GameState, intent: Intent): ReduceResult {
	switch (intent.t) {
		case 'START':
			requirePhase(state, 'SETUP')
			return runToHalt(startStep(state))
		case 'PASS':
			requirePhase(state, 'RESUPPLY', 'CONTROL', 'ACTION')
			requireNoChoice(state)
			return runToHalt(advancePhaseStep(state))
		case 'END_TURN':
			requirePhase(state, 'ACTION')
			requireNoChoice(state)
			return runToHalt(advancePhaseStep(state)) // ACTION -> CLEANUP via the same boundary
		case 'PLAY_CARD':
			return reducePlayCard(state, intent)
		case 'ACTIVATE':
			return reduceActivate(state, intent)
		case 'RESOLVE_CHOICE':
			return reduceResolveChoice(state, intent)
		case 'COMPLETE_MISSION':
			return reduceCompleteMission(state, intent)
		case 'BOT_STEP':
			requirePhase(state, 'BOT')
			requireNoChoice(state)
			if (state.stack.length > 0)
				throw new Error('BOT_STEP: the previous beat has not finished')
			return runToHalt(pushBotStep(state))
	}
}

/** Run to a halt, then finalise the game if it just ended (todo/10). The raw
 *  Burn/Resolution trigger becomes the COMPLETE record exactly once — the end
 *  screen reads `state.result.scoreboard`. `finalizeGame` is idempotent, so
 *  states that end mid-effect (e.g. a Burn inside a REACTION) finalise on the
 *  first reduce that observes the trigger. */
function runToHalt(state: GameState): ReduceResult {
	const { state: s, events } = runCollecting(state)
	return { state: finalizeGame(s), events }
}

/**
 * The auto-pilot for a seat no one plays at this device: Cadet Training's
 * virtual opponent (rules/10, todo/15 §1) and the official solo Bot (rules/13).
 * After ANY intent settles, a pending choice owned by that seat is answered by
 * its own deterministic policy (`cadetChoice` / `soloChoice`), validated, with
 * the probed first legal selection as the fallback if the policy's pick is
 * ever illegal. A headless driver therefore only ever answers the HUMAN's
 * choices (rules/12 §12.14 choice ownership: `choice.seat` = the deciding
 * seat); the Bot's own turn advances through BOT_STEP intents.
 */
export function pilotVirtualSeat(result: ReduceResult): ReduceResult {
	const out = { state: result.state, events: [...result.events] }
	let guard = 0
	for (;;) {
		const choice = out.state.pendingChoice
		if (out.state.result !== null || choice === null) break
		const policy = virtualPolicy(out.state, choice)
		if (policy === null || ++guard >= 1000) break
		let selection: unknown = policy(choice)
		if (!validateChoice(out.state, choice.id, selection).ok) {
			selection = firstLegalSelection(out.state)
			if (selection === null) {
				throw new Error(
					`virtual seat pilot: no legal selection for a seat-${choice.seat} choice (${choice.k}: ${choice.prompt})`,
				)
			}
		}
		const r = reduceCore(out.state, {
			t: 'RESOLVE_CHOICE',
			choiceId: choice.id,
			selection,
		})
		out.state = r.state
		out.events.push(...r.events)
	}
	return out
}

/** @deprecated the Cadet-only name of `pilotVirtualSeat`. */
export const pilotCadet = pilotVirtualSeat

/** The policy answering `choice`, when no player at the device owns it. */
function virtualPolicy(
	state: GameState,
	choice: PendingChoice,
): ((choice: PendingChoice) => unknown) | null {
	if (state.mode === 'CADET' && choice.seat === CADET_SEAT) return cadetChoice
	if (isSoloBot(state, choice.seat)) return (c) => soloChoice(state, c)
	return null
}

/** A virtual seat answers its own choices — legalIntents must never hand the
 *  driver one (the pilot already cleared it; this guards the pathological
 *  "pilot could not resolve" case). */
function cadetChoiceGuard(state: GameState): boolean {
	return (
		state.pendingChoice === null ||
		virtualPolicy(state, state.pendingChoice) === null
	)
}

/** Play a card from hand (rules/03 §3.5.4): move it into the Staging Area
 *  FIRST, then resolve exactly one of its PLAY operations (or, with `via`, the
 *  operation an ALT_PLAY PASSIVE lets it be treated as); after completion
 *  emit CARD_PLAYED and PUT_INTO_PLAY (the latter only if the operation left
 *  the card in play — deploy / log / master moves are respected). */
function reducePlayCard(
	state: GameState,
	intent: Extract<Intent, { t: 'PLAY_CARD' }>,
): ReduceResult {
	requirePhase(state, 'ACTION')
	requireNoChoice(state)
	const seat = state.activeSeat
	const card = state.cards[intent.iid]
	if (!card || card.owner !== seat || card.zone.k !== 'HAND') {
		throw new Error(`PLAY_CARD: ${intent.iid} is not in ${seat}'s hand`)
	}
	const check = canPlay(state, seat, intent.iid)
	const via = intent.via
	const legal =
		via === undefined
			? check.operations.includes(intent.operationIndex)
			: check.altPlays.some(
					(r) => r.source === via.source && r.opIndex === via.opIndex,
				)
	if (!check.ok || !legal) {
		const how =
			via === undefined ? '' : ` via ${via.source}#${via.opIndex} (ALT_PLAY)`
		throw new Error(
			`PLAY_CARD: ${intent.iid}#${intent.operationIndex}${how} is not playable (${check.reasons.join('; ')})`,
		)
	}
	const op = cardDef(card.def).operations[intent.operationIndex]
	if (!op || op.type !== 'PLAY')
		throw new Error(
			`PLAY_CARD: #${intent.operationIndex} is not a PLAY operation`,
		)

	const staged = moveCard(state, intent.iid, { k: 'STAGING', seat })
	const ctx = { actor: seat, source: intent.iid, bindings: {} }
	const frames: GameState['stack'][number][] = [
		// LIFO: the OPERATION runs first, then CARD_PLAYED, then PUT_INTO_PLAY.
		{
			k: 'EMIT',
			event: { k: 'PUT_INTO_PLAY', iid: intent.iid, seat },
			ifInPlay: { iid: intent.iid, seat },
		},
		{ k: 'EMIT', event: { k: 'CARD_PLAYED', iid: intent.iid, seat } },
		{
			k: 'OPERATION',
			card: intent.iid,
			opIndex: intent.operationIndex,
			ctx,
			phase: 0,
			...(via !== undefined ? { via: { ...via } } : {}),
		},
	]
	return runToHalt({ ...staged, stack: [...staged.stack, ...frames] })
}

/** Resolve an ACTIVATION operation (rules/03 §3.5.5): the card must be in play
 *  (not Staging, not beamed) and not exhausted; exhausting it is the reminder
 *  of the spent activation, then the operation (with its implicit action cost)
 *  runs. */
function reduceActivate(
	state: GameState,
	intent: Extract<Intent, { t: 'ACTIVATE' }>,
): ReduceResult {
	requirePhase(state, 'ACTION')
	requireNoChoice(state)
	const seat = state.activeSeat
	const check = canActivate(state, seat, intent.iid, intent.operationIndex)
	if (!check.ok)
		throw new Error(
			`ACTIVATE: ${intent.iid}#${intent.operationIndex} ${check.reason ?? ''}`,
		)
	const card = state.cards[intent.iid]!
	const exhausted = {
		...state,
		cards: { ...state.cards, [intent.iid]: { ...card, exhausted: true } },
	}
	const ctx = { actor: seat, source: intent.iid, bindings: {} }
	return runToHalt(
		pushOperation(exhausted, intent.iid, intent.operationIndex, ctx),
	)
}

/** Re-validate the selection against the published choice (never trust the
 *  client — docs/state-machine.md §2/§4) via the pure validateChoice gate: an
 *  illegal RESOLVE_CHOICE is rejected with the typed IllegalSelectionError
 *  and the state is left unchanged (todo/07 DoD). Then store the selection
 *  into the suspended frame and run to a halt. */
function reduceResolveChoice(
	state: GameState,
	intent: Extract<Intent, { t: 'RESOLVE_CHOICE' }>,
): ReduceResult {
	const v = validateChoice(state, intent.choiceId, intent.selection)
	if (!v.ok) throw new IllegalSelectionError(v.reason)
	return runToHalt(applyChoice(state, intent))
}

/** Complete a mission whose GOAL is currently met (rules/03 §3.5.7, rules/07
 *  §7.2.1) — no action cost. Validation is the legality gate `completableMissions`;
 *  the completion itself ({k:'COMPLETE_MISSION'}) marks it done and resolves its
 *  REWARD effect through the stack. */
function reduceCompleteMission(
	state: GameState,
	intent: Extract<Intent, { t: 'COMPLETE_MISSION' }>,
): ReduceResult {
	requirePhase(state, 'ACTION')
	requireNoChoice(state)
	const seat = state.activeSeat
	if (!completableMissions(state, seat).includes(intent.index)) {
		throw new Error(`COMPLETE_MISSION: mission ${intent.index} goal is not met`)
	}
	const frame: GameState['stack'][number] = {
		k: 'EFFECT',
		node: { k: 'COMPLETE_MISSION', index: intent.index },
		ctx: { actor: seat, source: '' as CardInstanceId, bindings: {} },
		ip: 0,
	}
	return runToHalt({ ...state, stack: [...state.stack, frame] })
}

/**
 * The intents currently legal for `state.activeSeat`, in a stable order —
 * what the UI can offer without tripping `reduce`'s validation. Includes the
 * pending choice as a RESOLVE_CHOICE with a deterministic first legal
 * selection (the UI replaces it with the player's actual choice).
 */
export function legalIntents(state: GameState): Intent[] {
	const out: Intent[] = []
	if (state.result !== null) return out
	if (state.pendingChoice !== null) {
		if (!cadetChoiceGuard(state)) return out // the virtual opponent decides its own
		const selection = firstLegalSelection(state)
		if (state.pendingChoice !== null) {
			out.push({
				t: 'RESOLVE_CHOICE',
				choiceId: state.pendingChoice.id,
				selection,
			})
		}
		return out
	}
	switch (state.phase.k) {
		case 'SETUP':
			out.push({ t: 'START' })
			break
		case 'RESUPPLY':
		case 'CONTROL':
			out.push({ t: 'PASS' })
			break
		case 'ACTION': {
			out.push({ t: 'PASS' })
			out.push({ t: 'END_TURN' })
			const seat = state.activeSeat
			for (const index of completableMissions(state, seat)) {
				out.push({ t: 'COMPLETE_MISSION', index })
			}
			for (const card of Object.values(state.cards)) {
				if (card.owner !== seat) continue
				const def = cardDef(card.def)
				if (card.zone.k === 'HAND') {
					const check = canPlay(state, seat, card.iid)
					for (const operationIndex of check.operations) {
						out.push({ t: 'PLAY_CARD', iid: card.iid, operationIndex })
					}
					// ALT_PLAY grants treat the card's first printed PLAY op (which
					// one is treated makes no difference — the granted text replaces it).
					const treated = def.operations.findIndex((op) => op.type === 'PLAY')
					for (const via of check.altPlays) {
						out.push({
							t: 'PLAY_CARD',
							iid: card.iid,
							operationIndex: treated,
							via,
						})
					}
				} else if (zoneProps(card.zone).tableOps && !card.exhausted) {
					def.operations.forEach((op, operationIndex) => {
						if (op.type !== 'ACTIVATION') return
						if (canActivate(state, seat, card.iid, operationIndex).ok) {
							out.push({ t: 'ACTIVATE', iid: card.iid, operationIndex })
						}
					})
				}
			}
			break
		}
		case 'BOT':
			// the official solo Bot's turn: its next beat (rules/13 §13.4)
			if (state.stack.length === 0) out.push({ t: 'BOT_STEP' })
			break
		case 'CLEANUP':
		case 'GAME_OVER':
			break
	}
	return out
}

/** A deterministic first legal selection for the current pending choice (probe
 *  semantics on a clone — docs/state-machine.md §5). Exported so the headless
 *  autoPlay driver (src/bot/autoPlay.ts, todo/16 §3) can reuse the engine's
 *  probe as its validated fallback selection. */
export function firstLegalSelection(state: GameState): unknown {
	const choice = state.pendingChoice
	if (!choice) return null
	try {
		const resolved = probeFirstChoice(forkState(state))
		const top = resolved.stack[resolved.stack.length - 1]
		if (top === undefined) return null
		if (top.k === 'EFFECT') return top.ctx.bindings[choice.id]
		if (top.k === 'PHASE_STEP' && top.ctx !== undefined)
			return top.ctx.bindings[choice.id]
		return null
	} catch {
		return null
	}
}
