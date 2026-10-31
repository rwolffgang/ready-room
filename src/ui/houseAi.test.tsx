// House AI in a local game (todo/15 §4): the store pumps a bot seat's intents
// through the same commit path a human's take, keeps the device with the one
// human (no pass-the-device UI), takes a bot's replies back together with the
// human's decision on undo, drops a stale in-flight decision, and runs a
// spectator game (both seats bots) with Pause / Step / Resume.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { legalIntents } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import { toIid } from '../engine/ids'
import { firstLegalPolicy, nextAutoIntent } from '../bot/autoPlay'
import type { BotId } from '../bot/types'
import { createSession } from '../session/log'
import { exportSession, importSession } from '../session/persistence'
import { decisionSeat } from '../session/interrupts'
import type { Opponents } from '../session/opponents'
import App from './App'
import { createInThreadRunner, type BotRunner } from './botRunner'
import { setBotRunner, stopBots, undoPolicy, useGameStore } from './store'
import { loadBrowserCatalog } from './browserCatalog'
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

/** Play the human's (seat 0) turn 1 to its end; returns the log index of the
 *  human's last decision. */
function humanTurnOne(): number {
	let last = 0
	while (st().activeSeat === 0 && st().turnNumber === 1) {
		humanMove()
		last = logLength() - 1
	}
	return last
}

/** The human seat plays the first-legal answer (the arena's first-legal bot). */
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

/** Let the bots run until none is thinking (a human must move, or the game
 *  is over, or a spectator game is paused). */
async function waitForBots(maxTicks = 20000): Promise<void> {
	for (let i = 0; i < maxTicks; i++) {
		await tick()
		if (store().botThinking === null) return
	}
	throw new Error('bots never settled')
}

/** A runner whose answers the test releases by hand. */
function manualRunner() {
	const calls: {
		state: GameState
		seat: Seat
		legal: Intent[]
		botId: BotId
		signal: AbortSignal | undefined
		resolve: (i: Intent) => void
	}[] = []
	const runner: BotRunner = {
		decide(state, seat, legal, botId, signal) {
			return new Promise<Intent>((resolve) => {
				calls.push({ state, seat, legal, botId, signal, resolve })
			})
		},
		dispose() {},
	}
	return { runner, calls }
}

/** The in-thread runner, recording who it was asked for. */
function recordingRunner() {
	const inner = createInThreadRunner()
	const asked: { seat: Seat; active: Seat; choice: boolean }[] = []
	const runner: BotRunner = {
		decide(state, seat, legal, botId, signal) {
			asked.push({
				seat,
				active: state.activeSeat,
				choice: state.pendingChoice !== null,
			})
			return inner.decide(state, seat, legal, botId, signal)
		},
		dispose: () => inner.dispose(),
	}
	return { runner, asked }
}

let viewerChanges: Seat[] = []
let unsubscribe: () => void = () => {}

beforeEach(() => {
	document.body.innerHTML = ''
	localStorage.clear()
	store().newGame()
	setBotRunner(createInThreadRunner())
	viewerChanges = []
	unsubscribe = useGameStore.subscribe((s, prev) => {
		if (s.viewerSeat !== prev.viewerSeat) viewerChanges.push(s.viewerSeat)
	})
})

afterEach(() => {
	unsubscribe()
	stopBots()
	store().newGame()
	localStorage.clear()
	resetShellChoiceCache()
})

