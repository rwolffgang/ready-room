// Online screens against the real game service (server/games.ts) run
// in-process: a KOL-vs-SIS game is played a few moves by both seats, then
// the Hails inbox and "Previously on…" render what the server returns — with
// no raw card ids and nothing hidden leaking into the page.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest'

import { GameService } from '../../../server/games'
import type { CardDef } from '../../data/schema'
import type { GameState } from '../../engine/state'
import { nextAutoIntent } from '../../bot/autoPlay'
import type {
	CreateGameResponse,
	GameView,
	OnlineGameClient,
	SeatCredentials,
} from '../../session/online'
import { loadBrowserCatalog } from '../browserCatalog'
import { Hails, timeLeft } from './Hails'
import { reactionCards } from './Orders'
import { SeatLink } from './SeatLink'
import { parseInvite } from '../../session/online'
import { RecapView, humanize } from './Recap'
import {
	addSeat,
	appUrl,
	loadSeats,
	removeSeat,
	serverUrl,
	setServerUrl,
} from './seats'
import { cardName } from '../../data/cardNames'

const catalog = loadBrowserCatalog()
const defs = new Map<string, CardDef>(catalog.defs.map((d) => [d.id, d]))
let dir: string
let service: GameService
let game: CreateGameResponse
let seats: [SeatCredentials, SeatCredentials]

async function viewOf(seat: 0 | 1): Promise<GameView> {
	return service.view(game.gameId, seats[seat].token)
}

/** The seat that must decide now submits its first auto intent. */
async function step(): Promise<void> {
	const v0 = await viewOf(0)
	const view = v0.toMove === 0 ? v0 : await viewOf(1)
	const intent = nextAutoIntent(
		view.state as unknown as GameState,
		view.legalIntents,
	)
	if (intent === undefined) throw new Error('no legal intent')
	await service.submit(game.gameId, seats[view.seat].token, {
		intent,
		version: view.version,
	})
}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'cc-online-ui-'))
	service = await GameService.open({
		dir,
		catalog,
		randomSeed: () => 17,
		deadlineCheckMs: 0,
		heartbeatMs: 0,
	})
	game = await service.create({
		players: [
			{ deck: 'KOL', boardSide: 'BASIC', name: 'Ana' },
			{ deck: 'SIS', boardSide: 'BASIC', name: 'Ben' },
		],
	})
	seats = [
		{ gameId: game.gameId, token: game.tokens[0] },
		{ gameId: game.gameId, token: game.tokens[1] },
	]
	// SIS opens (seed 17): play into KOL's first turn and a bit beyond
	for (let i = 0; i < 40; i++) await step()
})

afterAll(() => {
	service.close()
	rmSync(dir, { recursive: true, force: true })
})

let root: Root | null = null
let host: HTMLElement
beforeEach(() => {
	root?.unmount()
	host = document.createElement('div')
	document.body.innerHTML = ''
	document.body.appendChild(host)
	root = createRoot(host)
})

async function render(el: ReactElement): Promise<void> {
	await act(async () => {
		root!.render(el)
	})
	// let effects' promises settle
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0))
	})
}

const noop = () => {}

describe('Hails', () => {
	it('lists the game under whose move it is, with both captains and the score', async () => {
		const client = {
			listGames: (s: SeatCredentials[]) => service.summaries({ games: s }),
		} as unknown as OnlineGameClient
		const stored = seats.map((s) => ({
			...s,
			addedAt: new Date().toISOString(),
		}))
		await render(
			<Hails
				client={client}
				seats={[stored[0]!]}
				onOpen={noop}
				onNew={noop}
				onJoin={noop}
				onForget={noop}
				server="http://test"
				onServer={noop}
			/>,
		)
		// the inbox loads asynchronously; under a busy suite give it time
		for (let i = 0; i < 100 && host.querySelector('.ol-game') === null; i++)
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10))
			})
		const text = host.textContent ?? ''
		expect(text).toMatch(/Your move|Their move|Needs an answer/)
		expect(text).toContain('vs')
		expect(text).toContain('VP')
		expect(host.querySelector('.ol-game')).not.toBeNull()
	})
})

describe('Hails with both seats of one game on this device', () => {
	it('opens the seat of the row that was tapped', async () => {
		const client = {
			listGames: (s: SeatCredentials[]) => service.summaries({ games: s }),
		} as unknown as OnlineGameClient
		const stored = seats.map((s) => ({
			...s,
			addedAt: new Date().toISOString(),
		}))
		const opened: string[] = []
		await render(
			<Hails
				client={client}
				seats={stored}
				onOpen={(seat) => opened.push(seat.token)}
				onNew={noop}
				onJoin={noop}
				onForget={noop}
				server="http://test"
				onServer={noop}
			/>,
		)
		for (
			let i = 0;
			i < 100 && host.querySelectorAll('.ol-game').length < 2;
			i++
		)
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10))
			})
		const rows = [...host.querySelectorAll<HTMLButtonElement>('button.ol-game')]
		expect(rows).toHaveLength(2)
		const waiting = await viewOf(0)
		// the row under "Your move" belongs to whichever seat is to move
		const yours = host.querySelector<HTMLButtonElement>('button.ol-you')!
		await act(async () => yours.click())
		expect(opened).toEqual([seats[waiting.toMove === 0 ? 0 : 1].token])
	})
})

