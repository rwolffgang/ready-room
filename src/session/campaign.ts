// The Five-Year Mission campaign record (rules/14): your crew, the mode and
// challenges you chose, the logbook of games, your rank, your Reinforcement
// pile and your boosts. Pure functions over plain JSON; the UI stores a
// campaign beside the saves (`CAMPAIGN_KEY_PREFIX`) and each of its games is
// an ordinary solo save that names it (`Session.campaignId`).
//
// What carries into a game is `campaignSetup()`: the engine's
// `SetupConfig.solo.campaign` (src/engine/solo/campaign.ts), so every game
// replays from its own config. Modes and challenges have ids and labels of our
// own; rules/14 maps them to the rulebook.

import type { DeckId } from '../data/ids'
import type { BotCard, CardDef } from '../data/schema'
import type { SetupConfig } from '../engine/setup'
import type { BonusRef, CampaignSetup, SoloLevel } from '../engine/state'
import type { Storage } from './persistence'

export const CAMPAIGN_VERSION = 1
export const CAMPAIGN_KEY_PREFIX = 'ready-room:campaign:v1'

export function campaignKey(id: string): string {
	return `${CAMPAIGN_KEY_PREFIX}:${id}`
}

/** rules/14 §14.1: every win promotes you one rank. */
export const RANKS = [
	'ENSIGN',
	'LIEUTENANT',
	'COMMANDER',
	'CAPTAIN',
	'COMMODORE',
	'ADMIRAL',
] as const
export type Rank = (typeof RANKS)[number]

/** rules/14 §14.2: how far above your rank the Bot plays, easiest first. */
export const CAMPAIGN_MODES = ['EASY', 'NORMAL', 'HARD', 'BRUTAL'] as const
export type CampaignMode = (typeof CAMPAIGN_MODES)[number]

/** The Bot's difficulty by your rank and the mode (rules/14 §14.2). */
const LEVEL: Record<
	Exclude<Rank, 'ADMIRAL'>,
	Record<CampaignMode, SoloLevel>
> = {
	ENSIGN: {
		EASY: 'ENSIGN',
		NORMAL: 'LIEUTENANT',
		HARD: 'COMMANDER',
		BRUTAL: 'ADMIRAL',
	},
	LIEUTENANT: {
		EASY: 'LIEUTENANT',
		NORMAL: 'COMMANDER',
		HARD: 'CAPTAIN',
		BRUTAL: 'ADMIRAL',
	},
	COMMANDER: {
		EASY: 'COMMANDER',
		NORMAL: 'CAPTAIN',
		HARD: 'ADMIRAL',
		BRUTAL: 'ADMIRAL',
	},
	CAPTAIN: {
		EASY: 'CAPTAIN',
		NORMAL: 'CAPTAIN',
		HARD: 'ADMIRAL',
		BRUTAL: 'ADMIRAL',
	},
	COMMODORE: {
		EASY: 'CAPTAIN',
		NORMAL: 'ADMIRAL',
		HARD: 'ADMIRAL',
		BRUTAL: 'ADMIRAL',
	},
}

/** The optional challenges (rules/14 §14.5). */
export const CHALLENGES = [
	/** after a win, start without Dilithium or Latinum; after two, without both */
	'LEAN_START',
	/** from Lieutenant on, deal yourself a random Reserve deck */
	'SHUFFLED_RESERVE',
	/** after a win, the campaign Directive goes into your Reserve deck */
	'DIRECTIVE_IN_RESERVE',
	/** after two wins in a row, an INCIDENT starts in your deck */
	'INCIDENT_STREAK',
	/** after a win, only a Market card upgrade (no Option B) */
	'MARKET_ONLY',
	/** losing your starting SHIP loses the game */
	'ONE_SHIP',
	/** Away Teams set aside until your Reserve deck is empty */
	'LATE_TEAMS',
] as const
export type Challenge = (typeof CHALLENGES)[number]

