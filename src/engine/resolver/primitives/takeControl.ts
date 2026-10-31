import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	moveCard,
	emit,
	suspend,
	answered,
	answer,
	gainResource,
	addLog,
} from '../runtime'
import { pushOperation } from '../stack'
import { resolveQuery } from '../../queries/resolveQuery'
import { zonesOf, otherSeat, type GameState } from '../../state'
import { isSecured } from '../../queries/board'
import { refillNeutralZone } from '../../market'
import { cardDef, isLocationDef } from '../../cards'
import type { CardInstanceId } from '../../ids'
import {
	isCadetOpponent,
	opponentAwayTeamsAt,
	opponentShipTokensAt,
} from '../../../bot/cadet'
import { isSoloBot } from '../../solo/seat'

/** TAKE_CONTROL (rules/03 §3.4.2, rules/06 §6.4, rules/08 → take control):
 *  move a LOCATION into the actor's Location Area and resolve its CONTROL
 *  operation. When the Location is neutral (rules/08 §take control):
 *    1. dismiss all Ships present (each to its owner's Discard, token to the
 *       supply) and remove all Away Teams (returned to the owners' Captain
 *       cards);
 *    2. the OTHER player gains 1 Glory per of THEIR tokens there — away teams
 *       plus Ship tokens (rules/03 §3.4.1 "tokens") — via gainResource so the
 *       Stardate handoff can fire; the actor gains nothing;
 *    3. moveCard(loc → LOCATION_AREA:seat); set the owner;
 *    4. emit PUT_INTO_PLAY *before* pushing the CONTROL operation;
 *    5. push the CONTROL operation (the printed op resolves later);
 *    6. emit LOCATION_CONTROLLED;
 *    7. refillNeutralZone (idempotent when a phase continuation also refills).
 *  `requireSecured` restricts targets to Locations `isSecured` for the actor —
 *  only neutral Locations can be secured (rules/03 §3.4.1). A Location played
 *  from hand (its PLAY op is `TAKE_CONTROL{target:'THIS'}`) uses the same
 *  code path with no neutral dismissal (rules/08 → put into play).
 *  Locations already in a LOCATION_AREA are never re-takeable. */
export const takeControl: Primitive<Extract<Effect, { k: 'TAKE_CONTROL' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	execute(state, node, ctx, _frame) {
		const key = 'takeControl.loc'
		if (answered(ctx, key)) {
			return finish(state, ctx, answer<CardInstanceId>(ctx, key))
		}
		const cands = candidates(state, node, ctx)
		if (cands.length === 0) return state
		if (cands.length === 1) return finish(state, ctx, cands[0]!)
		return suspend(state, node, ctx, key, {
			k: 'CHOOSE_LOCATION',
			prompt: 'Take control of which Location?',
			candidates: cands,
		})
	},
}

