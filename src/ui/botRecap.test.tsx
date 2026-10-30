// The AI turn recap (src/ui/botMoves.ts hits / botTurns, the history in
// src/ui/BotTicker.tsx, the auto-open in src/ui/store.ts): what a bot move did
// to the human is found by comparing the states, named "your …", put first in
// the ticker, collected per turn, and opened once when the human's turn
// begins. Card names come from the fake STCC index, never from this file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import { zoneProps, type GameState, type LogEntry } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import { cardNameById, setCardNameIndex } from '../data/cardNames'
import App from './App'
import { createInThreadRunner, type BotRunner } from './botRunner'
import {
	addBotIntent,
	botTurns,
	emptyBotLog,
	hitsOn,
	lastBotTurn,
	moveHeadline,
	type BotMove,
	type BotMoveLog,
} from './botMoves'
import { setBotRunner, stopBots, useGameStore } from './store'
import { loadBrowserCatalog } from './browserCatalog'
import { fakeStccIndex } from './testStcc'
import { SHELL_KEY, resetShellChoiceCache } from './mobile/shell'

vi.setConfig({ testTimeout: 20_000 })

const catalog = loadBrowserCatalog()

function config(seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed,
		startingSeat: 0,
	}
}

const store = () => useGameStore.getState()

/** A card of `seat` that is in play on its own table. */
function inPlayOf(s: GameState, seat: Seat): CardInstanceId {
	const c = Object.values(s.cards).find(
		(c) =>
			c.owner === seat &&
			zoneProps(c.zone).inPlay &&
			'seat' in c.zone &&
			c.zone.seat === seat,
	)!
	return c.iid as CardInstanceId
}

function cardOf(s: GameState, k: string, seat: Seat): CardInstanceId {
	const c = Object.values(s.cards).find(
		(c) => c.owner === seat && c.zone.k === k,
	)!
	return c.iid as CardInstanceId
}

function moved(
	s: GameState,
	iid: CardInstanceId,
	zone: GameState['cards'][string]['zone'],
): GameState {
	return { ...s, cards: { ...s.cards, [iid]: { ...s.cards[iid]!, zone } } }
}

const token = (s: GameState, iid: string) => `[[card:${s.cards[iid]!.def}]]`

/** Seat 1 (the bot) dismisses seat 0's in-play card, with the engine's line. */
function dismissal(): {
	before: GameState
	after: GameState
	iid: CardInstanceId
} {
	const before = setup(config(7), catalog)
	const iid = inPlayOf(before, 0)
	const line: LogEntry = {
		kind: 'EVENT',
		seat: 1,
		message: `dismissed ${iid}`,
		iid,
		about: 0,
	}
	const after = moved(before, iid, { k: 'DISCARD', seat: 0 })
	return { before, after: { ...after, log: [...after.log, line] }, iid }
}

function record(
	log: BotMoveLog,
	before: GameState,
	after: GameState,
	intent: Intent = { t: 'END_TURN' },
): BotMoveLog {
	return addBotIntent(
		log,
		{
			seat: 1,
			botId: 'normal',
			intent,
			info: null,
			before,
			after,
			logIndex: 0,
		},
		{ seat: 0 },
	)
}

beforeEach(() => {
	setCardNameIndex(fakeStccIndex(catalog.defs))
})

afterEach(() => {
	setCardNameIndex(new Map())
})

