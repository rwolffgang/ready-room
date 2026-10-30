// The AI move ticker, history, "Why?" panel and card highlight
// (src/ui/BotTicker.tsx, src/ui/botMoves.ts): bot moves are grouped from the
// log as they are committed, kept and cleared with the game's lifecycle,
// named at render time from the STCC data (never hardcoded here), masked for
// the human, and highlighted with a static outline under reduced motion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { legalIntents, reduce } from '../engine/intents'
import { hiddenCards } from '../engine/projection'
import type { Seat } from '../engine/resolver/queries'
import { firstLegalPolicy, nextAutoIntent } from '../bot/autoPlay'
import type { DecisionInfo } from '../bot/explain'
import type { BotId } from '../bot/types'
import { cardNameById, setCardNameIndex } from '../data/cardNames'
import { decisionSeat } from '../session/interrupts'
import type { Opponents } from '../session/opponents'
import App from './App'
import { createInThreadRunner, type BotRunner } from './botRunner'
import {
	addBotIntent,
	BOT_HISTORY_MAX,
	decisionView,
	emptyBotLog,
	moveHeadline,
	phraseText,
	type BotMoveLog,
} from './botMoves'
import { BotHighlight, WhyPanel } from './BotTicker'
import { setBotRunner, stopBots, useGameStore } from './store'
import { loadBrowserCatalog } from './browserCatalog'
import { fakeStccIndex } from './testStcc'
import { SHELL_KEY, resetShellChoiceCache } from './mobile/shell'

// these render the full board and play real bot moves, so they outgrow the
// 5 s default when the machine is busy
vi.setConfig({ testTimeout: 20_000 })

const catalog = loadBrowserCatalog()

function config(seed: number, startingSeat: Seat = 0): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed,
		startingSeat,
	}
}

const store = () => useGameStore.getState()
const st = (): GameState => store().state!
const logLength = (): number => store().session?.log.length ?? 0

function start(seed: number, opponents: Opponents, startingSeat: Seat = 0) {
	act(() => {
		store().loadCatalog()
		store().setBotSpeed('instant')
		store().startGame(config(seed, startingSeat), opponents)
	})
}

function humanMove(): void {
	const state = st()
	const intent = nextAutoIntent(state, legalIntents(state), firstLegalPolicy)!
	act(() => store().dispatch(intent))
	expect(store().error).toBeNull()
}

/** The human (seat 0) plays turn 1 to its end. */
function humanTurnOne(): void {
	humanMove() // START
	while (st().activeSeat === 0 && st().turnNumber === 1) humanMove()
}

const tick = () =>
	act(async () => {
		await new Promise((r) => setTimeout(r, 0))
	})

async function waitForBots(maxTicks = 20000): Promise<void> {
	for (let i = 0; i < maxTicks; i++) {
		await tick()
		if (store().botThinking === null) return
	}
	throw new Error('bots never settled')
}

/** A runner that never answers (the bot stays "thinking"). */
function silentRunner(): BotRunner {
	return {
		decide: () => new Promise<Intent>(() => {}),
		dispose() {},
	}
}

/** Walk a first-legal game until `pick` accepts a state. */
function findState(
	seed: number,
	pick: (s: GameState) => boolean,
	cap = 600,
): GameState {
	let s = setup(config(seed), catalog)
	for (let i = 0; i < cap && s.result === null; i++) {
		if (pick(s)) return s
		s = reduce(s, nextAutoIntent(s, legalIntents(s), firstLegalPolicy)!).state
	}
	throw new Error('no such state')
}

/** Seat 1 in its Action Step with ≥ 3 playable hand cards of distinct defs. */
function botPlayState(): { state: GameState; plays: Intent[] } {
	const state = findState(4, (s) => {
		if (s.pendingChoice !== null || s.phase.k !== 'ACTION') return false
		if (s.activeSeat !== 1) return false
		return distinctPlays(s).length >= 3
	})
	return { state, plays: distinctPlays(state) }
}

function distinctPlays(s: GameState): Intent[] {
	const seen = new Set<string>()
	return legalIntents(s).filter((i) => {
		if (i.t !== 'PLAY_CARD') return false
		const card = s.cards[i.iid]!
		if (card.zone.k !== 'HAND' || seen.has(card.def)) return false
		seen.add(card.def)
		return true
	})
}

function playInfo(plays: Intent[], botId: BotId = 'normal'): DecisionInfo {
	return {
		botId,
		kind: 'heuristic',
		options: plays.slice(0, 3).map((intent, i) => ({
			intent,
			score: 3 - i,
			chosen: i === 0,
		})),
	}
}

const defOf = (s: GameState, intent: Intent): string =>
	s.cards[(intent as { iid: string }).iid]!.def