/** An upgrade after a game (rules/14 §14.3): a Market card you owned
 *  (Option A), or one of the Bot's bonuses (Option B) — for a REINFORCE
 *  bonus, the crew card it moves. */
export type Upgrade =
	| { k: 'CARD'; def: string }
	| { k: 'BONUS'; ref: BonusRef; def?: string | undefined }
	| { k: 'NONE' }

export interface CampaignGame {
	/** the Bot's crew */
	bot: DeckId
	level: SoloLevel
	/** the save of this game */
	sessionId: string
	/** what the game was set up with (for the logbook) */
	setup: CampaignSetup
	/** set once the game is over: your VP, the Bot's */
	score?: [number, number] | undefined
	won?: boolean | undefined
	/** the Market cards you owned during it (Option A's candidates) */
	marketOwned?: string[] | undefined
	/** the upgrade you took after it */
	upgrade?: Upgrade | undefined
}

export interface Campaign {
	version: typeof CAMPAIGN_VERSION
	id: string
	crew: DeckId
	side: 'BASIC' | 'ADVANCED'
	mode: CampaignMode
	challenges: Challenge[]
	startedAt: string
	updatedAt: string
	games: CampaignGame[]
	/** your Reinforcement pile, as card defs */
	reinforcement: string[]
	/** the BOOST bonuses you earned */
	boosts: BonusRef[]
}

export function newCampaign(opts: {
	id: string
	crew: DeckId
	side: 'BASIC' | 'ADVANCED'
	mode: CampaignMode
	challenges: readonly Challenge[]
	now: string
}): Campaign {
	return {
		version: CAMPAIGN_VERSION,
		id: opts.id,
		crew: opts.crew,
		side: opts.side,
		mode: opts.mode,
		challenges: CHALLENGES.filter((c) => opts.challenges.includes(c)),
		startedAt: opts.now,
		updatedAt: opts.now,
		games: [],
		reinforcement: [],
		boosts: [],
	}
}

// ---------------------------------------------------------------------------
// Where the campaign stands
// ---------------------------------------------------------------------------

const finished = (c: Campaign) => c.games.filter((g) => g.won !== undefined)

export function wins(c: Campaign): number {
	return finished(c).filter((g) => g.won === true).length
}

/** rules/14 §14.1: one rank per win, from Ensign. */
export function rankOf(c: Campaign): Rank {
	return RANKS[Math.min(wins(c), RANKS.length - 1)]!
}

/** Wins in a row at the end of the logbook. */
export function streak(c: Campaign): number {
	let n = 0
	for (const g of [...finished(c)].reverse()) {
		if (g.won !== true) break
		n++
	}
	return n
}

/** rules/14 §14.1: over at Admiral, or after 10 games. */
export function isOver(c: Campaign): boolean {
	return rankOf(c) === 'ADMIRAL' || finished(c).length >= 10
}

/** The game being played, if one is. */
export function currentGame(c: Campaign): CampaignGame | undefined {
	const last = c.games[c.games.length - 1]
	return last !== undefined && last.won === undefined ? last : undefined
}

/** The finished game still waiting for its upgrade (rules/14 §14.3). */
export function pendingUpgrade(c: Campaign): CampaignGame | undefined {
	if (isOver(c)) return undefined
	const last = c.games[c.games.length - 1]
	return last !== undefined &&
		last.won !== undefined &&
		last.upgrade === undefined
		? last
		: undefined
}

/** What the campaign waits for next. */
export function nextStep(
	c: Campaign,
): 'PLAY' | 'UPGRADE' | 'NEXT_GAME' | 'OVER' {
	if (currentGame(c) !== undefined) return 'PLAY'
	if (isOver(c)) return 'OVER'
	if (pendingUpgrade(c) !== undefined) return 'UPGRADE'
	return 'NEXT_GAME'
}

