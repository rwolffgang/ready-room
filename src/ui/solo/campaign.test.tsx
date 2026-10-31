// The Five-Year Mission in the app (rules/14): begin a campaign from the setup
// screen, start its first game from the logbook, finish it, log the result
// from the end screen, take the upgrade, and reach the second game — with the
// campaign stored beside the saves.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { autoPlay } from '../../bot/autoPlay'
import { setup } from '../../engine/setup'
import App from '../App'
import { stopBots, useGameStore } from '../store'
import { getSessionStore, resetSessionStoreForTests } from '../persistence'
import { resetShellChoiceCache } from '../mobile/shell'
import { nextStep } from '../../session/campaign'

vi.setConfig({ testTimeout: 30_000 })

const store = () => useGameStore.getState()

const flush = () =>
	act(async () => {
		for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
	})

const button = (host: HTMLElement, text: RegExp) =>
	[...host.querySelectorAll('button')].find((b) =>
		text.test(b.textContent ?? ''),
	)

let root: Root | null = null

beforeEach(() => {
	document.body.innerHTML = ''
	localStorage.clear()
	resetSessionStoreForTests()
	store().newGame()
	store().openCampaign(null)
})

afterEach(() => {
	act(() => root?.unmount())
	root = null
	stopBots()
	store().newGame()
	store().openCampaign(null)
	resetShellChoiceCache()
})

describe('a Five-Year Mission', () => {
	it('runs from the setup screen through a game and its upgrade to the next game', async () => {
		act(() => store().loadCatalog())
		const host = document.createElement('div')
		document.body.appendChild(host)
		root = createRoot(host)
		act(() => root!.render(<App />))
		await flush()

		// open the mode on the start screen's rail, begin with Player 1's captain
		act(() => button(host, /^03Five-Year Mission$/)!.click())
		await flush()
		const begin = button(host, /Begin a Five-Year Mission/)
		expect(begin).toBeDefined()
		act(() => begin!.click())
		await flush()
		const [campaign] = await getSessionStore().listCampaigns()
		expect(campaign).toBeDefined()
		expect(store().campaignOpen).toBe(campaign!.id)
		expect(host.textContent).toContain('Ensign')
		expect(host.textContent).toContain('Game 1')

		// start game 1 against a chosen Bot
		const pick = host.querySelector<HTMLSelectElement>(
			'select[aria-label="The Bot’s crew"]',
		)!
		const vs = [...pick.options]
			.map((o) => o.value)
			.find((v) => v !== 'RANDOM')!
		act(() => {
			pick.value = vs
			pick.dispatchEvent(new Event('change', { bubbles: true }))
		})
		act(() => button(host, /Start game 1/)!.click())
		await flush()
		const session = store().session!
		expect(session.campaignId).toBe(campaign!.id)
		expect(store().state?.mode).toBe('SOLO')
		expect(store().state?.solo?.crew).toBe(vs)
		let c = (await getSessionStore().loadCampaign(campaign!.id))!
		expect(nextStep(c)).toBe('PLAY')
		expect(c.games[0]!.sessionId).toBe(session.id)

		// play it to the end (first-legal) and land on the end screen
		const played = autoPlay(setup(session.setup, store().catalog!))
		expect(played.stopped).toBe('GAME_OVER')
		act(() => store().resumeGame({ ...session, log: played.intents }))
		await flush()
		expect(host.querySelector('.end-screen')).not.toBeNull()
		c = (await getSessionStore().loadCampaign(campaign!.id))!
		expect(c.games[0]!.won).toBeDefined()
		expect(nextStep(c)).toBe('UPGRADE')

		// back to the logbook: take the offered upgrade (or none)
		act(() => button(host, /To the logbook/)!.click())
		await flush()
		expect(store().state).toBeNull()
		expect(host.textContent).toContain('upgrade your deck')
		act(() => button(host, /Take this upgrade|Continue/)!.click())
		await flush()
		c = (await getSessionStore().loadCampaign(campaign!.id))!
		expect(c.games[0]!.upgrade).toBeDefined()
		expect(nextStep(c)).toBe('NEXT_GAME')
		expect(host.textContent).toContain('Start game 2')
		// a beaten crew is never offered again
		const next = host.querySelector<HTMLSelectElement>(
			'select[aria-label="The Bot’s crew"]',
		)!
		const offered = [...next.options].map((o) => o.value)
		expect(offered.includes(vs)).toBe(c.games[0]!.won !== true)
	})
})
