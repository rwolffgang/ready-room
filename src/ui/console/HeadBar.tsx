// The console's one head bar (docs/ui-lcars.md §4). It carries this turn and
// the doors to everything else, in one 38px row where there used to be four
// bars (title, session nav, counters, status):
//
//   cap · phase · turn · action tray · your pool · ~VP · alerts · House AI ·
//   Undo · Orders · primary step · Log · Fullscreen · Menu
//
// The counters it replaced are decks on the table now (CentrePiles, the hand
// dock, the opponent band); the end conditions show here only when they are
// close — the Burn at ≤2 Incidents, Resolution once triggered.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameState, LogEntry } from '../../engine/state'
import { estimateScore } from '../../session/log'
import { isSpectator } from '../../session/opponents'
import {
	useGameStore,
	useProjected,
	useRealState,
	useSession,
	useViewerSeat,
	undoPolicyLabel,
} from '../store'
import { ActionTray } from '../board'
import { BotStatus } from '../BotBar'
import { DeltaCounter } from '../delta'
import { Icon } from '../icons'
import { OrdersPanel } from '../OrdersPanel'
import { openReplay } from '../replay'
import { orderCount } from '../mobile/facts'
import { useViewerLegal } from '../tile/legal'
import { phaseLabel, RESOURCE_LABEL, seatLabel } from '../format'
import { useConsoleUi } from './consoleUi'
import { useEscape, useShortcut } from './useShortcut'
import {
	fullscreenAvailable,
	toggleFullscreen,
	useFullscreen,
} from './fullscreen'

export function HeadBar({
	state,
	incidentsLeft,
}: {
	state: GameState
	incidentsLeft: number
}) {
	const [confirmEnd, setConfirmEnd] = useState(false)
	// the house AI is to move: no primary step for the device
	const botToMove = useGameStore((s) => s.botToMove)
	const viewer = useViewerSeat()
	const real = useRealState()
	const active = state.players[state.activeSeat]
	const mine = state.players[viewer]
	const phase = state.phase.k
	const pending = state.pendingChoice !== null || botToMove !== null
	// nothing left to spend: the one obvious next move is ending the step
	const outOfActions =
		phase === 'ACTION' && !pending && (active?.actions.available ?? 0) === 0
	// every legal move in one list (O, or the button beside the primary step)
	const [ordersOpen, setOrdersOpen] = useState(false)
	const orders = orderCount(useViewerLegal())
	useShortcut('o', () => setOrdersOpen((o) => !o))
	// public information only: hidden cards' printed VP never shows
	const vp = useMemo(
		() => (real === null ? null : estimateScore(real, viewer, viewer)),
		[real, viewer],
	)

	const action = useMemo(() => {
		if (pending) return null
		switch (phase) {
			case 'SETUP':
				return { label: 'Start game', kind: 'start' as const }
			case 'RESUPPLY':
				return { label: 'Continue', kind: 'pass' as const }
			case 'CONTROL':
				return { label: 'Continue', kind: 'pass' as const }
			case 'ACTION':
				return { label: 'End Action Step', kind: 'endTurn' as const }
			default:
				return null
		}
	}, [pending, phase])

	const onPrimary = useCallback(() => {
		if (action === null) return
		if (action.kind === 'endTurn' && !confirmEnd) {
			setConfirmEnd(true)
			window.setTimeout(() => setConfirmEnd(false), 4000)
			return
		}
		setConfirmEnd(false)
		const s = useGameStore.getState()
		if (action.kind === 'start') s.dispatch({ t: 'START' })
		else if (action.kind === 'pass') s.dispatch({ t: 'PASS' })
		else s.dispatch({ t: 'END_TURN' })
	}, [action, confirmEnd])

	const burnClose = incidentsLeft <= 2 && state.result === null
	return (
		<div className="head-row">
			<span className="head-cap" aria-hidden="true" />
			<header className="topbar head-bar">
				<div className="topbar-left">
					<span className={`phase-chip phase-${phase.toLowerCase()}`}>
						{phaseLabel(state.phase)}
					</span>
					<span className="head-turn">
						Turn {state.turnNumber} · {seatLabel(state.activeSeat)}
					</span>
					<ActionTray seat={state.activeSeat} size="lg" />
					{/* Your resources and Away Teams: the one counter per pool a token
				    flight lands on (docs/ui-lcars.md §4.1). */}
					{mine !== undefined && (
						<span
							className="topbar-resources"
							aria-label={`${seatLabel(viewer)} resources`}
						>
							{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
								<DeltaCounter
									key={r}
									pool={`player:${viewer}:${r}`}
									label={`${seatLabel(viewer)} ${RESOURCE_LABEL[r]}`}
									className={`res-pip pip-${r.toLowerCase()}`}
									title={RESOURCE_LABEL[r]}
								>
									<Icon id={r} label={RESOURCE_LABEL[r]} />{' '}
									<span className="res-n">{mine.resources[r]}</span>
								</DeltaCounter>
							))}
							<span
								className="res-pip pip-away"
								title={`${mine.awayTeamsInPool} Away Team${mine.awayTeamsInPool === 1 ? '' : 's'} on your Captain · ${mine.awayTeamsTotal} owned`}
							>
								<Icon id="AWAY_TEAM" label="Away Teams" />{' '}
								<span className="res-n">
									{mine.awayTeamsInPool}
									<small>/{mine.awayTeamsTotal}</small>
								</span>
							</span>
						</span>
					)}
					{vp !== null && (
						<span
							className="head-vp"
							title="Your score so far from public information: Glory, tracks and the VP of your cards in play"
						>
							~{vp} VP
						</span>
					)}
				</div>
				<div className="head-alerts" role="status">
					{burnClose && (
						<span className="head-alert">
							⚠ The Burn — {incidentsLeft} Incident
							{incidentsLeft === 1 ? '' : 's'} left
						</span>
					)}
					{state.resolutionTriggered && (
						<span className="head-alert head-alert-res">
							⚠ Resolution triggered
						</span>
					)}
				</div>
				<BotStatus />
				<div className="topbar-actions">
					<UndoButton />
					{phase !== 'SETUP' && (
						<button
							type="button"
							className="btn orders-btn"
							onClick={() => setOrdersOpen(true)}
							title="Every legal move right now (O)"
						>
							Orders <span className="orders-n">{orders}</span>
						</button>
					)}
					{ordersOpen && <OrdersPanel onClose={() => setOrdersOpen(false)} />}
					{action !== null && (
						<button
							type="button"
							className={`btn btn-primary${confirmEnd ? ' btn-warn' : ''}${outOfActions ? ' btn-nudge' : ''}`}
							onClick={onPrimary}
						>
							{confirmEnd ? 'Really end?' : action.label}
						</button>
					)}
					<LogButton />
					<FullscreenButton />
					<HeadMenu />
				</div>
			</header>
		</div>
	)
}

