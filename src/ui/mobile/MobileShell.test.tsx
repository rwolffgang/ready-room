// The Pocket Bridge shells under jsdom: a new game renders on the phone, the
// dock and a lit line play a turn, a choice round-trips through its sheet with
// the candidate ringed on the board, every PendingChoice kind has a renderer,
// the tablet splits Sector and Ship, and a whole hot-seat game plays through
// the phone shell to the end screen.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../../engine/setup'
import type { GameState } from '../../engine/state'
import type { PendingChoice } from '../../engine/resolver/choices'
import { validateChoice } from '../../engine/resolver/choices'
import { firstLegalSelection, type Intent } from '../../engine/intents'
import { firstLegalPolicy } from '../../bot/autoPlay'
import App from '../App'
import { useGameStore } from '../store'
import { SHELL_KEY, resetShellChoiceCache } from './shell'
import { useBridgeUi } from './bridgeUi'
import { ChoiceSheet } from './ChoiceSheet'

let host: HTMLElement
let root: Root

function config(seed = 7, side: 'BASIC' | 'ADVANCED' = 'BASIC'): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: side },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed,
	}
}

function force(shell: 'phone' | 'tablet' | 'console') {
	localStorage.setItem(SHELL_KEY, shell)
	resetShellChoiceCache()
}

function startGame(c: SetupConfig) {
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().startGame(c)
	})
}

function renderApp() {
	act(() => {
		root.render(<App />)
	})
}

function click(el: Element | null | undefined) {
	expect(el).toBeTruthy()
	act(() => {
		;(el as HTMLElement).click()
	})
}

const byText = (sel: string, text: string): HTMLElement | undefined =>
	[...host.querySelectorAll<HTMLElement>(sel)].find((e) =>
		(e.textContent ?? '').includes(text),
	)

const st = (): GameState => useGameStore.getState().state!

beforeEach(() => {
	document.body.innerHTML = ''
	localStorage.clear()
	force('phone')
	useGameStore.getState().newGame()
	useBridgeUi.getState().reset()
	host = document.createElement('div')
	document.body.appendChild(host)
	root = createRoot(host)
})

afterEach(() => {
	act(() => root.unmount())
	localStorage.clear()
	resetShellChoiceCache()
})

