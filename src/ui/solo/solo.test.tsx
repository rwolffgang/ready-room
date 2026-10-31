// The official solo Bot in the app (rules/13, todo/15 §3): the store plays the
// Bot's turn beat by beat by itself, the device stays with the human, undo
// takes back the human's decision with the Bot's steps after it, the
// opponent band shows the Bot's row and its Automated Command cards, and the
// end screen and the save list name the Bot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../../engine/setup'
import type { GameState } from '../../engine/state'
import type { Intent } from '../../engine/intents'
import { legalIntents } from '../../engine/intents'
import { autoPlay, firstLegalPolicy, nextAutoIntent } from '../../bot/autoPlay'
import { setup } from '../../engine/setup'
import { decisionSeat } from '../../session/interrupts'
import { createSession, type Session } from '../../session/log'
import type { FinalScoreboard, ScoreBreakdown } from '../../engine/scoring'
import App from '../App'
import { endHeadline } from '../EndScreen'
import { endedLine } from '../load'
import { stopBots, useGameStore } from '../store'
import { loadBrowserCatalog } from '../browserCatalog'
import { resetShellChoiceCache } from '../mobile/shell'
import { segments } from './AutomatedCommand'

vi.setConfig({ testTimeout: 30_000 })

const catalog = loadBrowserCatalog()

function soloConfig(seed: number): SetupConfig {
	return {
		mode: 'SOLO',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'KOL', boardSide: 'BASIC' },
		],
		seed,
		solo: { level: 'COMMANDER' },
	}
}

const store = () => useGameStore.getState()
const st = (): GameState => store().state!

function start(seed: number) {
	act(() => {
		store().loadCatalog()
		store().setBotSpeed('instant')
		store().startGame(soloConfig(seed))
	})
}

/** The human plays the first-legal answer. */
function humanMove(): Intent {
	const state = st()
	const intent = nextAutoIntent(state, legalIntents(state), firstLegalPolicy)!
	act(() => store().dispatch(intent))
	expect(store().error).toBeNull()
	return intent
}

const tick = () =>
	act(async () => {
		await new Promise((r) => setTimeout(r, 0))
	})

const botStepping = (): boolean =>
	store().legal.length === 1 && store().legal[0]!.t === 'BOT_STEP'

/** Let the Bot's beats run until the human must decide (or the game ends). */
async function waitForBot(maxTicks = 5000): Promise<void> {
	for (let i = 0; i < maxTicks; i++) {
		if (!botStepping()) return
		await tick()
	}
	throw new Error('the Bot never settled')
}

beforeEach(() => {
	document.body.innerHTML = ''
	localStorage.clear()
	store().newGame()
})

afterEach(() => {
	stopBots()
	store().newGame()
	localStorage.clear()
	resetShellChoiceCache()
})

describe('a solo game in the store', () => {
	it('plays the Bot’s turn by itself, beat by beat, and hands it back', async () => {
		start(3)
		expect(st().mode).toBe('SOLO')
		expect(store().viewerSeat).toBe(0)
		let lastHuman = -1
		while (st().activeSeat === 0 && st().turnNumber === 1) {
			if (botStepping()) await waitForBot()
			else {
				humanMove()
				lastHuman = store().session!.log.length - 1
			}
		}
		await waitForBot()
		// the Bot's turn 2 ran to its end through BOT_STEPs; the human is up
		expect(st().turnNumber).toBe(3)
		expect(decisionSeat(st())).toBe(0)
		const log = store().session!.log
		const botSteps = log.slice(lastHuman + 1).filter((i) => i.t === 'BOT_STEP')
		expect(botSteps.length).toBeGreaterThan(3)
		// the device never changed hands
		expect(store().viewerSeat).toBe(0)
		expect(store().error).toBeNull()

		// undo takes back the human's last decision (a clean-up answer here, not
		// the END_TURN boundary) together with every Bot step after it, and the
		// Bot does not replay by itself: the human decides again
		expect(log[lastHuman]!.t).toBe('RESOLVE_CHOICE')
		expect(store().canUndo).toBe(true)
		act(() => store().undo())
		expect(store().session!.log.length).toBe(lastHuman)
		expect(st().turnNumber).toBe(1)
		await tick()
		expect(decisionSeat(st())).toBe(0)
		expect(botStepping()).toBe(false)
	})

	it('undo inside the human’s turn is a single step', () => {
		start(3)
		humanMove()
		const n = store().session!.log.length
		expect(store().canUndo).toBe(true)
		act(() => store().undo())
		expect(store().session!.log.length).toBe(n - 1)
		expect(store().warning).toBeNull()
	})
})

