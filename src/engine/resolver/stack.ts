// The stack machine (docs/state-machine.md §3, todo/04 §3):
//   - `executeOne` advances EXACTLY ONE primitive (never a whole subtree), so
//     REACTION windows can open between any two primitives (rules/12 §12.24);
//   - `SEQ` is an instruction pointer on the frame (`frame.ip`), NOT recursion,
//     so a choice mid-sequence halts and resumes with a fresh run() call;
//   - `run()` loops to a halt (stack empty / pendingChoice / result set) with a
//     hard iteration cap that throws a stack dump instead of hanging the tab.
//
// OPERATION frames own the per-operation lifecycle: phase 0 performs the
// `requires` Specialty check and prepends the implicit COST_ACTION (skipped
// for DUPLICATE, which never pushes an OPERATION frame), then runs the
// operation's effect; phase 1 clears transient wildcard declarations
// (rules/12 §12.12) and pops.

import type { Effect, Operation } from './nodes'
import type { GameState, EffectCtx, GameEvent, Frame } from '../state'
import {
	clearWildcards,
	player,
	otherSeat,
	zoneProps,
	awayTeamsTotal,
} from '../state'
import { primitiveOf, canResolveEffect, isControl } from './primitives'
import { recordFx } from '../fx'
import { evalPredicate } from '../queries/resolveQuery'
import { cardDef } from '../cards'
import { altPlayOperation, type AltPlayRef } from '../altPlay'
import { acRowOperation } from '../solo/acRegistry'
import {
	failOperation,
	skipBenefit,
	emit,
	makeChoiceId,
	nextRng,
} from './runtime'
import { executePhaseStep } from '../phases'
import { checkEndgame } from '../endgame'
import { overflowDismissCandidates } from '../dutyOfficers'
import {
	drainEvents as drainEventQueue,
	opKey,
	eventCardOf,
	reactionPayable,
} from './triggers'
import type { AcRowRef, OperationRef } from '../state'
import type { CardInstanceId } from '../ids'
import { chronicle, frameActor } from './chronicle'
import {
	ATTACK_BINDING,
	PENDING_BINDING,
	attackGate,
	closePending,
	openAttack,
	windowStillOpen,
} from './replacement'
import { soloOutcomeGate } from '../solo/outcome'

/** Hard cap on run-loop iterations — a malformed card must throw, not hang. */
export const MAX_STEPS = 10_000

/** Dev-only assertion: one executeOne may push at most this many frames. A
 *  primitive that resolved its own children in a loop would blow this budget
 *  and (correctly) fail the "one primitive per executeOne" invariant. */
const MAX_PUSH_PER_STEP = 600

/** Push a bare effect frame (used for probe, for odes, and for DUPLICATE's
 *  action-cost-free sub-effects). */
export function pushEffect(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): GameState {
	return {
		...state,
		stack: [...state.stack, { k: 'EFFECT', node, ctx, ip: 0 }],
	}
}

/**
 * Push a full operation: an OPERATION lifecycle frame plus (in phase 0) the
 * effect. `ctx.bindings` gets `$op.isAttack` / `$op.seat` — CHOOSE_ONE reads
 * them to hard-filter options when an ATTACK is resolved by the opponent
 * (rules/03 §3.5.3).
 */
export function pushOperation(
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	ctx: EffectCtx,
): GameState {
	return {
		...state,
		stack: [...state.stack, { k: 'OPERATION', card, opIndex, ctx, phase: 0 }],
	}
}

function opOf(
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	via?: AltPlayRef,
	row?: AcRowRef,
): Operation {
	const instance = state.cards[card]
	if (!instance) throw new Error(`pushOperation: no card instance ${card}`)
	// the solo Bot ignores the printed text: its Automated Command row instead
	if (row !== undefined) return acRowOperation(row)
	if (via !== undefined) {
		// an ALT_PLAY grant (1PIC08): the granted text replaces the printed op
		const granted = altPlayOperation(state, via)
		if (granted === null)
			throw new Error(
				`pushOperation: ${via.source}#${via.opIndex} grants no ALT_PLAY operation`,
			)
		return granted
	}
	const op = cardDef(instance.def).operations[opIndex]
	if (!op)
		throw new Error(`pushOperation: ${card} has no operation #${opIndex}`)
	return op
}

