import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	pickCards,
	suspend,
	answered,
	answer,
	answerSingle,
	emit,
	gainResource,
	setOwner,
	skipBenefit,
	declinedPick,
} from '../runtime'
import { refillMarket, suitOfOffer } from '../../market'
import { zonesOf, moveCard, zoneProps } from '../../state'
import { cardDef } from '../../cards'
import { scanIncludesJunk } from '../../modifiers'
import type { GameState } from '../../state'
import type { ZoneRef } from '../queries'
import type { Seat } from '../queries'
import type { CardInstanceId } from '../../ids'
import type { MarketSuit, ResourceId } from '../../../data/ids'
import { gainGate } from '../replacement'

/** GAIN_CARD (rules/05 §5.4.1, rules/08 → gain): choose a suit (when several),
 *  then pick the faceup offer OR the unseen top of that suit's deck (OR any
 *  matching Junk card with includeJunk), then place it on your Draw deck top
 *  or in your Discard pile (CHOOSE_DESTINATION). A faceup pick transfers its
 *  resource tokens to your pool and refills the slot. No cards anywhere of the
 *  indicated suit → no effect (the leaf guard logs SKIPPED). Emits CARD_GAINED. */
export interface GainCandidate {
	iid: CardInstanceId
	hidden: boolean // face-down deck-top ("top of the X deck (unknown)")
}

/** Every legal GAIN_CARD source target for `suit`: offer, deck top, Junk.
 *  `includeJunk` (node flag) OR the seat's active "scans include Junk" passive
 *  (1ENC03) brings the Junk in. */
export function candidatesForSuit(
	state: GameState,
	suit: MarketSuit,
	includeJunk?: boolean,
	seat?: Seat,
	onlyJunk?: boolean,
): GainCandidate[] {
	const out: GainCandidate[] = []
	if (onlyJunk !== true) {
		for (const iid of zonesOf(state, { k: 'MARKET_OFFER', suit }))
			out.push({ iid, hidden: false })
		const deck = zonesOf(state, { k: 'MARKET_DECK', suit })
		if (deck.length > 0) out.push({ iid: deck[0]!, hidden: true })
	}
	if (
		onlyJunk === true ||
		includeJunk === true ||
		(seat !== undefined && scanIncludesJunk(state, seat))
	) {
		for (const iid of zonesOf(state, { k: 'JUNK' })) {
			if (cardDef(state.cards[iid]!.def).suit === suit)
				out.push({ iid, hidden: false })
		}
	}
	return out
}

