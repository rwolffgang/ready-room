// Replacement windows — an attack whose negative effect is ignored and the gain → scan-2-of-that-suit swap (1SIS22, 1BUR06)
// (docs/effect-dsl.md §6 "would" windows).
//
// Both work the same way: the node that is about to do the thing re-pushes
// itself (its EFFECT frame gains a `gates` entry so the window opens once),
// records a GameState.pending entry and emits a WOULD_* event. The ordinary
// event drain then pushes the matching PASSIVEs (mandatory — 1SIS06
// 1SIS06) and a REACTION_WINDOW (optional — 1SIS10,
// 1PER19, 1BUR15, 1CAR11, 1SIS22, 1BUR06
// 1BUR06) ABOVE the re-pushed node. Their IGNORE_ATTACK / REPLACE_GAIN
// nodes write to the pending record (`$event.pending`), and when the node runs
// again it reads the record back: skip the negative effect, or scan instead of
// gaining.
//
// "Being attacked" (rules/03 §3.5.3: an ATTACK operation "negatively affects
// your opponent"): the opponent's ATTACK operation is about to apply an effect
// that acts on you or your things. The window opens at the FIRST such effect
// (never for an attack whose negative part cannot resolve, e.g. 1SIS15's "if
// the opponent has a SHIP at the Defiant's LOCATION" with no such ship), and
// the attacker's own benefits keep resolving whatever the victim does. The
// effects that count, while the attacker is acting:
//   - FORCE / OPPONENT (the victim acts: discards, takes an INCIDENT, dismisses …);
//   - STEAL; DISCARD / COST_DISCARD `whose: OPPONENT`; REMOVE_AWAY_TEAM
//     `whose: OPPONENT`;
//   - DISMISS / LOG / RECALL / DESTROY / EXHAUST / PUT_ON_DECK_TOP /
//     RETURN_INCIDENT whose candidates include a card the victim owns;
//   - a PAY_THEN whose cost contains one of the above (1CAR09: the victim
//     may pay an ATTACK from hand for 1 {GLO}): the whole PAY_THEN.
// Effect-specific windows ("when an attack would dismiss your Duty Officer" —
// 1BUR15; "… force you to remove AWAY TEAMs" — 1CAR11) open for each such
// effect: REMOVE_AWAY_TEAM with the pre-check, DISMISS once the dismissed card
// is picked and turns out to be the victim's Duty Officer.

import type { Effect, TriggerSpec } from './nodes'
import type {
	AttackEffectKind,
	EffectCtx,
	Frame,
	GameEvent,
	GameState,
	PendingReplacement,
} from '../state'
import type { CardInstanceId } from '../ids'
import type { MarketSuit } from '../../data/ids'
import { resolveQuery } from '../queries/resolveQuery'
import { addLog, emit } from './runtime'
import { collectPassiveOps, collectReactionGroups } from './triggers'
import { canResolveEffect, canPayAll } from './primitives'
import { cardDef } from '../cards'

type EffectFrame = Extract<Frame, { k: 'EFFECT' }>

/** Binding carrying the id of the ATTACK operation being resolved (stamped
 *  by the OPERATION frame; null inside a non-attack operation). */
export const ATTACK_BINDING = '$attack.id'
/** Binding a WOULD_* reaction/passive starts with: its pending record id. */
export const PENDING_BINDING = '$event.pending'

function setPending(
	state: GameState,
	id: string,
	rec: PendingReplacement | null,
): GameState {
	const pending = { ...(state.pending ?? {}) }
	if (rec === null) delete pending[id]
	else pending[id] = rec
	return { ...state, pending }
}

/** A fresh, deterministic pending id (unique among the open records). */
function newPendingId(state: GameState, base: string): string {
	let id = `${base}@${state.turnNumber}.${state.log.length}`
	while (state.pending?.[id] !== undefined) id += "'"
	return id
}

/** Open the record for an ATTACK operation (stack.ts, OPERATION phase 0). */
export function openAttack(
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	attacker: 0 | 1,
): { state: GameState; id: string } {
	const id = newPendingId(state, `atk:${card}#${opIndex}`)
	return {
		id,
		state: setPending(state, id, {
			k: 'ATTACK',
			attacker,
			victim: attacker === 0 ? 1 : 0,
			asked: false,
			ignored: false,
			ignoreEffect: false,
		}),
	}
}