/** Advance EXACTLY ONE primitive. May push frames, set pendingChoice, emit events. */
export function executeOne(state: GameState): GameState {
	const stack = [...state.stack]
	const frame = stack[stack.length - 1]
	if (!frame) return state
	stack.pop()
	const bound: GameState = { ...state, stack }

	switch (frame.k) {
		case 'EFFECT': {
			const before = stack.length
			const prim = primitiveOf(frame.node)
			// §5 benefit skipping (rules/12 §12.1): a NON-COST leaf that cannot fully
			// resolve is skipped silently with a SKIPPED log entry, and the sequence
			// continues. Control nodes (SEQ etc.) handle this internally so a SEQ runs
			// whichever of its steps genuinely can resolve. Costs are never guarded
			// here — they fail upward through the cost pre-validation path.
			let next: GameState
			if (
				!isControl(frame.node) &&
				!prim.isCost &&
				!canResolveEffect(bound, frame.node, frame.ctx)
			) {
				next = skipBenefit(bound, frame.node, frame.ctx, 'cannot fully resolve')
			} else {
				// "When you would be attacked" (replacement.ts): a negative effect
				// of the opponent's ATTACK may be ignored, or open a window first.
				const gate = attackGate(bound, frame, 'ATTACK')
				// "you choose the outcome" of your effects on the solo Bot's hand
				const solo = gate.run ? soloOutcomeGate(gate.state, frame) : gate
				next = solo.run
					? prim.execute(solo.state, frame.node, frame.ctx, frame)
					: solo.state
			}
			next = recordFx(bound, next, frame.ctx.source)
			if (next.stack.length - before > MAX_PUSH_PER_STEP) {
				throw new Error(
					`executeOne: ${frame.node.k} pushed ${next.stack.length - before} frames in one step — ` +
						`a primitive must not resolve a subtree in a loop (rules/12 §12.24)`,
				)
			}
			return scopeChoiceKeys(state, next, frame, before)
		}
		case 'OPERATION': {
			if (frame.phase === 0) {
				const op = opOf(state, frame.card, frame.opIndex, frame.via, frame.row)
				// Stamp the operation context ONCE per operation: CHOOSE_ONE reads
				// $op.isAttack / $op.seat to hard-filter options when an ATTACK is
				// resolved by the opponent (rules/03 §3.5.3), and FREE_PLAY/DUPLICATE
				// set $op.skipActionCost on the plain EFFECT frames they push. Any
				// OPERATION frame — however it was pushed — must see the same bindings.
				// An ATTACK operation opens its pending record ("when you would be
				// attacked" — replacement.ts); any other operation, even one nested
				// in an attack (a free play), is not the attack.
				let opened: GameState = state
				let attackId: string | null = null
				if (op.isAttack) {
					const o = openAttack(
						state,
						frame.card,
						frame.opIndex,
						frame.ctx.actor,
					)
					opened = o.state
					attackId = o.id
				}
				const ctx: EffectCtx = {
					...frame.ctx,
					bindings: {
						...frame.ctx.bindings,
						'$op.isAttack': op.isAttack,
						'$op.seat': frame.ctx.actor,
						[ATTACK_BINDING]: attackId,
					},
				}
				// Specialty restriction gates the whole operation (rules/12).
				if (op.requires !== undefined) {
					const ok = evalPredicate(
						state,
						{
							k: 'SPECIALTY_AT_LEAST',
							specialty: op.requires.specialty,
							value: op.requires.min,
						},
						ctx,
					)
					if (!ok) {
						return failOperation(
							state,
							`requires ${op.requires.specialty} ${op.requires.min}+`,
						)
					}
				}
				const skipAction = ctx.bindings['$op.skipActionCost'] === true
				// Implicit COST_ACTION (rules/12 §12.1): pre-validate before pushing —
				// an operation whose action cost cannot be paid fails upward cleanly
				// instead of throwing mid-resolution (todo/04 §4).
				if (!skipAction && op.costsAction) {
					const acts = player(state, ctx.actor).actions.available
					if (acts <= 0)
						return failOperation(state, 'COST_ACTION: no available action')
				}
				// re-push the lifecycle frame (phase 1), then the effect, then the
				// implicit COST_ACTION on top (LIFO → cost first).
				stack.push({
					...frame,
					phase: 1,
					...(attackId !== null ? { attack: attackId } : {}),
				})
				stack.push({ k: 'EFFECT', node: op.effect, ctx, ip: 0 })
				if (!skipAction && op.costsAction) {
					stack.push({
						k: 'EFFECT',
						node: { k: 'COST_ACTION' } as Effect,
						ctx,
						ip: 0,
					})
				}
				return { ...opened, stack }
			}
			// phase 1: operation complete — clear transient wildcard declarations.
			// A completed ATTACK notifies the victim ("after you are attacked",
			// rules/08 → REACTION, rules/03 §3.5.3: the opponent resolved it).
			let done: GameState = clearWildcards({ ...state, stack })
			if (frame.attack !== undefined) done = closePending(done, frame.attack)
			const completed = opOf(
				state,
				frame.card,
				frame.opIndex,
				frame.via,
				frame.row,
			)
			// A granted ALT_PLAY (or a Bot row) is not one of the card's printed
			// operations, so it has no index a later DUPLICATE could name.
			if (frame.via === undefined && frame.row === undefined) {
				done = recordResolved(done, {
					card: frame.card,
					opIndex: frame.opIndex,
					seat: frame.ctx.actor,
				})
			}
			if (completed.isAttack) {
				const attacker = frame.ctx.actor
				done = emit(done, {
					k: 'ATTACKED',
					seat: attacker,
					victim: otherSeat(attacker),
				})
			}
			// "After resolving an operation with a {LAT} cost" (1SIS24).
			if (frame.paid !== undefined && frame.paid.length > 0) {
				done = emit(done, {
					k: 'OPERATION_RESOLVED',
					seat: frame.ctx.actor,
					iid: frame.card,
					paid: frame.paid,
				})
			}
			return done
		}
		case 'PHASE_STEP':
			// todo/06: the phase machine advances one step per PHASE_STEP frame, on
			// the same stack the effects use — so a Resupply operation's REACTION
			// window or a phase choice can interrupt mid-phase (docs/state-machine
			// §1). The handler pushes the next step(s) and/or a PendingChoice.
			return executePhaseStep({ ...state, stack }, frame)
		case 'EMIT':
			// Emit a GameEvent after the frames below it have run (e.g. CARD_PLAYED
			// + PUT_INTO_PLAY once a PLAY operation completes — rules/08 put into
			// play: *after* for a play). todo/09 collects REACTION/PASSIVE ops.
			// A PLAY op can move the card (deploy / log / master) — PUT_INTO_PLAY is
			// gated on the card still being in play when the frame executes.
			if (frame.ifInPlay !== undefined) {
				const c = state.cards[frame.ifInPlay.iid]
				if (
					c === undefined ||
					c.owner !== frame.ifInPlay.seat ||
					!zoneProps(c.zone).inPlay
				) {
					return { ...state, stack }
				}
			}
			return emit({ ...state, stack }, frame.event)
		case 'REACTION_WINDOW':
			// todo/09: the window re-offers the not-yet-taken set as an
			// OPTIONAL_TRIGGERS choice until the player declines or the set empties.
			// Chosen REACTIONs are pushed ABOVE the window so they resolve before the
			// window (and the interrupted operation beneath it) resumes — §12.24.
			// The frame is already popped (bound); stepReactionWindow works on the
			// remainder so a decline / empty set really pops the window instead of
			// duplicating it.
			return stepReactionWindow(bound, frame)
	}
	return state
}

