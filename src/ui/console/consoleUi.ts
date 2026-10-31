// The console's own view state: whether the hand is pinned up, the log drawer,
// the viewscreen or a close-up is open, the head menu is showing. Game state
// never lives here — that is the game store (src/ui/store.ts); this only
// remembers where the player is looking, so it resets freely (a new game, a
// reload).

import { create } from 'zustand'

/** The parts of the table that come close up: the Neutral Zone (N), the
 *  Market (M) and your own area (B). */
export type Closeup = 'neutral-zone' | 'market' | 'area'

export interface ConsoleUi {
	/** H: the hand stays raised until H again (or Esc). */
	handPinned: boolean
	logOpen: boolean
	/** log entries the player had seen when they last closed the drawer */
	logSeen: number
	/** V: the opponent's full board on screen */
	viewscreen: boolean
	/** N / M / B: one part of the table close up, or none */
	closeup: Closeup | null
	menuOpen: boolean
	setHandPinned: (b: boolean) => void
	/** `entries` is the log length now, remembered when the drawer closes. */
	setLogOpen: (b: boolean, entries: number) => void
	/** The viewscreen and the close-ups share the screen: opening one puts
	 *  the other away. */
	setViewscreen: (b: boolean) => void
	setCloseup: (c: Closeup | null) => void
	setMenuOpen: (b: boolean) => void
	/** A new game: everything closed, its `entries` log rows already seen. */
	reset: (entries: number) => void
}

export const useConsoleUi = create<ConsoleUi>((set) => ({
	handPinned: false,
	logOpen: false,
	logSeen: 0,
	viewscreen: false,
	closeup: null,
	menuOpen: false,
	setHandPinned: (handPinned) => set({ handPinned }),
	setLogOpen: (logOpen, entries) => set({ logOpen, logSeen: entries }),
	setViewscreen: (viewscreen) =>
		set(viewscreen ? { viewscreen, closeup: null } : { viewscreen }),
	setCloseup: (closeup) =>
		set(closeup !== null ? { closeup, viewscreen: false } : { closeup }),
	setMenuOpen: (menuOpen) => set({ menuOpen }),
	reset: (entries) =>
		set({
			handPinned: false,
			logOpen: false,
			logSeen: entries,
			viewscreen: false,
			closeup: null,
			menuOpen: false,
		}),
}))