describe('human vs House AI', () => {
	it("plays the bot's whole turn after the human ends theirs, then hands control back", async () => {
		const { runner, asked } = recordingRunner()
		setBotRunner(runner)
		start(7, { 1: 'normal' })
		expect(store().viewerSeat).toBe(0)
		expect(store().session?.opponents).toEqual({ 1: 'normal' })

		// the human's turn 1: start, play, end the step, answer the clean-up
		const lastHuman = humanTurnOne()
		expect(st().activeSeat).toBe(1)
		await waitForBots()

		// the bot played turn 2 to its end; the human decides turn 3
		expect(st().turnNumber).toBe(3)
		expect(decisionSeat(st())).toBe(0)
		expect(store().botToMove).toBeNull()
		expect(store().legal.length).toBeGreaterThan(0)
		expect(asked.length).toBeGreaterThan(3)
		expect(asked.every((a) => a.seat === 1)).toBe(true)
		const log = store().session!.log
		expect(log.length).toBe(lastHuman + 1 + asked.length)
		// the device never changed hands
		expect(store().viewerSeat).toBe(0)
		expect(viewerChanges).toEqual([])
		expect(store().warning).toBeNull()
	})

	it('answers a bot-owned interrupt on the human’s turn by itself', async () => {
		const { runner, asked } = recordingRunner()
		setBotRunner(runner)
		start(10, { 1: 'normal' })
		let interrupts = 0
		for (let guard = 0; guard < 400 && st().turnNumber <= 3; guard++) {
			if (store().botToMove !== null) {
				const before = st()
				if (before.activeSeat === 0 && decisionSeat(before) === 1) interrupts++
				await waitForBots()
				continue
			}
			expect(decisionSeat(st())).toBe(0)
			humanMove()
		}
		// PIC vs SHR seed 10: SHR owes a choice on PIC's turn 3
		expect(interrupts).toBeGreaterThan(0)
		expect(asked.some((a) => a.seat === 1 && a.active === 0 && a.choice)).toBe(
			true,
		)
		expect(viewerChanges).toEqual([])
	})

	it('undo after the bot’s turn returns to the human’s previous decision and does not replay the bot', async () => {
		start(7, { 1: 'normal' })
		const lastHuman = humanTurnOne()
		await waitForBots()
		expect(st().turnNumber).toBe(3)
		// the human's last decision was turn 1's clean-up choice
		expect(store().session!.log[lastHuman]!.t).toBe('RESOLVE_CHOICE')
		expect(store().canUndo).toBe(true)

		const { runner, calls } = manualRunner()
		setBotRunner(runner)
		act(() => store().undo())
		expect(store().warning).toBeNull()
		expect(logLength()).toBe(lastHuman)
		expect(st().turnNumber).toBe(1)
		expect(st().pendingChoice?.seat).toBe(0)
		expect(decisionSeat(st())).toBe(0)
		await tick()
		await tick()
		expect(calls).toHaveLength(0)
		expect(store().botThinking).toBeNull()
		expect(logLength()).toBe(lastHuman)
		// the human's END_TURN is a turn boundary: no further take-back
		expect(store().canUndo).toBe(false)
	})

	it('undoPolicy: a take-back also removes the bot replies after it', () => {
		const base = createSession(config(10), catalog, {
			opponents: { 1: 'normal' },
		})
		const play: Intent = {
			t: 'PLAY_CARD',
			iid: toIid('c'),
			operationIndex: 0,
		}
		const reply: Intent = {
			t: 'RESOLVE_CHOICE',
			choiceId: 'x',
			selection: [],
		}
		const s = { ...base, log: [{ t: 'START' }, play, reply] as Intent[] }
		// the human's PLAY_CARD and the bot's reaction to it go together
		expect(undoPolicy(s, [0, 0, 1])).toMatchObject({ allowed: true, count: 2 })
		expect(undoPolicy(s, [0, 0, 0])).toMatchObject({ allowed: true, count: 1 })
		// the human's own turn boundary is never taken back
		const boundary = { ...base, log: [{ t: 'START' }, reply] as Intent[] }
		expect(undoPolicy(boundary, [0, 1]).allowed).toBe(false)
		// nothing of the human's yet
		expect(undoPolicy({ ...base, log: [reply] }, [1]).allowed).toBe(false)
		// spectator: off
		const watch = { ...s, opponents: { 0: 'easy', 1: 'hard' } as Opponents }
		expect(undoPolicy(watch, [0, 0, 1]).allowed).toBe(false)
	})

	it('drops a stale in-flight decision after undo', async () => {
		start(7, { 1: 'normal' })
		const lastHuman = humanTurnOne()
		// the bot is now to move; hold its answer
		const { runner, calls } = manualRunner()
		setBotRunner(runner)
		expect(calls).toHaveLength(1)
		expect(store().botThinking).toEqual({ seat: 1, botId: 'normal' })
		const pending = calls[0]!
		act(() => store().undo())
		expect(pending.signal?.aborted).toBe(true)
		const after = logLength()
		expect(after).toBe(lastHuman)
		// the old answer arrives late: it must never be dispatched
		pending.resolve(
			nextAutoIntent(pending.state, pending.legal, firstLegalPolicy)!,
		)
		await tick()
		await tick()
		expect(logLength()).toBe(after)
		expect(store().botThinking).toBeNull()
		expect(calls).toHaveLength(1)
	})

	it('drops a stale in-flight decision after a new game', async () => {
		const { runner, calls } = manualRunner()
		setBotRunner(runner)
		// the bot goes first: it is asked for its first move right away
		start(7, { 1: 'normal' }, 1)
		expect(calls).toHaveLength(1)
		expect(calls[0]!.seat).toBe(1)
		start(7, { 1: 'normal' }, 1)
		expect(calls).toHaveLength(2)
		expect(calls[0]!.signal?.aborted).toBe(true)
		const answer = (c: (typeof calls)[number]) =>
			nextAutoIntent(c.state, c.legal, firstLegalPolicy)!
		calls[0]!.resolve(answer(calls[0]!))
		await tick()
		await tick()
		expect(logLength()).toBe(1) // startGame's START only
		// the current game's answer still lands
		calls[1]!.resolve(answer(calls[1]!))
		await tick()
		await tick()
		expect(logLength()).toBe(2)
		expect(store().viewerSeat).toBe(0)
	})

	it('falls back to the first legal move when the bot answers illegally', async () => {
		const runner: BotRunner = {
			decide: async () => ({ t: 'START' }) as Intent, // not legal once started
			dispose() {},
		}
		setBotRunner(runner)
		start(7, { 1: 'normal' }, 1)
		await tick()
		await tick()
		expect(logLength()).toBeGreaterThanOrEqual(1)
		expect(store().session!.log[0]).toEqual({ t: 'START' })
		expect(store().warning).toMatch(/House AI \(Normal\) chose an illegal move/)
		expect(store().error).toBeNull()
	})

	it('renders no pass-the-device UI during the bot turn (console and phone)', async () => {
		for (const shell of ['console', 'phone'] as const) {
			localStorage.setItem(SHELL_KEY, shell)
			resetShellChoiceCache()
			const host = document.createElement('div')
			document.body.appendChild(host)
			const root: Root = createRoot(host)
			act(() => store().newGame())
			const { runner, calls } = manualRunner()
			setBotRunner(runner)
			start(7, { 1: 'normal' })
			act(() => root.render(<App />))
			humanTurnOne()
			// the bot is thinking: the indicator shows, no hand-off
			expect(calls.length).toBe(1)
			expect(host.textContent).toContain('House AI (Normal)')
			expect(host.textContent).toContain('thinking')
			expect(host.querySelector('.pass-bar')).toBeNull()
			expect(host.querySelector('[aria-label="Pass the device"]')).toBeNull()
			expect(host.textContent).not.toContain('pass the device')
			expect(host.textContent).not.toContain('Pass the device')
			act(() => root.unmount())
			host.remove()
		}
		expect(viewerChanges).toEqual([])
	})
})