/**
 * Choice-key scoping. A primitive publishes its answer under a fixed key
 * ('may.accept', 'discard', …) on the ctx it shares with its sibling steps,
 * so without scoping a second MAY in the same SEQ would read the first MAY's
 * answer instead of asking (1PIC04' six optional discards).
 *
 * - When the executed node suspended again, or pushed a continuation of
 *   itself (the same node object above the popped frame — SEQ, REPEAT UP_TO,
 *   CHOOSE_N), its published [key, choiceId] pairs are carried onto that
 *   frame.
 * - When it finished (no such frame), its pairs are scrubbed from every
 *   frame's bindings — copy-on-write, keeping frames that shared one ctx /
 *   bindings object sharing the new one.
 */
function scopeChoiceKeys(
	prev: GameState,
	next: GameState,
	frame: Extract<Frame, { k: 'EFFECT' }>,
	base: number,
): GameState {
	let carrier = -1
	for (let i = next.stack.length - 1; i >= base; i--) {
		const f = next.stack[i]!
		if (f.k === 'EFFECT' && f.node === frame.node) {
			carrier = i
			break
		}
	}
	if (carrier >= 0) {
		const f = next.stack[carrier] as Extract<Frame, { k: 'EFFECT' }>
		const pairs: [string, string][] = [...(frame.resume ?? [])]
		const pc = next.pendingChoice
		if (pc !== null && prev.pendingChoice === null) {
			for (const [k, v] of Object.entries(f.ctx.bindings))
				if (v === pc.id && !pairs.some(([pk]) => pk === k)) pairs.push([k, v])
		}
		if (pairs.length === 0) return next
		const stack = [...next.stack]
		stack[carrier] = { ...f, resume: pairs }
		return { ...next, stack }
	}
	if (frame.resume === undefined || frame.resume.length === 0) return next
	return scrubChoiceKeys(next, frame.resume)
}

