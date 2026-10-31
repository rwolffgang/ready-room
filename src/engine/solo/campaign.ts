// A Five-Year Mission game (rules/14): what the campaign so far brings into
// one solo game against the Bot. `SetupConfig.solo.campaign` carries it, and
// this module applies it, so every campaign game replays from its config and
// intent log alone:
//
//   - setup (before your opening hand): your Reinforcement pile is built
//     (crew cards leave your deck for it, Market cards leave the Market), the
//     campaign Directive joins your starting deck (or your Reserve deck), and
//     the challenges change your deck, resources and Away Teams;
//   - START: the BOOST bonuses resolve, those "before drawing the starting
//     hand" first (setup then holds the hand back until they have), the rest
//     after it;
//   - after every primitive (checkEndgame): the challenges that watch the
//     game — losing your starting SHIP loses it, and set-aside Away Teams
//     come back once your Reserve deck is empty.
//
// The campaign record itself (ranks, upgrades, the logbook) is session data:
// src/session/campaign.ts.

import type { Effect } from '../resolver/nodes'
import type { CardCatalog, SetupConfig } from '../setup'
import { mintInto } from '../setup'
import {
	moveCard,
	zoneKey,
	zonesOf,
	type BonusRef,
	type CampaignSetup,
	type GameState,
} from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'
import type { MarketSuit } from '../../data/ids'
import { cardDef } from '../cards'
import { shuffle } from '../rng'
import { pushEffect } from '../resolver/stack'
import { registerScript } from '../resolver/primitives/script'
import { botCard } from './acRegistry'
import { effectiveHandSize } from '../modifiers'

/** The campaign's own Directive (rules/14 §14.4): dealt only when your
 *  Reinforcement pile holds a card. */
export const CAMPAIGN_DIRECTIVE = '1DIR02-2'

const MARKET_SUITS: readonly string[] = ['PERSON', 'CARGO', 'SHIP', 'ALLY']

/** The campaign of a solo game's config, if it is one. */
export function campaignOf(config: SetupConfig): CampaignSetup | undefined {
	return config.mode === 'SOLO' ? config.solo?.campaign : undefined
}

/** A BOOST bonus's effect, or undefined when the ref names none. */
export function boostEffect(
	ref: BonusRef,
): { when: 'BEFORE_HAND' | 'AFTER_HAND'; effect: Effect } | undefined {
	const bonus = botCard(ref.deck)?.campaign?.[ref.side].bonus[ref.index]
	if (bonus?.k !== 'BOOST') return undefined
	return { when: bonus.when, effect: bonus.effect as Effect }
}

/** Setup holds your opening hand back for START when a boost must resolve
 *  "before drawing the starting hand". */
export function holdsOpeningHand(config: SetupConfig, seat: Seat): boolean {
	const c = campaignOf(config)
	if (c === undefined || seat !== 0) return false
	return c.boosts.some((b) => boostEffect(b)?.when === 'BEFORE_HAND')
}

function shuffleZone(
	state: GameState,
	zone: { k: 'DRAW' | 'RESERVE'; seat: Seat },
): GameState {
	const key = zoneKey(zone)
	const [order, rng] = shuffle(state.zones[key] ?? [], state.rng)
	return { ...state, rng, zones: { ...state.zones, [key]: order } }
}

/** One instance of `def` for the Reinforcement pile: a crew card of yours
 *  from your deck, or a Market card from its Market deck (refilling the offer
 *  when the card lay face up there). */