describe('Previously on…', () => {
	it('renders the recap without raw card ids and with the four deltas', async () => {
		const view = await viewOf(0)
		const recap = await service.recap(game.gameId, seats[0].token)
		expect(recap.entries.length).toBeGreaterThan(0)
		await render(
			<RecapView
				recap={recap}
				names={['Ana', 'Ben']}
				defs={defs}
				defOfIid={(iid) => view.state.cards[iid]?.def ?? null}
				onContinue={noop}
			/>,
		)
		const text = host.textContent ?? ''
		expect(text).toContain('Previously on…')
		expect(host.querySelectorAll('.ol-deltas > div')).toHaveLength(4)
		expect(host.querySelectorAll('.ol-ev').length).toBeGreaterThan(0)
		// no engine ids ("p0#0042", "hidden:HAND:1:3") reach the page
		expect(text).not.toMatch(/[a-z][a-z0-9]*#\d+/i)
		expect(text).not.toMatch(/hidden:/)
	})

	it('humanizes log lines: known cards by name, hidden ones as such', () => {
		const known = catalog.defs.find((d) => d.id === '1SIS10-25')!
		const line = humanize(
			'warped p1#0007 to hidden',
			(iid) => (iid === 'p1#0007' ? known.id : null),
			defs,
		)
		expect(line).toBe(`warped ${cardName(known)} to a hidden card`)
	})
})

describe('standing orders', () => {
	it('offers only your own visible reaction cards, once each', async () => {
		const view = await viewOf(1)
		const fake = {
			...view,
			state: {
				...view.state,
				cards: {
					a: {
						...Object.values(view.state.cards)[0]!,
						iid: 'a',
						owner: 1,
						def: '1SIS10-25',
					},
					b: {
						...Object.values(view.state.cards)[0]!,
						iid: 'b',
						owner: 1,
						def: '1SIS10-25',
					},
					c: {
						...Object.values(view.state.cards)[0]!,
						iid: 'c',
						owner: 0,
						def: '1SIS10-25',
					},
				},
			},
		} as unknown as GameView
		expect(reactionCards(fake, defs).map((d) => d.id)).toEqual(['1SIS10-25'])
	})
})

describe('seats on this device', () => {
	it('keeps, dedupes and forgets seats', () => {
		for (const s of loadSeats()) removeSeat(s.token)
		addSeat({ gameId: 'g1', token: 't1' })
		addSeat({ gameId: 'g2', token: 't2' })
		addSeat({ gameId: 'g1', token: 't1' })
		expect(loadSeats().map((s) => s.token)).toEqual(['t1', 't2'])
		removeSeat('t2')
		expect(loadSeats().map((s) => s.token)).toEqual(['t1'])
	})

	it('talks to port 8787 on the app host unless a server is set', () => {
		setServerUrl(null)
		expect(serverUrl()).toBe(`${location.protocol}//${location.hostname}:8787`)
		setServerUrl('https://bridge.example/')
		expect(serverUrl()).toBe('https://bridge.example')
		setServerUrl(null)
	})

	it("defaults to the build's hosted game (desktop) for server and invites", () => {
		vi.stubEnv('VITE_PUBLIC_URL', 'https://hosted.example/')
		try {
			setServerUrl(null)
			expect(serverUrl()).toBe('https://hosted.example')
			expect(appUrl()).toBe('https://hosted.example/')
			setServerUrl('https://bridge.example')
			expect(serverUrl()).toBe('https://bridge.example')
			expect(appUrl()).toBe('https://bridge.example/')
		} finally {
			setServerUrl(null)
			vi.unstubAllEnvs()
		}
	})

	it('reports the time left on a deadline', () => {
		const now = Date.parse('2026-09-28T10:00:00Z')
		expect(timeLeft('2026-09-28T21:30:00Z', now)).toBe('11 h left')
		expect(timeLeft('2026-09-28T10:20:00Z', now)).toBe('20 min left')
		expect(timeLeft('2026-09-28T09:00:00Z', now)).toBe('deadline passed')
	})
})

describe('seat link', () => {
	it('copies a link that opens this seat', async () => {
		const copied: string[] = []
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (t: string) => void copied.push(t) },
		})
		await render(<SeatLink creds={seats[0]} />)
		const button = host.querySelector('button')!
		expect(button.textContent).toBe('Copy my seat link')
		await act(async () => button.click())
		expect(copied).toHaveLength(1)
		expect(parseInvite(copied[0]!)).toEqual(seats[0])
		expect(button.textContent).toBe('Seat link copied')
	})

	it('shows the link to copy by hand when the clipboard refuses', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: () => Promise.reject(new Error('denied')),
			},
		})
		await render(<SeatLink creds={seats[1]} />)
		await act(async () => host.querySelector('button')!.click())
		const field = host.querySelector('input')!
		expect(parseInvite(field.value)).toEqual(seats[1])
	})
})
