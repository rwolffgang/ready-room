import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { canPayAll, canResolveEffect, isControl, primitiveOf } from './index'
import {
	suspend,
	answered,
	answer,
	skipBenefit,
	glorySubstitutedFor,
} from '../runtime'
import { describe } from '../../describe'
import { evalAmount, evalPredicate } from '../../queries/resolveQuery'
import type { GameState, EffectCtx } from '../../state'
import type { ResourceId } from '../../../data/ids'
import type { ChoicePreview } from '../choices'

/** MAY → CONFIRM choice; accept pushes the body, decline skips it. The
 *  prompt spells out the optional effect ("You may promote …?") so the
 *  player knows what they are confirming. A body that could do nothing right
 *  now is skipped without asking (rules/12 §12.1 benefit skipping) — e.g.
 *  1PIC20 "may promote a PERSON from your Staging Area" with no
 *  PERSON staged, or 1PIC04' "may discard a SHIP" (a PAY_THEN) with
 *  no SHIP in hand. The accepted body runs with `ctx.optional`, so a cost
 *  that became unpayable only skips the optional part (PAY_THEN). */
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
					ctx: ctx.optional === true ? ctx : { ...ctx, optional: true },
					ip: 0,
				})
			return state
		}
		if (wouldDoNothing(state, node.body, ctx))
			return skipBenefit(state, node.body, ctx, 'cannot fully resolve')
		const preview = previewOf(state, node.body, ctx)
		return suspend(state, node, ctx, key, {
			k: 'CONFIRM',
			prompt: mayPrompt(node) + gloryNote(state, node.body, ctx),
			...(preview !== null ? { preview } : {}),
		})
	},
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

function mayPrompt(node: Extract<Effect, { k: 'MAY' }>): string {
	const text = describe(node).trim()
	if (text === '') return 'Resolve this optional effect?'
	return text.endsWith('.') ? `${text.slice(0, -1)}?` : `${text}?`
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
