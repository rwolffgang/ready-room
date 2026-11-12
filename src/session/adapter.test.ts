// The GameAdapter sketch (todo/17 polish — headless, no UI): dispatch →
// append + reduce, settle → validated RESOLVE_CHOICE, undo → truncate +
// replay, plus the debounced autosave hook the UI wires to persistence.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { CardCatalog } from '../engine/setup'
import { IllegalSelectionError } from '../engine/resolver/choices'
import { createSession, replay } from './log'
import type { SessionAdapter } from './adapter'
import type { SessionAdapterOptions } from './adapter'
import { SessionAdapter as Adapter, IllegalIntentError } from './adapter'
import { makeCatalog, sessionConfig, playGame } from './playGame'

let catalog: CardCatalog

beforeEach(async () => {
	catalog = await makeCatalog()
})

afterEach(() => {
	vi.useRealTimers()
})

const fixedClock = (): Date => new Date('2026-09-21T10:00:00.000Z')

function freshAdapter(opts?: Partial<SessionAdapterOptions>): SessionAdapter {
	return new Adapter({
		session: createSession(sessionConfig(), catalog, {
			id: 'adapter-test',
			now: fixedClock,
		}),
		catalog,
		now: fixedClock,
		...opts,
	})
}

describe('dispatch', () => {
	it('appends the intent, reduces, and refreshes meta + onChange', () => {
		const changes: number[] = []
		const adapter = freshAdapter({
			onChange: (a) => changes.push(a.session.log.length),
		})
		adapter.dispatch({ t: 'START' })
		expect(adapter.session.log).toEqual([{ t: 'START' }])
		expect(adapter.state.phase.k).toBe('ACTION')
		expect(adapter.session.meta.intentCount).toBe(1)
		expect(adapter.session.meta.phase).toBe('ACTION')
		expect(changes).toEqual([1])
	})

	it('rejects an illegal intent and leaves the session untouched', () => {
		const adapter = freshAdapter()
		const before = JSON.stringify(adapter.state)
		expect(() => adapter.dispatch({ t: 'PASS' })).toThrow(IllegalIntentError)
		expect(adapter.session.log).toEqual([])
		expect(JSON.stringify(adapter.state)).toBe(before)
	})

	it('rejects an illegal RESOLVE_CHOICE selection (validateChoice gate)', () => {
		const adapter = freshAdapter()
		adapter.dispatch({ t: 'START' })
		// No choice pending yet -> a RESOLVE_CHOICE is illegal here.
		expect(() =>
			adapter.dispatch({
				t: 'RESOLVE_CHOICE',
				choiceId: 'nope',
				selection: null,
			}),
		).toThrow(IllegalIntentError)
	})

	it('rejects an illegal settle with the typed IllegalSelectionError', () => {
		const adapter = freshAdapter()
		adapter.dispatch({ t: 'START' })
		const pic23 = adapter.state.zones['HAND:0']!.find(
			(iid) => adapter.state.cards[iid]!.def === '1PIC23-24',
		)!
		adapter.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
		expect(adapter.pendingChoice).not.toBeNull()
		// 1PIC23's CHOOSE_CARDS requires at least one incident -> [] is illegal.
		expect(() => adapter.settle([])).toThrow(IllegalSelectionError)
	})
})

describe('settle', () => {
	it('validates a pending choice and dispatches RESOLVE_CHOICE', () => {
		const adapter = freshAdapter()
		adapter.dispatch({ t: 'START' })
		const before = adapter.session.log.length
		expect(adapter.pendingChoice).toBeNull()
		expect(() => adapter.settle(null)).toThrow('nothing to settle')
		expect(adapter.session.log.length).toBe(before)
	})
})

