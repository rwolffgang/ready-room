// The Pocket Bridge frames (docs/ui-mobile.md §2, §4): phone, phone-wide and
// tablet. They share every component below the station level; only the
// frame differs.
//
//   phone       pinned header · station tabs · one station · hand dock
//   phone-wide  header as a left rail · station · hand as a right column
//   tablet      header · Sector | Ship side by side · Crew in a drawer · dock
//
// Read at the top, act at the bottom: the dock and the choice sheet sit in
// the bottom of the column, sheets rise over a scrim. A pending choice takes
// the dock's place, so the board above stays visible and its ringed tiles
// stay tappable.
//
// Data comes only through the store hooks: useProjected for rendering, the
// viewer's legal-intents list for every lit line and button, dispatch /
// confirmChoice for moves. The real state is read only for optional extras
// (why-not reasons, ~VP, the Burn forecast, "if the game ended now"), so an
// online source that sends a seat view and its legal intents can stand in
// for the local session.

import { useEffect, useLayoutEffect, useState, type KeyboardEvent } from 'react'
import type { GameState } from '../../engine/state'
import type { Intent } from '../../engine/intents'
import {
	setDetail,
	useGameStore,
	usePendingChoice,
	useProjected,
	useSession,
	useViewerSeat,
} from '../store'
import { useDefIndex } from '../defs'
import { CardTile, captainName, runIntent } from '../tile/CardTile'
import { Gl } from '../tile/glyph'
import { intentOffered } from '../tile/lines'
import { orderCount, type Station } from './facts'
import { useBridgeUi } from './bridgeUi'
import { useViewerLegal } from '../tile/legal'
import { Header } from './Header'
import { Crew, Sector, Ship, useStationDots } from './stations'
import {
	CrewDrawer,
	DetailSheet,
	HandSheet,
	MenuSheet,
	OrdersSheet,
	PileSheet,
} from './sheets'
import { ChoiceSheet } from './ChoiceSheet'
import { OnlineStrip } from '../online/OnlineStrip'
import { BotBar } from '../BotBar'
import { hasBots } from '../../session/opponents'
import { OpponentView } from './Opponent'
import type { Shell } from './shell'
import './mobile.css'

export type MobileShellKind = Exclude<Shell, 'console'>

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

const TABS: { id: Station; label: string }[] = [
	{ id: 'sector', label: 'Sector' },
	{ id: 'ship', label: 'Ship' },
	{ id: 'crew', label: 'Crew' },
]

function Tabs() {
	const tab = useBridgeUi((s) => s.tab)
	const setTab = useBridgeUi((s) => s.setTab)
	const dots = useStationDots()
	const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
		const i = TABS.findIndex((t) => t.id === tab)
		const next =
			TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!
		setTab(next.id)
	}
	return (
		<div
			className="pb-tabs"
			role="tablist"
			aria-label="Stations"
			onKeyDown={onKey}
		>
			{TABS.map((t) => (
				<button
					key={t.id}
					type="button"
					role="tab"
					className="pb-tab"
					aria-selected={tab === t.id}
					tabIndex={tab === t.id ? 0 : -1}
					onClick={() => setTab(t.id)}
				>
					{t.label}
					{dots[t.id] && <span className="pb-dot" aria-label="needs you" />}
				</button>
			))}
		</div>
	)
}

function StationView({ tab }: { tab: Station }) {
	switch (tab) {
		case 'sector':
			return <Sector />
		case 'ship':
			return <Ship />
		case 'crew':
			return <Crew />
	}
}

// ---------------------------------------------------------------------------
// dock
// ---------------------------------------------------------------------------

function stepIntent(
	state: GameState,
): { label: string; intent: Intent } | null {
	switch (state.phase.k) {
		case 'SETUP':
			return { label: 'Start game ›', intent: { t: 'START' } }
		case 'RESUPPLY':
		case 'CONTROL':
			return { label: 'Continue ›', intent: { t: 'PASS' } }
		case 'ACTION':
			return { label: 'End step ›', intent: { t: 'END_TURN' } }
		default:
			return null
	}
}

