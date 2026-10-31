import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	suspend,
	answered,
	answer,
	skipBenefit,
	declineMay,
	withoutDecline,
} from '../runtime'
import type { GameState, EffectCtx } from '../../state'
import { canResolveEffect } from './index'
import { DECLINE_OPTION } from '../choices'

/** CHOOSE_ONE: pre-filter options with canResolveEffect; hard-filter disabled
 *  options for an isAttack resolved by the opponent (rules/03 §3.5.3). */
export function isAttackForOpponent(ctx: EffectCtx): boolean {
	return (
		ctx.bindings['$op.isAttack'] === true &&
		ctx.bindings['$op.seat'] !== ctx.actor
	)
}

export function chooseOneOptions(
	state: GameState,
	node: Effect & { k: 'CHOOSE_ONE' },
	ctx: EffectCtx,
	taken: ReadonlySet<number> = new Set(),
) {
	return node.options.map((o, i) => {
		const done = taken.has(i)
		const ok = !done && canResolveEffect(state, o.body, ctx)
		return {
			key: String(i),
			label: o.label,
			enabled: ok,
			reason: ok ? undefined : done ? 'already chosen' : 'cannot fully resolve',
		}
	})
}

/** The answer key of round `r` (kept until the node finishes, so later
 *  rounds know which options were taken). */
const roundKey = (count: number, r: number): string =>
	count > 1 ? `chooseN.${r}` : 'chooseOne.index'

/**
 * CHOOSE_ONE — "either A or B". With `count: N` — "choose N of the
 * following" — the player picks N DIFFERENT options, one round at a time
 * (`frame.ip` = rounds done); each chosen option resolves before the next
 * pick, and a round with no resolvable option left ends it early (benefit
 * skipping). 1SIS08, 1SIS09, 1SHI11.
 */
export const chooseOne: Primitive<Extract<Effect, { k: 'CHOOSE_ONE' }>> = {
	isCost: false,
	canResolve: (s, n, ctx) =>
		n.options.some((o) => canResolveEffect(s, o.body, ctx)),
	execute(state, node, ctx, frame) {
		const count = node.count ?? 1
		const round = count > 1 ? frame.ip : 0
		const key = roundKey(count, round)
		// "you may choose one" asked without a CONFIRM (may.ts): a Decline row
		const decline = count === 1 ? ctx.declinable : undefined
		if (answered(ctx, key)) {
			const sel = answer<{ key: string }>(ctx, key)
			if (sel.key === DECLINE_OPTION && decline !== undefined)
				return declineMay(state, decline)
			const opt = node.options[Number(sel.key)]
			if (round + 1 < count)
				state.stack.push({ k: 'EFFECT', node, ctx, ip: round + 1 })
			if (opt)
				state.stack.push({
					k: 'EFFECT',
					node: opt.body,
					ctx: withoutDecline(ctx),
					ip: 0,
				})
			return state
		}
		const taken = new Set<number>()
		for (let r = 0; r < round; r++) {
			if (!answered(ctx, roundKey(count, r))) continue
			taken.add(Number(answer<{ key: string }>(ctx, roundKey(count, r)).key))
		}
		const options = chooseOneOptions(state, node, ctx, taken)
		// Nothing at all resolvable → skip the benefit (or let a cost fail);
		// presenting a choice where every button is dead is a broken prompt.
		if (options.every((o) => !o.enabled)) {
			if (round > 0) return state // "choose 2", only one was possible
			return skipBenefit(state, node, ctx, 'no resolvable option')
		}
		// For an isAttack resolved by the opponent (rules/03 §3.5.3) hard-filter
		// disabled options out: they must choose one they can fully resolve. For a
		// normal CHOOSE_ONE we still present disabled options with their reasons so
		// the player sees why a route is closed.
		const offered = isAttackForOpponent(ctx)
			? options.filter((o) => o.enabled)
			: options
		return suspend(
			state,
			node,
			ctx,
			key,
			decline !== undefined
				? {
						k: 'CHOOSE_OPTION',
						prompt: decline.prompt,
						options: [
							...offered,
							{ key: DECLINE_OPTION, label: 'Decline', enabled: true },
						],
						mayDecline: true,
					}
				: {
						k: 'CHOOSE_OPTION',
						prompt:
							count > 1
								? `Choose ${count} different effects (${round + 1} of ${count}):`
								: 'Choose one effect:',
						options: offered,
					},
			undefined,
			round,
		)
	},
}