/** The Bot's difficulty for your next game (rules/14 §14.2). */
export function nextLevel(c: Campaign): SoloLevel {
	const rank = rankOf(c)
	return rank === 'ADMIRAL' ? 'ADMIRAL' : LEVEL[rank][c.mode]
}

/** The Bot crews you may face next: not your own, never one you have beaten
 *  in this campaign (rules/14 §14.1). */
export function opponents(c: Campaign, botCrews: readonly DeckId[]): DeckId[] {
	const beaten = new Set(
		finished(c)
			.filter((g) => g.won === true)
			.map((g) => g.bot),
	)
	return botCrews.filter((d) => d !== c.crew && !beaten.has(d))
}

/** How many of Dilithium / Latinum the lean-start challenge withholds next. */
export function leanStart(c: Campaign): 0 | 1 | 2 {
	if (!c.challenges.includes('LEAN_START')) return 0
	return Math.min(streak(c), 2) as 0 | 1 | 2
}

/** The engine's campaign context for the next game. `lean` picks the
 *  resource the lean-start challenge withholds after a single win. */
export function campaignSetup(
	c: Campaign,
	lean: 'DIL' | 'LAT' = 'DIL',
): CampaignSetup {
	const has = (x: Challenge) => c.challenges.includes(x)
	const run = streak(c)
	const lastWon = run > 0
	const without = leanStart(c)
	return {
		reinforcement: [...c.reinforcement],
		boosts: c.boosts.map((b) => ({ ...b })),
		...(has('DIRECTIVE_IN_RESERVE') && lastWon
			? { directiveToReserve: true }
			: {}),
		...(without === 2
			? { withoutResources: ['DIL', 'LAT'] as ('DIL' | 'LAT')[] }
			: without === 1
				? { withoutResources: [lean] }
				: {}),
		...(has('SHUFFLED_RESERVE') && rankOf(c) !== 'ENSIGN'
			? { shuffleReserve: true }
			: {}),
		...(has('INCIDENT_STREAK') && run >= 2 ? { incidentInDeck: true } : {}),
		...(has('ONE_SHIP') ? { startingShip: true } : {}),
		...(has('LATE_TEAMS') ? { awayTeamsAside: lastWon ? 2 : 1 } : {}),
	}
}

/** The SetupConfig of the campaign's next game against `bot`. */
export function nextGameConfig(
	c: Campaign,
	bot: DeckId,
	seed: number,
	lean: 'DIL' | 'LAT' = 'DIL',
): SetupConfig {
	return {
		mode: 'SOLO',
		players: [
			{ deck: c.crew, boardSide: c.side },
			{ deck: bot, boardSide: 'BASIC' },
		],
		seed,
		solo: { level: nextLevel(c), campaign: campaignSetup(c, lean) },
	}
}

/** Log a new game in progress. */
export function startGame(
	c: Campaign,
	config: SetupConfig,
	sessionId: string,
	now: string,
): Campaign {
	const solo = config.solo
	const bot = config.players[1]?.deck
	if (solo?.campaign === undefined || bot === undefined)
		throw new Error('startGame: not a campaign game')
	if (nextStep(c) !== 'NEXT_GAME')
		throw new Error(
			`startGame: the campaign is not ready for a game (${nextStep(c)})`,
		)
	return {
		...c,
		updatedAt: now,
		games: [
			...c.games,
			{ bot, level: solo.level, sessionId, setup: solo.campaign },
		],
	}
}

/** Log the end of the game in progress (rules/14 §14.3 #1–#2). */
export function recordResult(
	c: Campaign,
	result: {
		sessionId: string
		score: [number, number]
		won: boolean
		marketOwned: readonly string[]
	},
	now: string,
): Campaign {
	const game = currentGame(c)
	if (game === undefined || game.sessionId !== result.sessionId) return c
	const games = c.games.map((g) =>
		g === game
			? {
					...g,
					score: result.score,
					won: result.won,
					marketOwned: [...result.marketOwned],
				}
			: g,
	)
	return { ...c, updatedAt: now, games }
}

