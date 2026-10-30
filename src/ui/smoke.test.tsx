// Smoke test (todo/14 DOoD): the app can create a game and render the board.
// Runs under the `dom` vitest project (jsdom). We render the real <App/> root,
// then drive the store through startGame and assert the shared board, the
// viewer's area/hand and the log panel appear.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import App from './App'
import { useGameStore } from './store'

function config(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 7,
	}
}

async function renderApp(): Promise<HTMLElement> {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	await act(async () => {
		root.render(<App />)
	})
	return host
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('app smoke (jsdom)', () => {
	it('boots the setup screen and lists the built crew decks', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
		})
		const host = await renderApp()
		expect(host.textContent).toContain('Ready Room')
		expect(host.textContent).toContain('Start game')
		const state = useGameStore.getState()
		expect(state.catalog).not.toBeNull()
		expect(state.error).toBeNull()
	})

	it('starts a game and renders the board, areas, hand and log', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = await renderApp()

		const text = host.textContent ?? ''
		expect(text).toContain('Market')
		expect(text).toContain('Stardate')
		expect(text).toContain('Neutral Zone')
		expect(text).toContain('Log')
		expect(
			host.querySelector('.hand') ?? host.querySelector('.hand-opponent'),
		).not.toBeNull()
		expect(
			host.querySelector('.player-area') ??
				host.querySelector('.area-compact-grid'),
		).not.toBeNull()

		const store = useGameStore.getState()
		expect(store.projected).not.toBeNull()
		expect(store.error).toBeNull()
	})

	it('the crew board shows the real mission and the side’s own track glyphs', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = await renderApp()
		const board = host.querySelector('[aria-label="Player 1 crew board"]')
		expect(board).not.toBeNull()
		// the PIC Basic side prints 1PIC/M1 (no VP shown on the Basic side)
		expect(board!.textContent).toContain('1PIC/M1')
		expect(board!.querySelector('.mission-vp')).toBeNull()
		// Basic Influence: ×1 at 0 … ×7 at 15 (src/data/cards/boards/pic.json)
		const glyphs = [...board!.querySelectorAll('.track-mult')].map(
			(e) => e.textContent,
		)
		expect(glyphs).toContain('×7')
		// each specialty bar ends in its position and current multiplier
		const influence = board!.querySelector('.console-track.s-influence')
		expect(influence?.getAttribute('aria-label')).toContain(
			'Influence: step 0 of 15 · Focus icons score ×1',
		)
		expect(influence?.querySelector('.readout-mult')?.textContent).toBe('×1')
		expect(influence?.querySelectorAll('.console-seg').length).toBe(16)
	})

	it('your resources sit in the top bar, the opponent keeps its pips', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = await renderApp()
		const topbar = host.querySelector('.topbar')
		const board = host.querySelector('[aria-label="Player 1 crew board"]')
		const p0 = useGameStore.getState().state!.players[0]
		// one counter per pool, so a token flight has exactly one place to land
		expect(host.querySelectorAll('[data-anchor="player:0:DIL"]').length).toBe(1)
		expect(
			topbar!.querySelector('[data-anchor="player:0:DIL"] .res-n')?.textContent,
		).toBe(String(p0.resources.DIL))
		expect(topbar!.querySelector('.pip-away .res-n')?.textContent).toBe(
			`${p0.awayTeamsInPool}/${p0.awayTeamsTotal}`,
		)
		// the crew console keeps only the piles
		expect(board!.querySelector('[data-anchor^="player:0:"]')).toBeNull()
		expect(board!.querySelector('.tile-away')).toBeNull()
		expect(host.querySelector('[data-anchor="player:1:DIL"]')).not.toBeNull()
	})

	it('opens a new game past the START boundary, no extra click', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = await renderApp()
		expect(useGameStore.getState().session?.log).toEqual([{ t: 'START' }])
		expect(host.textContent).not.toContain('Start game')
		// After START the stack machine auto-advances RESUPPLY -> CONTROL -> ACTION
		// (no RESUPPLY ops in play at turn start, no secured Location turn 1) — the
		// same post-START halt src/engine/intents.test.ts asserts.
		expect(useGameStore.getState().state?.phase.k).toBe('ACTION')
		expect(useGameStore.getState().error).toBeNull()
		expect((host.textContent ?? '').length).toBeGreaterThan(0)
	})

	it('one Reference menu tabs between its panels; Settings holds the preferences', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = await renderApp()
		const button = (text: string, root: ParentNode = host) =>
			[...root.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === text,
			)!
		expect(host.textContent).not.toContain('MODE ·')
		// Reference and Settings sit in the head bar's Menu
		act(() => button('Menu').click())
		act(() => button('Reference').click())
		expect(host.querySelector('[aria-label="Rules drawer"]')).not.toBeNull()
		const tabs = host.querySelector('[role="tablist"][aria-label="Reference"]')!
		act(() => button('Card list', tabs).click())
		expect(host.querySelector('[aria-label="Rules drawer"]')).toBeNull()
		expect(host.querySelector('[aria-label="Card list"]')).not.toBeNull()
		act(() => useGameStore.getState().setCardListOpen(false))
		// the button reopens the menu on the last tab
		act(() => button('Menu').click())
		act(() => button('Reference').click())
		expect(host.querySelector('[aria-label="Card list"]')).not.toBeNull()
		act(() => useGameStore.getState().setCardListOpen(false))
		act(() => button('Menu').click())
		act(() => button('Settings').click())
		const settings = host.querySelector('[aria-label="Settings"]')!
		expect(settings.textContent).toContain('Layout')
		expect(settings.textContent).toContain('Card faces')
	}, 20_000) // renders the whole card list: slow under a loaded machine
})