describe('spectator (both seats House AI)', () => {
	it('pauses, steps one intent at a time, resumes and plays to the end', async () => {
		start(7, { 0: 'first-legal', 1: 'first-legal' })
		// pause before the first decision lands
		act(() => store().setBotPaused(true))
		await tick()
		expect(logLength()).toBe(1) // startGame's START only
		expect(store().botThinking).toBeNull()
		expect(store().viewerSeat).toBe(0)
		expect(store().canUndo).toBe(false)

		act(() => store().stepBot())
		await waitForBots()
		expect(logLength()).toBe(2)
		act(() => store().stepBot())
		await waitForBots()
		expect(logLength()).toBe(3)
		await tick()
		await tick()
		expect(logLength()).toBe(3) // still paused

		// the spectator may look from either side
		act(() => store().setViewer(1))
		expect(store().viewerSeat).toBe(1)
		act(() => store().setViewer(0))

		act(() => store().setBotPaused(false))
		await waitForBots()
		expect(st().result).not.toBeNull()
		expect(store().botThinking).toBeNull()
		expect(store().canUndo).toBe(false)
		expect(logLength()).toBeGreaterThan(50)
	}, 60000)
})

describe('saves', () => {
	it('an old session without opponents still loads as hot-seat', async () => {
		const session = createSession(config(7), catalog, { id: 'old' })
		const json = JSON.parse(exportSession(session)) as Record<string, unknown>
		delete json['opponents']
		const loaded = importSession(JSON.stringify(json))
		expect(loaded.opponents).toBeUndefined()
		act(() => store().resumeGame(loaded))
		expect(store().error).toBeNull()
		expect(store().session?.opponents).toBeUndefined()
		expect(store().botToMove).toBeNull()
		await tick()
		expect(store().botThinking).toBeNull()
		expect(logLength()).toBe(0)
	})

	it('a saved bot game resumes with the bot and the device pinned to the human', async () => {
		const { runner, calls } = manualRunner()
		setBotRunner(runner)
		const session = createSession(config(7, 1), catalog, {
			id: 'vs-ai',
			opponents: { 1: 'hard' },
		})
		const loaded = importSession(exportSession(session))
		expect(loaded.opponents).toEqual({ 1: 'hard' })
		act(() => store().resumeGame(loaded))
		expect(store().viewerSeat).toBe(0)
		expect(calls).toHaveLength(1)
		expect(calls[0]!.botId).toBe('hard')
	})
})

