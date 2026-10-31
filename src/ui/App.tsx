// Root app shell (todo/14). Three screens:
//   - SetupScreen  — pick two decks / board sides / seed, start a game
//   - GameScreen   — board + areas + hand + log + choice panel, hot-seat flow
//   - EndScreen    — winner banner + scoring breakdown (EndScreen.tsx, todo/10)
// plus the overlay hosts (CardDetail, PileBrowser, Rules drawer, Card List).
//
// Components never read the raw state — everything renders `useProjected()`.

import { useEffect, useMemo, useState } from 'react'
import { SOLO_LEVELS, type GameState, type SoloLevel } from '../engine/state'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import type { DeckId } from '../data/ids'
import type { Seat } from '../engine/resolver/queries'
import { availableDecks } from './browserCatalog'
import {
	useProjected,
	useGameStore,
	useCatalog,
	undoPolicyLabel,
} from './store'
import { CardDetailHost, PileBrowserHost } from './cards'
import { RulesDrawer, CardListPanel } from './rules'
import { DeckReview } from './deckReview'
import { isDesktop, openCardDatabase } from '../desktop/bridge'
import { SavedGamesPanel } from './load'
import { ReplayHost } from './replay'
import { useShell, type Shell } from './mobile/shell'
import { OnlineLobby, useOnlineRoute } from './online/OnlineLobby'
import { RecapView } from './online/Recap'
import { ShorthandGuide } from './guide/ShorthandGuide'
import { useDefIndex } from './defs'
import { MobileShell } from './mobile/MobileShell'
import { ConsoleShell } from './console/ConsoleShell'
import { SettingsPanel } from './SettingsPanel'
import { ThemeSwitch } from './ThemeSwitch'
import { deckLabel } from '../data/cardNames'
import type { BotId } from '../bot/types'
import {
	BOT_LEVELS,
	BOT_LEVEL_LABEL,
	hasBots,
	isBotId,
	type Opponents,
} from '../session/opponents'
import { EndScreen } from './EndScreen'
import { SOLO_LEVEL_LABEL } from './solo/labels'

function useRuleAnchor(): [string | null, (a: string | null) => void] {
	const [anchor, setAnchor] = useState<string | null>(null)
	useEffect(() => {
		const listener = (e: Event) => {
			const v = (e as CustomEvent<string>).detail
			setAnchor(typeof v === 'string' ? v : null)
		}
		window.addEventListener('codex:open-rule', listener)
		return () => window.removeEventListener('codex:open-rule', listener)
	}, [])
	return [anchor, setAnchor]
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
	const catalog = useCatalog()
	const loadCatalog = useGameStore((s) => s.loadCatalog)
	const [ruleAnchor, setRuleAnchor] = useRuleAnchor()
	const inGame = useGameStore((s) => s.state !== null && s.session !== null)
	const online = useGameStore((s) => s.online !== null)
	// phone / phone-wide / tablet / console (docs/ui-mobile.md §2)
	const { shell: chosen } = useShell()
	// the LCARS console plays local games; an online game on a wide screen
	// uses the tablet shell, which reads only the seat view
	const shell: Shell = online && chosen === 'console' ? 'tablet' : chosen
	const route = useOnlineRoute()

	useEffect(() => {
		loadCatalog()
	}, [loadCatalog])
	// going to Hails or New (a link, a bookmark, the back button) leaves the
	// open online game; an invite link switches games itself
	useEffect(() => {
		if ((route === 'hails' || route === 'new') && online)
			useGameStore.getState().newGame()
	}, [route, online])

	return (
		<div className="app">
			{route !== null && catalog !== null ? (
				<OnlineLobby key={route} route={route} />
			) : online ? (
				<OnlineGame shell={shell} />
			) : !inGame ? (
				<SetupScreen catalogReady={catalog !== null} />
			) : (
				<GameFlow shell={shell} />
			)}
			<Overlays
				ruleAnchor={ruleAnchor}
				setRuleAnchor={setRuleAnchor}
				shell={shell}
			/>
		</div>
	)
}

/** An open online game: connecting, then "Previously on…" when there is news
 *  from the other captain, then the bridge (docs/ui-mobile.md §5). */