/** Drop the record when the ATTACK operation completes (phase 1). */
export function closePending(state: GameState, id: string): GameState {
	return state.pending?.[id] === undefined ? state : setPending(state, id, null)
}

function attackOf(
	state: GameState,
	ctx: EffectCtx,
): [string, Extract<PendingReplacement, { k: 'ATTACK' }>] | null {
	const id = ctx.bindings[ATTACK_BINDING]
	if (typeof id !== 'string') return null
	const rec = state.pending?.[id]
	return rec?.k === 'ATTACK' ? [id, rec] : null
}

/** Would the attack gate stop `node` before it runs — the attacker executing
 *  something that negatively affects the victim (`victimEffects`)? A "you
 *  may" around it keeps its CONFIRM (may.ts), so the victim's "would be
 *  attacked" window never opens for an effect the attacker then declines. */
export function attackGated(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): boolean {
	const found = attackOf(state, ctx)
	if (found === null) return false
	const [, rec] = found
	return (
		ctx.actor === rec.attacker &&
		victimEffects(state, node, ctx, rec.victim) !== null
	)
}

/** The victim of the ATTACK operation `ctx` belongs to, if any. */
export function attackVictim(state: GameState, ctx: EffectCtx): 0 | 1 | null {
	return attackOf(state, ctx)?.[1].victim ?? null
}

/** Does anything of the victim's react to (or passively handle) `event`? */
function hasHandler(state: GameState, event: GameEvent): boolean {
	return (
		collectPassiveOps(state, event).length > 0 ||
		collectReactionGroups(state, event).length > 0
	)
}

function skipIgnored(state: GameState, frame: EffectFrame): GameState {
	return addLog(state, {
		kind: 'SKIPPED',
		seat: frame.ctx.actor,
		message: `${frame.node.k}: ignored — the attack's negative effect was prevented`,
	})
}

/** Would `node` (the attacker acting) negatively affect `victim`? Returns the
 *  effect kinds it carries ([] = a plain negative effect), or null. */
export function victimEffects(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	victim: 0 | 1,
): AttackEffectKind[] | null {
	switch (node.k) {
		case 'FORCE':
		case 'OPPONENT':
			return subtreeRemovesAwayTeams(node.body) ? ['REMOVE_AWAY_TEAM'] : []
		case 'PAY_THEN':
			return costHitsOpponent(node.cost) ? [] : null
		case 'STEAL':
			return []
		case 'DISCARD':
		case 'COST_DISCARD':
			return node.whose === 'OPPONENT' ? [] : null
		case 'REMOVE_AWAY_TEAM':
			return node.whose === 'OPPONENT' ? ['REMOVE_AWAY_TEAM'] : null
		case 'DISMISS':
		case 'LOG':
		case 'RECALL':
		case 'DESTROY':
		case 'EXHAUST':
		case 'PUT_ON_DECK_TOP':
		case 'RETURN_INCIDENT': {
			if (node.target === 'THIS') return null
			return resolveQuery(state, node.target, ctx).some(
				(iid) => state.cards[iid]?.owner === victim,
			)
				? []
				: null
		}
		default:
			return null
	}
}

/** Inside a FORCE/OPPONENT body the victim acts: "remove your AWAY TEAM". */
function subtreeRemovesAwayTeams(node: Effect): boolean {
	switch (node.k) {
		case 'REMOVE_AWAY_TEAM':
			return node.whose === 'SELF'
		case 'COST_REMOVE_AWAY_TEAM':
			return true
		case 'SEQ':
			return node.steps.some(subtreeRemovesAwayTeams)
		case 'CHOOSE_ONE':
			return node.options.some((o) => subtreeRemovesAwayTeams(o.body))
		case 'PAY_THEN':
			return (
				subtreeRemovesAwayTeams(node.cost) || subtreeRemovesAwayTeams(node.body)
			)
		case 'IF':
			return (
				subtreeRemovesAwayTeams(node.then) ||
				(node.else !== undefined && subtreeRemovesAwayTeams(node.else))
			)
		case 'MAY':
		case 'REPEAT':
		case 'FOR_EACH':
		case 'LET':
		case 'ATTACK':
			return subtreeRemovesAwayTeams(node.body)
		case 'TRY':
			return (
				subtreeRemovesAwayTeams(node.body) ||
				(node.otherwise !== undefined &&
					subtreeRemovesAwayTeams(node.otherwise))
			)
		default:
			return false
	}
}

