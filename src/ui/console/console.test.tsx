// The console laid out across the table (docs/ui-lcars.md §4): the opponent
// band, the decks on the table, the hand dock, and the layers that open only
// on request — the viewscreen (V), the Neutral Zone close-up (N), the log
// drawer (L), the menu.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../../engine/setup'
import { zoneKey } from '../../engine/state'
import App from '../App'
import { useGameStore } from '../store'
import { useConsoleUi } from './consoleUi'
import { HOLD_MS } from './longPress'

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

// unmounted between tests: a live root keeps its window shortcuts
const roots: Root[] = []

function renderGame(): HTMLElement {
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().startGame(config())
	})
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	roots.push(root)
	act(() => {
		root.render(<App />)
	})
	return host
}

function key(k: string, init: KeyboardEventInit = {}, target?: Element) {
	act(() => {
		;(target ?? window).dispatchEvent(
			new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }),
		)
	})
}

beforeEach(() => {
	act(() => {
		for (const root of roots.splice(0)) root.unmount()
	})
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	useConsoleUi.getState().reset(0)
})

describe('console across the table', () => {
	it('the opponent band holds their hand face down, their decks and their pool', () => {
		const host = renderGame()
		const band = host.querySelector('.opp-band')!
		const real = useGameStore.getState().state!
		const hand = real.zones[zoneKey({ k: 'HAND', seat: 1 })] ?? []
		expect(hand.length).toBeGreaterThan(0)
		// one back per card, and not one face among them
		expect(band.querySelectorAll('.opp-hand .card')).toHaveLength(hand.length)
		expect(band.querySelectorAll('.opp-hand .card-hidden')).toHaveLength(
			hand.length,
		)
		// their Draw and Discard as decks
		expect(band.querySelector('[aria-label^="Draw ("]')).not.toBeNull()
		expect(band.querySelector('[aria-label^="Discard ("]')).not.toBeNull()
		// one counter per pool: theirs in the band, yours in the head bar
		for (const seat of [0, 1])
			expect(
				host.querySelectorAll(`[data-anchor="player:${seat}:DIL"]`),
			).toHaveLength(1)
		expect(band.querySelector('[data-anchor="player:1:DIL"]')).not.toBeNull()
		expect(
			host.querySelector('.topbar [data-anchor="player:0:DIL"]'),
		).not.toBeNull()
		// their Captain is on the table, small
		expect(band.querySelector('.band-captain .card')).not.toBeNull()
	})

	it('the shared piles are decks in the centre, the Stardate counter once', () => {
		const host = renderGame()
		const piles = host.querySelector('.centre-piles')!
		expect(piles.querySelector('[aria-label^="Stardates ("]')).not.toBeNull()
		expect(piles.querySelector('[aria-label^="Incidents ("]')).not.toBeNull()
		expect(piles.querySelector('[aria-label^="Junk ("]')).not.toBeNull()
		expect(host.querySelectorAll('[data-anchor="stardate"]')).toHaveLength(1)
		// your own Draw and Discard sit in the hand dock
		const dock = host.querySelector('.hand-dock')!
		expect(dock.querySelector('[aria-label^="Draw ("]')).not.toBeNull()
		expect(dock.querySelector('[aria-label^="Discard ("]')).not.toBeNull()
	})

	it('V puts the opponent on screen, without a Complete button, and Esc takes it off', () => {
		const host = renderGame()
		expect(host.querySelector('.viewscreen')).toBeNull()
		key('v')
		const screen = host.querySelector('.viewscreen')!
		expect(screen).not.toBeNull()
		expect(screen.querySelector('[aria-label="Player 2 area"]')).not.toBeNull()
		expect(
			screen.querySelector('[aria-label="Player 2 crew board"]'),
		).not.toBeNull()
		expect(
			[...screen.querySelectorAll('button')].some(
				(b) => b.textContent === 'Complete',
			),
		).toBe(false)
		key('Escape')
		expect(host.querySelector('.viewscreen')).toBeNull()
		// a click on the band's background opens it too
		act(() => {
			;(host.querySelector('.band-tableau') as HTMLElement).click()
		})
		expect(host.querySelector('.viewscreen')).not.toBeNull()
	})

	it('N brings the Neutral Zone close up, and Esc or a click outside puts it away', () => {
		const host = renderGame()
		const closeup = () => host.querySelector('.closeup')
		expect(closeup()).toBeNull()
		key('n')
		expect(closeup()).not.toBeNull()
		// the three Locations, each with its teams' place and a readout
		const slots = closeup()!.querySelectorAll('.closeup-slot')
		expect(slots).toHaveLength(3)
		for (const slot of slots) {
			expect(slot.querySelector('.location-with-teams')).not.toBeNull()
			expect(slot.querySelector('.closeup-status')!.textContent).toBe(
				'Open · 0 vs 0',
			)
			expect(
				slot.querySelector(
					'[aria-label="Player 1 (you): 0 Away Teams, 0 ships"]',
				),
			).not.toBeNull()
		}
		key('Escape')
		expect(closeup()).toBeNull()
		// the button over the three Locations opens it too
		const button = host.querySelector(
			'.neutral-zone .nz-closeup-btn',
		) as HTMLElement
		act(() => {
			button.click()
		})
		expect(closeup()).not.toBeNull()
		act(() => {
			;(host.querySelector('.closeup-backdrop') as HTMLElement).click()
		})
		expect(closeup()).toBeNull()
	})

	it('the close-up works out who secures each Location', () => {
		const host = renderGame()
		const p = useGameStore.getState().projected!
		const locs = ([0, 1, 2] as const).map(
			(slot) => p.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot })]![0]!,
		)
		// UI-only: the view is patched directly
		act(() => {
			useGameStore.setState({
				projected: {
					...p,
					awayTeamsAt: {
						...p.awayTeamsAt,
						[locs[0]!]: [3, 1],
						[locs[1]!]: [1, 2],
						[locs[2]!]: [0, 4],
					},
				},
			})
		})
		key('n')
		const readouts = [...host.querySelectorAll('.closeup-readout')]
		expect(
			readouts.map((r) => r.querySelector('.closeup-status')!.textContent),
		).toEqual([
			'Secured by you · 3 vs 1',
			'Contested · 1 vs 2',
			'Secured by Player 2 · 0 vs 4',
		])
		// the holder's colour, none while it is contested
		expect(readouts[0]!.classList.contains('closeup-seat-0')).toBe(true)
		expect(readouts[1]!.className).toBe('closeup-readout')
		expect(readouts[2]!.classList.contains('closeup-seat-1')).toBe(true)
		expect(
			readouts[1]!.querySelector(
				'[aria-label="Player 2: 2 Away Teams, 0 ships"]',
			),
		).not.toBeNull()
		expect(readouts[1]!.querySelector('.closeup-note')!.textContent).toBe(
			'You need 3 more tokens here to secure it.',
		)
	})

	it('the close-up and the viewscreen share the screen: one puts the other away', () => {
		const host = renderGame()
		key('n')
		key('v')
		expect(host.querySelector('.closeup')).toBeNull()
		expect(host.querySelector('.viewscreen')).not.toBeNull()
		key('n')
		expect(host.querySelector('.closeup')).not.toBeNull()
		expect(host.querySelector('.viewscreen')).toBeNull()
		key('n')
		expect(host.querySelector('.closeup')).toBeNull()
	})

	it('the log opens only on request, and Esc closes the top layer first', () => {
		const host = renderGame()
		expect(host.querySelector('.log-drawer')).toBeNull()
		const play = useGameStore
			.getState()
			.legal.find((it) => it.t === 'PLAY_CARD' || it.t === 'ACTIVATE')
		if (play !== undefined)
			act(() => {
				useGameStore.getState().dispatch(play)
			})
		expect(host.querySelector('.log-drawer')).toBeNull()
		key('l')
		expect(
			host.querySelector('.log-drawer [aria-label="Game log"]'),
		).not.toBeNull()
		key('v')
		// the viewscreen opened last, so Esc closes it and leaves the log
		key('Escape')
		expect(host.querySelector('.viewscreen')).toBeNull()
		expect(host.querySelector('.log-drawer')).not.toBeNull()
		key('Escape')
		expect(host.querySelector('.log-drawer')).toBeNull()
	})

	it('shortcuts ignore modifiers, auto-repeat and typing in a field', () => {
		const host = renderGame()
		key('l', { metaKey: true })
		key('l', { altKey: true })
		key('l', { repeat: true })
		expect(host.querySelector('.log-drawer')).toBeNull()
		const input = document.createElement('input')
		document.body.appendChild(input)
		key('l', {}, input)
		expect(host.querySelector('.log-drawer')).toBeNull()
		key('L')
		expect(host.querySelector('.log-drawer')).not.toBeNull()
	})

	it('H pins the hand dock up and lets it drop again', () => {
		const host = renderGame()
		const dock = () => host.querySelector('.hand-dock')!
		expect(dock().classList.contains('dock-raised')).toBe(false)
		key('h')
		expect(dock().classList.contains('dock-raised')).toBe(true)
		expect(dock().classList.contains('dock-pinned')).toBe(true)
		key('h')
		expect(dock().classList.contains('dock-raised')).toBe(false)
		// the hand is in it, at full size
		const hand =
			useGameStore.getState().state!.zones[zoneKey({ k: 'HAND', seat: 0 })]!
		expect(dock().querySelectorAll('.dock-fan .card-hand')).toHaveLength(
			hand.length,
		)
	})

	it('a touch tap on the lowered hand lifts it instead of opening a card', () => {
		const host = renderGame()
		const dock = host.querySelector('.hand-dock')!
		const card = dock.querySelector('.dock-fan .card-inner') as HTMLElement
		act(() => {
			card.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					pointerType: 'touch',
				}),
			)
			card.click()
		})
		expect(dock.classList.contains('dock-raised')).toBe(true)
		expect(useGameStore.getState().detailIid).toBeNull()
	})

	it('Undo stays in the head bar; the rest sits in the menu', () => {
		const host = renderGame()
		const buttons = () =>
			[...host.querySelectorAll('button')].map((b) => b.textContent?.trim())
		expect(buttons()).toContain('Undo')
		expect(buttons()).not.toContain('Replay')
		act(() => {
			;[...host.querySelectorAll('button')]
				.find((b) => b.textContent?.trim() === 'Menu')!
				.click()
		})
		expect(buttons()).toEqual(
			expect.arrayContaining(['Replay', 'Reference', 'Settings', 'New game']),
		)
		key('Escape')
		expect(buttons()).not.toContain('Replay')
		// no fullscreen API in jsdom: no button for it
		expect(host.querySelector('[aria-label="Fullscreen"]')).toBeNull()
	})

	it('a long press zooms a card until the finger lifts, and swallows the tap', () => {
		vi.useFakeTimers()
		try {
			const host = renderGame()
			const card = host.querySelector('.own-row .card') as HTMLElement
			const touch = (type: string) =>
				act(() => {
					card.dispatchEvent(
						new PointerEvent(type, {
							bubbles: true,
							pointerType: 'touch',
							clientX: 20,
							clientY: 20,
						}),
					)
				})
			touch('pointerdown')
			act(() => {
				vi.advanceTimersByTime(HOLD_MS + 20)
			})
			expect(document.querySelector('.zoom-layer')).not.toBeNull()
			touch('pointerup')
			expect(document.querySelector('.zoom-layer')).toBeNull()
			act(() => {
				;(card.querySelector('.card-inner') as HTMLElement).click()
			})
			expect(useGameStore.getState().detailIid).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it('F asks for fullscreen where the browser offers it', () => {
		const request = vi.fn(() => Promise.resolve())
		Object.defineProperty(document, 'fullscreenEnabled', {
			configurable: true,
			value: true,
		})
		document.documentElement.requestFullscreen = request
		try {
			const host = renderGame()
			expect(host.querySelector('[aria-label="Fullscreen"]')).not.toBeNull()
			key('f')
			expect(request).toHaveBeenCalledTimes(1)
		} finally {
			Object.defineProperty(document, 'fullscreenEnabled', {
				configurable: true,
				value: undefined,
			})
		}
	})
})
