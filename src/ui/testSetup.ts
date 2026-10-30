// Setup for the `dom` test project (vitest.config.ts).
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, vi } from 'vitest'

// React's act() warns unless the test environment says it is one.
;(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Unmount every root a test created once it ends. A root left mounted stays
// subscribed to the shared game store, so the next test's store changes would
// re-render it outside act().
const mounted = vi.hoisted(() => new Set<Root>())

vi.mock('react-dom/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('react-dom/client')>()
	return {
		...actual,
		createRoot: (...args: Parameters<typeof actual.createRoot>) => {
			const root = actual.createRoot(...args)
			mounted.add(root)
			return root
		},
	}
})

afterEach(() => {
	act(() => {
		for (const root of mounted) root.unmount()
	})
	mounted.clear()
})