function scrubChoiceKeys(
	state: GameState,
	pairs: [string, string][],
): GameState {
	const hit = (b: Record<string, unknown>) =>
		pairs.some(([k, id]) => b[k] === id)
	const bindingsMap = new Map<object, EffectCtx['bindings']>()
	const ctxMap = new Map<EffectCtx, EffectCtx>()
	const remap = (ctx: EffectCtx): EffectCtx => {
		const seen = ctxMap.get(ctx)
		if (seen !== undefined) return seen
		let b = bindingsMap.get(ctx.bindings)
		if (b === undefined) {
			b = { ...ctx.bindings }
			for (const [k, id] of pairs) if (b[k] === id) delete b[k]
			bindingsMap.set(ctx.bindings, b)
		}
		const nc = { ...ctx, bindings: b }
		ctxMap.set(ctx, nc)
		return nc
	}
	let touched = false
	const stack = state.stack.map((f) => {
		if (f.k === 'EFFECT' || f.k === 'OPERATION') {
			if (!hit(f.ctx.bindings)) return f
			touched = true
			return { ...f, ctx: remap(f.ctx) }
		}
		if (f.k === 'PHASE_STEP' && f.ctx !== undefined) {
			if (!hit(f.ctx.bindings)) return f
			touched = true
			return { ...f, ctx: remap(f.ctx) }
		}
		return f
	})
	return touched ? { ...state, stack } : state
}

/** Append a completed operation to this turn's resolved list (DUPLICATE
 *  RESOLVED_THIS_TURN — 1PER11). A list from an earlier turn is dropped. */
function recordResolved(state: GameState, ref: OperationRef): GameState {
	const prev =
		state.resolvedOps?.turn === state.turnNumber ? state.resolvedOps.refs : []
	return {
		...state,
		resolvedOps: { turn: state.turnNumber, refs: [...prev, ref] },
	}
}

/** Bindings a chosen REACTION starts with: the event's card, when it has one. */
function eventBindings(
	event: Extract<Frame, { k: 'REACTION_WINDOW' }>['event'],
): EffectCtx['bindings'] {
	const card = eventCardOf(event)
	const out: EffectCtx['bindings'] =
		card === null ? {} : { '$event.card': card }
	// a WOULD_* window: the replacement nodes write to this pending record
	if ('pending' in event) out[PENDING_BINDING] = event.pending
	return out
}

/** One step of the REACTION_WINDOW frame (todo/09 §3, §5, rules/12 §12.24):
 *  publish an OPTIONAL_TRIGGERS choice for the remaining set; once answered,
 *  push the chosen REACTIONs above the window (reverse of the chosen order, so
 *  the first-chosen resolves first) and, when the set is exhausted or the
 *  player declines, pop the window. */
