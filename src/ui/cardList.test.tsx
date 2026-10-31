// The Card list carries the board's Option-hold zoom (cards.tsx CardZoom) for
// its catalog cards, with or without a game in progress.

import { beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { CardListPanel } from './rules'
import { useGameStore } from './store'

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('Card list zoom', () => {
	it('zooms the hovered catalog card only while Option is held', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardListPanel onClose={() => {}} />)
		})
		const card = host.querySelector('.cardlist-grid .card')!
		const option = (held: boolean) =>
			act(() => {
				window.dispatchEvent(
					new KeyboardEvent(held ? 'keydown' : 'keyup', {
						key: 'Alt',
						altKey: held,
					}),
				)
			})

		// Hover alone is not enough, as on the board.
		act(() => {
			card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
		})
		expect(host.querySelector('.zoom-layer')).toBeNull()

		option(true)
		expect(host.querySelector('.zoom-layer .card-zoom')).not.toBeNull()

		option(false)
		expect(host.querySelector('.zoom-layer')).toBeNull()

		// Option held but the pointer has left the card shows nothing.
		option(true)
		act(() => {
			card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
		})
		expect(host.querySelector('.zoom-layer')).toBeNull()

		// Closing the list drops the key, so nothing lingers.
		act(() => root.unmount())
		expect(useGameStore.getState().zoomHeld).toBe(false)
	})
})
