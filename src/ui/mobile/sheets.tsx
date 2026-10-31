// Bottom sheets (docs/ui-mobile.md §4): the hand with wide tiles, Orders
// (every legal move, grouped by where the card is), the Rosetta detail, the
// menu, a pile browser and the tablet's Crew drawer. On a phone on its side
// they open as side panels (mobile.css). Everything pressed to act sits in
// the bottom of the screen, in thumb reach.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CardInstanceId } from '../../engine/ids'
import type { Intent } from '../../engine/intents'
import type { GameState } from '../../engine/state'
import { isGameplayTrait, isSpecies } from '../../data/ids'
import {
	BOT_SPEEDS,
	setDetail,
	undoPolicyLabel,
	useDetailIid,
	useGameStore,
	useProjected,
	useRealState,
	useSession,
	useViewerSeat,
} from '../store'
import { useDefForIid, useDefIndex } from '../defs'
import { OpText, RunLabel } from '../cards'
import { cardImageUrl } from '../stcc'
import { TIMING_WORD } from '../shorthandGlyphs'
import { ShorthandLineView, ShorthandTokens } from '../shorthand'
import { CardTile, TileLineRow, runIntent } from '../tile/CardTile'
import { Gl, SuitGl } from '../tile/glyph'
import { contextOf, foldReason, tileLines, type TileLine } from '../tile/lines'
import { missionView, orderCount, orderGroups } from './facts'
import { useBridgeUi } from './bridgeUi'
import { useViewerLegal } from '../tile/legal'
import { setShellChoice, useShell, type ShellChoice } from './shell'
import { setTheme, THEMES, useTheme } from '../theme'
import { CrewBoardView } from './stations'
import { StandingOrders } from '../online/Orders'
import { SeatLink } from '../online/SeatLink'
import { GlyphLegend } from '../guide/legend'
import { cardName, deckLabel } from '../../data/cardNames'
import { hasBots } from '../../session/opponents'
import { SPEED_LABEL } from '../BotBar'

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export function SheetFrame({
	title,
	label,
	chips,
	sub,
	tall,
	onClose,
	footer,
	children,
	className = '',
	scrim = true,
}: {
	title: ReactNode
	label: string
	chips?: ReactNode
	sub?: ReactNode
	tall?: boolean
	onClose?: (() => void) | undefined
	footer?: ReactNode
	children?: ReactNode
	className?: string
	scrim?: boolean
}) {
	const closeRef = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		closeRef.current?.focus({ preventScroll: true })
		if (onClose === undefined) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	return (
		<>
			{scrim && (
				<div
					className="pb-scrim"
					onClick={onClose}
					aria-hidden="true"
					data-testid="pb-scrim"
				/>
			)}
			<div
				className={`pb-sheet${tall === true ? ' pb-tall' : ''} ${className}`}
				role="dialog"
				aria-modal={scrim ? 'true' : undefined}
				aria-label={label}
			>
				{onClose !== undefined && (
					<button
						type="button"
						className="pb-grab"
						onClick={onClose}
						aria-label="Close"
						tabIndex={-1}
					/>
				)}
				<div className="pb-sheet-h">
					<div className="pb-row">
						{typeof title === 'string' ? <h3>{title}</h3> : title}
						{chips}
						{onClose !== undefined && (
							<button
								ref={closeRef}
								type="button"
								className="pb-x"
								onClick={onClose}
								aria-label="Close"
							>
								×
							</button>
						)}
					</div>
					{sub !== undefined && <div className="pb-sub">{sub}</div>}
				</div>
				<div className="pb-scroll pb-sheet-body">{children}</div>
				{footer !== undefined && <div className="pb-confirm">{footer}</div>}
			</div>
		</>
	)
}