describe('hitsOn', () => {
	it('lists a card beamed aboard after its host, saying it went along', () => {
		const base = setup(config(7), catalog)
		const host = inPlayOf(base, 0)
		const crew = cardOf(base, 'DRAW', 0)
		const before = moved(base, crew, { k: 'BEAMED', host })
		let after = moved(before, host, { k: 'DISCARD', seat: 0 })
		after = moved(after, crew, { k: 'DISCARD', seat: 0 })
		expect(hitsOn(before, after, 0).map((h) => h.text)).toEqual([
			`dismissed your ${token(before, host)}`,
			`dismissed your ${token(before, crew)} (beamed aboard your ${token(before, host)})`,
		])
	})

	it("names the human's card that left play by where it went", () => {
		const { before, iid } = dismissal()
		const t = token(before, iid)
		const to = (zone: GameState['cards'][string]['zone']) =>
			hitsOn(before, moved(before, iid, zone), 0).map((h) => h.text)
		expect(to({ k: 'DISCARD', seat: 0 })).toEqual([`dismissed your ${t}`])
		expect(to({ k: 'BOX' })).toEqual([`destroyed your ${t}`])
		expect(to({ k: 'LOG', seat: 0 })).toEqual([`logged your ${t}`])
		expect(to({ k: 'HAND', seat: 0 })).toEqual([
			`returned your ${t} to your hand`,
		])
		expect(hitsOn(before, moved(before, iid, { k: 'BOX' }), 0)[0]!.iid).toBe(
			iid,
		)
	})

	it("reports the human's hand card discarded, their Away Teams removed and control lost", () => {
		const base = setup(config(7), catalog)
		const card = cardOf(base, 'DRAW', 0)
		const before = moved(base, card, { k: 'HAND', seat: 0 })
		const loc = Object.values(before.cards).find(
			(c) => c.zone.k === 'NEUTRAL_ZONE',
		)!.iid
		const own = inPlayOf(before, 0)
		const withTeams = {
			...before,
			awayTeamsAt: { [loc]: [2, 1] as [number, number] },
		}
		let after = moved(withTeams, card, { k: 'DISCARD', seat: 0 })
		after = { ...after, awayTeamsAt: { [loc]: [1, 1] as [number, number] } }
		const ownZone = withTeams.cards[own]!.zone as { k: 'FLEET'; seat: Seat }
		after = moved(after, own, { ...ownZone, seat: 1 })
		expect(hitsOn(withTeams, after, 0).map((h) => h.text)).toEqual(
			expect.arrayContaining([
				`discarded ${token(before, card)} from your hand`,
				`removed your Away Team from ${token(before, loc)}`,
				`took control of your ${token(before, own)}`,
			]),
		)
		// the bot's own losses are not the human's hits
		expect(hitsOn(withTeams, after, 1)).toEqual([])
	})
})

describe('a bot move that hit the human', () => {
	it("leads the ticker headline with the hit once, and marks the engine's line about it", () => {
		const { before, after, iid } = dismissal()
		const move = record(emptyBotLog(), before, after).moves[0]!
		const hit = `dismissed your ${token(before, iid)}`
		expect(move.hits.map((h) => h.text)).toEqual([hit])
		expect(move.steps[0]!.notes).toContainEqual({
			kind: 'EVENT',
			text: hit,
			hit: true,
		})
		const headline = moveHeadline(move, 'you')
		expect(headline.startsWith(`ended the turn → ${hit}`)).toBe(true)
		expect(headline.split(hit).length - 1).toBe(1)
	})

	it('is not recorded for a spectator', () => {
		const { before, after } = dismissal()
		const log = addBotIntent(
			emptyBotLog(),
			{
				seat: 1,
				botId: 'normal',
				intent: { t: 'END_TURN' },
				info: null,
				before,
				after,
				logIndex: 0,
			},
			{ seat: null },
		)
		expect(log.moves[0]!.hits).toEqual([])
	})
})

