// The console laid out across the table (docs/ui-lcars.md §4): the opponent
// band, the decks on the table, the hand dock, and the layers that open only
// on request — the viewscreen (V), the close-ups of the Neutral Zone (N), the
// Market (M) and your area (B), the log drawer (L), the menu.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../../engine/setup'
import { zoneKey } from '../../engine/state'
import App from '../App'
import { DETAIL_CLICK_WINDOW_MS, useGameStore } from '../store'
import { useConsoleUi } from './consoleUi'
import { HAND_ROOM_QUERY } from './HandDock'
import { handLayout } from './HandCloseup'
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
	useConsoleUi.getState().setHandPinned(false)
	vi.unstubAllGlobals()
})

/** The dock's end cap: pin the hand up or let it drop. */
function pin(host: HTMLElement) {
	act(() => host.querySelector<HTMLButtonElement>('.dock-cap')!.click())
}

/** A viewport as tall as HAND_ROOM_QUERY asks (jsdom has no matchMedia). */
function stubTallScreen() {
	vi.stubGlobal('matchMedia', (media: string) => ({
		media,
		matches: media === HAND_ROOM_QUERY,
		addEventListener: () => {},
		removeEventListener: () => {},
	}))
}

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
			'.neutral-zone .closeup-btn',
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

	it('M brings the Market close up: each suit, its card and its deck', () => {
		const host = renderGame()
		const p = useGameStore.getState().projected!
		key('m')
		const closeup = host.querySelector('.closeup-market')!
		expect(closeup).not.toBeNull()
		const slots = [...closeup.querySelectorAll('.closeup-slot')]
		expect(
			slots.map((s) => s.querySelector('.closeup-suit')!.textContent),
		).toEqual(['PERSON', 'CARGO', 'SHIP', 'ALLY'])
		for (const [i, suit] of (
			['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const
		).entries()) {
			const deck = p.zones[zoneKey({ k: 'MARKET_DECK', suit })]!.length
			expect(slots[i]!.querySelectorAll('.card')).toHaveLength(1)
			expect(slots[i]!.querySelector('.closeup-status')!.textContent).toBe(
				`${deck} in the deck`,
			)
		}
		key('Escape')
		expect(host.querySelector('.closeup')).toBeNull()
		// the panel's label is its door
		act(() => {
			;(host.querySelector('.market .panel-door') as HTMLElement).click()
		})
		expect(host.querySelector('.closeup-market')).not.toBeNull()
		key('m')
		expect(host.querySelector('.closeup')).toBeNull()
	})

	it('the Market close-up says what comes with each card', () => {
		const host = renderGame()
		const p = useGameStore.getState().projected!
		const offer = (suit: 'PERSON' | 'CARGO') =>
			p.zones[zoneKey({ k: 'MARKET_OFFER', suit })]![0]!
		const person = offer('PERSON')
		const cargo = offer('CARGO')
		// UI-only: the view is patched directly
		act(() => {
			useGameStore.setState({
				projected: {
					...p,
					cards: {
						...p.cards,
						[cargo]: { ...p.cards[cargo]!, resourceTokens: { GLO: 2 } },
					},
					zones: {
						...p.zones,
						[zoneKey({ k: 'MARKET_OFFER', suit: 'PERSON' })]: [],
						JUNK: [person],
						[zoneKey({ k: 'MARKET_DECK', suit: 'SHIP' })]: [],
					},
				},
			})
		})
		key('m')
		const slots = [...host.querySelectorAll('.closeup-market .closeup-slot')]
		const note = (i: number) =>
			slots[i]!.querySelector('.closeup-note')!.textContent
		// the PERSON card went to the Junk, and its slot waits
		expect(slots[0]!.querySelector('.card')).toBeNull()
		expect(slots[0]!.textContent).toContain('In the Junk1')
		expect(note(0)).toBe('Nothing on offer.')
		// the Glory on the CARGO card goes with it
		expect(slots[1]!.querySelector('[title="2 Glory"]')).not.toBeNull()
		expect(note(1)).toBe(
			'Whoever gains it takes its tokens too, and while it carries them it can’t be junked.',
		)
		expect(slots[2]!.querySelector('.closeup-status')!.textContent).toBe(
			'Deck empty',
		)
		expect(note(2)).toBe(
			'Its deck is empty: once it goes, the slot stays empty.',
		)
		expect(note(3)).toBe(
			'Once it goes, the next card of the deck takes its place.',
		)
	})

	it('B brings your own area close up', () => {
		const host = renderGame()
		key('b')
		const closeup = host.querySelector('.closeup-area')!
		expect(closeup).not.toBeNull()
		expect(closeup.querySelector('[aria-label="Player 1 area"]')).not.toBeNull()
		expect(closeup.querySelector('.card')).not.toBeNull()
		// no door to itself inside
		expect(closeup.querySelector('.closeup-btn')).toBeNull()
		key('b')
		expect(host.querySelector('.closeup')).toBeNull()
		// the button at the end of your area's zones opens it too
		act(() => {
			;(
				host.querySelector('.own-row .player-area .closeup-btn') as HTMLElement
			).click()
		})
		expect(host.querySelector('.closeup-area')).not.toBeNull()
	})

	it('the close-ups and the viewscreen share the screen: one puts the other away', () => {
		const host = renderGame()
		const open = () =>
			[...host.querySelectorAll('.closeup, .viewscreen')].map(
				(el) => el.className,
			)
		key('n')
		key('m')
		expect(open()).toEqual(['closeup closeup-market'])
		key('b')
		expect(open()).toEqual(['closeup closeup-area'])
		key('v')
		expect(open()).toEqual(['viewscreen'])
		key('n')
		expect(open()).toEqual(['closeup closeup-neutral-zone'])
		key('n')
		expect(open()).toEqual([])
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

	it('H brings your hand close up, every card on the close-up size', async () => {
		const host = renderGame()
		const hand =
			useGameStore.getState().state!.zones[zoneKey({ k: 'HAND', seat: 0 })]!
		const dock = () => host.querySelector('.hand-dock')!
		// the dock holds the hand at hand size
		expect(dock().querySelectorAll('.dock-fan .card-hand')).toHaveLength(
			hand.length,
		)
		key('h')
		const closeup = host.querySelector('.closeup-hand')!
		expect(closeup).not.toBeNull()
		expect(closeup.querySelectorAll('.card-board')).toHaveLength(hand.length)
		// H opens a view, it doesn't pin the dock
		expect(dock().classList.contains('dock-pinned')).toBe(false)
		key('h')
		expect(host.querySelector('.closeup')).toBeNull()
		// the dock's name is the door to it
		const door = dock().querySelector<HTMLButtonElement>('.dock-handle')!
		act(() => door.click())
		expect(host.querySelector('.closeup-hand')).not.toBeNull()
		expect(door.getAttribute('aria-expanded')).toBe('true')
		// and a card in it opens its detail, as in the dock
		act(() => {
			host.querySelector<HTMLElement>('.closeup-hand .card-inner')!.click()
		})
		await act(async () => {
			await new Promise((r) => setTimeout(r, DETAIL_CLICK_WINDOW_MS + 50))
		})
		expect(useGameStore.getState().detailIid).toBe(hand[0])
	})

	it('the hand close-up draws the cards largest, in even rows', () => {
		// a laptop's backdrop: five cards fit in one row
		expect(handLayout(5, 1376, 640)).toEqual({ cardW: 262, cols: 5 })
		// seven go four and three, not six and one
		expect(handLayout(7, 1376, 640).cols).toBe(4)
		expect(handLayout(10, 1376, 640).cols).toBe(5)
		// a short hand stops at the close-up's largest card
		expect(handLayout(2, 1376, 640).cardW).toBe(360)
		// an empty one still lays out
		expect(handLayout(0, 1376, 640).cols).toBe(1)
	})

	it('the end cap pins the hand, and the pin is kept on this device', () => {
		const host = renderGame()
		const dock = () => host.querySelector('.hand-dock')!
		const cap = () => dock().querySelector<HTMLButtonElement>('.dock-cap')!
		// the cap closes the dock on the right, after the hand
		expect(dock().lastElementChild).toBe(cap())
		expect(cap().getAttribute('aria-pressed')).toBe('false')
		act(() => cap().click())
		expect(cap().getAttribute('aria-pressed')).toBe('true')
		expect(dock().classList.contains('dock-raised')).toBe(true)
		expect(localStorage.getItem('ready-room:hand-pinned')).toBe('1')
		// a new game keeps it
		act(() => useConsoleUi.getState().reset(0))
		expect(dock().classList.contains('dock-pinned')).toBe(true)
		// and the drop shows at once, though focus stays on the cap
		act(() => {
			cap().focus()
			cap().click()
		})
		expect(dock().classList.contains('dock-raised')).toBe(false)
		expect(localStorage.getItem('ready-room:hand-pinned')).toBeNull()
	})

	it('on a short screen a pinned hand lifts over the board and Esc drops it', () => {
		const host = renderGame()
		pin(host)
		expect(host.querySelector('.frame.hand-docked')).toBeNull()
		expect(host.querySelector('.hand-dock.dock-raised')).not.toBeNull()
		// under the hand close-up it stays down, and lifts again after
		key('h')
		expect(host.querySelector('.hand-dock.dock-raised')).toBeNull()
		key('h')
		expect(host.querySelector('.hand-dock.dock-raised')).not.toBeNull()
		key('Escape')
		expect(host.querySelector('.hand-dock.dock-raised')).toBeNull()
	})

	it('on a tall screen a pinned hand docks in its own row, and Esc leaves it', () => {
		stubTallScreen()
		const host = renderGame()
		expect(host.querySelector('.frame.hand-docked')).toBeNull()
		pin(host)
		expect(host.querySelector('.frame.hand-docked')).not.toBeNull()
		key('Escape')
		expect(host.querySelector('.frame.hand-docked')).not.toBeNull()
		expect(host.querySelector('.hand-dock.dock-pinned')).not.toBeNull()
		pin(host)
		expect(host.querySelector('.frame.hand-docked')).toBeNull()
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