function stepReactionWindow(
	state: GameState,
	frame: Extract<Frame, { k: 'REACTION_WINDOW' }>,
): GameState {
	const stack = state.stack
	const bindings = frame.bindings ?? {}
	if (frame.choiceId !== undefined) {
		const sel = bindings[frame.choiceId]
		if (Array.isArray(sel)) {
			const chosen = (sel as unknown as OperationRef[]).filter(
				(r) => !(frame.taken ?? []).some((t) => opKey(t) === opKey(r)),
			)
			if (chosen.length === 0) {
				// declined → the window pops; the caller (probe/run) resumes below.
				return { ...state, stack }
			}
			// Taking a REACTION exhausts its card (rules/03 §3.5.5, rules/08
			// `REACTION operations`), so a card answers at most once until it is
			// refreshed — also within one window: walk the refs in the chosen
			// (= resolution) order, exhausting as we go, so a second op of an
			// already-taken card is skipped. Then push in reverse (LIFO).
			let cards = state.cards
			const accepted: OperationRef[] = []
			for (const ref of chosen) {
				if (ref.seat !== frame.seat)
					throw new Error(
						`REACTION_WINDOW: chosen op belongs to seat ${ref.seat}, not ${frame.seat}`,
					)
				if (!reactionLegalFor({ ...state, cards }, ref)) continue
				cards = {
					...cards,
					[ref.card]: { ...cards[ref.card]!, exhausted: true },
				}
				accepted.push(ref)
			}
			const ops: Frame[] = []
			for (const ref of [...accepted].reverse()) {
				ops.push({
					k: 'OPERATION',
					card: ref.card,
					opIndex: ref.opIndex,
					// `$event.card` = the card the triggering event points at ("free
					// play it" / "the gained card" — 1PIC09, 1PIC01 PIC).
					ctx: {
						actor: ref.seat,
						source: ref.card,
						bindings: eventBindings(frame.event),
					},
					phase: 0,
				})
			}
			const taken = [...(frame.taken ?? []), ...chosen]
			// Push the reactions above the window, then re-arm the window so the
			// remaining set is re-offered when the reactions pop.
			return {
				...state,
				cards,
				stack: [
					...stack,
					...ops,
					{ ...frame, taken, choiceId: undefined, bindings: {} },
				],
			}
		}
		// published but not answered in bindings: fall through and (re)publish.
	}
	// A "would" window whose outcome is already decided (the attack ignored,
	// the gain replaced) has nothing left to offer.
	if (!windowStillOpen(state, frame.event)) return { ...state, stack }
	const takenKeys = new Set((frame.taken ?? []).map((r) => opKey(r)))
	// re-check at every (re)offer: an earlier reaction may have spent what a
	// remaining one needs (an action, the last card in hand) — rules/12 §12.1
	const remaining = frame.offered.filter(
		(r) =>
			!takenKeys.has(opKey(r)) &&
			reactionLegalFor(state, r) &&
			reactionPayable(state, r, frame.event),
	)
	if (remaining.length === 0) return { ...state, stack }
	const id = makeChoiceId(state)
	const next = nextRng(state)
	const sourceCard = eventCardOf(frame.event)
	next.pendingChoice = {
		k: 'OPTIONAL_TRIGGERS',
		id,
		seat: frame.seat,
		prompt: 'Reaction window — use any of these, or none',
		// Clone the refs: the same objects also live on the window frame, and
		// assertSerialisable treats a shared reference across two structures as a
		// cycle (the published choice must own its own copies).
		offered: remaining.map((r) => ({ ...r })),
		sourceCard,
	}
	const sourceDef = publicEventDef(state, frame.event, sourceCard)
	if (sourceDef !== undefined) next.pendingChoice.sourceDef = sourceDef
	next.stack = [...stack, { ...frame, choiceId: id, bindings }]
	return next
}

/** The def of the window's event card when both players know it: it lies face
 *  up, or it was gained face up and now lies face-down on the deck top (a
 *  Market pick put there). A card only its owner can see gets no stamp: the
 *  stamp outlives the seat projection, so it may name only public cards. */
function publicEventDef(
	state: GameState,
	event: Extract<Frame, { k: 'REACTION_WINDOW' }>['event'],
	iid: CardInstanceId | null,
): string | undefined {
	const card = iid === null ? undefined : state.cards[iid]
	if (card === undefined) return undefined
	const seen = event.k === 'CARD_GAINED' && event.seen === true
	return seen || zoneProps(card.zone).visibleTo === 'ALL' ? card.def : undefined
}

/** Re-validate a reaction ref at window-answer time — the card may have left
 *  play (or been exhausted) while the window was sitting open. */
