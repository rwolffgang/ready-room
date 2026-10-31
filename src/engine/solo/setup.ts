// The official solo Bot's board (rules/13 §13.2): no hand, no resources, no
// Action or Mission tokens, Basic side with its tracks at 0 and no Mission.
// Its crew deck becomes a Supplement deck (Development cards shuffled, its
// Reserve shuffled on top) and a Bot deck (Available cards shuffled, its
// Deployed and Controlled cards shuffled together on top); Discard cards
// start in its Discard pile and a Status card goes back to the box. The
// shuffles run in a fixed order, so the game replays from its seed.

import type { CardDef } from '../../data/schema'
import type { CardCatalog, SetupConfig } from '../setup'
import { mintInto, setupMissions } from '../setup'
import type { GameState, PlayerState } from '../state'
import { zoneKey } from '../state'
import { cardDef } from '../cards'
import { shuffle } from '../rng'
import { botCard } from './acRegistry'
import type { CardInstanceId } from '../ids'
import type { Seat, ZoneRef } from '../resolver/queries'

/** Mint `defs` into `zone` (owned by the Bot) and return them shuffled. */
function mintShuffled(
	state: GameState,
	defs: CardDef[],
	zone: ZoneRef,
	bot: Seat,
): { state: GameState; order: CardInstanceId[] } {
	let s = state
	const iids: CardInstanceId[] = []
	for (const d of defs) {
		const r = mintInto(s, d.id, bot, zone, `p${bot}`)
		s = r.state
		iids.push(r.iid)
	}
	const [order, rng] = shuffle(iids, s.rng)
	return { state: { ...s, rng }, order }
}

export function setupSoloBot(
	state: GameState,
	bot: Seat,
	config: SetupConfig,
	catalog: CardCatalog,
): GameState {
	const solo = config.solo
	const crew = config.players[bot]?.deck
	const human = config.players[bot === 1 ? 0 : 1]?.deck
	if (solo === undefined || crew === undefined)
		throw new Error('setupSoloBot: a solo game needs `solo` and the Bot’s crew')
	if (botCard(crew) === undefined)
		throw new Error(`setupSoloBot: ${crew} has no Automated Command cards`)
	if (crew === human)
		throw new Error('setupSoloBot: you and the Bot cannot play the same crew')

	const defs = catalog.defs.filter((d) => d.deck === crew)
	const by = (pos: CardDef['startPosition']) =>
		defs.filter((d) => d.startPosition === pos)
	let s = state
	const prefix = `p${bot}`
	for (const d of defs) {
		if (d.suit === 'CAPTAIN') s = mintInto(s, d.id, bot, { k: 'CAPTAIN', seat: bot }, prefix).state
		else if (d.suit === 'STATUS') s = mintInto(s, d.id, bot, { k: 'BOX' }, prefix).state
	}

	// Supplement deck: Development cards shuffled, the Reserve shuffled on top.
	const supplement: ZoneRef = { k: 'SUPPLEMENT', seat: bot }
	const dev = mintShuffled(s, by('DEVELOPMENT'), supplement, bot)
	const res = mintShuffled(dev.state, by('RESERVE'), supplement, bot)
	s = res.state
	// The solo Directives: under the Conspiring Admirals challenge the SURPRISE
	// one joins the Bot's Available cards (rules/13 §13.14); the rest go back
	// to the box (the campaign's own Directive is dealt by rules/14 setup).
	const directives = catalog.defs.filter((d) => d.deck === 'SOLO')
	const challenge = directives.filter(
		(d) => solo.conspiringAdmirals === true && d.traits.includes('SURPRISE'),
	)
	// (a campaign game may have dealt its Directive to you already)
	const dealt = new Set(Object.values(s.cards).map((c) => c.def))
	for (const d of directives)
		if (!challenge.includes(d) && !dealt.has(d.id))
			s = mintInto(s, d.id, null, { k: 'BOX' }, 'solo').state
	// Bot deck: Available shuffled, Deployed + Controlled shuffled on top.
	const deck: ZoneRef = { k: 'DRAW', seat: bot }
	const avail = mintShuffled(s, [...by('AVAILABLE'), ...challenge], deck, bot)
	const onTop = mintShuffled(
		avail.state,
		[...by('DEPLOYED'), ...by('CONTROLLED_LOCATION')],
		deck,
		bot,
	)
	s = onTop.state
	s = {
		...s,
		zones: {
			...s.zones,
			[zoneKey(supplement)]: [...res.order, ...dev.order],
			[zoneKey(deck)]: [...onTop.order, ...avail.order],
		},
	}
	for (const d of by('DISCARD'))
		s = mintInto(s, d.id, bot, { k: 'DISCARD', seat: bot }, prefix).state

	// Basic side tracks (Focus multipliers score for the Bot), but no Mission.
	s = setupMissions(
		s,
		bot,
		{
			...config,
			players: config.players.map((p, i) =>
				i === bot ? { ...p, boardSide: 'BASIC' as const } : p,
			),
		},
		catalog,
	)
	const captain = s.zones[zoneKey({ k: 'CAPTAIN', seat: bot })]?.[0]
	const awayTeams =
		captain !== undefined ? (cardDef(s.cards[captain]!.def).awayTeams ?? 0) : 0
	const p = s.players[bot]!
	const record: PlayerState = {
		...p,
		deckId: crew,
		boardSide: 'BASIC',
		resources: { DIL: 0, LAT: 0, GLO: 0 },
		actions: { available: 0, spent: 0 },
		specialties: { RESEARCH: 0, INFLUENCE: 0, MILITARY: 0 },
		awayTeamsInPool: awayTeams,
		awayTeamsTotal: awayTeams,
		missions: [],
		missionTokens: 0,
		handSize: 0,
		dutyOfficerLimit: 1,
		heldStardate: null,
	}
	return {
		...s,
		players: s.players.map((pl) =>
			pl.seat === bot ? record : pl,
		) as GameState['players'],
		solo: {
			bot,
			crew,
			level: solo.level,
			conspiringAdmirals: solo.conspiringAdmirals === true,
			marketOwned: [],
		},
	}
}