describe('phone shell', () => {
	it('renders a new game: header, stations, dock', () => {
		startGame(config())
		renderApp()
		const pb = host.querySelector('.pb.pb-phone')
		expect(pb).not.toBeNull()
		// the console is not drawn underneath
		expect(host.querySelector('.frame')).toBeNull()
		const header = host.querySelector('.pb-hdr')!
		expect(header.textContent).toContain('Turn')
		expect(header.textContent).toContain('to the Burn')
		expect(header.textContent).toContain('SHR')
		expect(host.querySelectorAll('[role="tab"]').length).toBe(3)
		// a new game opens on its first Action step, no Start click
		expect(st().phase.k).toBe('ACTION')
		// the Ship station shows the Enterprise with its lit activation lines
		expect(
			host.querySelectorAll('.pb-content .pb-ln.pb-lit').length,
		).toBeGreaterThan(0)
		const orders = byText('.pb-dockbar .pb-pill', 'Orders')!
		expect(Number(orders.querySelector('.pb-n')!.textContent)).toBe(
			useGameStore
				.getState()
				.legal.filter(
					(i) =>
						i.t === 'PLAY_CARD' ||
						i.t === 'ACTIVATE' ||
						i.t === 'COMPLETE_MISSION',
				).length,
		)
		// every station renders
		for (const tab of ['Sector', 'Crew', 'Ship']) {
			click(byText('[role="tab"]', tab))
			expect(host.querySelector('.pb-content .pb-station')).not.toBeNull()
		}
		click(byText('[role="tab"]', 'Crew'))
		expect(host.textContent).toContain('If the game ended now')
		expect(host.textContent).toContain('0 until you complete a mission')
		expect(useGameStore.getState().error).toBeNull()
	})

	it('plays a card by tapping its lit line in the hand sheet', () => {
		startGame(config())
		renderApp()
		click(byText('.pb-dockbar .pb-pill', 'Hand'))
		const sheet = host.querySelector('[role="dialog"][aria-label="Your hand"]')!
		expect(sheet).not.toBeNull()
		const before = st().zones['HAND:0']!.length
		const lit = sheet.querySelector<HTMLElement>('.pb-ln.pb-lit')!
		const iid = lit.closest('[data-iid]')!.getAttribute('data-iid')!
		click(lit)
		expect(useGameStore.getState().error).toBeNull()
		expect(st().cards[iid]!.zone.k).not.toBe('HAND')
		expect(st().zones['HAND:0']!.length).toBeLessThan(before)
	})

	it('a choice round-trips: switch station, ring in place, confirm', () => {
		startGame(config(25, 'ADVANCED'))
		renderApp()
		const pic23 = st().zones['HAND:0']!.find(
			(i) => st().cards[i]!.def === '1PIC23-24',
		)!
		act(() => {
			useGameStore
				.getState()
				.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
		})
		const choice = useGameStore.getState().pendingChoice
		expect(choice?.k).toBe('CHOOSE_LOCATION')
		// the choice sheet replaced the dock; the Sector station came up
		expect(host.querySelector('.pb-dock')).toBeNull()
		const sheet = host.querySelector('.pb-choice')!
		expect(sheet.textContent).toContain('1PIC23/24')
		expect(useBridgeUi.getState().tab).toBe('sector')
		const confirm = byText('.pb-choice .pb-pill', 'Confirm')!
		expect((confirm as HTMLButtonElement).disabled).toBe(true)
		const ringed = host.querySelectorAll<HTMLElement>('.pb-content .pb-cand')
		expect(ringed.length).toBeGreaterThan(0)
		const loc = ringed[0]!.getAttribute('data-iid')!
		const teams = st().awayTeamsAt[loc]?.[0] ?? 0
		click(ringed[0])
		expect(useGameStore.getState().selected).toEqual([loc])
		expect(
			host.querySelector(`.pb-content [data-iid="${loc}"]`)!.className,
		).toContain('pb-picked')
		click(byText('.pb-choice .pb-pill', 'Confirm'))
		expect(useGameStore.getState().error).toBeNull()
		expect(useGameStore.getState().pendingChoice?.id).not.toBe(choice!.id)
		expect(st().awayTeamsAt[loc]?.[0] ?? 0).toBeGreaterThan(teams)
	})

	it('resuming mid-choice opens on the station holding the candidates', () => {
		startGame(config(25, 'ADVANCED'))
		const pic23 = st().zones['HAND:0']!.find(
			(i) => st().cards[i]!.def === '1PIC23-24',
		)!
		act(() => {
			useGameStore
				.getState()
				.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
		})
		expect(useGameStore.getState().pendingChoice?.k).toBe('CHOOSE_LOCATION')
		// a fresh mount (reload / resume) with the choice already open
		renderApp()
		expect(useBridgeUi.getState().tab).toBe('sector')
		expect(
			host.querySelectorAll('.pb-content .pb-cand').length,
		).toBeGreaterThan(0)
	})

	it('has a renderer for every PendingChoice kind', () => {
		startGame(config())
		const s = st()
		const hand = s.zones['HAND:0']!
		const offer = s.zones['MARKET_OFFER:PERSON']![0]!
		const ship = s.zones['FLEET:0']![0]!
		const cap = s.zones['CAPTAIN:0']![0]!
		const base = {
			id: 'x',
			seat: 0 as const,
			prompt: 'Test prompt',
			sourceCard: cap,
		}
		const kinds: PendingChoice[] = [
			{ ...base, k: 'CONFIRM' },
			{
				...base,
				k: 'CHOOSE_OPTION',
				options: [
					{ key: 'a', label: 'Gain 1 {DIL}', enabled: true },
					{ key: 'b', label: 'Nope', enabled: false, reason: 'no reason' },
				],
			},
			{
				...base,
				k: 'CHOOSE_CARDS',
				candidates: [hand[0]!, offer],
				min: 1,
				max: 1,
				from: 'x',
				optional: true,
			},
			{
				...base,
				k: 'CHOOSE_LOCATION',
				candidates: [s.zones['NEUTRAL_ZONE:0']![0]!],
			},
			{ ...base, k: 'CHOOSE_SUIT', suits: ['PERSON', 'ALLY'] },
			{ ...base, k: 'CHOOSE_TRAIT', traits: ['HUMAN', 'VULCAN'] },
			{
				...base,
				k: 'CHOOSE_SPECIALTY',
				specialties: ['RESEARCH', 'MILITARY'],
				gains: { RESEARCH: 2, MILITARY: 0 },
			},
			{
				...base,
				k: 'CHOOSE_DESTINATION',
				card: offer,
				options: ['DECK_TOP', 'DISCARD'],
			},
			{ ...base, k: 'CHOOSE_AMOUNT', min: 0, max: 3 },
			{
				...base,
				k: 'ORDER_OPERATIONS',
				pending: [
					{ card: ship, opIndex: 1, seat: 0 },
					{ card: cap, opIndex: 0, seat: 0 },
				],
			},
			{
				...base,
				k: 'OPTIONAL_TRIGGERS',
				offered: [{ card: cap, opIndex: 0, seat: 0 }],
			},
			{ ...base, k: 'CHOOSE_WITNESS', sets: [[hand[0]!], [hand[1]!]] },
			{ ...base, k: 'CHOOSE_WILDCARD_AS', card: hand[0]!, traits: ['HUMAN'] },
			{ ...base, k: 'ORDER_CARDS', cards: [hand[0]!, hand[1]!] },
		]
		expect(new Set(kinds.map((k) => k.k)).size).toBe(14)
		for (const choice of kinds) {
			act(() => {
				useGameStore.setState({ pendingChoice: choice, selected: [] })
			})
			act(() => {
				root.render(<ChoiceSheet splitView={false} />)
			})
			const sheet = host.querySelector(`.pb-choice[data-kind="${choice.k}"]`)
			expect(sheet, choice.k).not.toBeNull()
			expect(sheet!.textContent).toContain('Test prompt')
			expect(sheet!.textContent).toContain('1PIC01/24') // source card
			expect(sheet!.querySelectorAll('button').length).toBeGreaterThan(1)
		}
		// the destination sheet offers to remember its answer for the game
		act(() => {
			useGameStore.setState({ pendingChoice: kinds[7]!, selected: [] })
		})
		act(() => {
			root.render(<ChoiceSheet splitView={false} />)
		})
		expect(host.querySelector('[role="switch"]')).not.toBeNull()
		expect(host.textContent).toContain('Remember this for the rest of the game')
	})

	it('the tablet shows Sector and Ship side by side', () => {
		force('tablet')
		startGame(config())
		renderApp()
		expect(host.querySelector('.pb.pb-tablet')).not.toBeNull()
		const split = host.querySelector('.pb-split')!
		expect(split.querySelector('[aria-label="Sector"]')).not.toBeNull()
		expect(split.querySelector('[aria-label="Ship"]')).not.toBeNull()
		expect(byText('.pb-dockbar .pb-pill', 'Crew')).toBeTruthy()
	})

	it('the console stays the console', () => {
		force('console')
		startGame(config())
		renderApp()
		expect(host.querySelector('.pb')).toBeNull()
		expect(host.querySelector('.frame')).not.toBeNull()
	})

	it('plays a whole hot-seat game through the phone shell to the end screen', () => {
		startGame(config(11))
		renderApp()
		let passes = 0
		let steps = 0
		for (; steps < 4000; steps++) {
			const s = st()
			if (s.result !== null && s.result.kind === 'COMPLETE') break
			// hand the device over when the phone asks for it
			const pass = host.querySelector('.pb-pass button')
			if (pass !== null) {
				click(pass)
				passes++
				continue
			}
			const viewer = useGameStore.getState().viewerSeat
			const choice = s.pendingChoice
			if (choice !== null) {
				expect(choice.seat).toBe(viewer)
				expect(host.querySelector('.pb-choice')).not.toBeNull()
				let sel = firstLegalPolicy(s, choice)
				if (!validateChoice(s, choice.id, sel).ok) sel = firstLegalSelection(s)
				act(() => useGameStore.getState().settle(sel))
			} else {
				expect(s.activeSeat).toBe(viewer)
				const legal = useGameStore.getState().legal
				const pick: Intent | undefined =
					legal.find((i) => i.t !== 'PASS' && i.t !== 'END_TURN') ??
					legal.find((i) => i.t === 'END_TURN') ??
					legal[0]
				expect(pick).toBeDefined()
				act(() => useGameStore.getState().dispatch(pick!))
			}
			expect(useGameStore.getState().error).toBeNull()
			expect(host.querySelector('.pb, .end-screen')).not.toBeNull()
		}
		expect(st().result?.kind).toBe('COMPLETE')
		expect(passes).toBeGreaterThan(2)
		expect(host.textContent).toContain('Final score')
	}, 120_000)
})
