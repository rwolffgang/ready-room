import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { canPayAll, canResolveEffect, isControl, primitiveOf } from './index'
import {
	suspend,
	answered,
	answer,
	skipBenefit,
	glorySubstitutedFor,
	withoutDecline,
} from '../runtime'
import { describe } from '../../describe'
import { evalAmount, evalPredicate } from '../../queries/resolveQuery'
import type { GameState, EffectCtx } from '../../state'
import type { ResourceId } from '../../../data/ids'
import type { ChoicePreview } from '../choices'
import { attackGated } from '../replacement'

/** MAY → CONFIRM choice; accept pushes the body, decline skips it. The
 *  prompt spells out the optional effect ("You may promote …?") so the
 *  player knows what they are confirming. A body that could do nothing right
 *  now is skipped without asking (rules/12 §12.1 benefit skipping) — e.g.
 *  1PIC20 "may promote a PERSON from your Staging Area" with no
 *  PERSON staged, or 1PIC04' "may discard a SHIP" (a PAY_THEN) with
 *  no SHIP in hand. The accepted body runs with `ctx.optional`, so a cost
 *  that became unpayable only skips the optional part (PAY_THEN). A body
 *  whose first prompt can say no (`offersDecline`: "you may promote a
 *  PERSON" — the pick has a Decline, "you may warp" — the destination has a
 *  Skip) runs straight away with `ctx.declinable`, without the CONFIRM, so
 *  the yes/no and the pick are one dialog. A cost partly paid in Glory keeps
 *  the CONFIRM, the only prompt that says so. */
export const may: Primitive<Extract<Effect, { k: 'MAY' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const key = 'may.accept'
		if (answered(ctx, key)) {
			const accept = answer<boolean>(ctx, key)
			if (accept)
				state.stack.push({
					k: 'EFFECT',
					node: node.body,
					ctx: { ...withoutDecline(ctx), optional: true },
					ip: 0,
				})
			return state
		}
		if (wouldDoNothing(state, node.body, ctx))
			return skipBenefit(state, node.body, ctx, 'cannot fully resolve')
		const glory = gloryNote(state, node.body, ctx)
		if (glory === '' && offersDecline(state, node.body, ctx)) {
			state.stack.push({
				k: 'EFFECT',
				node: node.body,
				ctx: {
					...ctx,
					optional: true,
					declinable: { base: state.stack.length, prompt: `${mayText(node)}.` },
				},
				ip: 0,
			})
			return state
		}
		const preview = previewOf(state, node.body, ctx)
		return suspend(state, node, ctx, key, {
			k: 'CONFIRM',
			prompt: `${mayText(node)}?${glory}`,
			...(preview !== null ? { preview } : {}),
		})
	},
}

/** True when `node` asks before it changes anything and that first prompt can
 *  carry the decline: a primitive's `offersDecline`, reached through a SEQ's
 *  first step or a PAY_THEN's cost (asked before its body), or a single
 *  CHOOSE_ONE (its option choice gains a Decline row). A REPEAT UP_TO asks
 *  its rounds the same way (repeat.ts). That prompt must really come up: a
 *  first step that cannot resolve is skipped unasked (stack.ts), and the
 *  steps after it would run without the "you may" — so it keeps the CONFIRM,
 *  as does a node the attack gate would stop first (attackGated). Exported
 *  for REPEAT. */
export function offersDecline(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): boolean {
	if (attackGated(state, node, ctx)) return false
	switch (node.k) {
		case 'SEQ':
			return (
				node.steps[0] !== undefined && offersDecline(state, node.steps[0], ctx)
			)
		case 'PAY_THEN':
			return offersDecline(state, node.cost, ctx)
		case 'CHOOSE_ONE':
			return (node.count ?? 1) === 1 && canResolveEffect(state, node, ctx)
		case 'REPEAT':
			return (
				typeof node.times === 'object' &&
				node.times.k === 'UP_TO' &&
				offersDecline(state, node.body, ctx)
			)
		default:
			if (isControl(node)) return false
			return (
				primitiveOf(node).offersDecline?.(state, node, ctx) === true &&
				canResolveEffect(state, node, ctx)
			)
	}
}

