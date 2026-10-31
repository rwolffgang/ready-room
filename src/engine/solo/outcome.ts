// "You freely choose the outcome" (rules/13 §13.12.2): the official solo Bot
// has no hand, and an attack that makes it choose from its own Discard pile
// has no effect — so wherever one of YOUR effects hinges on the Bot's hand or
// Discard pile, you say whether it succeeded.
//
//   - An IF of your effect that reads the Bot's hand/Discard pile and has an
//     "otherwise" ("if they can, log a PERSON … if they cannot, take an
//     INCIDENT"): you pick the branch.
//   - A step that would make the Bot pick from its hand/Discard pile (a
//     forced discard, a forced log …): no effect. If the step binds its card
//     for a later "if they did", the branch you picked decides — or you are
//     asked — and success binds a placeholder that only DID ever reads.
//
// The Bot's own rows (their source is the Bot's card) never pass through here.

import type { Effect } from '../resolver/nodes'
import type { Predicate, Query, ZoneSpec } from '../resolver/queries'
import type { EffectCtx, Frame, GameState } from '../state'
import { otherSeat } from '../state'
import { addLog, answer, answered, suspend } from '../resolver/runtime'
import type { Seat } from '../resolver/queries'

/** The branch you picked, for the steps inside it. */
const OUTCOME = '$solo.outcome'
/** The answer key of the outcome question. */
const ASK = '$solo.outcome.ask'
/** What a "succeeded" step binds: no card — only DID reads it. */
export const ASSUMED = '$solo.assumed'

type Gate = { run: boolean; state: GameState }

/** Does `spec` (resolved for `actor`) name the Bot's hand or Discard pile? */
function botPrivate(spec: ZoneSpec, actor: Seat, bot: Seat): boolean {
	if (typeof spec !== 'object' || !('seat' in spec)) return false
	if (spec.k !== 'HAND' && spec.k !== 'DISCARD') return false
	return (spec.seat === 0 ? actor : otherSeat(actor)) === bot
}

function queryReadsBot(q: Query, actor: Seat, bot: Seat): boolean {
	return q.zones.some((z) => botPrivate(z, actor, bot))
}

function predicateReadsBot(p: Predicate, actor: Seat, bot: Seat): boolean {
	switch (p.k) {
		case 'COUNT_AT_LEAST':
			return queryReadsBot(p.query, actor, bot)
		case 'AND':
		case 'OR':
			return p.terms.some((t) => predicateReadsBot(t, actor, bot))
		case 'NOT':
			return predicateReadsBot(p.term, actor, bot)
		default:
			return false
	}
}

/** A step acting as the Bot that would make it pick from its hand/Discard. */
function picksFromBot(node: Effect, actor: Seat, bot: Seat): boolean {
	if (actor !== bot) return false
	switch (node.k) {
		case 'DISCARD':
			return node.from === 'HAND'
		case 'COST_DISCARD':
			return true
		case 'LOG':
		case 'RETURN_INCIDENT':
			return (
				node.target !== 'THIS' &&
				node.target.zones.every((z) => botPrivate(z, actor, bot))
			)
		case 'DRAW_FROM_DISCARD':
			return true
		case 'FIND':
			return node.zones.every((z) => botPrivate(z, actor, bot))
		default:
			return false
	}
}

function bindOf(node: Effect): string | undefined {
	return 'bind' in node && typeof node.bind === 'string' ? node.bind : undefined
}

/** Ask YOU (the Bot's opponent) whether it succeeded; null = still asking. */
function ask(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
	human: Seat,
): { state: GameState } | { ok: boolean } {
	if (answered(ctx, ASK)) {
		const ok = answer<{ key: string }>(ctx, ASK).key === 'YES'
		delete ctx.bindings[ASK]
		return { ok }
	}
	const s = suspend(state, node, ctx, ASK, {
		k: 'CHOOSE_OPTION',
		prompt:
			'The Bot has no hand: you decide — did it succeed? (solo rules: you choose the outcome)',
		options: [
			{ key: 'YES', label: 'It succeeded', enabled: true },
			{ key: 'NO', label: 'It failed', enabled: true },
		],
	})
	return { state: { ...s, pendingChoice: { ...s.pendingChoice!, seat: human } } }
}

/** The gate (resolver/stack.ts, next to the attack gate). */
export function soloOutcomeGate(
	state: GameState,
	frame: Extract<Frame, { k: 'EFFECT' }>,
): Gate {
	const go = { run: true, state }
	if (state.mode !== 'SOLO' || state.solo === undefined) return go
	const bot = state.solo.bot
	const human = otherSeat(bot)
	const { node, ctx } = frame
	if (state.cards[ctx.source]?.owner !== human) return go

	if (
		node.k === 'IF' &&
		node.else !== undefined &&
		predicateReadsBot(node.cond, ctx.actor, bot)
	) {
		const r = ask(state, node, ctx, human)
		if ('state' in r) return { run: false, state: r.state }
		ctx.bindings[OUTCOME] = r.ok ? 'SUCCESS' : 'FAIL'
		const branch = r.ok ? node.then : node.else
		return {
			run: false,
			state: { ...state, stack: [...state.stack, { k: 'EFFECT', node: branch, ctx, ip: 0 }] },
		}
	}

	if (picksFromBot(node, ctx.actor, bot)) {
		const bind = bindOf(node)
		const flag = ctx.bindings[OUTCOME]
		let ok: boolean | null = flag === 'SUCCESS' ? true : flag === 'FAIL' ? false : null
		if (ok === null && bind !== undefined) {
			const r = ask(state, node, ctx, human)
			if ('state' in r) return { run: false, state: r.state }
			ok = r.ok
		}
		if (ok === true && bind !== undefined) ctx.bindings[bind] = ASSUMED
		return {
			run: false,
			state: addLog(state, {
				kind: 'INFO',
				seat: bot,
				message: 'no effect — the Bot has no hand (solo rules)',
			}),
		}
	}
	return go
}