function claimForReinforcement(
	state: GameState,
	def: string,
	seat: Seat,
): GameState {
	const d = cardDef(def)
	const pile = { k: 'REINFORCEMENT', seat } as const
	if (d.deck !== 'COMMON') {
		const iid = (Object.keys(state.cards) as CardInstanceId[]).find((i) => {
			const c = state.cards[i]!
			return (
				c.def === def &&
				c.owner === seat &&
				c.zone.k !== 'REINFORCEMENT' &&
				c.zone.k !== 'CAPTAIN' &&
				c.zone.k !== 'STATUS'
			)
		})
		return iid === undefined ? state : moveCard(state, iid, pile)
	}
	if (!MARKET_SUITS.includes(d.suit)) return state
	const suit = d.suit as MarketSuit
	const deck = zonesOf(state, { k: 'MARKET_DECK', suit })
	const offer = zonesOf(state, { k: 'MARKET_OFFER', suit })
	const inDeck = deck.find((i) => state.cards[i]?.def === def)
	const inOffer = offer.find((i) => state.cards[i]?.def === def)
	const iid = inDeck ?? inOffer
	if (iid === undefined) return state
	let s = moveCard(state, iid, pile)
	s = { ...s, cards: { ...s.cards, [iid]: { ...s.cards[iid]!, owner: seat } } }
	if (iid === inOffer && inDeck === undefined) {
		const top = zonesOf(s, { k: 'MARKET_DECK', suit })[0]
		if (top !== undefined) s = moveCard(s, top, { k: 'MARKET_OFFER', suit })
	}
	return s
}

/** rules/14: your deck, resources and Away Teams for a campaign game — after
 *  your board is laid out and before your opening hand. The steps (and so
 *  their shuffles) run in a fixed order. */
export function setupCampaignDeck(
	state: GameState,
	seat: Seat,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const c = campaignOf(config)
	if (c === undefined || seat !== 0) return state
	let s = state
	// §14.3: the Reinforcement pile
	for (const def of c.reinforcement) s = claimForReinforcement(s, def, seat)
	// §14.5: a random Reserve deck of the same size
	if (c.shuffleReserve === true) {
		const reserve = zonesOf(s, { k: 'RESERVE', seat })
		const draw = zonesOf(s, { k: 'DRAW', seat })
		const [all, rng] = shuffle([...reserve, ...draw], s.rng)
		s = { ...s, rng }
		// deal: the first cards back to the Reserve deck, the rest to Draw
		all.forEach((iid, i) => {
			s = moveCard(s, iid, { k: i < reserve.length ? 'RESERVE' : 'DRAW', seat })
		})
	}
	// §14.4: the campaign Directive, when the pile holds a card
	if (
		zonesOf(s, { k: 'REINFORCEMENT', seat }).length > 0 &&
		catalog.defs.some((d) => d.id === CAMPAIGN_DIRECTIVE)
	) {
		const zone = {
			k: c.directiveToReserve === true ? 'RESERVE' : 'DRAW',
			seat,
		} as const
		s = mintInto(s, CAMPAIGN_DIRECTIVE, seat, zone, 'solo').state
		s = shuffleZone(s, zone)
	}
	// §14.5: an INCIDENT from the Incident deck in your starting deck
	if (c.incidentInDeck === true) {
		const top = zonesOf(s, { k: 'INCIDENT_DECK' })[0]
		if (top !== undefined) {
			s = moveCard(s, top, { k: 'DRAW', seat })
			s = {
				...s,
				cards: { ...s.cards, [top]: { ...s.cards[top]!, owner: seat } },
			}
			s = shuffleZone(s, { k: 'DRAW', seat })
		}
	}
	// §14.5: no Dilithium and/or Latinum to start with
	const without = c.withoutResources ?? []
	// §14.5: Away Teams set aside
	const aside = Math.max(0, c.awayTeamsAside ?? 0)
	if (without.length > 0 || aside > 0) {
		const players = s.players.map((p) => {
			if (p.seat !== seat) return p
			const resources = { ...p.resources }
			for (const r of without) resources[r] = 0
			const n = Math.min(aside, p.awayTeamsInPool)
			return {
				...p,
				resources,
				awayTeamsInPool: p.awayTeamsInPool - n,
				awayTeamsTotal: p.awayTeamsTotal - n,
			}
		}) as GameState['players']
		s = { ...s, players }
	}
	return s
}

