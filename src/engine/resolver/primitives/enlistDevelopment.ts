import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickCards, moveCard } from '../runtime'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'
import { canPayAll } from './index'
import { cardDef } from '../../cards'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ResourceId } from '../../../data/ids'

/** Legal Development enlistments: a Development card whose cost is payable
 *  (or `free`). Enlist = pay the development cost unless `free`, then place on
 *  top of the Draw deck (placed by the 'enlist.place' script handler). */
export const enlistDevelopment: Primitive<
	Extract<Effect, { k: 'ENLIST_DEVELOPMENT' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return legalCandidates(state, node, ctx).length > 0
	},
	execute(state, node, ctx, _frame) {
		// A picked Development (several candidates) resumes here too: pickCards
		// returns the answer, and it pays exactly like an auto-picked one.
		const cands = legalCandidates(state, node, ctx)
		const r = pickCards(state, node, ctx, 'enlist.dev', {
			prompt: 'Enlist a Development',
			candidates: cands,
			min: 1,
			max: 1,
			from: `DEVELOPMENT:${ctx.actor}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		const variants = costVariants(state, node, ctx, iid)
		if (node.free === true || variants === null) {
			return moveCard(
				state,
				iid,
				{ k: 'DRAW', seat: ctx.actor },
				{ toTop: true },
			)
		}
		// Pay the cost first, then place — PAY_THEN with a scripted placement body.
		// Several payable discount splits ("1 {DIL} or 1 {LAT} per STARBASE")
		// surface as a CHOOSE_ONE between the resulting costs.
		const body: Effect = { k: 'SCRIPT', fn: 'enlist.place' }
		const payable = variants.filter((v) => canPayAll(state, v.cost, ctx))
		const pick = payable.length > 0 ? payable : variants
		const effect: Effect =
			pick.length === 1
				? { k: 'PAY_THEN', cost: pick[0]!.cost, body }
				: {
						k: 'CHOOSE_ONE',
						options: pick.map((v) => ({
							label: v.label,
							body: { k: 'PAY_THEN', cost: v.cost, body },
						})),
					}
		state.stack.push({
			k: 'EFFECT',
			node: effect,
			ctx: { ...ctx, bindings: { ...ctx.bindings, 'enlist.pick': iid } },
			ip: 0,
		})
		return state
	},
}

function legalCandidates(
	state: GameState,
	node: Effect & { k: 'ENLIST_DEVELOPMENT' },
	ctx: EffectCtx,
): CardInstanceId[] {
	return resolveQuery(
		state,
		{
			zones: [{ k: 'DEVELOPMENT', seat: 0 }],
			seat: 'SELF',
			...(node.filter !== undefined ? { filter: node.filter } : {}),
		},
		ctx,
	).filter((iid) => {
		const variants = costVariants(state, node, ctx, iid)
		if (node.free === true || variants === null) return true
		return variants.some((v) => canPayAll(state, v.cost, ctx))
	})
}

/** The Development's cost after `node.discount` ("reducing the cost by 1
 *  {DIL} and 1 {LAT}" — 1SIS04): one variant per
 *  distinct result of splitting the "or" pools ("1 {DIL} or 1 {LAT} for each
 *  STARBASE" — 1SIS/M1), null when the card has no development cost. */
function costVariants(
	state: GameState,
	node: Effect & { k: 'ENLIST_DEVELOPMENT' },
	ctx: EffectCtx,
	iid: CardInstanceId,
): { cost: Effect; label: string }[] | null {
	const cost = cardDef(state.cards[iid]!.def).developmentCost
	if (cost === null) return null
	if (node.discount === undefined) return [{ cost, label: 'Pay the cost' }]
	const fixed: Partial<Record<ResourceId, number>> = {}
	const pools: { res: ResourceId[]; n: number }[] = []
	for (const d of node.discount) {
		const n = evalAmount(state, d.amount, ctx)
		if (Array.isArray(d.res)) pools.push({ res: d.res, n })
		else fixed[d.res] = (fixed[d.res] ?? 0) + n
	}
	const out = new Map<string, { cost: Effect; label: string }>()
	for (const split of splits(pools)) {
		const off = { ...fixed }
		for (const [res, n] of Object.entries(split) as [ResourceId, number][])
			off[res] = (off[res] ?? 0) + n
		const discounted = discountCost(state, cost, off, ctx).node
		const key = JSON.stringify(discounted)
		if (out.has(key)) continue
		const parts = (Object.entries(split) as [ResourceId, number][])
			.filter(([, n]) => n > 0)
			.map(([res, n]) => `${n} ${res}`)
		out.set(key, {
			cost: discounted,
			label:
				parts.length > 0
					? `Reduce the cost by ${parts.join(' + ')}`
					: 'Pay the cost',
		})
	}
	return [...out.values()]
}

/** Every way to hand out the "or" pools' points over their resources. */
function splits(
	pools: { res: ResourceId[]; n: number }[],
): Partial<Record<ResourceId, number>>[] {
	let acc: Partial<Record<ResourceId, number>>[] = [{}]
	for (const pool of pools) {
		const next: Partial<Record<ResourceId, number>>[] = []
		const give = (
			i: number,
			left: number,
			cur: Partial<Record<ResourceId, number>>,
		): void => {
			const res = pool.res[i]!
			if (i === pool.res.length - 1) {
				next.push({ ...cur, [res]: (cur[res] ?? 0) + left })
				return
			}
			for (let k = left; k >= 0; k--)
				give(i + 1, left - k, { ...cur, [res]: (cur[res] ?? 0) + k })
		}
		for (const base of acc) give(0, Math.max(0, pool.n), base)
		acc = next
	}
	return acc
}

/**
 * Lower every COST_RESOURCE of a discounted resource, never below 0. A SEQ
 * threads the remaining discount through its steps ("{DIL} ×3, {LAT} ×2"
 * with the {DIL} split over two nodes); alternative branches (IF / CHOOSE_ONE
 * — "{DIL} ×6 OR free if …") each get the full remaining discount.
 */
export function discountCost(
	state: GameState,
	node: Effect,
	off: Partial<Record<ResourceId, number>>,
	ctx: EffectCtx,
): { node: Effect; off: Partial<Record<ResourceId, number>> } {
	switch (node.k) {
		case 'COST_RESOURCE': {
			const left = off[node.res] ?? 0
			if (left <= 0) return { node, off }
			const amount = evalAmount(state, node.amount, ctx)
			const take = Math.min(left, amount)
			return {
				node: { ...node, amount: amount - take },
				off: { ...off, [node.res]: left - take },
			}
		}
		case 'SEQ': {
			let rest = off
			const steps: Effect[] = []
			for (const step of node.steps) {
				const r = discountCost(state, step, rest, ctx)
				steps.push(r.node)
				rest = r.off
			}
			return { node: { ...node, steps }, off: rest }
		}
		case 'IF':
			return {
				node: {
					...node,
					then: discountCost(state, node.then, off, ctx).node,
					...(node.else !== undefined
						? { else: discountCost(state, node.else, off, ctx).node }
						: {}),
				},
				off,
			}
		case 'CHOOSE_ONE':
			return {
				node: {
					...node,
					options: node.options.map((o) => ({
						...o,
						body: discountCost(state, o.body, off, ctx).node,
					})),
				},
				off,
			}
		default:
			return { node, off }
	}
}
