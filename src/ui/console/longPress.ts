// Long press to read a card on a touch screen (docs/ui-lcars.md §4.2). An
// iPad has no Option key, so a finger held on a card for half a second lifts
// it into the same zoom overlay Option-hover does (CardZoom), until the finger
// lifts. Moving the finger first is a scroll, not a press; the tap that ends a
// long press is swallowed, so reading a card never also opens or plays it.
// A mouse never long-presses: a right click opens the same zoom instead, and
// it stays open until a click or Esc closes it (CardZoom).

import type {
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from 'react'
import type { CardInstanceId } from '../../engine/ids'
import { useGameStore } from '../store'

export const HOLD_MS = 450
const SLOP_PX = 8

// one finger, one press at a time
let pending: { timer: number; x: number; y: number } | null = null
let fired = false

function cancel() {
	if (pending !== null) window.clearTimeout(pending.timer)
	pending = null
}

function release() {
	cancel()
	const { zoomIid, zoomPinned, setZoomIid } = useGameStore.getState()
	if (zoomIid !== null && !zoomPinned) setZoomIid(null)
}

export interface LongPressHandlers {
	onPointerDown: (e: ReactPointerEvent) => void
	onPointerMove: (e: ReactPointerEvent) => void
	onPointerUp: () => void
	onPointerCancel: () => void
	onClickCapture: (e: ReactMouseEvent) => void
	onContextMenu: (e: ReactMouseEvent) => void
}

export function longPress(iid: CardInstanceId): LongPressHandlers {
	return {
		onPointerDown: (e) => {
			cancel()
			fired = false
			if (e.pointerType === 'mouse') return
			pending = {
				x: e.clientX,
				y: e.clientY,
				timer: window.setTimeout(() => {
					pending = null
					fired = true
					useGameStore.getState().setZoomIid(iid)
				}, HOLD_MS),
			}
		},
		onPointerMove: (e) => {
			if (pending === null) return
			if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP_PX)
				cancel()
		},
		onPointerUp: release,
		onPointerCancel: release,
		onClickCapture: (e) => {
			if (!fired) return
			fired = false
			e.stopPropagation()
			e.preventDefault()
		},
		// a right click, or the browser's own long-press menu
		onContextMenu: (e) => {
			e.preventDefault()
			if (fired || pending !== null) return
			useGameStore.getState().setZoomIid(iid, true)
		},
	}
}
