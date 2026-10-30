// Deck Review page tests: the special overview opens from the app, groups
// cards by deck ("type") and suit, and lays out each card with the printed
// card art plus Printed / Interpreted operation columns side by side.
// Runs under the `dom` vitest project (jsdom); Image errors out so every card
// falls back to its text face — fine for structure assertions.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGameStore } from './store'
import { resetImageLoadCache } from './cards'
import { setStccIndex } from './stcc'
import { fakeStccIndex } from './testStcc'
import { loadBrowserCatalog } from './browserCatalog'

function installFakeImage(mode: 'load' | 'error' = 'error'): void {
	class FakeImage {
		naturalWidth = 0
		naturalHeight = 0
		onload: (() => void) | null = null
		onerror: (() => void) | null = null
		private _src = ''
		get src(): string {
			return this._src
		}
		set src(v: string) {
			this._src = v
			if (mode === 'error') {
				this.onerror?.()
			} else {
				this.naturalWidth = 1535
				this.naturalHeight = 1306
				this.onload?.()
			}
		}
	}
	vi.stubGlobal('Image', FakeImage)
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
	resetImageLoadCache()
	installFakeImage()
})

afterEach(() => {
	vi.unstubAllGlobals()
	setStccIndex(new Map())
})

// The page renders the whole catalogue (~280 cards, every operation in text
// and Shorthand): about 2 s alone, so the 5 s default flakes on a busy machine.
describe('deck review page', { timeout: 20_000 }, () => {
	it('lists every captain deck plus the common pool, grouped by deck and suit', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().setDeckReviewOpen(true)
		})
		const host = await renderApp()
		const text = host.textContent ?? ''

		expect(host.querySelector('.deck-review')).not.toBeNull()
		expect(
			host.querySelector('.deck-section-head')?.textContent ?? '',
		).toContain('cards')
		for (const deck of ['PIC', 'SIS', 'SEL', 'SHR', 'BUR', 'KOL', 'COMMON']) {
			expect(host.querySelector(`#deck-${deck}`)).not.toBeNull()
		}
		// Within a deck the suits are grouped under their own heading (e.g. PIC -> SHIP).
		expect(host.querySelectorAll('.deck-suit').length).toBeGreaterThanOrEqual(6)
		// A captain card is present and rendered with both text columns.
		expect(text).toContain('1PIC01/24') // name falls back to the card number
	})

	it('renders each card with the printed card art and Printed/Interpreted columns', async () => {
		// Load mode with scans for every card, so CardFace draws the printed art.
		installFakeImage('load')
		setStccIndex(fakeStccIndex(loadBrowserCatalog().defs))
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().setDeckReviewOpen(true)
		})
		const host = await renderApp()

		const cards = host.querySelectorAll('.review-card')
		expect(cards.length).toBeGreaterThan(20)

		const first = cards[0]!
		expect(first.querySelector('.review-art .card')).not.toBeNull()
		expect(first.querySelector('.review-art .card-art-img')).not.toBeNull()
		expect(
			first.querySelector('.review-col-printed .review-col-label')?.textContent,
		).toBe('Printed')
		expect(
			first.querySelector('.review-col-interpreted .review-col-label')
				?.textContent,
		).toBe('Interpreted')
		// The printed column holds the ground-truth op text, the interpreted the engine description.
		const printed =
			first.querySelector('.review-col-printed .op-text')?.textContent ?? ''
		const interpreted =
			first.querySelector('.review-col-interpreted .op-text')?.textContent ?? ''
		expect(printed.length).toBeGreaterThan(0)
		expect(interpreted.length).toBeGreaterThan(0)
	})

	it('closes through the page close button', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().setDeckReviewOpen(true)
		})
		const host = await renderApp()
		expect(host.querySelector('.deck-review')).not.toBeNull()
		const close = [...host.querySelectorAll('button')].find(
			(b) => (b.textContent ?? '').trim() === 'Close',
		)
		expect(close).toBeDefined()
		act(() => {
			close!.click()
		})
		expect(host.querySelector('.deck-review')).toBeNull()
	})
})