describe('the solo screens', () => {
	let root: Root | null = null
	afterEach(() => {
		act(() => root?.unmount())
		root = null
	})

	it('shows the Bot’s row, its piles and the Automated Command cards', async () => {
		start(3)
		const host = document.createElement('div')
		document.body.appendChild(host)
		root = createRoot(host)
		act(() => root!.render(<App />))
		const text = () => host.textContent ?? ''
		expect(text()).toContain('The Bot')
		expect(text()).toContain('Supplement')
		expect(text()).toContain('Bot deck')
		expect(text()).not.toContain('pass the device')
		const open = [...host.querySelectorAll('button')].find(
			(b) => b.textContent === 'Command cards',
		)
		expect(open).toBeDefined()
		act(() => open!.click())
		const dialog = document.querySelector('.ac-modal')
		expect(dialog).not.toBeNull()
		expect(dialog!.querySelector('[aria-label="TRAITS card"]')).not.toBeNull()
		// eight suits on the SUITS card, every row with our own words for it
		const suits = dialog!.querySelectorAll('.ac-suits .ac-row')
		expect(suits.length).toBe(8)
		for (const row of suits)
			expect(
				row.querySelector('.ac-text')!.textContent!.length,
			).toBeGreaterThan(0)
		expect(dialog!.textContent).toContain('with no Duty Officer')
		await tick()
	})
})

describe('the solo end screen', () => {
	let root: Root | null = null
	afterEach(() => {
		act(() => root?.unmount())
		root = null
	})

	it('names the Bot with its level and scores its Dilithium and Latinum', () => {
		const config = soloConfig(2)
		const played = autoPlay(setup(config, catalog))
		expect(played.stopped).toBe('GAME_OVER')
		const session = {
			...createSession(config, catalog, { id: 'solo-end' }),
			log: played.intents,
		}
		act(() => {
			store().loadCatalog()
			store().resumeGame(session)
		})
		expect(st().result?.kind).toBe('COMPLETE')
		const host = document.createElement('div')
		document.body.appendChild(host)
		root = createRoot(host)
		act(() => root!.render(<App />))
		const end = host.querySelector('.end-screen')
		expect(end).not.toBeNull()
		expect(end!.textContent).toContain('The Bot (Commander)')
		expect(end!.textContent).toContain('Dilithium and Latinum')
		const title = end!.querySelector('h1')!.textContent
		expect(['You win', 'The Bot (Commander) wins']).toContain(title)
	})
})

describe('the STCC row markup', () => {
	it('splits the red attack part and the blue you-may part', () => {
		expect(
			segments(
				'Gain 1 [[dil]]. @Opponent discards 1./@ Then $you may draw 1/$.',
			),
		).toEqual([
			{ tone: 'plain', text: 'Gain 1 [[dil]]. ' },
			{ tone: 'attack', text: 'Opponent discards 1.' },
			{ tone: 'plain', text: ' Then ' },
			{ tone: 'you', text: 'you may draw 1' },
			{ tone: 'plain', text: '.' },
		])
	})
})

describe('naming the Bot', () => {
	const breakdown = (total: number): ScoreBreakdown => ({
		total,
		glory: total,
		neutralTokens: { count: 0, vp: 0 },
		endgame: [],
		printedVp: [],
		focus: [],
		missions: [],
		missionsCompleted: 0,
		focusSuppressed: false,
	})
	const board = (
		totals: [number, number],
		winners: (0 | 1)[],
		extra: Partial<FinalScoreboard> = {},
	): FinalScoreboard => ({
		breakdown: [breakdown(totals[0]), breakdown(totals[1])],
		winners,
		cadetLoss: false,
		...extra,
	})
	const names: [string, string] = ['You', 'The Bot (Commander)']

	it('the Burn and a tie on points are the Bot’s', () => {
		expect(
			endHeadline(
				board([50, 40], [1], { incidentCounts: [1, 3] }),
				false,
				names,
				1,
			),
		).toMatchObject({ tone: 'alert', title: 'The Bot (Commander) wins' })
		expect(endHeadline(board([44, 44], [1]), false, names, 1)).toEqual({
			tone: 'seat-1',
			title: 'The Bot (Commander) wins',
			reason: '44 – 44 VP · a tie goes to the Bot',
		})
		expect(endHeadline(board([51, 44], [0]), false, names, 1).title).toBe(
			'You win',
		)
	})

	it('the save list says who won', () => {
		const s = createSession(soloConfig(1), catalog, { id: 'solo' })
		const ended = (final: Session['meta']['final']): Session => ({
			...s,
			meta: { ...s.meta, result: 'COMPLETE', final },
		})
		expect(endedLine(ended({ score: [60, 52], winners: [0] }))).toBe(
			'Game over · You won · 60–52',
		)
		expect(endedLine(ended({ score: [40, 52], winners: [1] }))).toBe(
			'Game over · The Bot (Commander) won · 40–52',
		)
	})
})