function UndoButton() {
	const undo = useGameStore((s) => s.undo)
	const canUndo = useGameStore((s) => s.canUndo)
	const session = useSession()
	const locked = session !== null && session.log.length > 0 && !canUndo
	return (
		<button
			type="button"
			className="btn head-btn"
			onClick={undo}
			disabled={!canUndo}
			title={
				locked
					? `${undoPolicyLabel(session?.setup.mode, session?.opponents)} — ${isSpectator(session?.opponents) ? 'spectator' : 'at a turn boundary'}`
					: undoPolicyLabel(session?.setup.mode, session?.opponents)
			}
		>
			Undo
		</button>
	)
}

/** L, or this button: the log drawer. It never opens by itself; the count is
 *  what the other side has done since you last looked. */
function LogButton() {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const open = useConsoleUi((s) => s.logOpen)
	const seen = useConsoleUi((s) => s.logSeen)
	const setLogOpen = useConsoleUi((s) => s.setLogOpen)
	const log = (projected?.log ?? []) as unknown as LogEntry[]
	const fresh = open
		? 0
		: log.slice(seen).filter((e) => e.seat !== undefined && e.seat !== viewer)
				.length
	const toggle = () => setLogOpen(!open, log.length)
	useShortcut('l', toggle)
	return (
		<button
			type="button"
			className={`btn head-btn${open ? ' btn-active' : ''}`}
			onClick={toggle}
			aria-expanded={open}
			title="Game log (L)"
		>
			Log
			{fresh > 0 && (
				<span className="head-badge" aria-label={`${fresh} new`}>
					{fresh}
				</span>
			)}
		</button>
	)
}

function FullscreenButton() {
	const full = useFullscreen()
	const [offered] = useState(fullscreenAvailable)
	useShortcut('f', toggleFullscreen, offered)
	if (!offered) return null
	return (
		<button
			type="button"
			className={`btn head-btn head-icon${full ? ' btn-active' : ''}`}
			onClick={toggleFullscreen}
			aria-pressed={full}
			aria-label="Fullscreen"
			title={full ? 'Leave fullscreen (F)' : 'Fullscreen (F)'}
		>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
				<path
					d={
						full
							? 'M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5'
							: 'M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5'
					}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
				/>
			</svg>
		</button>
	)
}

/** Everything that is not this turn: Replay, Reference, Settings, New game. */
function HeadMenu() {
	const open = useConsoleUi((s) => s.menuOpen)
	const setOpen = useConsoleUi((s) => s.setMenuOpen)
	const session = useSession()
	const openReference = useGameStore((s) => s.openReference)
	const setSettingsOpen = useGameStore((s) => s.setSettingsOpen)
	const newGame = useGameStore((s) => s.newGame)
	const close = useCallback(() => setOpen(false), [setOpen])
	useEscape(open, close)
	// a click anywhere else closes it
	useEffect(() => {
		if (!open) return
		const onDown = (e: PointerEvent) => {
			const t = e.target as Element | null
			if (t?.closest('.head-menu') == null) close()
		}
		window.addEventListener('pointerdown', onDown)
		return () => window.removeEventListener('pointerdown', onDown)
	}, [open, close])
	const item = (label: string, run: () => void, disabled = false) => (
		<button
			type="button"
			role="menuitem"
			className="head-menu-item"
			disabled={disabled}
			onClick={() => {
				close()
				run()
			}}
		>
			{label}
		</button>
	)
	return (
		<span className="head-menu">
			<button
				type="button"
				className={`btn head-btn${open ? ' btn-active' : ''}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				Menu
			</button>
			{open && (
				<span className="head-menu-list" role="menu" aria-label="Menu">
					{item('Replay', openReplay, session === null)}
					{item('Reference', () => openReference())}
					{item('Settings', () => setSettingsOpen(true))}
					{item('New game', newGame)}
				</span>
			)}
		</span>
	)
}
