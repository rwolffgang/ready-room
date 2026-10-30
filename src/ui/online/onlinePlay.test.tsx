// Online play through the real store: the controller (src/ui/online/
// controller.ts) drives `projected` / `legal` / `pendingChoice` from the seat
// view of the real game service (server/games.ts, in-process), sends intents
// with the view's version, recovers from a stale version, and an invite link
// opens its game (or, while it waits for its guest, the answer screen) and
// leaves the address bar clean.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { GameError, GameService } from '../../../server/games'
import { nextAutoIntent } from '../../bot/autoPlay'
import type { GameState } from '../../engine/state'
import type {
	CreateGameResponse,
	OnlineGameClient,
	SeatCredentials,
} from '../../session/online'
import { OnlineError, inviteLink } from '../../session/online'
import { loadBrowserCatalog } from '../browserCatalog'
import { useGameStore } from '../store'
import { setOnlineClientFactory } from './controller'
import { OnlineLobby } from './OnlineLobby'
import { loadSeats, removeSeat } from './seats'

const catalog = loadBrowserCatalog()
let dir: string
let service: GameService
let game: CreateGameResponse
let seats: [SeatCredentials, SeatCredentials]

/** Service refusals as the HTTP client reports them (OnlineError). */
function wire<A extends unknown[], R>(
	f: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
	return (...args) =>
		f(...args).catch((err: unknown) => {
			if (err instanceof GameError)
				throw new OnlineError(
					err.status,
					err.code,
					err.message,
					typeof err.extra['version'] === 'number'
						? err.extra['version']
						: undefined,
				)
			throw err
		})
}

/** The client the controller uses, calling the service without HTTP (jsdom
 *  has no EventSource, so the controller fetches instead of streaming). */
function fakeClient(): OnlineGameClient {
	return {
		getView: wire((c: SeatCredentials) => service.view(c.gameId, c.token)),
		submitIntent: wire((c: SeatCredentials, intent: unknown, version: number) =>
			service.submit(c.gameId, c.token, { intent, version }),
		),
		undo: wire((c: SeatCredentials, version: number) =>
			service.undo(c.gameId, c.token, { version }),
		),
		setStandingOrder: wire(
			(c: SeatCredentials, cardDef: string, policy: string) =>
				service.setOrder(c.gameId, c.token, { cardDef, policy }),
		),
		getRecap: wire((c: SeatCredentials) => service.recap(c.gameId, c.token)),
		getLobby: wire((c: SeatCredentials) => service.lobby(c.gameId, c.token)),
		joinGame: wire(async (c: SeatCredentials, req: unknown) => {
			const res = await service.join(c.gameId, c.token, req)
			return { seat: { gameId: c.gameId, token: res.token }, view: res.view }
		}),
	} as unknown as OnlineGameClient
}

async function settle(): Promise<void> {
	await act(async () => {
		for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
	})
}

async function until(pred: () => boolean): Promise<void> {
	for (let i = 0; i < 50 && !pred(); i++) await settle()
	expect(pred()).toBe(true)
}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'cc-online-play-'))
	service = await GameService.open({
		dir,
		catalog,
		randomSeed: () => 17,
		deadlineCheckMs: 0,
		heartbeatMs: 0,
	})
	game = await service.create({
		players: [
			{ deck: 'KOL', boardSide: 'BASIC' },
			{ deck: 'SIS', boardSide: 'BASIC' },
		],
	})
	seats = [
		{ gameId: game.gameId, token: game.tokens[0] },
		{ gameId: game.gameId, token: game.tokens[1] },
	]
	setOnlineClientFactory(fakeClient)
	useGameStore.getState().loadCatalog()
})

afterEach(() => {
	useGameStore.getState().newGame()
})

afterAll(() => {
	setOnlineClientFactory(null)
	service.close()
	rmSync(dir, { recursive: true, force: true })
})

