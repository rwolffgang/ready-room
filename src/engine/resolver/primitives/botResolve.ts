import type { Effect } from '../nodes'
import type { Primitive } from './index'
import type { AcRowRef, EffectCtx, Frame, GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import { addLog, emit, moveCard } from '../runtime'
import { matchFilter } from '../../queries/resolveQuery'
import { cardDef, isLocationDef } from '../../cards'
import { botDeckCanAdvance, botDeckTop } from '../../solo/deck'
import { classify } from '../../solo/classify'

type Node = Extract<Effect, { k: 'BOT_RESOLVE' }>

const MATCH = { allowWildcard: false, actorMayOptIn: false } as const

/** Bindings the post-resolution step reads (on its own copy of the ctx). */
const CARD = '$botResolve.card'
const PLAYED = '$botResolve.played'

/** The topmost card of the Bot Discard pile matching `node.filter`. */
function discardMatch(
	state: GameState,
	node: Node,
	ctx: EffectCtx,
): CardInstanceId | null {
	const pile = state.zones[`DISCARD:${ctx.actor}`] ?? []
	for (let i = pile.length - 1; i >= 0; i--) {
		const iid = pile[i]!
		if (
			node.filter === undefined ||
			matchFilter(state, state.cards[iid]!, node.filter, MATCH)
		)
			return iid
	}
	return null
}

/** Fetch the card to resolve, face up into the Bot's Staging Area (a bound
 *  card — a LOCATION just taken control of — is resolved where it lies). */
function fetch(
	state: GameState,
	node: Node,
	ctx: EffectCtx,
): { state: GameState; iid: CardInstanceId | null } {
	const bot = ctx.actor
	let iid: CardInstanceId | null = null
	let next = state
	switch (node.from) {
		case 'ROW':
			iid = state.zones[`BOT_ROW:${bot}`]?.[0] ?? null
			break
		case 'DECK_TOP': {
			const r = botDeckTop(state, bot)
			next = r.state
			iid = r.top
			break
		}
		case 'SUPPLEMENT_TOP':
			iid = state.zones[`SUPPLEMENT:${bot}`]?.[0] ?? null
			break
		case 'DISCARD':
			iid = discardMatch(state, node, ctx)
			break
		case 'BOUND': {
			const b = node.bound === undefined ? undefined : ctx.bindings[node.bound]
			iid = typeof b === 'string' ? (b as CardInstanceId) : null
			return { state, iid }
		}
	}
	if (iid === null) return { state: next, iid }
	return { state: moveCard(next, iid, { k: 'STAGING', seat: bot }), iid }
}

function rowLabel(row: AcRowRef | null): string {
	if (row === null) return 'no matching row'
	if ('surprise' in row) return 'its own SURPRISE operation'
	if ('trait' in row) return `TRAITS row ${row.trait + 1}`
	return `SUITS row ${row.suit} (${row.do ? 'with' : 'no'} Duty Officer)`
}

/** BOT_RESOLVE — the Bot resolves a card through its Automated Command cards
 *  (rules/13 §13.6, §13.8): flip the next Staging row card, or take the top of
 *  its deck / Supplement, the topmost match of its Discard pile, or a bound
 *  card; find its row (solo/classify.ts); run that row as an OPERATION with
 *  "this card" = the card; then a LOCATION still in the Staging Area moves to
 *  the Control Area (§13.6.4). A row card counts as played (ruling 052). */
export const botResolve: Primitive<Node> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const bot = ctx.actor
		switch (node.from) {
			case 'ROW':
				return (state.zones[`BOT_ROW:${bot}`]?.length ?? 0) > 0
			case 'DECK_TOP':
				return botDeckCanAdvance(state, bot)
			case 'SUPPLEMENT_TOP':
				return (state.zones[`SUPPLEMENT:${bot}`]?.length ?? 0) > 0
			case 'DISCARD':
				return discardMatch(state, node, ctx) !== null
			case 'BOUND':
				return (
					node.bound !== undefined &&
					typeof ctx.bindings[node.bound] === 'string'
				)
		}
	},
	execute(state, node, ctx, frame) {
		const bot = ctx.actor
		if (frame.ip === 1) return afterResolve(state, ctx)
		const fetched = fetch(state, node, ctx)
		const iid = fetched.iid
		if (iid === null) return fetched.state
		const row = classify(fetched.state, iid, bot)
		let next: GameState = addLog(fetched.state, {
			kind: 'EVENT',
			seat: bot,
			iid,
			message: `resolves ${iid}: ${rowLabel(row)}`,
		})
		if (next.solo !== undefined) {
			const beat = next.phase.k === 'BOT' ? next.phase.beat : 'RESOLVE'
			next = {
				...next,
				solo: {
					...next.solo,
					beat: { beat, card: iid, ...(row !== null ? { row } : {}) },
				},
			}
		}
		const after: Frame = {
			k: 'EFFECT',
			node,
			ctx: {
				...ctx,
				bindings: {
					...ctx.bindings,
					[CARD]: iid,
					[PLAYED]: node.from === 'ROW',
				},
			},
			ip: 1,
		}
		if (row === null) return { ...next, stack: [...next.stack, after] }
		const opCtx: EffectCtx = { actor: bot, source: iid, bindings: {} }
		const op: Frame =
			'surprise' in row
				? {
						k: 'OPERATION',
						card: iid,
						opIndex: cardDef(next.cards[iid]!.def).operations.findIndex(
							(o) => o.type === 'SURPRISE',
						),
						ctx: opCtx,
						phase: 0,
					}
				: {
						k: 'OPERATION',
						card: iid,
						opIndex: -1,
						row,
						ctx: opCtx,
						phase: 0,
					}
		return { ...next, stack: [...next.stack, after, op] }
	},
}

/** After the row: a LOCATION left in the Staging Area joins the Control Area
 *  (rules/13 §13.6.4); a flipped row card raises CARD_PLAYED (ruling 052). */
function afterResolve(state: GameState, ctx: EffectCtx): GameState {
	const bot = ctx.actor
	const iid = ctx.bindings[CARD] as CardInstanceId
	const card = state.cards[iid]
	let next = state
	if (
		card !== undefined &&
		card.zone.k === 'STAGING' &&
		card.zone.seat === bot &&
		isLocationDef(cardDef(card.def))
	) {
		next = emit(moveCard(next, iid, { k: 'LOCATION_AREA', seat: bot }), {
			k: 'LOCATION_CONTROLLED',
			iid,
			seat: bot,
		})
	}
	if (ctx.bindings[PLAYED] === true)
		next = emit(next, { k: 'CARD_PLAYED', iid, seat: bot })
	return next
}