/** What the optional effect would act on first: the node itself, the first
 *  step of a SEQ, or the cost of a PAY_THEN (it is asked before the body). */
function previewOf(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): ChoicePreview | null {
	if (node.k === 'SEQ')
		return node.steps[0] === undefined
			? null
			: previewOf(state, node.steps[0], ctx)
	if (node.k === 'PAY_THEN') return previewOf(state, node.cost, ctx)
	if (isControl(node)) return null
	return primitiveOf(node).preview?.(state, node, ctx) ?? null
}

/** True when accepting could not change anything (the optional effect is
 *  not offered):
 *  - a benefit leaf the stack's leaf guard would skip anyway;
 *  - a PAY_THEN whose cost cannot be paid ("you may discard X to …");
 *  - an IF whose branch would be skipped: an "if you do" (DID) on steps that
 *    have not happened yet, or a plain predicate that is false now and has no
 *    else — inside a SEQ only when nothing before it could change that;
 *  - a SEQ whose steps all do nothing, or whose first step that could do
 *    something is an unpayable PAY_THEN (accepting would fail it).
 *  Other control nodes and costs are always offered — their resolvability
 *  can depend on bindings made while they run (1SHI02: LOG the card just
 *  gained). Exported for REPEAT UP_TO (each round is optional). */
export function wouldDoNothing(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): boolean {
	switch (node.k) {
		case 'SEQ':
			for (const step of node.steps) {
				if (step.k === 'PAY_THEN' && !canPayAll(state, step.cost, ctx))
					return true
				if (!wouldDoNothing(state, step, ctx)) return false
			}
			return true
		case 'PAY_THEN':
			// paying the cost is already doing something
			return !canPayAll(state, node.cost, ctx)
		case 'IF':
			// evaluated now: inside a SEQ this is only reached when every earlier
			// step does nothing, so nothing could change the answer (an "if you
			// do" DID on binds no step will make stays false)
			return evalPredicate(state, node.cond, ctx)
				? wouldDoNothing(state, node.then, ctx)
				: node.else === undefined
					? true
					: wouldDoNothing(state, node.else, ctx)
		case 'CHOOSE_ONE':
			return !canResolveEffect(state, node, ctx)
		case 'NOOP':
			return true
		default:
			if (isControl(node) || primitiveOf(node).isCost) return false
			return !canResolveEffect(state, node, ctx)
	}
}

/** The MAY's card wording without its full stop ("You may promote …"). */
function mayText(node: Extract<Effect, { k: 'MAY' }>): string {
	const text = describe(node).trim()
	if (text === '') return 'Resolve this optional effect'
	return text.endsWith('.') ? text.slice(0, -1) : text
}

/** " (Paid with N {GLO}.)" when accepting would pay a resource cost partly
 *  or wholly in Glory (rules/04 §4.3.2 substitution), else "". The printed
 *  cost names only the resource, and Glory is also VP, so the player should
 *  see what they are really spending. Looks at the costs paid up front: the
 *  body's PAY_THEN cost, or the PAY_THEN / cost steps of a SEQ body. */
export function gloryNote(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): string {
	const owed: Partial<Record<ResourceId, number>> = {}
	const addCost = (cost: Effect): void => {
		if (cost.k === 'SEQ') cost.steps.forEach(addCost)
		else if (cost.k === 'COST_RESOURCE')
			owed[cost.res] =
				(owed[cost.res] ?? 0) + evalAmount(state, cost.amount, ctx)
	}
	if (node.k === 'PAY_THEN') addCost(node.cost)
	else if (node.k === 'SEQ')
		for (const step of node.steps)
			if (step.k === 'PAY_THEN') addCost(step.cost)
			else addCost(step)
	else addCost(node)
	let glory = 0
	for (const [res, amount] of Object.entries(owed) as [ResourceId, number][])
		glory += glorySubstitutedFor(state, ctx.actor, res, amount)
	return glory > 0 ? ` (Paid with ${glory} {GLO}.)` : ''
}