let host: HTMLDivElement
let root: Root | null = null

function render(shell: 'console' | 'phone' = 'console'): void {
	localStorage.setItem(SHELL_KEY, shell)
	resetShellChoiceCache()
	root = createRoot(host)
	act(() => root!.render(<App />))
}

beforeEach(() => {
	document.body.innerHTML = ''
	host = document.createElement('div')
	document.body.appendChild(host)
	localStorage.clear()
	setCardNameIndex(fakeStccIndex(catalog.defs))
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
	setCardNameIndex(new Map())
	vi.unstubAllGlobals()
})

describe('bot move history', () => {
	it("groups the bot's intents into moves straight from the log", async () => {
		start(7, { 1: 'normal' })
		humanTurnOne()
		await waitForBots()
		const { moves, live } = store().botLog
		expect(moves.length).toBeGreaterThan(0)
		expect(live).toBe(true)
		const log = store().session!.log
		for (const m of moves) {
			expect(m.seat).toBe(1)
			expect(m.botId).toBe('normal')
			// a move is a contiguous slice of the log: its top-level intent
			// (or a lone choice answer), then the bot's own choice answers
			expect(log.slice(m.logFrom, m.logFrom + m.intents.length)).toEqual(
				m.intents,
			)
			expect(m.intents.slice(1).every((i) => i.t === 'RESOLVE_CHOICE')).toBe(
				true,
			)
			expect(m.steps).toHaveLength(m.intents.length)
			expect(m.infos).toHaveLength(m.intents.length)
			expect(JSON.parse(JSON.stringify(m))).toEqual(m)
		}
		// the in-thread runner explains its decisions
		expect(moves.some((m) => m.info !== null)).toBe(true)
		// one burst for the bot's whole turn
		expect(new Set(moves.map((m) => m.burst)).size).toBe(1)
		// the human's next decision ends the burst
		humanMove()
		expect(store().botLog.live).toBe(false)
	})

	it('is trimmed on undo and cleared on a new game and on resume', async () => {
		start(7, { 1: 'normal' })
		humanTurnOne()
		await waitForBots()
		expect(store().botLog.moves.length).toBeGreaterThan(0)
		const session = store().session!
		setBotRunner(silentRunner())
		act(() => store().undo())
		// the undo lands on the human's last decision: every bot reply is gone
		expect(store().botLog.moves.every((m) => m.logFrom < logLength())).toBe(
			true,
		)
		expect(store().botLog.moves).toHaveLength(0)
		expect(store().botLog.live).toBe(false)

		setBotRunner(createInThreadRunner())
		start(7, { 1: 'normal' })
		humanTurnOne()
		await waitForBots()
		expect(store().botLog.moves.length).toBeGreaterThan(0)
		act(() => store().newGame())
		expect(store().botLog.moves).toEqual([])

		setBotRunner(silentRunner())
		act(() => store().resumeGame(session))
		expect(store().botLog.moves).toEqual([])
	})

	it(`keeps at most ${BOT_HISTORY_MAX} moves in a spectator game`, async () => {
		start(3, { 0: 'easy', 1: 'normal' })
		await waitForBots()
		for (let i = 0; i < 4000 && st().turnNumber < 7; i++) await tick()
		const { moves } = store().botLog
		expect(moves.length).toBe(BOT_HISTORY_MAX)
		expect(new Set(moves.map((m) => m.seat)).size).toBe(2)
		// spectator moves are recorded unmasked
		expect(moves.every((m) => !m.masked)).toBe(true)
		act(() => store().setBotPaused(true))
	})
})

