// The console's keyboard shortcuts (docs/ui-lcars.md §4.2) share one guard:
// a bare key only — no Cmd/Ctrl/Option, no auto-repeat — and never while the
// player is typing in a field. Esc is a stack: it closes the topmost open
// layer (menu, log drawer, viewscreen, Neutral Zone close-up, move history)
// and nothing under it.

import { useEffect, useRef } from 'react'

/** True for an element that takes text — a shortcut must not fire there. */
export function isTypingTarget(t: EventTarget | null): boolean {
	if (!(t instanceof HTMLElement)) return false
	return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
}

/** Run `fn` when the bare `key` (a letter, either case) is pressed. */
export function useShortcut(key: string, fn: () => void, enabled = true) {
	const latest = useRef(fn)
	useEffect(() => {
		latest.current = fn
	})
	useEffect(() => {
		if (!enabled) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== key) return
			if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
			if (isTypingTarget(e.target)) return
			latest.current()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [key, enabled])
}

// Open layers, oldest first; Esc closes the last one.
const escStack: (() => void)[] = []

function onEscape(e: KeyboardEvent) {
	if (e.key !== 'Escape' || e.repeat) return
	const top = escStack[escStack.length - 1]
	if (top === undefined) return
	e.preventDefault()
	top()
}

/** While `open`, Esc calls `close` — unless a layer opened later is on top. */
export function useEscape(open: boolean, close: () => void) {
	const latest = useRef(close)
	useEffect(() => {
		latest.current = close
	})
	useEffect(() => {
		if (!open) return
		const entry = () => latest.current()
		if (escStack.length === 0) window.addEventListener('keydown', onEscape)
		escStack.push(entry)
		return () => {
			const i = escStack.lastIndexOf(entry)
			if (i >= 0) escStack.splice(i, 1)
			if (escStack.length === 0) window.removeEventListener('keydown', onEscape)
		}
	}, [open])
}