function reactionLegalFor(state: GameState, ref: OperationRef): boolean {
	const card = state.cards[ref.card]
	if (card === undefined) return false
	if (!zoneProps(card.zone).inPlay) return false
	if (card.zone.k === 'BEAMED' || card.zone.k === 'STAGING') return false
	if (card.exhausted) return false
	const op = cardDef(card.def).operations[ref.opIndex]
	return op !== undefined && op.type === 'REACTION'
}

/**
 * Run the stack to a halt (docs/state-machine.md §3): empty stack, a pending
 * choice, a game result, or the loop cap. Resuming after a choice is just a
 * fresh call to run() — the resume frame's bindings carry the selection, so a
 * mid-effect save/reload round-trip produces the identical final state.
 */
export function runCollecting(state: GameState): {
	state: GameState
	events: GameEvent[]
} {
	let s = state
	const events: GameEvent[] = []
	let steps = 0
	// Away-team invariant (todo/08 §8): the total number of away-team tokens
	// (pools + every Location) never decreases during play. Asserted after
	// every primitive — tokens only move between a Captain card and Locations.
	let awayBefore = awayTeamsTotal(s)
	while (s.pendingChoice === null && s.stack.length > 0 && s.result === null) {
		if (++steps > MAX_STEPS) {
			throw new Error(
				`run: exceeded ${MAX_STEPS} steps — runaway effect? stack:\n${dumpStack(s)}`,
			)
		}
		const actor = frameActor(s, s.stack[s.stack.length - 1])
		s = chronicle(executeOne(s), actor)
		const awayAfter = awayTeamsTotal(s)
		if (awayAfter < awayBefore) {
			throw new Error(
				`away-team invariant (todo/08 §8): total fell from ${awayBefore} to ${awayAfter} at step ${steps}`,
			)
		}
		awayBefore = awayAfter
		// Drain the event queue: PASSIVEs resolve automatically, REACTION windows
		// open (todo/09). Events are surfaced to the caller, then every primitive
		// boundary re-checks the Burn (rules/12 §12.11 #1).
		const drained = drainEventQueue(s)
		s = drained.state
		events.push(...drained.drained)
		s = checkEndgame(s)
		if (s.pendingChoice === null && s.stack.length === 0 && s.result === null)
			s = pushDutyOfficerOverflow(s)
	}
	return { state: s, events }
}

/** rules/08 `promote`: "If you ever exceed your limit, you must dismiss Duty
 *  Officers until you meet it." Checked whenever the stack settles (a
 *  slot-granting card left play, a `requires` threshold dropped): the
 *  over-limit seat (active seat first) dismisses one surplus Duty Officer;
 *  the next settle re-checks until everyone fits. */
function pushDutyOfficerOverflow(state: GameState): GameState {
	for (const seat of [state.activeSeat, otherSeat(state.activeSeat)]) {
		const surplus = overflowDismissCandidates(state, seat)
		if (surplus.length === 0) continue
		const names = surplus.map((_, i) => `$doOverflow.${i}`)
		const bindings: EffectCtx['bindings'] = {}
		surplus.forEach((iid, i) => (bindings[names[i]!] = iid))
		return {
			...state,
			stack: [
				...state.stack,
				{
					k: 'EFFECT',
					node: {
						k: 'DISMISS',
						target: {
							zones: [{ k: 'DUTY_OFFICER', seat: 0 }],
							bound: names,
						},
					},
					ctx: { actor: seat, source: '' as CardInstanceId, bindings },
					ip: 0,
				},
			],
		}
	}
	return state
}

export function run(state: GameState): GameState {
	return runCollecting(state).state
}

function dumpStack(state: GameState): string {
	return state.stack
		.map((f, i) => {
			if (f.k === 'EFFECT') return `  ${i}: EFFECT ${f.node.k} ip=${f.ip}`
			if (f.k === 'OPERATION')
				return `  ${i}: OPERATION ${f.card}#${f.opIndex} phase=${f.phase}`
			return `  ${i}: ${f.k}`
		})
		.join('\n')
}

/**
 * Drain the event queue after each primitive (todo/09 — see triggers.ts):
 * matches PASSIVEs resolve automatically, REACTION windows open. Returns the
 * state; the drained events are exposed via runCollecting. Kept as a thin
 * wrapper so the resolver's public surface (index.ts) stays unchanged.
 */
export function drainEvents(state: GameState): GameState {
	return drainEventQueue(state).state
}