function useClose(): () => void {
	const openSheet = useBridgeUi((s) => s.openSheet)
	return useMemo(() => () => openSheet(null), [openSheet])
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

export function playableCount(legal: readonly Intent[]): number {
	return new Set(legal.filter((it) => it.t === 'PLAY_CARD').map((it) => it.iid))
		.size
}

export function HandSheet() {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const legal = useViewerLegal()
	const close = useClose()
	const hand = projected?.zones[`HAND:${viewer}`] ?? []
	const playable = playableCount(legal)
	return (
		<SheetFrame
			title={`Hand · ${hand.length}`}
			label="Your hand"
			tall
			onClose={close}
			chips={
				<span className="pb-src">
					<Gl g="CHECK" />
					{playable} playable
				</span>
			}
			sub="Lit lines are legal now: tap one to play it. Tap a name for the full card."
		>
			<div className="pb-stack">
				{hand.length === 0 ? (
					<div className="pb-empty">Your hand is empty.</div>
				) : (
					hand.map((iid) => <CardTile key={iid} iid={iid} />)
				)}
			</div>
		</SheetFrame>
	)
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function OrderRow({ intent, state }: { intent: Intent; state: GameState }) {
	const viewer = useViewerSeat()
	const index = useDefIndex()
	const close = useClose()
	if (intent.t === 'COMPLETE_MISSION') {
		const m = missionView(state, viewer, intent.index, [intent])
		if (m === null) return null
		return (
			<div className="pb-ord">
				<div className="pb-who">
					<SuitGl suit="MISSION" />
					{m.title}
					<span className="pb-where">goal met</span>
				</div>
				<div
					className="pb-ln pb-lit"
					role="button"
					tabIndex={0}
					aria-label={`Complete mission ${m.title}: ${m.rewardEnglish}`}
					onClick={() => {
						close()
						runIntent(intent)
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							close()
							runIntent(intent)
						}
					}}
				>
					<ShorthandTokens toks={m.reward} label={m.rewardEnglish} />
				</div>
			</div>
		)
	}
	if (intent.t !== 'PLAY_CARD' && intent.t !== 'ACTIVATE') return null
	const card = state.cards[intent.iid]
	if (card === undefined) return null
	const def = index.get(card.def)
	if (def === undefined) return null
	const line = tileLines({
		def,
		iid: intent.iid,
		view: state,
		legal: [intent],
		viewer,
	}).find(
		(l) =>
			l.intent !== undefined &&
			JSON.stringify(l.intent) === JSON.stringify(intent),
	)
	if (line === undefined) return null
	const where =
		card.zone.k === 'HAND'
			? 'hand'
			: card.zone.k === 'LOCATION_AREA'
				? 'Location Area'
				: card.zone.k === 'DUTY_OFFICER'
					? 'Duty Officer'
					: card.zone.k.charAt(0) + card.zone.k.slice(1).toLowerCase()
	return (
		<div className="pb-ord">
			<div className="pb-who">
				<SuitGl suit={def.suit} />
				{cardName(def)}
				<span className="pb-where">{where}</span>
			</div>
			<TileLineRow
				l={line}
				cardName={cardName(def)}
				interactive
				onRun={close}
			/>
		</div>
	)
}

export function OrdersSheet() {
	const legal = useViewerLegal()
	const projected = useProjected()
	const viewer = useViewerSeat()
	const close = useClose()
	const view = projected as unknown as GameState | null
	const groups = useMemo(
		() => (view !== null ? orderGroups(legal, view) : []),
		[legal, view],
	)
	const n = orderCount(legal)
	const actions = view?.players[viewer].actions.available ?? 0
	return (
		<SheetFrame
			title={`Orders · ${n}`}
			label="Orders: every legal move"
			tall
			onClose={close}
			sub={
				<>
					Every legal move right now, wherever the card is. Costs are on the
					line; <Gl g="ACT" /> spends one of your {actions} action
					{actions === 1 ? '' : 's'}.
				</>
			}
		>
			{view === null || groups.length === 0 ? (
				<div className="pb-empty">
					{view?.pendingChoice !== null && view?.pendingChoice !== undefined
						? 'Answer the open choice first.'
						: view !== null && view.activeSeat !== viewer
							? 'It is not your turn.'
							: view !== null && view.phase.k !== 'ACTION'
								? 'Nothing to order outside your Action step — continue to move on.'
								: 'No legal moves left. End the step when you are ready.'}
				</div>
			) : (
				groups.map((g) => (
					<div key={g.label}>
						<h3 className="pb-sec-h">
							<span>{g.label}</span>
						</h3>
						<div className="pb-orders-g">
							{g.rows.map((it, i) => (
								<OrderRow key={i} intent={it} state={view} />
							))}
						</div>
					</div>
				))
			)}
		</SheetFrame>
	)
}

// ---------------------------------------------------------------------------
// Detail — the Rosetta view
// ---------------------------------------------------------------------------

function openRulesFor(anchor: string): void {
	useGameStore.getState().setRulesOpen(true)
	window.dispatchEvent(new CustomEvent('codex:open-rule', { detail: anchor }))
}

const TIMING_TONE: Record<TileLine['line']['timing'], string> = {
	PLAY: 'play',
	ACTIVATION: 'table',
	PASSIVE: 'table',
	REACTION: 'table',
	RESUPPLY: 'turn',
	CLEANUP: 'turn',
	CONTROL: 'turn',
	ENDGAME: 'end',
	SPECIAL: 'special',
	SURPRISE: 'special',
	DEVELOPMENT: 'dev',
}

/** One operation in the detail sheet. A lit one is a control as a whole —
 *  keyword links and other buttons inside keep their own taps — and one that
 *  would do nothing (idleOperationReason) asks "Are you sure?" first. */
function DetailOp({
	l,
	onDone,
	children,
}: {
	l: TileLine
	onDone: () => void
	children: ReactNode
}) {
	const [confirm, setConfirm] = useState(false)
	const lit = l.state === 'lit' && l.intent !== undefined
	const run = () => {
		if (l.intent === undefined) return
		if (l.idle !== undefined && !confirm) {
			setConfirm(true)
			return
		}
		setConfirm(false)
		onDone()
		runIntent(l.intent)
	}
	return (
		<div
			className={`pb-dt-op pb-tone-${TIMING_TONE[l.line.timing]}${lit ? ' pb-dt-run' : ''}`}
			onClick={
				lit
					? (e) => {
							const t = e.target as HTMLElement
							if (t.closest('button, a, input, select, textarea') !== null)
								return
							run()
						}
					: undefined
			}
		>
			{children}
			<LineState l={l} confirm={confirm} onRun={run} />
		</div>
	)
}

function LineState({
	l,
	confirm,
	onRun,
}: {
	l: TileLine
	confirm: boolean
	onRun: () => void
}) {
	switch (l.state) {
		case 'lit': {
			const verb = l.line.timing === 'ACTIVATION' ? 'Activate' : 'Play'
			const button = (
				<button
					type="button"
					className="pb-pill pb-primary"
					onClick={(e) => {
						e.stopPropagation()
						onRun()
					}}
				>
					<RunLabel
						label={confirm ? 'Are you sure?' : verb}
						costsAction={l.line.action}
					/>
				</button>
			)
			// legal, but every benefit would be skipped (idleOperationReason)
			if (l.idle !== undefined)
				return (
					<div className="pb-state pb-idle">
						Does nothing right now: “{l.idle}” can’t happen
						{l.line.action ? ' · still spends 1 action' : ''}
						{button}
					</div>
				)
			return (
				<div className="pb-state pb-ok">
					<Gl g="CHECK" />
					You can do this now{l.line.action ? ' · spends 1 action' : ''}
					{button}
				</div>
			)
		}
		case 'dim':
			return (
				<div className="pb-state pb-no">
					{l.reason !== undefined
						? `Why not: ${l.reason}`
						: 'Not available now'}
				</div>
			)
		case 'done':
			return <div className="pb-state pb-ok">Resolved this turn</div>
		case 'later':
		case 'na':
			return <div className="pb-state pb-na">{l.reason}</div>
		case 'plain':
			return null
	}
}

export function zoneWords(
	zone: { k: string; seat?: number; suit?: string },
	viewer: number,
	oppName: string,
): string {
	const whose =
		zone.seat === undefined
			? ''
			: zone.seat === viewer
				? 'your '
				: `${oppName}'s `
	switch (zone.k) {
		case 'HAND':
			return `In ${whose}hand`
		case 'FLEET':
			return `In ${whose}Fleet`
		case 'LOCATION_AREA':
			return `In ${whose}Location Area`
		case 'DUTY_OFFICER':
			return `${zone.seat === viewer ? 'Your' : `${oppName}'s`} Duty Officer`
		case 'CAPTAIN':
			return `${zone.seat === viewer ? 'Your' : `${oppName}'s`} Captain`
		case 'STAGING':
			return `In ${whose}Staging Area`
		case 'DISCARD':
			return `In ${whose}Discard pile`
		case 'DEVELOPMENT':
			return `In ${whose}Development pile`
		case 'LOG':
			return `In ${whose}Captain's Log`
		case 'MARKET_OFFER':
			return `In the Market (${zone.suit ?? ''})`
		case 'NEUTRAL_ZONE':
			return 'In the Neutral Zone'
		case 'JUNK':
			return 'In the Junk pile'
		case 'BEAMED':
			return 'Beamed onto a ship'
		default:
			return zone.k.replace(/_/g, ' ').toLowerCase()
	}
}

export function DetailSheet() {
	const iid = useDetailIid()
	const projected = useProjected()
	const legal = useViewerLegal()
	// reasons only ("why not") — legality is the legal list
	const real = useRealState()
	const viewer = useViewerSeat()
	const def = useDefForIid(iid)
	const [printed, setPrinted] = useState(false)
	const [broken, setBroken] = useState(false)
	const close = useMemo(() => () => setDetail(null), [])
	const lines = useMemo(
		() =>
			def === null || iid === null
				? []
				: tileLines({
						def,
						iid,
						view: projected as unknown as GameState | null,
						legal,
						viewer,
						real,
						show: 'all',
					}),
		[def, iid, projected, legal, real, viewer],
	)
	if (iid === null || projected === null) return null
	const card = projected.cards[iid]
	if (card === undefined) return null
	if (def === null) {
		return (
			<SheetFrame title="Face-down card" label="Card detail" onClose={close}>
				<div className="pb-empty">Face down — no information.</div>
			</SheetFrame>
		)
	}
	// lines that cannot run from this zone (a deployed card's PLAY lines, the
	// activations of a card in hand) fold away below the ones that can
	const ctx = contextOf(card.zone)
	const folds = (l: TileLine) => foldReason(ctx, l.line.timing) !== undefined
	const away = lines.filter(folds)
	const opView = (l: TileLine) => (
		<DetailOp key={l.key} l={l} onDone={close}>
			<div className="pb-lblrow">
				{TIMING_WORD[l.line.timing]}
				{l.line.action && (
					<span className="pb-cost-note">· costs an action</span>
				)}
				{l.line.attack && <span className="pb-cost-note pb-atk">· attack</span>}
				{l.via !== undefined && (
					<span className="pb-cost-note">· via {l.via}</span>
				)}
			</div>
			<ShorthandLineView line={l.line} label={l.english} size="lg" />
			{l.english !== undefined && (
				<p className="pb-en">
					<OpText text={l.english} onKeyword={openRulesFor} />
				</p>
			)}
		</DetailOp>
	)
	const scan = cardImageUrl(def)
	const oppDeck = projected.players[viewer === 0 ? 1 : 0]?.deckId
	const oppName = oppDeck !== undefined ? deckLabel(oppDeck) : 'Opponent'
	const vp =
		def.vp !== 0 || def.vpAsterisk
			? `${def.vpAsterisk ? '*' : ''}${def.vp} VP`
			: null
	return (
		<SheetFrame
			title={
				<div className="pb-dt-name">
					<SuitGl suit={def.suit} />
					<h3>{cardName(def)}</h3>
					{vp !== null && <span className="pb-vp">{vp}</span>}
				</div>
			}
			label={`${cardName(def)} detail`}
			tall
			onClose={close}
			className="pb-detail"
			sub={
				<>
					<div className="pb-dt-where">
						{zoneWords(card.zone, viewer, oppName)}
						{card.exhausted ? ' · exhausted' : ''}
					</div>
					{(def.traits.length > 0 ||
						def.skills.length > 0 ||
						def.focus !== null) && (
						<div className="pb-traits">
							{def.skills.map((s, i) => (
								<span key={`${s}${i}`} className="pb-chip">
									{s.replace('SKILL_', '').toLowerCase()} skill
								</span>
							))}
							{def.focus !== null && (
								<span className="pb-chip">
									{def.focus.replace('FOCUS_', '').toLowerCase()} focus
								</span>
							)}
							{def.traits.map((t) => (
								<span
									key={t}
									className={`sh-trait${isSpecies(t) ? ' sh-species' : isGameplayTrait(t) ? ' sh-gameplay' : ''}`}
								>
									{t.replace(/_/g, ' ')}
								</span>
							))}
						</div>
					)}
					<div className="pb-seg" role="group" aria-label="View">
						<button
							type="button"
							aria-pressed={!printed}
							onClick={() => setPrinted(false)}
						>
							Shorthand
						</button>
						<button
							type="button"
							aria-pressed={printed}
							disabled={scan === null}
							title={
								scan === null
									? 'No printed scan on this device (npm run fetch-cards)'
									: undefined
							}
							onClick={() => setPrinted(true)}
						>
							Printed card
						</button>
					</div>
				</>
			}
		>
			{printed && scan !== null ? (
				<div className="pb-printed">
					{broken ? (
						<div className="pb-empty">
							The printed scan could not be loaded on this device.
						</div>
					) : (
						<img
							src={scan}
							alt={cardName(def)}
							onError={() => setBroken(true)}
						/>
					)}
				</div>
			) : lines.length === 0 ? (
				<div className="pb-empty">No operations.</div>
			) : (
				<>
					{lines.filter((l) => !folds(l)).map(opView)}
					{away.length > 0 && (
						<details className="pb-dt-away">
							<summary>Not usable from here ({away.length})</summary>
							{away.map(opView)}
						</details>
					)}
				</>
			)}
			{!printed && lines.length > 0 && (
				<GlyphLegend
					lines={lines.map((l) => l.line)}
					onLearn={() => useGameStore.getState().openGuide()}
					collapsible
				/>
			)}
		</SheetFrame>
	)
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

const LAYOUTS: { v: ShellChoice; label: string }[] = [
	{ v: 'auto', label: 'Auto' },
	{ v: 'phone', label: 'Phone' },
	{ v: 'tablet', label: 'Tablet' },
	{ v: 'console', label: 'Console' },
]

export function MenuSheet() {
	const close = useClose()
	const { choice } = useShell()
	const theme = useTheme()
	const canUndo = useGameStore((s) => s.canUndo)
	const undo = useGameStore((s) => s.undo)
	const newGame = useGameStore((s) => s.newGame)
	const openReference = useGameStore((s) => s.openReference)
	const botSpeed = useGameStore((s) => s.botSpeed)
	const setBotSpeed = useGameStore((s) => s.setBotSpeed)
	const session = useSession()
	const [confirmNew, setConfirmNew] = useState(false)
	const online = useGameStore((s) => s.online)
	const botGame = online === null && hasBots(session?.opponents)
	const setStandingOrder = useGameStore((s) => s.setStandingOrder)
	const showRecap = useGameStore((s) => s.showRecap)
	const defs = useDefIndex()
	return (
		<SheetFrame title="Menu" label="Menu" onClose={close}>
			<div className="pb-menu">
				{online !== null && online.view !== null && (
					<>
						<button
							type="button"
							className="pb-pill"
							onClick={() => {
								close()
								showRecap()
							}}
						>
							Previously on…
						</button>
						<div className="pb-lbl">Standing orders</div>
						<StandingOrders
							view={online.view}
							defs={defs}
							onSet={setStandingOrder}
							busy={online.busy}
						/>
						<div className="pb-lbl">Your seat</div>
						<SeatLink creds={online.creds} />
					</>
				)}
				<button
					type="button"
					className="pb-pill"
					disabled={!canUndo}
					onClick={() => {
						undo()
						close()
					}}
				>
					Undo
				</button>
				<p className="pb-note">
					{online !== null
						? 'Undo works on your own turn until something new is revealed to you.'
						: undoPolicyLabel(session?.setup.mode, session?.opponents)}
				</p>
				<div className="pb-lbl">Layout on this device</div>
				<div className="pb-seg pb-seg-wide" role="group" aria-label="Layout">
					{LAYOUTS.map((l) => (
						<button
							key={l.v}
							type="button"
							aria-pressed={choice === l.v}
							onClick={() => setShellChoice(l.v)}
						>
							{l.label}
						</button>
					))}
				</div>
				<div className="pb-lbl">Colour theme</div>
				<div className="pb-seg pb-seg-wide" role="group" aria-label="Theme">
					{THEMES.map((t) => (
						<button
							key={t.v}
							type="button"
							aria-pressed={theme === t.v}
							title={t.label}
							onClick={() => setTheme(t.v)}
						>
							<span
								className="pb-swatch"
								style={{ background: t.frame }}
								aria-hidden
							/>
							{t.short}
						</button>
					))}
				</div>
				{botGame && (
					<>
						<div className="pb-lbl">House AI speed</div>
						<div
							className="pb-seg pb-seg-wide"
							role="group"
							aria-label="House AI speed"
						>
							{BOT_SPEEDS.map((sp) => (
								<button
									key={sp}
									type="button"
									aria-pressed={botSpeed === sp}
									onClick={() => setBotSpeed(sp)}
								>
									{SPEED_LABEL[sp]}
								</button>
							))}
						</div>
					</>
				)}
				<button
					type="button"
					className="pb-pill"
					onClick={() => {
						close()
						openReference()
					}}
				>
					Reference
				</button>
				<p className="pb-note">Rules, card list, Shorthand and deck review.</p>
				<button
					type="button"
					className={`pb-pill${confirmNew ? ' pb-danger' : ''}`}
					onClick={() => {
						if (online !== null) {
							close()
							newGame()
							window.location.hash = 'hails'
							return
						}
						if (!confirmNew) {
							setConfirmNew(true)
							return
						}
						close()
						newGame()
					}}
				>
					{online !== null
						? 'Back to Hails'
						: confirmNew
							? 'Really leave this game? (it is saved)'
							: 'New game'}
				</button>
			</div>
		</SheetFrame>
	)
}

// ---------------------------------------------------------------------------
// Pile browser, Crew drawer
// ---------------------------------------------------------------------------

export function PileSheet({
	label,
	iids,
}: {
	label: string
	iids: CardInstanceId[]
}) {
	const close = useClose()
	const projected = useProjected()
	const live = iids.filter((iid) => projected?.cards[iid] !== undefined)
	return (
		<SheetFrame
			title={`${label} · ${live.length}`}
			label={`${label} pile`}
			tall
			onClose={close}
			sub="Public information: every card in this pile."
		>
			<div className="pb-stack">
				{live.map((iid) => (
					<CardTile key={iid} iid={iid} show="all" />
				))}
			</div>
		</SheetFrame>
	)
}

export function CrewDrawer() {
	const close = useClose()
	const viewer = useViewerSeat()
	return (
		<SheetFrame
			title="Crew"
			label="Crew board"
			onClose={close}
			className="pb-drawer"
			tall
		>
			<CrewBoardView seat={viewer} />
		</SheetFrame>
	)
}