function OnlineGame({ shell }: { shell: Shell }) {
	const online = useGameStore((s) => s.online)
	const error = useGameStore((s) => s.error)
	const dismissRecap = useGameStore((s) => s.dismissRecap)
	const defs = useDefIndex()
	if (online === null) return null
	const view = online.view
	if (view === null || (online.recap === null && !online.recapSeen))
		return (
			<main className="ol-screen">
				<p className="ol-sub">Connecting to the game server…</p>
				{error !== null && (
					<>
						<p className="ol-alert" role="alert">
							{error}
						</p>
						<button
							type="button"
							className="ol-pill"
							onClick={() => {
								useGameStore.getState().newGame()
								window.location.hash = 'hails'
							}}
						>
							Back to Hails
						</button>
					</>
				)}
			</main>
		)
	if (!online.recapSeen && online.recap !== null)
		return (
			<RecapView
				recap={online.recap}
				names={[
					view.players[0].name ?? deckLabel(view.players[0].deck),
					view.players[1].name ?? deckLabel(view.players[1].deck),
				]}
				defs={defs}
				defOfIid={(iid) => view.state.cards[iid]?.def ?? null}
				onContinue={dismissRecap}
			/>
		)
	return <GameFlow shell={shell} />
}

function Overlays({
	ruleAnchor,
	setRuleAnchor,
	shell,
}: {
	ruleAnchor: string | null
	setRuleAnchor: (a: string | null) => void
	shell: Shell
}) {
	const rulesOpen = useGameStore((s) => s.rulesOpen)
	const cardListOpen = useGameStore((s) => s.cardListOpen)
	const deckReviewOpen = useGameStore((s) => s.deckReviewOpen)
	const setRulesOpen = useGameStore((s) => s.setRulesOpen)
	const setCardListOpen = useGameStore((s) => s.setCardListOpen)
	const setDeckReviewOpen = useGameStore((s) => s.setDeckReviewOpen)
	const guide = useGameStore((s) => s.guide)
	const openGuide = useGameStore((s) => s.openGuide)
	const closeGuide = useGameStore((s) => s.closeGuide)
	const settingsOpen = useGameStore((s) => s.settingsOpen)
	const setSettingsOpen = useGameStore((s) => s.setSettingsOpen)
	return (
		<>
			{/* the phone shells draw the same detail as a Rosetta sheet */}
			{shell === 'console' && <CardDetailHost />}
			<PileBrowserHost />
			<ReplayHost />
			{rulesOpen && (
				<RulesDrawer
					openAnchor={ruleAnchor}
					onClose={() => {
						setRulesOpen(false)
						setRuleAnchor(null)
					}}
				/>
			)}
			{cardListOpen && <CardListPanel onClose={() => setCardListOpen(false)} />}
			{deckReviewOpen && (
				<DeckReview onClose={() => setDeckReviewOpen(false)} />
			)}
			{guide !== null && (
				<ShorthandGuide
					section={guide}
					onSection={openGuide}
					onClose={closeGuide}
				/>
			)}
			{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
		</>
	)
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

/** Who sits in a seat on the setup screen: a human at the device or a
 *  house-AI level. */
type SeatController = 'human' | BotId

const SEATS_KEY = 'ready-room:setup-seats'

/** The last seat choice on this device (localStorage; two humans if none). */
function loadSeats(): [SeatController, SeatController] {
	const parse = (v: unknown): SeatController =>
		isBotId(v) && BOT_LEVELS.includes(v) ? v : 'human'
	try {
		const raw = JSON.parse(
			globalThis.localStorage?.getItem(SEATS_KEY) ?? 'null',
		) as unknown
		if (Array.isArray(raw)) return [parse(raw[0]), parse(raw[1])]
	} catch {
		// unreadable: fall back to hot-seat
	}
	return ['human', 'human']
}

function saveSeats(seats: [SeatController, SeatController]): void {
	try {
		globalThis.localStorage?.setItem(SEATS_KEY, JSON.stringify(seats))
	} catch {
		// per-device convenience only
	}
}

function opponentsOf(
	seats: readonly [SeatController, SeatController],
): Opponents | undefined {
	const out: Opponents = {}
	if (seats[0] !== 'human') out[0] = seats[0]
	if (seats[1] !== 'human') out[1] = seats[1]
	return hasBots(out) ? out : undefined
}

function SetupScreen({ catalogReady }: { catalogReady: boolean }) {
	const catalog = useCatalog()
	const startGame = useGameStore((s) => s.startGame)
	const error = useGameStore((s) => s.error)
	const savedMode = useGameStore((s) =>
		s.session !== null ? s.session.setup.mode : undefined,
	)
	const decks = useMemo<DeckId[]>(
		() => (catalog !== null ? availableDecks(catalog) : []),
		[catalog],
	)
	const [seat0, setSeat0] = useState<DeckId>('PIC')
	const [seat1, setSeat1] = useState<DeckId>('SHR')
	const [side0, setSide0] = useState<'BASIC' | 'ADVANCED'>('BASIC')
	const [side1, setSide1] = useState<'BASIC' | 'ADVANCED'>('BASIC')
	const [seed, setSeed] = useState(12345)
	const [seats, setSeatsState] =
		useState<[SeatController, SeatController]>(loadSeats)
	const setSeat = (seat: Seat, c: SeatController) => {
		const next: [SeatController, SeatController] =
			seat === 0 ? [c, seats[1]] : [seats[0], c]
		setSeatsState(next)
		saveSeats(next)
	}

	useEffect(() => {
		if (decks.length === 0) return
		if (!decks.includes(seat0)) setSeat0(decks[0]!)
		if (!decks.includes(seat1)) setSeat1(decks[Math.min(1, decks.length - 1)]!)
	}, [decks, seat0, seat1])

	const start = (
		controllers: readonly [SeatController, SeatController] = seats,
	) => {
		const config: SetupConfig = {
			mode: 'TWO_PLAYER',
			players: [
				{ deck: seat0, boardSide: side0 },
				{ deck: seat1, boardSide: side1 },
			],
			seed,
		}
		startGame(config, opponentsOf(controllers))
	}
	// one click to a game against the house AI: you as Player 1, the level
	// last picked for Player 2 (Normal by default)
	const quickLevel: BotId = seats[1] !== 'human' ? seats[1] : 'normal'
	const playVsAi = () => {
		const next: [SeatController, SeatController] = ['human', quickLevel]
		setSeatsState(next)
		saveSeats(next)
		start(next)
	}

	return (
		<main className="setup-screen">
			<h1>Ready Room</h1>
			<p className="muted">
				Pick the two captains, who plays each seat and the seed (reproducible
				games).
			</p>
			{!catalogReady ? (
				<p>Loading cards…</p>
			) : (
				<div className="setup-form">
					<button
						type="button"
						className="btn"
						onClick={() => useGameStore.getState().setDeckReviewOpen(true)}
					>
						Review decks
					</button>
					<DeckPicker
						label="Player 1"
						decks={decks}
						deck={seat0}
						onDeck={setSeat0}
						side={side0}
						onSide={setSide0}
						controller={seats[0]}
						onController={(c) => setSeat(0, c)}
					/>
					<DeckPicker
						label="Player 2"
						decks={decks}
						deck={seat1}
						onDeck={setSeat1}
						side={side1}
						onSide={setSide1}
						controller={seats[1]}
						onController={(c) => setSeat(1, c)}
					/>
					<p className="muted small house-ai-hint">
						House AI: a computer opponent of our own. For the game’s official
						solo Bot, see “Solo vs the Bot” below.
					</p>
					<label className="seed-field">
						Seed
						<input
							type="number"
							value={seed}
							onChange={(e) => setSeed(Number(e.target.value))}
							aria-label="random seed"
						/>
					</label>
					<button
						type="button"
						className="btn btn-primary btn-lg"
						onClick={() => start()}
						disabled={seat0 === seat1}
					>
						{seats[0] === 'human' && seats[1] === 'human'
							? 'Start game'
							: seats[0] !== 'human' && seats[1] !== 'human'
								? 'Watch the House AI'
								: 'Start game vs House AI'}
					</button>
					{seats[0] === 'human' && seats[1] === 'human' && (
						<button
							type="button"
							className="btn btn-lg"
							onClick={playVsAi}
							disabled={seat0 === seat1}
						>
							Play vs House AI ({BOT_LEVEL_LABEL[quickLevel]})
						</button>
					)}
					{seat0 === seat1 && (
						<p className="muted small">The two captains must differ.</p>
					)}
					{catalog !== null && (
						<SoloSetup
							catalog={catalog}
							you={seat0}
							side={side0}
							seed={seed}
							onStart={(config) => startGame(config, undefined)}
						/>
					)}
					<button
						type="button"
						className="btn btn-lg"
						onClick={() => {
							window.location.hash = 'hails'
						}}
					>
						Play online
					</button>
					<button
						type="button"
						className="btn"
						onClick={() => useGameStore.getState().openGuide()}
					>
						Learn the card glyphs
					</button>
					{isDesktop() && (
						<button type="button" className="btn" onClick={openCardDatabase}>
							Card database
						</button>
					)}
					{error !== null && <p className="error-text">{error}</p>}
				</div>
			)}
			{catalogReady && catalog !== null ? (
				<SavedGamesPanel catalog={catalog} />
			) : null}
			<div className="setup-theme">
				<ThemeSwitch />
			</div>
			<p className="muted small setup-note">
				Games autosave here as you play (intent log, ~1 s debounce) — refresh
				mid-turn and Continue to resume.{' '}
				<span className="undo-policy-chip">{undoPolicyLabel(savedMode)}</span>
			</p>
		</main>
	)
}

/** Solo against the game's official Bot (rules/13): your captain is Player 1's
 *  pick; choose the Bot's crew, the difficulty and the Conspiring Admirals
 *  challenge. */
function SoloSetup({
	catalog,
	you,
	side,
	seed,
	onStart,
}: {
	catalog: CardCatalog
	you: DeckId
	side: 'BASIC' | 'ADVANCED'
	seed: number
	onStart: (config: SetupConfig) => void
}) {
	const botCrews = useMemo<DeckId[]>(
		() => (catalog.bots ?? []).map((b) => b.deck),
		[catalog],
	)
	const [crew, setCrew] = useState<DeckId | null>(null)
	const [level, setLevel] = useState<SoloLevel>('ENSIGN')
	const [admirals, setAdmirals] = useState(false)
	const choices = botCrews.filter((d) => d !== you)
	const bot =
		crew !== null && choices.includes(crew) ? crew : (choices[0] ?? null)
	if (botCrews.length === 0) return null
	return (
		<section className="solo-setup" aria-label="Solo vs the official Bot">
			<h2>Solo vs the Bot</h2>
			<p className="muted small">
				The game’s official solo opponent: it resolves its cards through its
				crew’s Automated Command cards. You play Player 1’s captain.
			</p>
			<div className="deck-picker">
				<strong>The Bot</strong>
				<select
					value={bot ?? ''}
					onChange={(e) => setCrew(e.target.value as DeckId)}
					aria-label="The Bot’s crew"
				>
					{choices.map((d) => (
						<option key={d} value={d}>
							{deckLabel(d)}
						</option>
					))}
				</select>
				<select
					value={level}
					onChange={(e) => setLevel(e.target.value as SoloLevel)}
					aria-label="Difficulty"
				>
					{SOLO_LEVELS.map((l) => (
						<option key={l} value={l}>
							{SOLO_LEVEL_LABEL[l]}
						</option>
					))}
				</select>
			</div>
			<label className="muted small">
				<input
					type="checkbox"
					checked={admirals}
					onChange={(e) => setAdmirals(e.target.checked)}
				/>{' '}
				Conspiring Admirals challenge (for Captain and Admiral)
			</label>
			<button
				type="button"
				className="btn btn-primary btn-lg"
				disabled={bot === null}
				onClick={() =>
					bot !== null &&
					onStart({
						mode: 'SOLO',
						players: [
							{ deck: you, boardSide: side },
							{ deck: bot, boardSide: 'BASIC' },
						],
						seed,
						solo: { level, conspiringAdmirals: admirals },
					})
				}
			>
				Play solo vs the Bot
			</button>
		</section>
	)
}

function DeckPicker({
	label,
	decks,
	deck,
	onDeck,
	side,
	onSide,
	controller,
	onController,
}: {
	label: string
	decks: DeckId[]
	deck: DeckId
	onDeck: (d: DeckId) => void
	side: 'BASIC' | 'ADVANCED'
	onSide: (s: 'BASIC' | 'ADVANCED') => void
	controller: SeatController
	onController: (c: SeatController) => void
}) {
	return (
		<div className="deck-picker">
			<strong>{label}</strong>
			<select
				value={controller}
				onChange={(e) => onController(e.target.value as SeatController)}
				aria-label={`${label} played by`}
			>
				<option value="human">Human</option>
				{BOT_LEVELS.map((id) => (
					<option key={id} value={id}>
						House AI — {BOT_LEVEL_LABEL[id]}
					</option>
				))}
			</select>
			<select
				value={deck}
				onChange={(e) => onDeck(e.target.value as DeckId)}
				aria-label={`${label} deck`}
			>
				{decks.map((d) => (
					<option key={d} value={d}>
						{deckLabel(d)}
					</option>
				))}
			</select>
			<div
				className="side-toggle"
				role="group"
				aria-label={`${label} board side`}
			>
				{(['BASIC', 'ADVANCED'] as const).map((s) => (
					<button
						key={s}
						type="button"
						className={`btn micro${side === s ? ' btn-active' : ''}`}
						onClick={() => onSide(s)}
					>
						{s}
					</button>
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// In-game flow
// ---------------------------------------------------------------------------

function GameFlow({ shell }: { shell: Shell }) {
	const projected = useProjected()
	if (projected === null) {
		return (
			<main className="game-screen">
				<p>Loading…</p>
			</main>
		)
	}
	const state = projected as unknown as GameState
	if (state.result !== null && state.result.kind === 'COMPLETE') {
		return <EndScreen onNewGame={() => useGameStore.getState().newGame()} />
	}
	if (shell !== 'console') return <MobileShell shell={shell} />
	return <ConsoleShell state={state} />
}