describe('the ticker', () => {
	it("shows the bot's move with the card's runtime name, and opens the history and Why?", () => {
		const { state, plays } = botPlayState()
		const play = plays[0]!
		const after = reduce(state, play).state
		const log: BotMoveLog = addBotIntent(
			emptyBotLog(),
			{
				seat: 1,
				botId: 'normal',
				intent: play,
				info: playInfo(plays),
				before: state,
				after,
				logIndex: 0,
			},
			{ seat: 0 },
		)
		setBotRunner(silentRunner())
		start(7, { 1: 'normal' })
		act(() => useGameStore.setState({ botLog: log }))
		render('console')
		const ticker = host.querySelector('.bot-ticker')!
		expect(ticker).not.toBeNull()
		const name = cardNameById(defOf(state, play))
		expect(name).not.toBe(defOf(state, play))
		expect(ticker.textContent).toContain('House AI (Normal)')
		expect(ticker.textContent).toContain(`played ${name}`)
		expect(ticker.querySelector('[aria-live="polite"]')).not.toBeNull()
		expect(moveHeadline(log.moves[0]!, 'you')).toContain('played [[card:')

		// Why? opens the history on this move's panel
		const why = [...ticker.querySelectorAll('button')].find(
			(b) => b.textContent === 'Why?',
		)!
		act(() => why.click())
		const dialog = host.querySelector('[role="dialog"]')!
		expect(dialog).not.toBeNull()
		expect(dialog.querySelector('.why-chosen')!.textContent).toContain(name)
		// the human cannot see the bot's other hand cards
		const others = [...dialog.querySelectorAll('.why-opt:not(.why-chosen)')]
		expect(others.length).toBe(2)
		for (const o of others) {
			expect(o.textContent).toContain('a card from hand')
			expect(o.textContent).not.toContain(cardNameById(defOf(state, plays[1]!)))
			expect(o.textContent).not.toContain(cardNameById(defOf(state, plays[2]!)))
		}
	})

	it('fits one line on the phone, between the bot bar and the stations', () => {
		const { state, plays } = botPlayState()
		const after = reduce(state, plays[0]!).state
		const log = addBotIntent(
			emptyBotLog(),
			{
				seat: 1,
				botId: 'hard',
				intent: plays[0]!,
				info: playInfo(plays, 'hard'),
				before: state,
				after,
				logIndex: 0,
			},
			{ seat: 0 },
		)
		setBotRunner(silentRunner())
		start(7, { 1: 'hard' })
		act(() => useGameStore.setState({ botLog: log }))
		render('phone')
		const ticker = host.querySelector('.bot-ticker-mobile')
		expect(ticker).not.toBeNull()
		// in the shell's flow (not an overlay over the hand or the dock)
		expect(ticker!.previousElementSibling?.classList.contains('bot-bar')).toBe(
			true,
		)
		expect(ticker!.textContent).toContain(cardNameById(defOf(state, plays[0]!)))
	})
})

describe('the history entry', () => {
	it('shows the card the move played while it is open', async () => {
		const { state, plays } = botPlayState()
		const play = plays[0]!
		const log = addBotIntent(
			emptyBotLog(),
			{
				seat: 1,
				botId: 'normal',
				intent: play,
				info: null,
				before: state,
				after: reduce(state, play).state,
				logIndex: 0,
			},
			{ seat: 0 },
		)
		expect(log.moves[0]!.steps[0]!.card).toBe(defOf(state, play))
		setBotRunner(silentRunner())
		start(7, { 1: 'normal' })
		act(() => useGameStore.setState({ botLog: log }))
		render('console')
		act(() => store().openBotHistory(null))
		const entry = host.querySelector('.bot-history-item')!
		const details = entry.querySelector('details')!
		const shown = () =>
			entry
				.querySelector('.bot-move-card .card-inner')
				?.getAttribute('aria-label')
		// the latest move opens with its card
		expect(details.open).toBe(true)
		expect(shown()).toBe(cardNameById(defOf(state, play)))
		await act(async () => {
			details.open = false
			await new Promise((r) => setTimeout(r, 0))
		})
		expect(shown()).toBeUndefined()
		await act(async () => {
			details.open = true
			await new Promise((r) => setTimeout(r, 0))
		})
		expect(shown()).toBe(cardNameById(defOf(state, play)))
	})
})