export const gainCard: Primitive<Extract<Effect, { k: 'GAIN_CARD' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return node.suits.some(
			(suit) =>
				candidatesForSuit(
					state,
					suit,
					node.includeJunk,
					ctx.actor,
					node.onlyJunk,
				).length > 0,
		)
	},
	offersDecline: (_state, node) => new Set(node.suits).size === 1,
	execute(state, node, ctx, frame) {
		const suitKey = 'gainCard.suit'
		const pickKey = 'gainCard.pick'
		const destKey = 'gainCard.dest'

		// 3. destination answered → place the picked card.
		if (answered(ctx, destKey)) {
			const dest = answer<'DECK_TOP' | 'DISCARD'>(ctx, destKey)
			const iid = derivePick(state, node, ctx)
			// Bind the gained card so a later IF tests it (todo/13: "the gained
			// card is a WEAPON" — 1SHI13 / 1KOL23). In-place write on the shared
			// operation ctx, readable by later steps of the same operation.
			if (node.bind !== undefined) ctx.bindings[node.bind] = iid
			return finish(state, ctx.actor, iid, dest)
		}
		// 2. a card was picked → ask where it goes.
		if (answered(ctx, pickKey)) {
			const declined = declinedPick(state, ctx, pickKey)
			if (declined !== null) return declined
			const iid = answerSingle(ctx, pickKey)
			const gate = gainGate(state, frame, iid)
			return gate.run ? placeOrAsk(gate.state, node, ctx, iid) : gate.state
		}
		// 1. suit (locked once chosen — rules/05 §5.4.1 "choose one").
		const suits = [...new Set(node.suits)]
		if (suits.length > 1 && !answered(ctx, suitKey)) {
			const offered = suits.filter(
				(s) =>
					candidatesForSuit(
						state,
						s,
						node.includeJunk,
						ctx.actor,
						node.onlyJunk,
					).length > 0,
			)
			return suspend(state, node, ctx, suitKey, {
				k: 'CHOOSE_SUIT',
				suits: offered,
				prompt: 'Gain which suit?',
			})
		}
		const suit = suits.length > 1 ? answer<MarketSuit>(ctx, suitKey) : suits[0]!
		const cands = candidatesForSuit(
			state,
			suit,
			node.includeJunk,
			ctx.actor,
			node.onlyJunk,
		)
		if (cands.length === 0) {
			// canResolve guards against this; kept for safety (rules/05 §5.4.1).
			return skipBenefit(state, node, ctx, `no ${suit} cards in the Market`)
		}
		const r = pickCards(state, node, ctx, pickKey, {
			prompt: `Gain a ${suit} card`,
			declinable: true,
			candidates: cands.map((c) => c.iid),
			hidden: cands.filter((c) => c.hidden).map((c) => c.iid),
			min: 1,
			max: 1,
			from: `MARKET:${suit}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		// gain → scan 2 of that suit instead (1SIS22,
		// 1BUR06): the picked card may be replaced before it is gained.
		const gate = gainGate(state, frame, r.iids[0]!)
		return gate.run ? placeOrAsk(gate.state, node, ctx, r.iids[0]!) : gate.state
	},
}

/** A single legal placement (`to: ['DISCARD']` — "gain … to your Discard
 *  pile", 1BUR07) places at once; otherwise ask (rules/05 §5.4.3). */
function placeOrAsk(
	state: GameState,
	node: Effect & { k: 'GAIN_CARD' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	iid: CardInstanceId,
): GameState {
	const to = node.to ?? ['DECK_TOP', 'DISCARD']
	if (to.length === 1) {
		if (node.bind !== undefined) ctx.bindings[node.bind] = iid
		return finish(state, ctx.actor, iid, to[0]!)
	}
	return askDest(state, node, ctx, iid, to)
}

/** The picked card after a resume. When the pick was auto-selected (exactly
 *  one candidate) no CHOOSE_CARDS choice was ever published, so re-derive it —
 *  nothing has moved yet, so the same single candidate is still valid. */
function derivePick(
	state: GameState,
	node: Effect & { k: 'GAIN_CARD' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId {
	if (answered(ctx, 'gainCard.pick')) {
		const sel = answer<CardInstanceId[]>(ctx, 'gainCard.pick')
		if (sel.length !== 1) throw new Error(`GAIN_CARD: expected one picked card`)
		return sel[0]!
	}
	const suits = [...new Set(node.suits)]
	const suit =
		suits.length > 1 ? answer<MarketSuit>(ctx, 'gainCard.suit') : suits[0]!
	const cands = candidatesForSuit(
		state,
		suit,
		node.includeJunk,
		ctx.actor,
		node.onlyJunk,
	)
	if (cands.length !== 1)
		throw new Error(
			`GAIN_CARD: cannot re-derive an auto-picked card (${cands.length} candidates)`,
		)
	return cands[0]!.iid
}

export function askDest(
	state: GameState,
	node: Effect,
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	iid: CardInstanceId,
	options: ('DECK_TOP' | 'DISCARD')[] = ['DECK_TOP', 'DISCARD'],
): GameState {
	return suspend(state, node, ctx, 'gainCard.dest', {
		k: 'CHOOSE_DESTINATION',
		prompt: 'Place the gained card?',
		card: iid,
		options: [...options],
	})
}

/** Placement zone for a CHOOSE_DESTINATION answer. */
export function placeRef(dest: 'DECK_TOP' | 'DISCARD', seat: 0 | 1): ZoneRef {
	return dest === 'DECK_TOP' ? { k: 'DRAW', seat } : { k: 'DISCARD', seat }
}

export function finish(
	state: GameState,
	seat: 0 | 1,
	iid: CardInstanceId,
	dest: 'DECK_TOP' | 'DISCARD',
): GameState {
	const card = state.cards[iid]!
	let next = state
	const toTop = dest === 'DECK_TOP' ? { toTop: true } : undefined
	// Capture the offer suit BEFORE the move — the card leaves the offer slot,
	// so suitOfOffer is only answerable while it still sits there.
	const suit =
		card.zone.k === 'MARKET_OFFER' ? suitOfOffer(state, iid) : undefined
	// a face-up pick stays public knowledge after it goes onto the deck top
	const seen = zoneProps(card.zone).visibleTo === 'ALL'
	if (card.zone.k === 'MARKET_OFFER') {
		// faceup pick: transfer resource tokens to the pool (via 'MARKET'), move,
		// refill the slot (rules/05 §5.4.4).
		const tokens = card.resourceTokens
		for (const [res, amt] of Object.entries(tokens)) {
			if (amt !== undefined && amt > 0)
				next = gainResource(next, seat, res as ResourceId, amt, {
					via: 'MARKET',
				})
		}
		next = setOwner(next, iid, seat)
		next = moveCard(next, iid, placeRef(dest, seat), toTop)
		next = emit(next, { k: 'CARD_GAINED', iid, seat, dest, seen })
		if (suit !== undefined) next = refillMarket(next, suit)
		return next
	}
	// deck-top or Junk pick — no tokens, no refill.
	next = setOwner(next, iid, seat)
	next = moveCard(next, iid, placeRef(dest, seat), toTop)
	return emit(next, { k: 'CARD_GAINED', iid, seat, dest, seen })
}
