// Solo arena: a house AI plays the HUMAN seat against the official solo Bot
// (rules/13), over every Bot crew × difficulty level. It measures how hard
// each level is for a given house bot and doubles as a fuzzer for the Bot's
// turn machine (tools/solo-arena.ts, `npm run bot:check`). Pure and DOM-free.
//
// Each cell — a Bot crew at a level — is played against a human crew that
// rotates through the other crews, with seeds derived from the base seed.
// The official Bot is rules, not a bot: playBots dispatches its BOT_STEPs and
// its own choices are piloted inside `reduce`, so seat 1's bot is never asked.

import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import { SOLO_LEVELS, type SoloLevel } from '../engine/state'
import type { DeckId } from '../data/ids'
import { botDecks, registerBots } from '../engine/solo/acRegistry'
import { playBots, type AutoPlayStop } from './autoPlay'
import { CREW_DECKS, deriveSeed, wilson } from './arena'
import type { Bot } from './types'

export interface SoloCell {
	bot: DeckId
	level: SoloLevel
}

export interface SoloGame extends SoloCell {
	human: DeckId
	seed: number
}

export interface SoloResult extends SoloGame {
	stopped: AutoPlayStop | 'CRASH'
	crash?: string | undefined
	/** the house bot (the human seat) won: strictly more VP, no Burn */
	won: boolean
	/** house bot VP − official Bot VP */
	margin: number
	fallbacks: number
}

/** The schedule: `games` per Bot crew × level, the human crew rotating. */
export function soloSchedule(
	catalog: CardCatalog,
	games: number,
	baseSeed: number,
	levels: readonly SoloLevel[] = SOLO_LEVELS,
): SoloGame[] {
	registerBots(catalog.bots ?? [])
	const bots = botDecks()
	const out: SoloGame[] = []
	let n = 0
	for (const bot of bots)
		for (const level of levels)
			for (let g = 0; g < games; g++) {
				const others = CREW_DECKS.filter((d) => d !== bot)
				const human = others[n % others.length]!
				out.push({ bot, level, human, seed: deriveSeed(baseSeed, n) })
				n++
			}
	return out
}

export function soloConfig(game: SoloGame): SetupConfig {
	return {
		mode: 'SOLO',
		players: [
			{ deck: game.human, boardSide: 'ADVANCED' },
			{ deck: game.bot, boardSide: 'BASIC' },
		],
		seed: game.seed,
		solo: { level: game.level },
	}
}

/** Play one solo game with `house` in the human seat. Never throws. */
export function playSolo(
	catalog: CardCatalog,
	house: Bot,
	game: SoloGame,
): SoloResult {
	try {
		const r = playBots(setup(soloConfig(game), catalog), [house, house])
		const end = r.state.result
		const board = end?.kind === 'COMPLETE' ? end.scoreboard : null
		const margin =
			board === null
				? 0
				: board.breakdown[0].total - board.breakdown[1].total
		return {
			...game,
			stopped: r.stopped,
			won: board?.winners.includes(0) === true,
			margin,
			fallbacks: r.fallbacksBySeat[0],
		}
	} catch (e) {
		return {
			...game,
			stopped: 'CRASH',
			crash: e instanceof Error ? e.message : String(e),
			won: false,
			margin: 0,
			fallbacks: 0,
		}
	}
}

export interface SoloLevelSummary {
	level: SoloLevel
	games: number
	wins: number
	winRate: { p: number; lo: number; hi: number }
	meanMargin: number
}

/** Win rate (Wilson 95 %) and mean margin per level, easiest first. */
export function summarizeSolo(results: readonly SoloResult[]): SoloLevelSummary[] {
	return SOLO_LEVELS.flatMap((level) => {
		const rs = results.filter((r) => r.level === level && r.stopped === 'GAME_OVER')
		if (rs.length === 0) return []
		const wins = rs.filter((r) => r.won).length
		return [
			{
				level,
				games: rs.length,
				wins,
				winRate: wilson(wins, rs.length),
				meanMargin: rs.reduce((a, r) => a + r.margin, 0) / rs.length,
			},
		]
	})
}