describe('online play through the store', () => {
	it('fills the store from the seat view and plays with the view’s legal intents', async () => {
		// seed 17: SIS (seat 2) opens
		useGameStore.getState().openOnline(seats[1])
		await until(() => useGameStore.getState().online?.view != null)
		const s = useGameStore.getState()
		expect(s.state).toBeNull()
		expect(s.session).toBeNull()
		expect(s.viewerSeat).toBe(1)
		expect(s.projected).toBe(s.online!.view!.state)
		expect(s.legal).toEqual(s.online!.view!.legalIntents)
		expect(s.legal.length).toBeGreaterThan(0)

		const before = s.online!.view!.version
		const intent = nextAutoIntent(s.projected as unknown as GameState, s.legal)!
		useGameStore.getState().dispatch(intent)
		await until(
			() => (useGameStore.getState().online?.view?.version ?? 0) > before,
		)
		expect(useGameStore.getState().online!.busy).toBe(false)
	})

	it('recovers from a stale version: warns and shows the latest view', async () => {
		useGameStore.getState().openOnline(seats[1])
		await until(() => useGameStore.getState().online?.view != null)
		const mine = useGameStore.getState().online!.view!
		// the same seat moves from another device meanwhile
		const other = await service.view(game.gameId, seats[1].token)
		await service.submit(game.gameId, seats[1].token, {
			intent: nextAutoIntent(
				other.state as unknown as GameState,
				other.legalIntents,
			),
			version: other.version,
		})
		useGameStore
			.getState()
			.dispatch(
				nextAutoIntent(mine.state as unknown as GameState, mine.legalIntents)!,
			)
		await until(() => useGameStore.getState().warning !== null)
		await until(
			() => (useGameStore.getState().online?.view?.version ?? 0) > mine.version,
		)
		expect(useGameStore.getState().error).toBeNull()
	})

	it('leaves online play on newGame', async () => {
		useGameStore.getState().openOnline(seats[0])
		await until(() => useGameStore.getState().online?.view != null)
		useGameStore.getState().newGame()
		const s = useGameStore.getState()
		expect(s.online).toBeNull()
		expect(s.projected).toBeNull()
	})
})

describe('invite links', () => {
	it('open their game, remember the seat and drop the token from the URL', async () => {
		for (const s of loadSeats()) removeSeat(s.token)
		const link = inviteLink(`${location.origin}${location.pathname}`, seats[0])
		window.history.replaceState(null, '', link)
		expect(location.hash).toContain('join=')
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		await act(async () => {
			root.render(<OnlineLobby route="join" />)
		})
		await until(() => useGameStore.getState().online !== null)
		expect(useGameStore.getState().online!.creds).toEqual(seats[0])
		expect(location.hash).toBe('')
		expect(location.href).not.toContain(seats[0].token)
		expect(loadSeats().map((s) => s.token)).toContain(seats[0].token)
		await act(async () => root.unmount())
		host.remove()
	})

	it('answer an open hail: the guest picks a captain and moves first', async () => {
		for (const s of loadSeats()) removeSeat(s.token)
		const created = await service.create({
			host: { deck: 'PIC', boardSide: 'BASIC', name: 'Rob' },
		})
		const invite = { gameId: created.gameId, token: created.tokens[1] }
		const link = inviteLink(`${location.origin}${location.pathname}`, invite)
		window.history.replaceState(null, '', link)
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		await act(async () => {
			root.render(<OnlineLobby route="join" />)
		})
		await until(() => host.textContent?.includes('Incoming hail') === true)
		expect(host.textContent).toContain('Rob')
		// the host's crew is not on offer
		const select = host.querySelector<HTMLSelectElement>('#ol-guest-deck')!
		const offered = [...select.options].map((o) => o.value)
		expect(offered).not.toContain('PIC')
		expect(offered).toContain('SIS')
		await act(async () => {
			select.value = 'SIS'
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		await act(async () => {
			host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
		})
		await until(() => useGameStore.getState().online?.view != null)
		const online = useGameStore.getState().online!
		expect(online.creds.gameId).toBe(created.gameId)
		expect(online.creds.token).not.toBe(invite.token) // retired on joining
		expect(online.view!.yourMove).toBe(true)
		expect(online.view!.players.map((p) => p.deck)).toEqual(['PIC', 'SIS'])
		expect(location.href).not.toContain(invite.token)
		expect(loadSeats().map((s) => s.token)).toEqual([online.creds.token])
		await act(async () => root.unmount())
		host.remove()
	})
})