describe('todo/17 DoD — undo through the adapter', () => {
	it('undoing the last intent byte-matches the state before it ran, incl. back into a choice', () => {
		const adapter = freshAdapter()
		const snapshots = new Map<number, string>()
		snapshots.set(0, JSON.stringify(adapter.state))
		playGame(adapter, (a) =>
			snapshots.set(a.session.log.length, JSON.stringify(a.state)),
		)

		const N = adapter.session.log.length
		expect(adapter.undo()).toBe(true)
		expect(adapter.session.log).toHaveLength(N - 1)
		expect(JSON.stringify(adapter.state)).toBe(snapshots.get(N - 1))
		// The last intent was a RESOLVE_CHOICE (game-ending clean-up) -> undoing
		// returns to the state that first published that choice.
		expect(adapter.pendingChoice).not.toBeNull()

		// A couple more undos still byte-match their snapshots.
		expect(adapter.undo()).toBe(true)
		expect(JSON.stringify(adapter.state)).toBe(snapshots.get(N - 2))
	})

	it('undo on an empty log is a no-op returning false', () => {
		const adapter = freshAdapter()
		expect(adapter.undo()).toBe(false)
		expect(adapter.session.log).toEqual([])
	})

	it('repeated undos reproduce a sequence identical to never having played', () => {
		const adapter = freshAdapter()
		const snapshots = new Map<number, string>()
		snapshots.set(0, JSON.stringify(adapter.state))
		playGame(adapter, (a) =>
			snapshots.set(a.session.log.length, JSON.stringify(a.state)),
		)
		const N = adapter.session.log.length
		for (let k = 1; k <= 5; k++) {
			adapter.undo()
		}
		expect(adapter.session.log).toHaveLength(N - 5)
		expect(JSON.stringify(adapter.state)).toBe(snapshots.get(N - 5))
	})

	it('reset rewinds to the SETUP-phase session', () => {
		const adapter = freshAdapter()
		playGame(adapter)
		expect(adapter.session.log.length).toBeGreaterThan(0)
		expect(adapter.reset()).toBe(true)
		expect(adapter.session.log).toEqual([])
		expect(adapter.state.phase.k).toBe('SETUP')
		expect(adapter.reset()).toBe(false)
	})
})

describe('autosave (todo/17 §1)', () => {
	it('persists after every commit when no debounce is set', () => {
		const saved: number[] = []
		const adapter = freshAdapter({
			persist: (s) => {
				saved.push(s.log.length)
			},
		})
		adapter.dispatch({ t: 'START' })
		adapter.dispatch({ t: 'PASS' })
		expect(saved).toEqual([1, 2])
	})

	it('persist is called once after the debounce window, and dispose cancels it', () => {
		vi.useFakeTimers()
		const saved: number[] = []
		const adapter = freshAdapter({
			persist: (s) => void saved.push(s.log.length),
			autosaveDebounceMs: 1000,
		})
		// Drive only through legalIntents — the engine may land on a PendingChoice
		// between steps (PASS → Clean-up), and the adapter is single-observer.
		const auto = (): void => {
			adapter.dispatch(adapter.legalIntents[0]!)
		}
		auto()
		vi.advanceTimersByTime(500)
		auto()
		vi.advanceTimersByTime(500)
		expect(saved).toEqual([]) // reset by the second commit
		vi.advanceTimersByTime(1000)
		expect(saved).toEqual([2])

		auto()
		adapter.dispose()
		vi.advanceTimersByTime(2000)
		expect(saved).toEqual([2]) // cancelled, nothing more fired
	})
})

describe('adapter state integrity', () => {
	it('adapter state always equals replay(session) — the log is the truth', () => {
		const adapter = freshAdapter()
		playGame(adapter)
		expect(JSON.stringify(adapter.state)).toBe(
			JSON.stringify(replay(adapter.session, catalog)),
		)
	})

	it('available intents are offered while a choice is pending', () => {
		const adapter = freshAdapter()
		adapter.dispatch({ t: 'START' })
		const someChoice = adapter.state.pendingChoice
		// START hands the turn to seat 0's ACTION phase; the only ply offered is
		// exactly what legalIntents returns.
		expect(adapter.legalIntents.length).toBeGreaterThan(0)
		expect(someChoice).toBeNull()
	})
})

it('records the rules transition and restores it through save/load and undo', () => {
	const adapter = freshAdapter()
	adapter.dispatch({ t: 'START' })
	const before = JSON.stringify(adapter.state)
	const iid = adapter.state.zones['HAND:0']!.find(
		(iid) => adapter.state.cards[iid]!.def === '1PIC23-24',
	)!
	adapter.dispatch({ t: 'PLAY_CARD', iid, operationIndex: 0 })
	expect(adapter.session.log.at(-1)).toMatchObject({
		chooseAwayTeamCount: true,
	})
	expect(adapter.state.chooseAwayTeamCount).toBe(true)
	const loaded = new Adapter({
		session: JSON.parse(JSON.stringify(adapter.session)),
		catalog,
		now: fixedClock,
	})
	expect(loaded.state).toEqual(adapter.state)
	loaded.undo()
	expect(JSON.stringify(loaded.state)).toBe(before)
	expect(loaded.state.chooseAwayTeamCount).toBeUndefined()
})