function PrimaryStep() {
	const projected = useProjected()
	const legal = useViewerLegal()
	const viewer = useViewerSeat()
	const [confirm, setConfirm] = useState(false)
	useEffect(() => {
		if (!confirm) return
		const t = window.setTimeout(() => setConfirm(false), 4000)
		return () => window.clearTimeout(t)
	}, [confirm])
	if (projected === null) return null
	const state = projected as unknown as GameState
	const step = stepIntent(state)
	const mine = state.activeSeat === viewer && state.pendingChoice === null
	if (step === null || !mine || !intentOffered(legal, step.intent))
		return (
			<button type="button" className="pb-pill pb-primary pb-push" disabled>
				{state.phase.k === 'CLEANUP' ? 'Clean-up…' : 'Waiting'}
			</button>
		)
	const unused = state.players[viewer].actions.available
	const ask = step.intent.t === 'END_TURN' && unused > 0 && !confirm
	return (
		<button
			type="button"
			className={`pb-pill pb-primary pb-push${confirm ? ' pb-warn' : ''}`}
			onClick={() => {
				if (ask) {
					setConfirm(true)
					return
				}
				setConfirm(false)
				runIntent(step.intent)
			}}
			aria-label={
				confirm
					? `End the step: ${unused} unused action${unused === 1 ? '' : 's'} will be lost`
					: undefined
			}
		>
			{confirm ? `End? ${unused} unused ›` : step.label}
		</button>
	)
}