function costHitsOpponent(node: Effect): boolean {
	switch (node.k) {
		case 'COST_DISCARD':
			return node.whose === 'OPPONENT'
		case 'SEQ':
			return node.steps.some(costHitsOpponent)
		case 'CHOOSE_ONE':
			return node.options.some((o) => costHitsOpponent(o.body))
		default:
			return false
	}
}

/** The outcome of a gate: `run` = the node still executes now, on `state`;
 *  otherwise `state` is final for this step (the node was skipped, or
 *  re-pushed under a window). */
export interface GateResult {
	run: boolean
	state: GameState
}

/**
 * The attack gate (docs/effect-dsl.md §6). `frame` is the EFFECT frame about
 * to execute (already popped off `state.stack`). The node is skipped when the
 * attack was ignored, or re-pushed under a WOULD_BE_ATTACKED window.
 *
 * - gate 'ATTACK': the pre-check, for a node the ATTACKER executes that would
 *   negatively affect the victim (`victimEffects`).
 * - gate 'ATTACK_DO': DISMISS picked the victim's Duty Officer (dismiss.ts).
 */
export function attackGate(
	state: GameState,
	frame: EffectFrame,
	gate: 'ATTACK' | 'ATTACK_DO',
	effects?: AttackEffectKind[],
): GateResult {
	const go: GateResult = { run: true, state }
	if (state.probe === true) return go
	const found = attackOf(state, frame.ctx)
	if (found === null) return go
	const [id, rec] = found
	let kinds = effects
	if (gate === 'ATTACK') {
		if (frame.ctx.actor !== rec.attacker) return go
		kinds = victimEffects(state, frame.node, frame.ctx, rec.victim) ?? undefined
		if (kinds === undefined) return go
		// no window for an effect that could not apply anyway
		const node = frame.node
		const resolvable =
			node.k === 'PAY_THEN'
				? canPayAll(state, node.cost, frame.ctx)
				: node.k === 'FORCE'
					? canResolveEffect(state, node.body, {
							...frame.ctx,
							actor: rec.victim,
						})
					: canResolveEffect(state, node, frame.ctx)
		if (!resolvable) return go
	}
	if (rec.ignored) return { run: false, state: skipIgnored(state, frame) }
	if (frame.gates?.includes(gate) === true) {
		if (!rec.ignoreEffect) return go
		return {
			run: false,
			state: skipIgnored(
				setPending(state, id, { ...rec, ignoreEffect: false }),
				frame,
			),
		}
	}
	const first = !rec.asked
	const list = kinds ?? []
	if (!first && list.length === 0) return go
	const event: GameEvent = {
		k: 'WOULD_BE_ATTACKED',
		seat: rec.attacker,
		victim: rec.victim,
		pending: id,
		first,
		effects: list,
	}
	const next = first ? setPending(state, id, { ...rec, asked: true }) : state
	if (!hasHandler(next, event)) return { run: true, state: next }
	return {
		run: false,
		state: emit(
			{
				...next,
				stack: [
					...next.stack,
					{ ...frame, gates: [...(frame.gates ?? []), gate] },
				],
			},
			event,
		),
	}
}

/** IGNORE_ATTACK: mark the pending attack (the `$event.pending` record). */
export function ignoreAttack(
	state: GameState,
	ctx: EffectCtx,
	scope: 'ATTACK' | 'EFFECT',
): GameState {
	const id = ctx.bindings[PENDING_BINDING]
	if (typeof id !== 'string') return state
	const rec = state.pending?.[id]
	if (rec?.k !== 'ATTACK') return state
	const next = setPending(
		state,
		id,
		scope === 'ATTACK'
			? { ...rec, ignored: true }
			: { ...rec, ignoreEffect: true },
	)
	return addLog(next, {
		kind: 'BENEFIT',
		seat: ctx.actor,
		message:
			scope === 'ATTACK'
				? "ignores the attack's negative effect"
				: "ignores the attack's effect",
	})
}