describe('Why? masking', () => {
	it('masks the hidden hand options the bot did not choose, for a human', () => {
		const { state, plays } = botPlayState()
		const after = reduce(state, plays[0]!).state
		const view = decisionView(playInfo(plays), state, after, { seat: 0 })
		const [chosen, ...others] = view.options
		expect(chosen!.chosen).toBe(true)
		// the move itself revealed the played card
		expect(chosen!.masked).toBe(false)
		expect(chosen!.phrase).toBe(`Play [[card:${defOf(state, plays[0]!)}]]`)
		for (const o of others) {
			expect(o.masked).toBe(true)
			expect(o.phrase).toBe('Play a card from hand')
			expect(o.phrase).not.toContain('[[card:')
		}
		// a spectator sees everything
		const open = decisionView(playInfo(plays), state, after, { seat: null })
		expect(open.options.map((o) => o.masked)).toEqual([false, false, false])
		expect(open.options.map((o) => o.phrase)).toEqual(
			plays.slice(0, 3).map((p) => `Play [[card:${defOf(state, p)}]]`),
		)
		// the bot's own seat sees its hand (the viewer could see the cards)
		const own = decisionView(playInfo(plays), state, after, { seat: 1 })
		expect(own.options.every((o) => !o.masked)).toBe(true)
	})

	it('masks a pick among hidden cards; the pick shows only if the move revealed it', () => {
		const state = findState(
			10,
			(s) => {
				const c = s.pendingChoice
				return (
					c !== null &&
					c.seat === 1 &&
					c.k === 'CHOOSE_CARDS' &&
					c.from.startsWith('HAND') &&
					c.max === 1 &&
					c.candidates.length >= 2
				)
			},
			2000,
		)
		const choice = state.pendingChoice as Extract<
			NonNullable<GameState['pendingChoice']>,
			{ k: 'CHOOSE_CARDS' }
		>
		const options: Intent[] = choice.candidates.slice(0, 3).map((iid) => ({
			t: 'RESOLVE_CHOICE',
			choiceId: choice.id,
			selection: [iid],
		}))
		const info: DecisionInfo = {
			botId: 'normal',
			kind: 'heuristic',
			options: options.map((intent, i) => ({
				intent,
				score: -i,
				chosen: i === 0,
			})),
		}
		const after = reduce(state, options[0]!).state
		const view = decisionView(info, state, after, { seat: 0 })
		for (const o of view.options.slice(1)) {
			expect(o.masked).toBe(true)
			expect(o.phrase).not.toContain('[[card:')
		}
		const picked = choice.candidates[0]!
		const stillHidden = hiddenCards(after, 0).has(picked)
		expect(view.options[0]!.masked).toBe(stillHidden)
		expect(view.options[0]!.phrase.includes('[[card:')).toBe(!stillHidden)
		// spectators see every candidate
		const open = decisionView(info, state, after, { seat: null })
		expect(open.options.every((o) => o.phrase.includes('[[card:'))).toBe(true)
	})

	it('renders masked options without the hidden names; a spectator panel names them', () => {
		const { state, plays } = botPlayState()
		const after = reduce(state, plays[0]!).state
		const hiddenName = cardNameById(defOf(state, plays[1]!))
		for (const seat of [0, null] as const) {
			const view = decisionView(playInfo(plays), state, after, { seat })
			const h = document.createElement('div')
			document.body.appendChild(h)
			const r = createRoot(h)
			act(() => r.render(<WhyPanel view={view} title="played" />))
			if (seat === 0) {
				expect(h.textContent).not.toContain(hiddenName)
				expect(h.textContent).toContain('a card from hand')
			} else {
				expect(h.textContent).toContain(hiddenName)
				expect(h.textContent).not.toContain('a card from hand')
			}
			expect(phraseText(view.options[0]!.phrase)).toBe(
				`Play ${cardNameById(defOf(state, plays[0]!))}`,
			)
			act(() => r.unmount())
			h.remove()
		}
	})
})

describe('card highlight', () => {
	function stubMotion(reduce: boolean): void {
		vi.stubGlobal(
			'matchMedia',
			(q: string) =>
				({
					matches: reduce && q.includes('prefers-reduced-motion'),
					media: q,
					addEventListener() {},
					removeEventListener() {},
					addListener() {},
					removeListener() {},
				}) as unknown as MediaQueryList,
		)
	}

	function highlightOnce(): { el: HTMLElement; unmount: () => void } {
		const { state, plays } = botPlayState()
		const play = plays[0]! as Extract<Intent, { t: 'PLAY_CARD' }>
		const after = reduce(state, play).state
		const log = addBotIntent(
			emptyBotLog(),
			{
				seat: 1,
				botId: 'normal',
				intent: play,
				info: null,
				before: state,
				after,
				logIndex: 0,
			},
			{ seat: 0 },
		)
		expect(log.moves[0]!.involvedIids).toContain(play.iid)
		setBotRunner(silentRunner())
		start(7, { 1: 'normal' })
		const el = document.createElement('div')
		el.setAttribute('data-anchor', `card:${play.iid}`)
		document.body.appendChild(el)
		const h = document.createElement('div')
		document.body.appendChild(h)
		const r = createRoot(h)
		act(() => r.render(<BotHighlight />))
		act(() => useGameStore.setState({ botLog: log }))
		return {
			el,
			unmount: () => {
				act(() => r.unmount())
				h.remove()
			},
		}
	}

	it('pulses the cards a move involved', () => {
		stubMotion(false)
		const { el, unmount } = highlightOnce()
		expect(el.classList.contains('bot-hl')).toBe(true)
		expect(el.classList.contains('bot-hl-pulse')).toBe(true)
		unmount()
		expect(el.classList.contains('bot-hl')).toBe(false)
	})

	it('falls back to a static outline with prefers-reduced-motion', () => {
		stubMotion(true)
		const { el, unmount } = highlightOnce()
		expect(el.classList.contains('bot-hl')).toBe(true)
		expect(el.classList.contains('bot-hl-static')).toBe(true)
		expect(el.classList.contains('bot-hl-pulse')).toBe(false)
		unmount()
	})
})

describe('decision seat sanity', () => {
	it('the fixture states are bot decisions', () => {
		const { state } = botPlayState()
		expect(decisionSeat(state)).toBe(1)
	})
})