function Dock({ shell }: { shell: MobileShellKind }) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const legal = useViewerLegal()
	const openSheet = useBridgeUi((s) => s.openSheet)
	const hand = projected?.zones[`HAND:${viewer}`] ?? []
	const openHand = () => openSheet({ k: 'hand' })
	// swipe up on the dock opens the hand (tapping does too)
	const [touchY, setTouchY] = useState<number | null>(null)
	return (
		<div
			className="pb-dock"
			onTouchStart={(e) => setTouchY(e.touches[0]?.clientY ?? null)}
			onTouchEnd={(e) => {
				const end = e.changedTouches[0]?.clientY
				if (touchY !== null && end !== undefined && touchY - end > 40)
					openHand()
				setTouchY(null)
			}}
		>
			<button
				type="button"
				className="pb-grab"
				onClick={openHand}
				aria-label="Open hand"
				tabIndex={-1}
			/>
			<div className="pb-dockbar">
				<button type="button" className="pb-pill" onClick={openHand}>
					<Gl g="HAND" />
					Hand <span className="pb-n">{hand.length}</span>
				</button>
				<button
					type="button"
					className="pb-pill"
					onClick={() => openSheet({ k: 'orders' })}
				>
					Orders <span className="pb-n">{orderCount(legal)}</span>
				</button>
				{shell === 'tablet' && (
					<button
						type="button"
						className="pb-pill"
						onClick={() => openSheet({ k: 'crew' })}
					>
						Crew
					</button>
				)}
				<PrimaryStep />
			</div>
			<div
				className="pb-peek"
				role="button"
				tabIndex={0}
				aria-label={`Open hand: ${hand.length} card${hand.length === 1 ? '' : 's'}`}
				onClick={openHand}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						openHand()
					}
				}}
			>
				{hand.length === 0 ? (
					<span className="pb-empty">Empty hand</span>
				) : (
					hand.map((iid) => (
						<CardTile key={iid} iid={iid} interactive={false} />
					))
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

function SheetHost() {
	const sheet = useBridgeUi((s) => s.sheet)
	if (sheet === null) return null
	switch (sheet.k) {
		case 'hand':
			return <HandSheet />
		case 'orders':
			return <OrdersSheet />
		case 'menu':
			return <MenuSheet />
		case 'crew':
			return <CrewDrawer />
		case 'pile':
			return <PileSheet label={sheet.label} iids={sheet.iids} />
	}
}

function Toasts() {
	const error = useGameStore((s) => s.error)
	const warning = useGameStore((s) => s.warning)
	const clearError = useGameStore((s) => s.clearError)
	const clearWarning = useGameStore((s) => s.clearWarning)
	if (error === null && warning === null) return null
	return (
		<div className="pb-toasts">
			{error !== null && (
				<div className="pb-toast pb-toast-err" role="alert">
					<span>{error}</span>
					<button
						type="button"
						className="pb-x"
						onClick={clearError}
						aria-label="Dismiss"
					>
						×
					</button>
				</div>
			)}
			{warning !== null && (
				<div className="pb-toast" role="status">
					<span>{warning}</span>
					<button
						type="button"
						className="pb-x"
						onClick={clearWarning}
						aria-label="Dismiss"
					>
						×
					</button>
				</div>
			)}
		</div>
	)
}

/** Hot-seat: the device belongs to one captain at a time (ui-spec §1). */
function PassDevice({ seat, answer }: { seat: 0 | 1; answer: boolean }) {
	const projected = useProjected()
	const index = useDefIndex()
	const setViewer = useGameStore((s) => s.setViewer)
	if (projected === null) return null
	const name = captainName(projected, seat, index)
	return (
		<div
			className="pb-pass"
			role="dialog"
			aria-modal="true"
			aria-label="Pass the device"
		>
			<div className="pb-pass-card">
				<div className="pb-lbl">Hot-seat</div>
				<h2>{answer ? `${name} must answer` : `${name}'s turn`}</h2>
				<p>
					Pass the device to Player {seat + 1}. This hand stays hidden until
					they take it.
				</p>
				<button
					type="button"
					className="pb-pill pb-primary"
					onClick={() => setViewer(seat)}
				>
					I&apos;m {name} · Player {seat + 1} ›
				</button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// the shell
// ---------------------------------------------------------------------------

export function MobileShell({ shell }: { shell: MobileShellKind }) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const pending = usePendingChoice()
	const session = useSession()
	const tab = useBridgeUi((s) => s.tab)
	const screen = useBridgeUi((s) => s.screen)
	const openSheet = useBridgeUi((s) => s.openSheet)
	const reset = useBridgeUi((s) => s.reset)
	const online = useGameStore((s) => s.online !== null)
	const botToMove = useGameStore((s) => s.botToMove)

	// a new game or another captain at the device: start from the Ship. A
	// layout effect, so it lands before a choice sheet's own (passive) effect
	// switches to the station holding that choice's candidates.
	useLayoutEffect(() => {
		reset()
	}, [session?.id, viewer, reset])
	// a new choice for this captain closes whatever sheet was up
	const mineChoice =
		pending !== null && pending.seat === viewer && botToMove === null
	useEffect(() => {
		if (!mineChoice) return
		openSheet(null)
		setDetail(null)
	}, [pending?.id, mineChoice, openSheet])

	if (projected === null) return null
	const state = projected as unknown as GameState
	const live = state.result === null
	// online this device is its own seat, and against the house AI or the
	// official solo Bot it stays with the human: never ask to pass it
	const passTo: 0 | 1 | null =
		!live || online || hasBots(session?.opponents) || state.mode === 'SOLO'
			? null
			: pending !== null
				? pending.seat !== viewer
					? pending.seat
					: null
				: state.activeSeat !== viewer
					? state.activeSeat
					: null

	const bottom = mineChoice ? (
		<ChoiceSheet splitView={shell === 'tablet'} />
	) : (
		<Dock shell={shell} />
	)
	const menu = () => openSheet({ k: 'menu' })

	return (
		<div className={`pb pb-${shell}`} data-shell={shell}>
			{screen === 'opponent' ? (
				<OpponentView />
			) : shell === 'tablet' ? (
				<>
					<Header onMenu={menu} />
					<OnlineStrip />
					<BotBar variant="mobile" />
					<div className="pb-split">
						<div className="pb-scroll" aria-label="Sector station">
							<Sector />
						</div>
						<div className="pb-scroll" aria-label="Ship station">
							<Ship />
						</div>
					</div>
					{bottom}
				</>
			) : shell === 'phone-wide' ? (
				<>
					<aside className="pb-rail-col">
						<Header onMenu={menu} />
						<OnlineStrip />
						<BotBar variant="mobile" />
					</aside>
					<main className="pb-main">
						<Tabs />
						<div className="pb-scroll pb-content" key={tab}>
							<StationView tab={tab} />
						</div>
					</main>
					<aside className="pb-hand-col">{bottom}</aside>
				</>
			) : (
				<>
					<Header onMenu={menu} />
					<OnlineStrip />
					<BotBar variant="mobile" />
					<Tabs />
					<div className="pb-scroll pb-content" key={tab}>
						<StationView tab={tab} />
					</div>
					{bottom}
				</>
			)}
			<SheetHost />
			<DetailSheet />
			<Toasts />
			{passTo !== null && (
				<PassDevice seat={passTo} answer={pending !== null} />
			)}
		</div>
	)
}