function candidates(
	state: GameState,
	node: Effect & { k: 'TAKE_CONTROL' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	let locs: CardInstanceId[]
	if (node.target === 'FROM_LOCATION_DECK') {
		locs = zonesOf(state, { k: 'LOCATION_DECK' }).slice(0, 1) // take the top Location
	} else if (node.target === 'THIS') {
		// self-reference redirects to the duplicating card when inside DUPLICATE
		const iid = ctx.duplicating ?? ctx.source
		const card = state.cards[iid]
		locs =
			card !== undefined &&
			isLocationDef(cardDef(card.def)) &&
			card.zone.k !== 'LOCATION_AREA'
				? [iid]
				: []
	} else {
		locs = resolveQuery(state, node.target, ctx).filter((iid) => {
			const card = state.cards[iid]!
			return isLocationDef(cardDef(card.def)) && card.zone.k !== 'LOCATION_AREA'
		})
	}
	if (node.requireSecured === true) {
		locs = locs.filter((iid) => isSecured(state, iid, ctx.actor))
	}
	return locs
}

function finish(
	state: GameState,
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	loc: CardInstanceId,
): GameState {
	const seat = ctx.actor
	const opp = otherSeat(seat)
	const locCard = state.cards[loc]!
	const isNeutral = locCard.zone.k === 'NEUTRAL_ZONE'
	const at = state.awayTeamsAt[loc] ?? [0, 0]
	let next = state

	if (isNeutral) {
		// 2. count the opponent's tokens BEFORE anything is removed — 1 Glory per
		//    token they HAD there (away teams + Ship tokens; rules/03 §3.4.1).
		//    The virtual cadet "has" 1 Away Team (and no Ships) at the Location
		//    (rules/10 §10.2 #3), so that compensation is 1 Glory.
		let oppTokens = 0
		if (isCadetOpponent(state.mode, opp)) {
			oppTokens =
				opponentAwayTeamsAt(loc as string) + opponentShipTokensAt(loc as string)
		} else {
			oppTokens = at[opp] ?? 0
			for (const card of Object.values(state.cards)) {
				if (
					card.zone.k === 'FLEET' &&
					card.shipTokenAt === loc &&
					card.owner === opp
				)
					oppTokens++
			}
		}
		// 1. dismiss every Ship parked here (token → supply via leave-play) and
		//    return every Away Team to its owner's Captain card.
		for (const [iid, card] of Object.entries(next.cards)) {
			if (card.zone.k === 'FLEET' && card.shipTokenAt === loc) {
				const owner = card.owner ?? 0
				next = moveCard(next, iid as CardInstanceId, {
					k: 'DISCARD',
					seat: owner,
				})
				next = emit(next, {
					k: 'CARD_DISMISSED',
					iid: iid as CardInstanceId,
					seat: owner,
				})
			}
		}
		if ((at[0] ?? 0) > 0 || (at[1] ?? 0) > 0) {
			const awayTeamsAt = { ...next.awayTeamsAt }
			delete awayTeamsAt[loc]
			let players = next.players
			for (const s of [0, 1] as const) {
				if ((at[s] ?? 0) > 0) {
					players = players.map((pl) =>
						pl.seat === s
							? { ...pl, awayTeamsInPool: pl.awayTeamsInPool + (at[s] ?? 0) }
							: pl,
					) as GameState['players']
					next = emit(
						{ ...next, players },
						{
							k: 'AWAY_TEAM_REMOVED',
							seat: s,
							location: loc as string,
							count: at[s]!,
						},
					)
				}
			}
			next = { ...next, awayTeamsAt, players }
		}
		if (oppTokens > 0) next = gainResource(next, opp, 'GLO', oppTokens)
	}

	// 3. ownership flip + move into the actor's Location Area.
	next = {
		...next,
		cards: { ...next.cards, [loc]: { ...next.cards[loc]!, owner: seat } },
	}
	next = moveCard(next, loc, { k: 'LOCATION_AREA', seat })

	// 4/6/7. PUT_INTO_PLAY first, the CONTROL op in between, LOCATION_CONTROLLED
	//        after, then refill the vacated Neutral Zone slot.
	next = emit(next, { k: 'PUT_INTO_PLAY', iid: loc, seat })
	const ops = cardDef(state.cards[loc]!.def).operations
	const ctrlIndex = ops.findIndex((o) => o.type === 'CONTROL')
	// the official solo Bot resolves its Automated Command row instead of the
	// LOCATION's text (rules/13 §13.4 #2 — solo/turn.ts)
	if (ctrlIndex >= 0 && !isSoloBot(state, seat)) {
		next = pushOperation(next, loc, ctrlIndex, {
			actor: seat,
			source: loc,
			bindings: {},
		})
	}
	next = emit(next, { k: 'LOCATION_CONTROLLED', iid: loc, seat })
	next = addLog(next, {
		kind: 'EVENT',
		seat,
		message: `took control of ${loc}`,
	})
	return refillNeutralZone(next)
}