// ---------------------------------------------------------------------------
// "When you would gain a card" (GAIN_CARD)
// ---------------------------------------------------------------------------

/**
 * The gain gate (gainCard.ts, once the card to gain is picked): gain
 * normally (`run`), or stop here — the gain re-pushed under a
 * WOULD_GAIN_CARD window, or — on the second pass, when a REPLACE_GAIN
 * answered — a SCAN_N of the same suit pushed in its place (same ctx and
 * `bind`, so "the gained card" still names what was scanned).
 */
export function gainGate(
	state: GameState,
	frame: EffectFrame,
	iid: CardInstanceId,
): GateResult {
	const go: GateResult = { run: true, state }
	if (state.probe === true) return go
	const node = frame.node
	if (node.k !== 'GAIN_CARD') return go
	if (frame.gates?.includes('GAIN') === true) {
		const id = frame.pending
		const rec = id === undefined ? undefined : state.pending?.[id]
		if (id === undefined || rec?.k !== 'GAIN') return go
		const next = setPending(state, id, null)
		if (rec.scan === null) return { run: true, state: next }
		const scan: Effect = {
			k: 'SCAN_N',
			n: rec.scan,
			suits: [rec.suit],
			...(node.includeJunk === true ? { includeJunk: true } : {}),
			...(node.bind !== undefined ? { bind: node.bind } : {}),
		}
		return {
			run: false,
			state: addLog(
				{
					...next,
					stack: [
						...next.stack,
						{ k: 'EFFECT', node: scan, ctx: frame.ctx, ip: 0 },
					],
				},
				{
					kind: 'BENEFIT',
					seat: frame.ctx.actor,
					message: `scans ${rec.scan} ${rec.suit} instead of gaining`,
				},
			),
		}
	}
	const suit = cardDef(state.cards[iid]!.def).suit as MarketSuit
	const id = newPendingId(state, `gain:${iid}`)
	const event: GameEvent = {
		k: 'WOULD_GAIN_CARD',
		seat: frame.ctx.actor,
		pending: id,
		suit,
	}
	if (!hasHandler(state, event)) return go
	const next = setPending(state, id, {
		k: 'GAIN',
		seat: frame.ctx.actor,
		suit,
		scan: null,
	})
	const opened = emit(
		{
			...next,
			stack: [
				...next.stack,
				{
					...frame,
					gates: [...(frame.gates ?? []), 'GAIN'],
					pending: id,
				},
			],
		},
		event,
	)
	return { run: false, state: opened }
}

/** REPLACE_GAIN: "scan N of the same suit instead". */
export function replaceGain(
	state: GameState,
	ctx: EffectCtx,
	scan: number,
): GameState {
	const id = ctx.bindings[PENDING_BINDING]
	if (typeof id !== 'string') return state
	const rec = state.pending?.[id]
	if (rec?.k !== 'GAIN' || rec.scan !== null) return state
	return setPending(state, id, { ...rec, scan })
}

/** Is a WOULD_* window still worth offering? Once the attack (or this
 *  effect) is ignored, or the gain already replaced, the remaining
 *  reactions of that window could change nothing. */
export function windowStillOpen(state: GameState, event: GameEvent): boolean {
	if (event.k === 'WOULD_BE_ATTACKED') {
		const rec = state.pending?.[event.pending]
		return rec?.k === 'ATTACK' && !rec.ignored && !rec.ignoreEffect
	}
	if (event.k === 'WOULD_GAIN_CARD') {
		const rec = state.pending?.[event.pending]
		return rec?.k === 'GAIN' && rec.scan === null
	}
	return true
}

/** Does a WOULD_BE_ATTACKED trigger match this event for its owner? */
export function matchesWouldBeAttacked(
	trigger: Extract<TriggerSpec, { on: 'WOULD_BE_ATTACKED' }>,
	event: Extract<GameEvent, { k: 'WOULD_BE_ATTACKED' }>,
): boolean {
	return trigger.effect === undefined
		? event.first
		: event.effects.includes(trigger.effect)
}