/** After the Bot's board: the challenges the game keeps watching. */
export function finishCampaignSetup(
	state: GameState,
	config: SetupConfig,
): GameState {
	const c = campaignOf(config)
	if (c === undefined || state.solo === undefined) return state
	const human: Seat = state.solo.bot === 1 ? 0 : 1
	const ship =
		c.startingShip === true
			? zonesOf(state, { k: 'FLEET', seat: human }).find(
					(i) => cardDef(state.cards[i]!.def).suit === 'SHIP',
				)
			: undefined
	const setAside = (c.awayTeamsAside ?? 0) > 0 ? c.awayTeamsAside : undefined
	const held = holdsOpeningHand(config, human)
	return {
		...state,
		solo: {
			...state.solo,
			...(ship !== undefined || setAside !== undefined
				? {
						campaign: {
							...(ship !== undefined ? { startingShip: ship } : {}),
							...(setAside !== undefined ? { awayTeamsAside: setAside } : {}),
						},
					}
				: {}),
			...(c.boosts.length > 0 || held
				? { start: { boosts: [...c.boosts], held } }
				: {}),
		},
	}
}

// ---------------------------------------------------------------------------
// START: the boosts
// ---------------------------------------------------------------------------

registerScript('campaign.openingHand', {
	canResolve: () => true,
	execute: (state, _node, ctx) => drawHand(state, ctx.actor),
})

/** Your opening hand, held back by setup: draw it now (rules/02 §2.2 #13,
 *  through the hand-size modifiers like setup's own draw). */
function drawHand(state: GameState, seat: Seat): GameState {
	const n = effectiveHandSize(state, seat)
	let s = state
	for (let i = 0; i < n; i++) {
		const top = zonesOf(s, { k: 'DRAW', seat })[0]
		if (top === undefined) break
		s = moveCard(s, top, { k: 'HAND', seat })
	}
	return s
}

/** START in a campaign game: push the boosts above the first turn's
 *  RESUPPLY step — before-hand boosts, the held-back opening hand, then the
 *  after-hand ones — so they resolve first. Consumes `solo.start`. */
export function pushCampaignStart(state: GameState): GameState {
	const start = state.solo?.start
	if (start === undefined) return state
	state = { ...state, solo: { ...state.solo!, start: undefined } }
	const before: Effect[] = []
	const after: Effect[] = []
	for (const ref of start.boosts) {
		const b = boostEffect(ref)
		if (b === undefined) continue
		;(b.when === 'BEFORE_HAND' ? before : after).push(b.effect)
	}
	const steps: Effect[] = [
		...before,
		...(start.held
			? [{ k: 'SCRIPT', fn: 'campaign.openingHand' } as Effect]
			: []),
		...after,
	]
	if (steps.length === 0) return state
	const human: Seat = state.solo?.bot === 1 ? 0 : 1
	// the boosts are the campaign's, sourced at your Captain
	const captain = zonesOf(state, { k: 'CAPTAIN', seat: human })[0]
	if (captain === undefined) return state
	return pushEffect(state, { k: 'SEQ', steps } as Effect, {
		actor: human,
		source: captain,
		bindings: {},
	})
}

// ---------------------------------------------------------------------------
// The challenges that watch the game
// ---------------------------------------------------------------------------

/** After every primitive: your starting SHIP left your Fleet → you lose
 *  (the game ends and the Bot wins); your Reserve deck emptied → the
 *  set-aside Away Teams return to your Captain. */
export function campaignCheck(state: GameState): GameState {
	const watch = state.solo?.campaign
	if (watch === undefined || state.result !== null) return state
	const human: Seat = state.solo!.bot === 1 ? 0 : 1
	let s = state
	const ship = watch.startingShip
	if (ship !== undefined && s.cards[ship]?.zone.k !== 'FLEET') {
		return {
			...s,
			solo: { ...s.solo!, lost: 'STARTING_SHIP' },
			result: { kind: 'FINAL_SCORING' },
			phase: { k: 'GAME_OVER' },
		}
	}
	const aside = watch.awayTeamsAside ?? 0
	if (aside > 0 && zonesOf(s, { k: 'RESERVE', seat: human }).length === 0) {
		const players = s.players.map((p) =>
			p.seat === human
				? {
						...p,
						awayTeamsInPool: p.awayTeamsInPool + aside,
						awayTeamsTotal: p.awayTeamsTotal + aside,
					}
				: p,
		) as GameState['players']
		s = {
			...s,
			players,
			solo: { ...s.solo!, campaign: { ...watch, awayTeamsAside: 0 } },
		}
	}
	return s
}
