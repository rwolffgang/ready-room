// Error-handling tests (todo/17 §5): an engine/render throw shows the
// recoverable error screen with a copyable session — never a white page — and
// a malformed card (data that slipped past validation) renders as a text-only
// card with a warning badge instead of crashing the game.

import { describe, expect, it, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import type { SetupConfig } from '../engine/setup'
import type { CardDef } from '../data/schema'
import App from './App'
import { useGameStore } from './store'
import { RecoverableErrorBoundary } from './errorScreen'
import { CardFace } from './cards'
import { loadBrowserCatalog } from './browserCatalog'
import { cardName } from '../data/cardNames'

const catalog = loadBrowserCatalog()

function config(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 7,
	}
}

/** A render-crashing component (stands in for an engine throw mid-render). */
function Boom(): never {
	throw new Error('engine boom')
}

async function render(node: ReactNode): Promise<HTMLElement> {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	await act(async () => {
		root.render(node)
	})
	return host
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('recoverable error boundary', () => {
	it('catches a render throw and shows the recoverable screen (not a blank page)', async () => {
		const host = await render(
			<RecoverableErrorBoundary>
				<Boom />
			</RecoverableErrorBoundary>,
		)
		const text = host.textContent ?? ''
		expect(text).toContain('hit an error')
		expect(text).toContain('engine boom')
		expect(text).toContain('Back to setup')
		expect(host.querySelector('.error-screen')).not.toBeNull()
	})

	it('the recoverable screen carries the live session log + a copy button', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		expect(useGameStore.getState().session).not.toBeNull()
		const host = await render(
			<RecoverableErrorBoundary>
				<Boom />
			</RecoverableErrorBoundary>,
		)
		const text = host.textContent ?? ''
		expect(text).toContain('Copy session')
		expect(text).toContain('Download .json')
		expect(text).toContain('intent')
		expect(text).toContain(useGameStore.getState().session!.id)
		expect(host.querySelector('.error-screen')).not.toBeNull()
	})

	it('Back to setup returns to the setup screen without a white page', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = await render(
			<RecoverableErrorBoundary>
				<Boom />
			</RecoverableErrorBoundary>,
		)
		const back = [...host.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Back to setup'),
		)
		expect(back).toBeDefined()
		act(() => back!.click())
		expect(useGameStore.getState().state).toBeNull() // session torn down → setup screen state
	})

	it('the app shell itself keeps its outer boundary (main.tsx safety net)', async () => {
		// <App/> mounts the let-adapter behind GameFlow; without a game the setup
		// screen renders. This guards the wiring path (the boundary is added around
		// <App/> in main.tsx and around the board in App.tsx).
		act(() => useGameStore.getState().loadCatalog())
		const host = await render(<App />)
		expect(host.textContent ?? '').toContain('Ready Room')
	})
})

describe('malformed card fallback', () => {
	const malformed = {
		id: 'x-malformed-1',
		cardId: '',
		name: 'Broken Relay',
		suit: 'CARGO',
		deck: 'COMMON',
		traits: ['FAULTY'],
		skills: [],
		variableSkill: undefined,
		focus: null,
		vp: 0,
		vpAsterisk: false,
		startPosition: null,
		developmentCost: null,
		operations: [
			// A SEQ with a broken `steps` — describeOperation throws on it.
			{
				type: 'GENERIC',
				costsAction: false,
				isAttack: false,
				text: 'broken',
				effect: { k: 'SEQ', steps: null },
			} as unknown as CardDef['operations'][number],
		],
	} as unknown as CardDef

	it('renders a text-only card with a warning badge instead of crashing', async () => {
		const host = await render(<CardFace def={malformed} size="hand" />)
		const text = host.textContent ?? ''
		expect(text).toContain('Broken Relay')
		expect(text).toContain('malformed')
		expect(host.querySelector('.malformed-badge')).not.toBeNull()
		// The broken op description is surfaced as text, not a crash.
		expect(text).toContain('unreadable operation')
	})

	it('healthy cards keep rendering normally through the same path', async () => {
		const def = catalog.defs.find((d) => d.deck === 'PIC') ?? catalog.defs[0]!
		// Sprites are the default face now; use the Details view so this stays a
		// deterministic text-path assertion (jsdom has no real image loading).
		useGameStore.getState().setShowCardDetails(true)
		const host = await render(<CardFace def={def} size="board" />)
		expect(host.textContent ?? '').toContain(cardName(def))
		expect(host.querySelector('.malformed-badge')).toBeNull()
	})
})