describe('botTurns', () => {
	it('groups moves by turn, newest first, and adds the net resource loss', () => {
		const { before, after } = dismissal()
		const log = record(emptyBotLog(), before, after)
		const m = log.moves[0]!
		const at = (
			id: number,
			turn: number,
			active: Seat,
			extra: Partial<BotMove> = {},
		) => ({
			...m,
			id,
			turn,
			active,
			...extra,
		})
		const moves: BotMove[] = [
			at(1, 5, 1, { deltas: [{ DIL: -2 }, { DIL: 2 }] }),
			at(2, 5, 1, { hits: [], deltas: [{ DIL: 1 }, {}] }),
			at(3, 6, 0, { hits: [] }),
		]
		const turns = botTurns(moves, 0)
		expect(turns.map((t) => t.turn)).toEqual([6, 5])
		expect(turns[1]!.moves.map((x) => x.id)).toEqual([1, 2])
		expect(turns[1]!.hits.map((h) => h.text)).toEqual([
			m.hits[0]!.text,
			'you lost 1 {DIL}',
		])
		// the newest turn the bot played as the active seat
		expect(lastBotTurn(turns)?.turn).toBe(5)
		expect(botTurns(moves, null)[1]!.hits).toEqual([m.hits[0]])
	})
})

// ---------------------------------------------------------------------------
// the dialog and the auto-open
// ---------------------------------------------------------------------------

let host: HTMLDivElement
let root: Root | null = null

function silentRunner(): BotRunner {
	return { decide: () => new Promise<Intent>(() => {}), dispose() {} }
}

function startAgainstBot(): void {
	act(() => {
		store().loadCatalog()
		store().setBotSpeed('instant')
		store().startGame(config(7), { 1: 'normal' })
	})
}

/** A history with one bot move of the bot's own (earlier) turn. */
function hitLog(hits: boolean): BotMoveLog {
	const { before, after } = dismissal()
	const log = record(emptyBotLog(), before, hits ? after : before)
	return {
		...log,
		live: false,
		openId: null,
		moves: log.moves.map((m) => ({ ...m, turn: 0, active: 1 })),
	}
}

/** Ask the store to look for a bot move (the human is to act: none). */
function pump(): void {
	act(() => setBotRunner(silentRunner()))
}

describe('the AI turn recap', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
		host = document.createElement('div')
		document.body.appendChild(host)
		localStorage.clear()
		store().newGame()
		setBotRunner(createInThreadRunner())
	})

	afterEach(() => {
		if (root !== null) act(() => root!.unmount())
		root = null
		stopBots()
		store().newGame()
		localStorage.clear()
		resetShellChoiceCache()
	})

	it('opens by itself once when your turn begins after an AI turn that hit you, showing what it did', () => {
		startAgainstBot()
		const log = hitLog(true)
		act(() => useGameStore.setState({ botLog: log }))
		pump()
		expect(store().botHistoryOpen).toBe(true)

		localStorage.setItem(SHELL_KEY, 'console')
		resetShellChoiceCache()
		root = createRoot(host)
		act(() => root!.render(<App />))
		const dialog = host.querySelector('[role="dialog"]')!
		const hits = dialog.querySelector('.bot-hits')!
		expect(hits.textContent).toContain('What it did to you')
		const { before, iid } = dismissal()
		expect(hits.textContent).toContain(
			`dismissed your ${cardNameById(before.cards[iid]!.def)}`,
		)
		expect(dialog.querySelector('.bot-turn-head')!.textContent).toBe(
			"Turn 0 · House AI (Normal)'s turn",
		)

		// once per AI turn
		act(() => store().closeBotHistory())
		pump()
		expect(store().botHistoryOpen).toBe(false)
	})

	it('follows the setting: not without a hit by default, always when asked, never when off', () => {
		startAgainstBot()
		act(() => useGameStore.setState({ botLog: hitLog(false) }))
		pump()
		expect(store().botHistoryOpen).toBe(false)

		act(() => store().setBotRecap('always'))
		pump()
		expect(store().botHistoryOpen).toBe(true)
		expect(localStorage.getItem('ready-room:bot-recap')).toBe('always')

		act(() => {
			store().closeBotHistory()
			store().setBotRecap('never')
			useGameStore.setState({
				botLog: {
					...hitLog(true),
					moves: hitLog(true).moves.map((m) => ({ ...m, turn: -1 })),
				},
			})
		})
		pump()
		expect(store().botHistoryOpen).toBe(false)
	})
})
