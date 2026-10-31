// "You may warp" is one dialog: the destination choice with a Skip, no
// CONFIRM before it. 1MAL01's reaction (warp a ship after taking an
// INCIDENT) on the opening turn of a MAL game: Skip leaves the ship where it
// is, a Location warps it.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { ChoicePanel } from './choice'

const SHIP = 'p0#0157' as CardInstanceId

/** Seat 0 plays its opening until 1MAL01's reaction is accepted. */
function atMayWarp() {
	const catalog = loadBrowserCatalog()
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: 'MAL', boardSide: 'BASIC' },
					{ deck: 'SIS', boardSide: 'BASIC' },
				],
				seed: 12345,
			},
			catalog,
		),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	adapter.dispatch({
		t: 'PLAY_CARD',
		iid: 'p0#0152' as CardInstanceId,
		operationIndex: 0,
	})
	adapter.dispatch({
		t: 'PLAY_CARD',
		iid: 'p0#0148' as CardInstanceId,
		operationIndex: 1,
	})
	const window = adapter.pendingChoice!
	if (window.k !== 'OPTIONAL_TRIGGERS') throw new Error(window.k)
	adapter.dispatch({
		t: 'RESOLVE_CHOICE',
		choiceId: window.id,
		selection: window.offered,
	})
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

function render(): HTMLElement {
	act(() => useGameStore.getState().resumeGame(atMayWarp()))
	const host = document.createElement('div')
	document.body.appendChild(host)
	act(() => createRoot(host).render(<ChoicePanel />))
	return host
}

const buttons = (host: HTMLElement) =>
	[...host.querySelectorAll('button')].map((b) => b.textContent?.trim())
const tokenAt = () =>
	useGameStore.getState().projected!.cards[SHIP]!.shipTokenAt

describe('"you may warp": one dialog', () => {
	it('asks for the destination straight away, with a Skip', () => {
		const host = render()
		const choice = useGameStore.getState().pendingChoice!
		expect(choice.k).toBe('CHOOSE_LOCATION')
		expect(host.textContent).toContain('You may warp')
		expect(buttons(host)).toContain('Skip')
		expect(buttons(host)).not.toContain('Cancel / decline')
	})

	it('Skip leaves the ship where it is', () => {
		const host = render()
		const before = tokenAt()
		const skip = [...host.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Skip',
		)!
		act(() => skip.click())
		expect(useGameStore.getState().pendingChoice?.k).not.toBe('CHOOSE_LOCATION')
		expect(tokenAt()).toBe(before)
	})
})
