import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'
import { moveCard } from '../runtime'
import { cardDef } from '../../cards'
import { emit, suspend, answer } from '../runtime'
import { shuffle } from '../../rng'
import { canPayAll } from './index'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { Seat } from '../queries'
import { isSoloBot } from '../../solo/seat'
import { botDeckCanAdvance, botDeckTop } from '../../solo/deck'

// DRAW + deck cycling (rules/04 §4.1, rules/12 §12.22, todo/05 §4).
//
// When the Draw deck is empty the draw step cycles: shuffle the Discard into a
// new Draw deck, enlist the top Reserve card automatically (guaranteed to be
// the next card drawn), and — only when the Reserve is empty — MAY enlist a
// Development. That Development offer is a real (MAY) PendingChoice, so the
// DRAW primitive is a *resumable frame*: it halts mid-draw at the offer and
// resumes once the player confirms/declines.
//
// Progress is tracked in `ctx.bindings` (plain JSON), so a mid-draw save/
// reload round-trip resumes identically: `$draw.remaining` and the offered
// marker `$draw.devPending`.

interface CycleState {
	kind: 'drew' | 'offered' | 'done'
	state: GameState
}

export const draw: Primitive<Extract<Effect, { k: 'DRAW' }>> = {
	isCost: false,
	canResolve(state, _node, ctx) {
		if (isSoloBot(state, ctx.actor)) return botDeckCanAdvance(state, ctx.actor)
		return deckCanAdvance(state, ctx.actor, ctx)
	},
	execute(state, node, ctx, _frame) {
		const seat = ctx.actor
		// the official solo Bot has no hand: a draw discards the top of its deck
		// instead (rules/13 §13.12.3)
		if (isSoloBot(state, seat)) return botMill(state, seat, evalAmount(state, node.count, ctx))
		const handSizeCap = ctx.bindings['$draw.handSizeCap']
		const started = ctx.bindings['$draw.remaining']
		const total = evalAmount(state, node.count, ctx)
		const remaining = typeof started === 'number' ? started : total
		if (remaining <= 0) return state

		// Resume path after the Development offer was answered.
		if (ctx.bindings['$draw.devPending'] === true) {
			const accepted = answer<boolean>(ctx, '$draw.dev')
			// `suspend` wrote the offer's bindings IN PLACE on the ctx it shares
			// with the sibling steps. Clear them, or a later DRAW in the same
			// sequence reads the stale offer and fails on `answer($draw.dev)`
			// (found by tools/arena.ts). The resume frame below gets its own copy.
			delete ctx.bindings['$draw.devPending']
			delete ctx.bindings['$draw.remaining']
			delete ctx.bindings['$draw.dev']
			if (accepted === true) {
				// rules/12 §12.23: if the Development's cost put cards in your hand and
				// that brought you to hand size, the enlisted card stays on top of the
				// deck — you do NOT draw it (the Clean-up draw is "up to" hand size).
				if (handAtCap(state, seat, handSizeCap)) return state
				// Run ENLIST_DEVELOPMENT, then resume the draw for the rest.
				const resumeBindings = {
					...ctx.bindings,
					'$draw.devPending': false,
					'$draw.remaining': remaining,
				}
				state.stack.push({
					k: 'EFFECT',
					node,
					ctx: { ...ctx, bindings: resumeBindings },
					ip: 0,
				})
				state.stack.push({
					k: 'EFFECT',
					node: { k: 'ENLIST_DEVELOPMENT' } as Effect,
					ctx,
					ip: 0,
				})
				return state
			}
			// Declined: the deck cannot be refilled — drawing stops here.
			return state
		}

		let next = state
		let rem = remaining
		while (rem > 0) {
			if (handAtCap(next, seat, handSizeCap)) break
			const deck = next.zones[`DRAW:${seat}`] ?? []
			if (deck.length > 0) {
				// "draw the bottom card of your deck" (1KOL05)
				const top = node.fromBottom === true ? deck[deck.length - 1]! : deck[0]!
				next = emit(moveCard(next, top, { k: 'HAND', seat }), {
					k: 'CARD_DRAWN',
					iid: top,
					seat,
				})
				// "Draw a card, then … discard IT" (1PIC08): bind the drawn card for the
				// operation's later steps (ctx.bindings is shared forward). A draw that
				// resumes after the Development offer runs in a copied ctx, so the bind
				// is only visible to later steps when no offer interrupted it.
				// A bind list names each drawn card in order ("draw 2 cards and
				// discard one of THEM" — 1PIC16).
				if (typeof node.bind === 'string') ctx.bindings[node.bind] = top
				else if (node.bind !== undefined) {
					const name = node.bind[total - rem]
					if (name !== undefined) ctx.bindings[name] = top
				}
				rem--
				continue
			}
			const cycle = refillCycle(next, ctx)
			next = cycle.state
			if (cycle.kind === 'done') break
			if (cycle.kind === 'offered') {
				return suspend(
					next,
					node,
					ctx,
					'$draw.dev',
					{
						k: 'CONFIRM',
						prompt:
							'Your Draw deck is empty and your Reserve is empty — enlist a Development instead?',
					},
					{ '$draw.remaining': rem, '$draw.devPending': true },
				)
			}
			// refilled: loop draws the (enlisted) top card next
		}
		return next
	},
}

