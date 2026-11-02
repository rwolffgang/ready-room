// The hand dock (docs/ui-lcars.md §4): your hand rests along the bottom edge
// with only the top strip of each card showing — the name band, enough to see
// what you hold and which cards are live (the rest stay dimmed, as in the
// raised hand) — so the board above it is never covered by default.
//
// It lifts to full size over the board when you point at it, when focus moves
// into it, or on a tap (the first tap on a lowered dock only lifts it). The
// end cap that closes the dock on the right pins it up and lets it drop
// again; the pin is kept per device. The dock's name on the left is the door
// to the hand close-up (H, Closeup.tsx), every card at once and large. On a screen tall enough (HAND_ROOM_QUERY)
// a pinned hand docks at full height in a row of its own and the board shrinks
// to fit above it, so it covers nothing; on a shorter one it lifts over the
// board and Esc lets it drop. Raising moves the cards straight up and never
// sideways, so the two clicks of a double-click (the store's timer in
// cardClicked) land on the same card.
//
// Your Draw and Discard sit at its left end, the decks on your side of the
// table.

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from 'react'
import { zoneKey } from '../../engine/state'
import type { Seat } from '../../engine/resolver/queries'
import { DeckPiles, Hand } from '../board'
import { useProjected } from '../store'
import { CloseupLabel } from './Closeup'
import { useConsoleUi } from './consoleUi'
import { useEscape } from './useShortcut'

/** Pointer dwell before the dock lifts, and grace before it drops — so a
 *  pointer crossing the bottom edge on its way somewhere does not flap it. */
const RAISE_MS = 140
const LOWER_MS = 260

/** Tall enough for the hand at full size below a board whose cards stay
 *  near their laptop size (console.css: --card-w with the docked --dock-h). */
export const HAND_ROOM_QUERY = '(min-height: 960px)'

function roomQuery(): MediaQueryList | null {
	try {
		return typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function'
			? window.matchMedia(HAND_ROOM_QUERY)
			: null
	} catch {
		return null
	}
}

function subscribeRoom(fn: () => void): () => void {
	const q = roomQuery()
	q?.addEventListener?.('change', fn)
	return () => q?.removeEventListener?.('change', fn)
}

/** True while a pinned hand has a row of its own (ConsoleShell sets the
 *  frame's `hand-docked` from this). */
export function useHandDocked(): boolean {
	const pinned = useConsoleUi((s) => s.handPinned)
	const room = useSyncExternalStore(
		subscribeRoom,
		() => roomQuery()?.matches ?? false,
	)
	return pinned && room
}

function inCap(t: EventTarget | null): boolean {
	return t instanceof Element && t.closest('.dock-cap') !== null
}

export function HandDock({ seat }: { seat: Seat }) {
	const projected = useProjected()
	const count = projected?.zones[zoneKey({ k: 'HAND', seat })]?.length ?? 0
	const pinned = useConsoleUi((s) => s.handPinned)
	const setPinned = useConsoleUi((s) => s.setHandPinned)
	const docked = useHandDocked()
	const [hovered, setHovered] = useState(false)
	const [focused, setFocused] = useState(false)
	const [tapped, setTapped] = useState(false)
	// the hand close-up shows these cards already: the dock stays down under
	// it, unless it has a row of its own
	const inCloseup = useConsoleUi((s) => s.closeup === 'hand')
	const raised =
		docked || (!inCloseup && (pinned || hovered || focused || tapped))
	const timer = useRef<number | null>(null)
	const dock = useRef<HTMLDivElement>(null)

	const clear = () => {
		if (timer.current !== null) window.clearTimeout(timer.current)
		timer.current = null
	}
	const later = (fn: () => void, ms: number) => {
		clear()
		timer.current = window.setTimeout(() => {
			timer.current = null
			fn()
		}, ms)
	}
	useEffect(() => clear, [])

	const toggle = () => {
		setTapped(false)
		// a drop shows at once, though the pointer is still on the cap
		if (pinned) {
			clear()
			setHovered(false)
		}
		setPinned(!pinned)
	}
	const drop = useCallback(() => {
		setPinned(false)
		setTapped(false)
	}, [setPinned])
	// a docked hand is part of the table, not a layer over it
	useEscape((pinned && !docked) || tapped, drop)

	// a tap outside lowers a dock a tap raised
	useEffect(() => {
		if (!tapped) return
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Node) || dock.current?.contains(e.target))
				return
			setTapped(false)
		}
		window.addEventListener('pointerdown', onDown)
		return () => window.removeEventListener('pointerdown', onDown)
	}, [tapped])

	const onEnter = (e: ReactPointerEvent) => {
		if (e.pointerType === 'touch') return
		later(() => setHovered(true), RAISE_MS)
	}
	const onLeave = (e: ReactPointerEvent) => {
		if (e.pointerType === 'touch') return
		later(() => setHovered(false), LOWER_MS)
	}
	// after a drop the pointer is still on the dock: moving it off the cap
	// lifts the hand again
	const onMove = (e: ReactPointerEvent) => {
		if (e.pointerType === 'touch' || hovered || timer.current !== null) return
		if (inCap(e.target)) return
		later(() => setHovered(true), RAISE_MS)
	}
	// touch: the first tap on a lowered hand only lifts it (the decks, the
	// end cap and a card's Play button work at once)
	const lastPointer = useRef<string>('mouse')
	const onDownCapture = (e: ReactPointerEvent) => {
		lastPointer.current = e.pointerType
	}
	const onClickCapture = (e: ReactMouseEvent) => {
		if (raised || inCloseup || lastPointer.current !== 'touch') return
		if (
			!(e.target instanceof Element) ||
			e.target.closest('.dock-fan') === null ||
			e.target.closest('.quick-play') !== null
		)
			return
		e.stopPropagation()
		e.preventDefault()
		setTapped(true)
	}

	return (
		<div
			ref={dock}
			className={`hand-dock${raised ? ' dock-raised' : ''}${pinned ? ' dock-pinned' : ''}`}
			style={{ '--hand-n': Math.max(1, count) } as CSSProperties}
			onPointerEnter={onEnter}
			onPointerLeave={onLeave}
			onPointerMove={onMove}
			onPointerDownCapture={onDownCapture}
			onClickCapture={onClickCapture}
			// the cap only pins and drops: focus on it lifts nothing
			onFocus={(e) => setFocused(!inCap(e.target))}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null))
					setFocused(false)
			}}
		>
			<DeckPiles seat={seat} />
			<CloseupLabel kind="hand" className="dock-handle">
				Hand
			</CloseupLabel>
			<div className="dock-fan">
				<Hand seat={seat} />
			</div>
			<button
				type="button"
				className="dock-cap"
				onClick={toggle}
				aria-pressed={pinned}
				aria-label="Keep your hand up"
				title={pinned ? 'Let your hand drop' : 'Keep your hand up'}
			>
				Hold
			</button>
		</div>
	)
}