// ---------------------------------------------------------------------------
// Upgrades (rules/14 §14.3)
// ---------------------------------------------------------------------------

/** Suits that never join the Reinforcement pile (rules/14 §14.3). */
const NEVER = new Set(['ENCOUNTER', 'INCIDENT', 'LOCATION'])

export interface UpgradeOptions {
	/** the game they are for */
	game: CampaignGame
	/** Option A: the Market cards you owned that match the Bot's list */
	cards: string[]
	/** Option B: each bonus, with the crew cards a REINFORCE bonus may move */
	bonuses: { ref: BonusRef; k: 'BOOST' | 'TO_REINFORCEMENT'; cards: string[] }[]
	/** Option B is closed (after a win, under the Market-only challenge) */
	marketOnly: boolean
}

function matches(def: CardDef, match: readonly string[]): boolean {
	return match.includes(def.suit) || def.traits.some((t) => match.includes(t))
}

/** What you may choose after the finished game (rules/14 §14.3): either
 *  option, freely — Option B is the only one when no Market card matches —
 *  except that the Market-only challenge closes Option B after a win. */
export function upgradeOptions(
	c: Campaign,
	bot: BotCard | undefined,
	defs: ReadonlyMap<string, CardDef>,
): UpgradeOptions | undefined {
	const game = pendingUpgrade(c)
	if (game === undefined) return undefined
	const side = game.won === true ? 'win' : 'loss'
	const reward = bot?.campaign?.[side]
	if (reward === undefined)
		return { game, cards: [], bonuses: [], marketOnly: false }
	const cards = (game.marketOwned ?? []).filter((id) => {
		const def = defs.get(id)
		return (
			def !== undefined &&
			def.deck === 'COMMON' &&
			!NEVER.has(def.suit) &&
			!c.reinforcement.includes(id) &&
			matches(def, reward.match)
		)
	})
	const marketOnly = game.won === true && c.challenges.includes('MARKET_ONLY')
	const bonuses: UpgradeOptions['bonuses'] = marketOnly
		? []
		: reward.bonus.flatMap((b, index): UpgradeOptions['bonuses'] => {
				const ref: BonusRef = { deck: game.bot, side, index }
				if (b.k === 'BOOST') return [{ ref, k: 'BOOST', cards: [] }]
				const crew = [...defs.values()].filter(
					(d) =>
						d.deck === c.crew &&
						d.startPosition === b.from &&
						!NEVER.has(d.suit) &&
						!c.reinforcement.includes(d.id) &&
						(b.filter === undefined || matchesFilter(d, b.filter)),
				)
				return crew.length > 0
					? [
							{
								ref,
								k: 'TO_REINFORCEMENT' as const,
								cards: crew.map((d) => d.id),
							},
						]
					: []
			})
	return { game, cards, bonuses, marketOnly }
}

/** The small card filter a REINFORCE bonus carries (suits / traits / not). */
function matchesFilter(
	def: CardDef,
	f: {
		suits?: string[] | undefined
		traits?: string[] | undefined
		not?: unknown
	},
): boolean {
	if (f.suits !== undefined && !f.suits.includes(def.suit)) return false
	if (f.traits !== undefined && !def.traits.some((t) => f.traits!.includes(t)))
		return false
	if (f.not !== undefined && matchesFilter(def, f.not as typeof f)) return false
	return true
}

/** Apply the upgrade chosen after the finished game. Throws on a choice the
 *  options don't offer. */
