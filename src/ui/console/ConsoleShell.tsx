// The LCARS console (docs/ui-lcars.md §4): the desktop and iPad-landscape
// frame, laid out like the table it stands for —
//
//   head bar    this turn, your pool, Undo · Orders · step · Log · Menu
//   ─────────────────────────────────────────────────────────────────────
//   opponent    their hand (face down), decks, pool, tracks, cards in play
//   shared      Market ×4 · Neutral Zone ×3 · Stardate / Incident / Junk
//   you         your in-play area · your crew console
//   hand dock   your Draw and Discard, your hand peeking up from the edge
//
// with layers that open only on request: the hand lifted (hover, tap, the
// dock's end cap — on a tall screen a pinned hand docks in a row of its own
// instead), the opponent on the viewscreen (V), a close-up of the Neutral Zone
// (N), the Market (M), your area (B) or your hand (H), and the log drawer (L). Cards size themselves
// to the height the board has (--card-w in console.css), so on a laptop or an
// iPad everything a turn needs is on one screen.

import { useEffect } from 'react'
import type { GameState } from '../../engine/state'
import type { Seat } from '../../engine/resolver/queries'
import { hasBots } from '../../session/opponents'
import { BotBar } from '../BotBar'
import { BotHighlight, BotHistory } from '../BotTicker'
import {
	CrewBoard,
	CentrePiles,
	Market,
	NeutralZone,
	PlayerArea,
} from '../board'
import { CardZoom } from '../cards'
import { ChoicePanel } from '../choice'
import { RecoverableErrorBoundary } from '../errorScreen'
import { FlightLayer } from '../flight'
import { seatLabel } from '../format'
import { useGameStore, useSession, useViewerSeat } from '../store'
import { useConsoleUi } from './consoleUi'
import { HandDock, useHandDocked } from './HandDock'
import { HeadBar } from './HeadBar'
import { LogDrawer } from './LogDrawer'
import { CloseupButton, CloseupLabel, Closeups } from './Closeup'
import { OpponentBand } from './OpponentBand'
import { Viewscreen } from './Viewscreen'
import './console.css'

export function ConsoleShell({ state }: { state: GameState }) {
	const session = useSession()
	// a new game starts with everything put away and its history read
	const gameId = session?.id
	useEffect(() => {
		// only on a new game, not on every log entry
		useConsoleUi.getState().reset(state.log.length)
	}, [gameId])
	// The frame is the only thing allowed to change colour (docs/ui-lcars.md §8):
	// red alert when the Burn is one Incident away.
	const incidentsLeft = state.zones['INCIDENT_DECK']?.length ?? 0
	const alert = incidentsLeft <= 1 && state.result === null
	const handDocked = useHandDocked()
	return (
		<div
			className={`frame console${alert ? ' frame-alert' : ''}${handDocked ? ' hand-docked' : ''}`}
		>
			<HeadBar state={state} incidentsLeft={incidentsLeft} />
			<div className="frame-body">
				<BotBar variant="console" />
				<ErrorBanner />
				<WarningBanner />
				<RecoverableErrorBoundary title="while rendering the board">
					<Board />
				</RecoverableErrorBoundary>
			</div>
			<PassDeviceBar state={state} />
			<ChoicePanel />
			<CardZoom />
			<FlightLayer />
			<BotHistory />
			<BotHighlight />
		</div>
	)
}

function Board() {
	const viewer = useViewerSeat()
	const opponent: Seat = viewer === 0 ? 1 : 0
	return (
		<main className="board">
			<div className="table">
				<OpponentBand seat={opponent} />
				<div className="shared-row">
					<Market label={<CloseupLabel kind="market">Market</CloseupLabel>} />
					<NeutralZone aside={<CloseupButton kind="neutral-zone" />} />
					<CentrePiles />
				</div>
				<div className="own-row">
					<PlayerArea
						seat={viewer}
						head={false}
						aside={<CloseupButton kind="area" />}
					/>
					<CrewBoard seat={viewer} />
				</div>
			</div>
			<HandDock seat={viewer} />
			<Viewscreen seat={opponent} />
			<Closeups />
			<LogDrawer />
		</main>
	)
}

function ErrorBanner() {
	const error = useGameStore((s) => s.error)
	const clear = useGameStore((s) => s.clearError)
	if (error === null) return null
	return (
		<div className="error-banner" role="alert">
			<strong>⚠ {error}</strong>
			<button type="button" className="btn micro" onClick={clear}>
				dismiss
			</button>
		</div>
	)
}

/** Informational (non-blocking) notice — resume warnings, undo refusals,
 *  autosave failures (todo/17 §1/§2). Dismissible like the error banner. */
function WarningBanner() {
	const warning = useGameStore((s) => s.warning)
	const clear = useGameStore((s) => s.clearWarning)
	if (warning === null) return null
	return (
		<div className="warning-banner" role="status">
			<strong>ℹ {warning}</strong>
			<button type="button" className="btn micro" onClick={clear}>
				dismiss
			</button>
		</div>
	)
}

function PassDeviceBar({ state }: { state: GameState }) {
	const viewer = useViewerSeat()
	const setViewer = useGameStore((s) => s.setViewer)
	// against the house AI the device never changes hands
	const bots = useGameStore((s) => hasBots(s.session?.opponents))
	if (state.result !== null || bots) return null
	const needOpponent =
		state.pendingChoice === null && state.activeSeat !== viewer
	if (!needOpponent) return null
	return (
		<div className="pass-bar" role="status">
			<span>
				It&apos;s {seatLabel(state.activeSeat)}&apos;s turn — pass the device.
			</span>
			<button
				type="button"
				className="btn btn-primary"
				onClick={() => setViewer(state.activeSeat)}
			>
				I&apos;m {seatLabel(state.activeSeat)}
			</button>
		</div>
	)
}