/** The home guard for the Clean-up draw-to-hand-size: once the hand has
 *  reached `$draw.handSizeCap`, no further card is drawn (rules/12 §12.21,
 *  §12.23). Unset for ordinary effect-driven draws — there is no hand limit
 *  on a plain "draw N". */
function handAtCap(state: GameState, seat: Seat, cap: unknown): boolean {
	if (typeof cap !== 'number') return false
	return (state.zones[`HAND:${seat}`]?.length ?? 0) >= cap
}

/** Can one more card be made available right now? (deck non-empty, or the
 *  discard/reserve/development refill paths are open). */
export function deckCanAdvance(
	state: GameState,
	seat: Seat,
	ctx: EffectCtx,
): boolean {
	if ((state.zones[`DRAW:${seat}`]?.length ?? 0) > 0) return true
	const discard = state.zones[`DISCARD:${seat}`] ?? []
	const reserve = state.zones[`RESERVE:${seat}`] ?? []
	if (discard.length > 0 || reserve.length > 0) return true
	return affordableDevelopments(state, ctx).length > 0
}

/**
 * One empty-deck cycle (rules/04 §4.1): shuffle the Discard into a new Draw
 * deck, auto-enlist the top Reserve card when present, otherwise expose the
 * Development MAY offer (when any cost is affordable). Return 'done' when the
 * deck cannot be refilled at all.
 */
export function refillCycle(state: GameState, ctx: EffectCtx): CycleState {
	const seat = ctx.actor
	const discard = state.zones[`DISCARD:${seat}`] ?? []
	const reserve = state.zones[`RESERVE:${seat}`] ?? []
	const devs = affordableDevelopments(state, ctx)

	let next = state
	if (discard.length > 0) next = shuffleDiscardIntoDeck(next, seat)

	if (reserve.length > 0) {
		const top = next.zones[`RESERVE:${seat}`]?.[0]
		if (top === undefined) return { kind: 'done', state: next } // unreachable (checked above)
		next = moveCard(next, top, { k: 'DRAW', seat }, { toTop: true })
		return { kind: 'drew', state: next }
	}
	if (devs.length > 0) return { kind: 'offered', state: next }
	if (discard.length === 0) return { kind: 'done', state: next } // nothing refilled the deck
	return { kind: 'drew', state: next } // the shuffled Discard refilled it
}

/** Shuffle the entire Discard pile into the Draw deck (top becomes the new
 *  top). Consumes RNG — the state must thread it through for exact replay. */
export function shuffleDiscardIntoDeck(
	state: GameState,
	seat: Seat,
): GameState {
	const discard = state.zones[`DISCARD:${seat}`] ?? []
	if (discard.length === 0) return state
	const [order, rng] = shuffle(discard, state.rng)
	let next: GameState = { ...state, rng }
	// moveCard(toTop) prepends; iterate in reverse so the final deck order
	// matches the shuffled order (order[0] = new top).
	for (let i = order.length - 1; i >= 0; i--) {
		next = moveCard(next, order[i]!, { k: 'DRAW', seat }, { toTop: true })
	}
	return next
}

/** Development cards whose cost is fully payable right now (§4.2: you cannot
 *  enlist a Development you cannot fully pay/perform). */
export function affordableDevelopments(
	state: GameState,
	ctx: EffectCtx,
): CardInstanceId[] {
	return resolveQuery(
		state,
		{ zones: [{ k: 'DEVELOPMENT', seat: 0 }], seat: 'SELF' },
		ctx,
	).filter((iid) => {
		const cost = cardDef(state.cards[iid]!.def).developmentCost
		if (cost === null) return true
		return canPayAll(state, cost, ctx)
	})
}

/** Schedule `n` card draws for `seat` (rules/04 §4.1, todo/05 §4). This is
 *  the named convenience around the resumable DRAW primitive: it pushes a
 *  DRAW frame onto the stack and lets the stack machine run it (the frame may
 *  halt mid-draw on the Development MAY offer, and resumes later — same
 *  contract as the primitive itself). */
export function drawCards(
	state: GameState,
	seat: Seat,
	n: number,
	opts?: { untilHandSize?: number },
): GameState {
	const capBinding =
		opts?.untilHandSize !== undefined
			? { '$draw.handSizeCap': opts.untilHandSize }
			: {}
	return {
		...state,
		stack: [
			...state.stack,
			{
				k: 'EFFECT',
				node: { k: 'DRAW', count: n },
				ctx: {
					actor: seat,
					source: '' as CardInstanceId,
					bindings: capBinding,
				},
				ip: 0,
			},
		],
	}
}

/** The official solo Bot "draws" `n`: the top of its deck (reshuffling as
 *  needed) goes to its Discard pile instead (rules/13 §13.12.3). */
function botMill(state: GameState, bot: Seat, n: number): GameState {
	let next = state
	for (let i = 0; i < n; i++) {
		const r = botDeckTop(next, bot)
		next = r.state
		if (r.top === null) break
		next = emit(moveCard(next, r.top, { k: 'DISCARD', seat: bot }), {
			k: 'CARD_DISCARDED',
			iid: r.top,
			seat: bot,
		})
	}
	return next
}