export function applyUpgrade(
	c: Campaign,
	options: UpgradeOptions,
	upgrade: Upgrade,
	now: string,
): Campaign {
	const game = pendingUpgrade(c)
	if (game === undefined || game.sessionId !== options.game.sessionId)
		throw new Error('applyUpgrade: no game is waiting for an upgrade')
	let reinforcement = c.reinforcement
	let boosts = c.boosts
	switch (upgrade.k) {
		case 'CARD':
			if (!options.cards.includes(upgrade.def))
				throw new Error(
					`applyUpgrade: ${upgrade.def} is not a matching Market card`,
				)
			reinforcement = [...reinforcement, upgrade.def]
			break
		case 'BONUS': {
			const same = (r: BonusRef) =>
				r.deck === upgrade.ref.deck &&
				r.side === upgrade.ref.side &&
				r.index === upgrade.ref.index
			const offered = options.bonuses.find((b) => same(b.ref))
			if (offered === undefined)
				throw new Error('applyUpgrade: that bonus is not offered')
			if (offered.k === 'BOOST') boosts = [...boosts, { ...upgrade.ref }]
			else {
				if (upgrade.def === undefined || !offered.cards.includes(upgrade.def))
					throw new Error(
						'applyUpgrade: pick one of the crew cards the bonus allows',
					)
				reinforcement = [...reinforcement, upgrade.def]
			}
			break
		}
		case 'NONE':
			if (options.cards.length > 0 || options.bonuses.length > 0)
				throw new Error('applyUpgrade: an upgrade is available')
			break
	}
	const games = c.games.map((g) => (g === game ? { ...g, upgrade } : g))
	return { ...c, updatedAt: now, games, reinforcement, boosts }
}

// ---------------------------------------------------------------------------
// The performance review (rules/14 §14.6), in our own words
// ---------------------------------------------------------------------------

export function performanceReview(c: Campaign): {
	title: string
	text: string
} {
	const rank = rankOf(c)
	const played = finished(c).length
	switch (rank) {
		case 'ENSIGN':
			return {
				title: 'Ensign',
				text: 'Reassigned to a desk at Starfleet Command.',
			}
		case 'LIEUTENANT':
			return {
				title: 'Lieutenant',
				text: 'A steady officer, not yet ready for command.',
			}
		case 'COMMANDER':
			return { title: 'Commander', text: 'A capable first officer.' }
		case 'CAPTAIN':
			return { title: 'Captain', text: 'A starship of your own awaits.' }
		case 'COMMODORE':
			return { title: 'Commodore', text: 'Trusted with a whole squadron.' }
		case 'ADMIRAL':
			return played <= 6
				? {
						title: 'Admiral',
						text: 'Flag rank in record time: a legend of the fleet.',
					}
				: played <= 8
					? { title: 'Admiral', text: 'A swift rise to the Admiralty.' }
					: {
							title: 'Admiral',
							text: 'Promoted to the Admiralty after a long campaign.',
						}
	}
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Shape-check a stored value; null for anything else. */
export function parseCampaign(raw: unknown): Campaign | null {
	if (typeof raw !== 'object' || raw === null) return null
	const c = raw as Partial<Campaign>
	if (c.version !== CAMPAIGN_VERSION || typeof c.id !== 'string') return null
	if (
		!Array.isArray(c.games) ||
		!Array.isArray(c.reinforcement) ||
		!Array.isArray(c.boosts)
	)
		return null
	return raw as Campaign
}

export async function saveCampaign(
	storage: Storage,
	c: Campaign,
): Promise<void> {
	await storage.set(campaignKey(c.id), c)
}

export async function loadCampaign(
	storage: Storage,
	id: string,
): Promise<Campaign | null> {
	return parseCampaign(await storage.get(campaignKey(id)))
}

export async function deleteCampaign(
	storage: Storage,
	id: string,
): Promise<void> {
	await storage.del(campaignKey(id))
}

/** Every stored campaign, most recently played first. */
export async function listCampaigns(storage: Storage): Promise<Campaign[]> {
	const out: Campaign[] = []
	for (const key of await storage.keys()) {
		if (!key.startsWith(CAMPAIGN_KEY_PREFIX)) continue
		const c = parseCampaign(await storage.get(key))
		if (c !== null) out.push(c)
	}
	return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
