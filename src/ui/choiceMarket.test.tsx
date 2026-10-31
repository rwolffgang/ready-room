// The card choice's candidates read like the table: groups say where the
// cards are in words ("Market", "Your hand"), never as engine zone keys;
// Market offers lie under their suit banner, the face-down deck on the left
// and the offered card on the right; and the buttons come after the cards.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { ChoicePanel } from './choice'

function startedSession() {
	const catalog = loadBrowserCatalog()
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: 'PIC', boardSide: 'BASIC' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed: 25,
			},
			catalog,
		),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('CHOOSE_CARDS from the Market', () => {
	it('draws the offers as on the table, names the groups, buttons last', () => {
		act(() => {
			useGameStore.getState().resumeGame(startedSession())
		})
		const projected = useGameStore.getState().projected!
		const person = projected.zones['MARKET_OFFER:PERSON']![0]! as CardInstanceId
		const ally = projected.zones['MARKET_OFFER:ALLY']![0]! as CardInstanceId
		const inHand = projected.zones['HAND:0']![0]! as CardInstanceId
		act(() => {
			useGameStore.setState({
				pendingChoice: {
					k: 'CHOOSE_CARDS',
					id: 'c-test',
					seat: 0,
					prompt: 'Gain a card',
					candidates: [person, ally, inHand],
					min: 1,
					max: 1,
					from: 'MARKET',
					sourceCard: null,
				},
			} as never)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		act(() => {
			createRoot(host).render(<ChoicePanel />)
		})
		const panel = host.querySelector('.choice-panel')!
		const labels = [...panel.querySelectorAll('.candidate-group-label')].map(
			(e) => e.textContent,
		)
		expect(labels).toEqual(['Market', 'Your hand · 1'])
		expect(panel.textContent).not.toContain('MARKET_OFFER')
		expect(panel.textContent).not.toContain('HAND:')

		const slots = [...panel.querySelectorAll('.market-slot')]
		expect(
			slots.map((s) => s.querySelector('.suit-banner')?.textContent),
		).toEqual(['PERSON', 'ALLY'])
		for (const [slot, suit] of [
			[slots[0]!, 'PERSON'],
			[slots[1]!, 'ALLY'],
		] as const) {
			const pair = slot.querySelector('.market-pair')!
			// the deck, face down, comes first; the offered card after it
			expect(pair.children[0]!.classList.contains('cardstack-deck')).toBe(true)
			expect(
				pair.querySelector('.stack-back')?.getAttribute('aria-label'),
			).toBe(`${suit} deck (${projected.zones[`MARKET_DECK:${suit}`]!.length})`)
			expect(pair.children[1]!.querySelector('.card')).not.toBeNull()
		}

		// the decision comes after the cards
		const children = [...panel.children]
		const actions = children.findIndex((e) =>
			e.classList.contains('choice-actions'),
		)
		const cards = children.findIndex((e) =>
			e.classList.contains('candidate-groups'),
		)
		expect(cards).toBeGreaterThanOrEqual(0)
		expect(actions).toBeGreaterThan(cards)
	})

	it('draws a greyed offer once when it is also a candidate (JUNK)', () => {
		act(() => {
			useGameStore.getState().resumeGame(startedSession())
		})
		const projected = useGameStore.getState().projected!
		const person = projected.zones['MARKET_OFFER:PERSON']![0]! as CardInstanceId
		const ally = projected.zones['MARKET_OFFER:ALLY']![0]! as CardInstanceId
		act(() => {
			useGameStore.setState({
				pendingChoice: {
					k: 'CHOOSE_CARDS',
					id: 'c-test',
					seat: 0,
					prompt: 'Junk a card',
					candidates: [person, ally],
					disabled: [{ iid: person, reason: 'bears resource tokens' }],
					min: 1,
					max: 1,
					from: 'MARKET',
					sourceCard: null,
				},
			} as never)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		act(() => {
			createRoot(host).render(<ChoicePanel />)
		})
		const panel = host.querySelector('.choice-panel')!
		expect(panel.querySelectorAll('.candidate-tile')).toHaveLength(2)
		expect(panel.querySelectorAll('.candidate-disabled')).toHaveLength(1)
		expect(panel.querySelectorAll('.why-not')).toHaveLength(1)
	})

	it("takes a deck's top card from the deck itself, not a group of its own", () => {
		act(() => {
			useGameStore.getState().resumeGame(startedSession())
		})
		const projected = useGameStore.getState().projected!
		const offer = projected.zones['MARKET_OFFER:ALLY']![0]! as CardInstanceId
		const top = projected.zones['MARKET_DECK:ALLY']![0]! as CardInstanceId
		act(() => {
			useGameStore.setState({
				pendingChoice: {
					k: 'CHOOSE_CARDS',
					id: 'c-test',
					seat: 0,
					prompt: 'Gain a card',
					candidates: [offer, top],
					hidden: [top],
					min: 1,
					max: 1,
					from: 'MARKET',
					sourceCard: null,
				},
			} as never)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		act(() => {
			createRoot(host).render(<ChoicePanel />)
		})
		const panel = host.querySelector('.choice-panel')!
		expect(
			[...panel.querySelectorAll('.candidate-group-label')].map(
				(e) => e.textContent,
			),
		).toEqual(['Market'])
		expect(panel.querySelectorAll('.market-slot')).toHaveLength(1)
		expect(panel.textContent).not.toContain('(face down)')
		const deck = panel.querySelector<HTMLButtonElement>(
			'.deck-pick .stack-back',
		)!
		expect(deck.getAttribute('aria-label')).toBe(
			`Top card of the ALLY deck (${projected.zones['MARKET_DECK:ALLY']!.length})`,
		)
		act(() => deck.click())
		expect(useGameStore.getState().selected).toEqual([top])
		expect(
			panel
				.querySelector('.deck-pick')!
				.classList.contains('candidate-selected'),
		).toBe(true)
	})
})
