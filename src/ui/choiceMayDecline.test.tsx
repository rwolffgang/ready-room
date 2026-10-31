// A "you may …" whose effect starts with a pick is one dialog: the pick
// itself, with the card's wording and a Decline, no CONFIRM before it. A
// first-legal game (PIC vs SHR) is driven up to its first such prompt.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { Session } from '../session/log'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { legalIntents } from '../engine/intents'
import { nextAutoIntent } from '../bot/autoPlay'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { ChoicePanel } from './choice'

/** A game stopped at its first one-dialog "you may". */
function atFirstMay(): Session {
	const catalog = loadBrowserCatalog()
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: 'PIC', boardSide: 'ADVANCED' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed: 25,
			},
			catalog,
		),
		catalog,
	})
	for (let i = 0; i < 400; i++) {
		if (adapter.pendingChoice?.mayDecline === true) return adapter.session
		const intent = nextAutoIntent(adapter.state, legalIntents(adapter.state))
		if (intent === undefined) break
		adapter.dispatch(intent)
	}
	throw new Error('no one-dialog "you may" reached')
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

function render(): HTMLElement {
	act(() => useGameStore.getState().resumeGame(atFirstMay()))
	const host = document.createElement('div')
	document.body.appendChild(host)
	act(() => createRoot(host).render(<ChoicePanel />))
	return host
}

const button = (host: HTMLElement, label: string) =>
	[...host.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === label,
	)

describe('"you may": the pick is the whole dialog', () => {
	it('shows the card wording and a Decline, no Yes/No', () => {
		const host = render()
		const choice = useGameStore.getState().pendingChoice!
		expect(choice.k).toBe('CHOOSE_CARDS')
		expect(choice.prompt).toMatch(/^You may /)
		expect(button(host, 'Decline / none')).toBeDefined()
		expect(button(host, 'Cancel / decline')).toBeUndefined()
	})

	it('Decline leaves the card where it is', () => {
		const host = render()
		const choice = useGameStore.getState().pendingChoice!
		if (choice.k !== 'CHOOSE_CARDS') throw new Error(choice.k)
		const card = choice.candidates[0]!
		const before = useGameStore.getState().projected!.cards[card]!.zone
		act(() => button(host, 'Decline / none')!.click())
		expect(useGameStore.getState().pendingChoice?.id).not.toBe(choice.id)
		expect(useGameStore.getState().projected!.cards[card]!.zone).toEqual(before)
	})
})