describe('setup screen', () => {
	it('picks Human / House AI per seat, remembers it, and has a one-click vs-AI start', () => {
		act(() => store().loadCatalog())
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => root.render(<App />))
		// the House AI is ours; the official solo Bot has its own panel
		expect(host.textContent).toContain(
			'House AI: a computer opponent of our own',
		)
		expect(host.textContent).toContain('Solo vs the Bot')
		const p2 = host.querySelector<HTMLSelectElement>(
			'select[aria-label="Player 2 played by"]',
		)!
		expect(p2.value).toBe('human')
		expect([...p2.options].map((o) => o.textContent)).toEqual([
			'Human',
			'House AI — Easy',
			'House AI — Normal',
			'House AI — Hard',
		])
		// one click: you vs House AI (Normal)
		const quick = [...host.querySelectorAll('button')].find((b) =>
			(b.textContent ?? '').startsWith('Play vs House AI'),
		)!
		expect(quick.textContent).toBe('Play vs House AI (Normal)')
		act(() => quick.click())
		expect(store().session?.opponents).toEqual({ 1: 'normal' })
		expect(store().viewerSeat).toBe(0)
		expect(JSON.parse(localStorage.getItem('ready-room:setup-seats')!)).toEqual(
			['human', 'normal'],
		)
		act(() => store().newGame())
		// the choice is remembered on the next visit to the setup screen
		const again = host.querySelector<HTMLSelectElement>(
			'select[aria-label="Player 2 played by"]',
		)!
		expect(again.value).toBe('normal')
		act(() => root.unmount())
		host.remove()
	})
})
