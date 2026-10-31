// The start screen (todo/14): an LCARS frame around the four ways to play —
// a skirmish at one table (hot-seat or against the House AI), solo against the
// game's official Bot (rules/13), the Five-Year Mission (rules/14) and online
// play — with the saved games beside them. The rail picks the mode; the stage
// seats the captains: a dossier per seat and a roster that fills the seat
// being chosen (picking the other seat's captain swaps the two, so the two
// captains always differ). Mode and seat controllers are remembered per device.

import {
	useEffect,
	useMemo,
	useState,
	type CSSProperties,
	type ReactNode,
} from 'react'
import { SOLO_LEVELS, type SoloLevel } from '../../engine/state'
import type { SetupConfig } from '../../engine/setup'
import type { DeckId } from '../../data/ids'
import type { Seat } from '../../engine/resolver/queries'
import type { BotId } from '../../bot/types'
import {
	BOT_LEVELS,
	BOT_LEVEL_LABEL,
	hasBots,
	isBotId,
	type Opponents,
} from '../../session/opponents'
import { RANKS } from '../../session/campaign'
import { isDesktop, openCardDatabase } from '../../desktop/bridge'
import { availableDecks } from '../browserCatalog'
import { useCatalog, useGameStore, undoPolicyLabel } from '../store'
import { SavedGamesPanel } from '../load'
import { ThemeSwatches } from '../ThemeSwitch'
import { THEMES, useTheme } from '../theme'
import { RANK_LABEL, SOLO_LEVEL_LABEL } from '../solo/labels'
import { CampaignSetupPanel } from '../solo/Campaign'
import { go } from '../online/OnlineLobby'
import { loadSeats as loadOnlineSeats } from '../online/seats'
import { Dossier, Field, RankPips, Roster, Segmented, VsBadge } from './parts'
import './launch.css'

type Side = 'BASIC' | 'ADVANCED'

/** Who sits in a seat: a human at the device or a House AI level. */
type SeatController = 'human' | BotId

type Mode = 'skirmish' | 'solo' | 'campaign' | 'online'

const MODES: readonly { v: Mode; label: string; code: string }[] = [
	{ v: 'skirmish', label: 'Skirmish', code: '01' },
	{ v: 'solo', label: 'Solo vs the Bot', code: '02' },
	{ v: 'campaign', label: 'Five-Year Mission', code: '03' },
	{ v: 'online', label: 'Online', code: '04' },
]

const SEATS_KEY = 'ready-room:setup-seats'
const MODE_KEY = 'ready-room:launch-mode'

function readKey(key: string): unknown {
	try {
		return JSON.parse(
			globalThis.localStorage?.getItem(key) ?? 'null',
		) as unknown
	} catch {
		return null
	}
}

function writeKey(key: string, value: unknown): void {
	try {
		globalThis.localStorage?.setItem(key, JSON.stringify(value))
	} catch {
		// per-device convenience only
	}
}

/** The last seat choice on this device (two humans if none). */
function loadSeats(): [SeatController, SeatController] {
	const parse = (v: unknown): SeatController =>
		isBotId(v) && BOT_LEVELS.includes(v) ? v : 'human'
	const raw = readKey(SEATS_KEY)
	return Array.isArray(raw)
		? [parse(raw[0]), parse(raw[1])]
		: ['human', 'human']
}

function loadMode(): Mode {
	const raw = readKey(MODE_KEY)
	return MODES.find((m) => m.v === raw)?.v ?? 'skirmish'
}

function opponentsOf(
	seats: readonly [SeatController, SeatController],
): Opponents | undefined {
	const out: Opponents = {}
	if (seats[0] !== 'human') out[0] = seats[0]
	if (seats[1] !== 'human') out[1] = seats[1]
	return hasBots(out) ? out : undefined
}

function roleOf(c: SeatController): string {
	return c === 'human' ? 'Human' : `House AI · ${BOT_LEVEL_LABEL[c]}`
}

/** A playful stardate for the frame: the year and how far through it we are. */
function stardate(now: Date): string {
	const y = now.getFullYear()
	const start = new Date(y, 0, 1).getTime()
	const end = new Date(y + 1, 0, 1).getTime()
	const part = Math.floor(((now.getTime() - start) / (end - start)) * 100)
	return `${y}.${String(part).padStart(2, '0')}`
}

const randomSeed = () => 10000 + Math.floor(Math.random() * 90000)

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function LaunchScreen({ catalogReady }: { catalogReady: boolean }) {
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
	const botCrews = useMemo<DeckId[]>(
		() => (catalog?.bots ?? []).map((b) => b.deck),
		[catalog],
	)
	const [mode, setModeState] = useState<Mode>(loadMode)
	const [pick, setPick] = useState<[DeckId, DeckId]>(['PIC', 'SHR'])
	const [sides, setSides] = useState<[Side, Side]>(['BASIC', 'BASIC'])
	const [seats, setSeatsState] =
		useState<[SeatController, SeatController]>(loadSeats)
	const [seed, setSeed] = useState(12345)
	const [active, setActive] = useState<Seat>(0)
	const [botCrew, setBotCrew] = useState<DeckId | null>(null)
	const [level, setLevel] = useState<SoloLevel>('ENSIGN')
	const [admirals, setAdmirals] = useState(false)

	useEffect(() => {
		if (decks.length === 0) return
		const [a, b] = pick
		const okA = decks.includes(a) ? a : decks[0]!
		const okB =
			decks.includes(b) && b !== okA ? b : (decks.find((d) => d !== okA) ?? okA)
		if (okA !== a || okB !== b) setPick([okA, okB])
	}, [decks, pick])

	const setMode = (m: Mode) => {
		setModeState(m)
		writeKey(MODE_KEY, m)
	}
	const setSeat = (seat: Seat, c: SeatController) => {
		const next: [SeatController, SeatController] =
			seat === 0 ? [c, seats[1]] : [seats[0], c]
		setSeatsState(next)
		writeKey(SEATS_KEY, next)
	}
	const seatDeck = (seat: Seat, d: DeckId) =>
		setPick(([a, b]) =>
			seat === 0 ? [d, d === b ? a : b] : [d === a ? b : a, d],
		)
	const setSide = (seat: Seat, s: Side) =>
		setSides(([a, b]) => (seat === 0 ? [s, b] : [a, s]))

	// solo: you are Player 1's captain; the Bot is a crew with Automated
	// Command cards other than yours
	const you = pick[0]
	const botChoices = botCrews.filter((d) => d !== you)
	const bot =
		botCrew !== null && botChoices.includes(botCrew)
			? botCrew
			: (botChoices[0] ?? null)
	const pickSolo = (d: DeckId) => {
		if (active === 1) return setBotCrew(d)
		if (d === bot) setBotCrew(botCrews.includes(you) ? you : null)
		seatDeck(0, d)
	}

	const start = (
		controllers: readonly [SeatController, SeatController] = seats,
	) => {
		const config: SetupConfig = {
			mode: 'TWO_PLAYER',
			players: [
				{ deck: pick[0], boardSide: sides[0] },
				{ deck: pick[1], boardSide: sides[1] },
			],
			seed,
		}
		startGame(config, opponentsOf(controllers))
	}
	// one click to a game against the House AI: you as Player 1, the level
	// last picked for Player 2 (Normal by default)
	const quickLevel: BotId = seats[1] !== 'human' ? seats[1] : 'normal'
	const playVsAi = () => {
		const next: [SeatController, SeatController] = ['human', quickLevel]
		setSeatsState(next)
		writeKey(SEATS_KEY, next)
		start(next)
	}
	const startSolo = () => {
		if (bot === null) return
		startGame(
			{
				mode: 'SOLO',
				players: [
					{ deck: you, boardSide: sides[0] },
					{ deck: bot, boardSide: 'BASIC' },
				],
				seed,
				solo: { level, conspiringAdmirals: admirals },
			},
			undefined,
		)
	}

	const ready = catalogReady && catalog !== null
	const label = MODES.find((m) => m.v === mode)!.label
	const sideField = (seat: Seat, who: string) => (
		<Field label="Board side">
			<Segmented
				label={`${who} board side`}
				value={sides[seat]}
				onChange={(s) => setSide(seat, s)}
				options={[
					{ v: 'BASIC', text: 'Basic' },
					{ v: 'ADVANCED', text: 'Advanced' },
				]}
			/>
		</Field>
	)

	let stage: ReactNode = <Loading />
	if (ready && mode === 'skirmish') {
		const humans = seats[0] === 'human' && seats[1] === 'human'
		stage = (
			<Stage
				title="Skirmish"
				lede="Two captains at one table. Pass the device between turns, or hand either chair to the House AI."
			>
				<div className="lr-viewscreen">
					<div className="lr-matchup">
						{([0, 1] as const).map((s) => (
							<Dossier
								key={s}
								catalog={catalog}
								deck={pick[s]}
								seat={s}
								tag={`Player ${s + 1}`}
								role={roleOf(seats[s])}
								active={active === s}
								onActivate={() => setActive(s)}
							>
								<Field label="Played by">
									<Segmented
										label={`Player ${s + 1} played by`}
										value={seats[s]}
										onChange={(c) => setSeat(s, c)}
										className="lr-seg-controller"
										options={[
											{ v: 'human', text: 'Human' },
											...BOT_LEVELS.map((id) => ({
												v: id,
												text: BOT_LEVEL_LABEL[id],
												name: `House AI — ${BOT_LEVEL_LABEL[id]}`,
												group: 'House AI',
											})),
										]}
									/>
								</Field>
								{sideField(s, `Player ${s + 1}`)}
							</Dossier>
						))}
						<VsBadge />
					</div>
				</div>
				<p className="lr-hint">
					House AI: a computer opponent of our own. For the game’s official solo
					Bot, pick “Solo vs the Bot”.
				</p>
				<Roster
					catalog={catalog}
					decks={decks}
					seated={pick}
					seatTags={['Player 1', 'Player 2']}
					active={active}
					enabled={() => true}
					onPick={(d) => seatDeck(active, d)}
				/>
				<LaunchBar seed={seed} onSeed={setSeed}>
					{humans && (
						<button
							type="button"
							className="lr-go-alt"
							onClick={playVsAi}
							disabled={pick[0] === pick[1]}
						>
							Play vs House AI ({BOT_LEVEL_LABEL[quickLevel]})
						</button>
					)}
					<button
						type="button"
						className="lr-go"
						onClick={() => start()}
						disabled={pick[0] === pick[1]}
					>
						{humans
							? 'Start game'
							: seats[0] !== 'human' && seats[1] !== 'human'
								? 'Watch the House AI'
								: 'Start game vs House AI'}
					</button>
				</LaunchBar>
			</Stage>
		)
	} else if (ready && mode === 'solo') {
		stage = (
			<Stage
				title="Solo vs the Bot"
				lede="The game’s official solo opponent: it resolves its cards through its crew’s Automated Command cards. Your captain is Player 1’s."
			>
				{botCrews.length === 0 ? (
					<p className="lr-hint">No crew with Automated Command cards yet.</p>
				) : (
					<>
						<div className="lr-viewscreen">
							<div className="lr-matchup">
								<Dossier
									catalog={catalog}
									deck={you}
									seat={0}
									tag="You"
									role="Human"
									active={active === 0}
									onActivate={() => setActive(0)}
								>
									{sideField(0, 'Your')}
								</Dossier>
								<Dossier
									catalog={catalog}
									deck={bot}
									seat={1}
									tag="The Bot"
									role={SOLO_LEVEL_LABEL[level]}
									active={active === 1}
									onActivate={() => setActive(1)}
								>
									<Field
										label={
											<>
												Difficulty · <b>{SOLO_LEVEL_LABEL[level]}</b>
											</>
										}
									>
										<Segmented
											label="Difficulty"
											value={level}
											onChange={setLevel}
											className="lr-seg-ranks"
											options={SOLO_LEVELS.map((l) => ({
												v: l,
												text: <RankPips rank={l} />,
												name: SOLO_LEVEL_LABEL[l],
											}))}
										/>
									</Field>
									<label className="lr-switch">
										<input
											type="checkbox"
											checked={admirals}
											onChange={(e) => setAdmirals(e.target.checked)}
										/>
										<span className="lr-switch-track" aria-hidden="true" />
										<span>
											Conspiring Admirals challenge{' '}
											<span className="muted">(for Captain and Admiral)</span>
										</span>
									</label>
								</Dossier>
								<VsBadge />
							</div>
						</div>
						<Roster
							catalog={catalog}
							decks={decks}
							seated={[you, bot]}
							seatTags={['You', 'The Bot']}
							active={active}
							enabled={(d) =>
								active === 0 || (botCrews.includes(d) && d !== you)
							}
							onPick={pickSolo}
						/>
						<LaunchBar seed={seed} onSeed={setSeed}>
							<button
								type="button"
								className="lr-go"
								disabled={bot === null}
								onClick={startSolo}
							>
								Play solo vs the Bot
							</button>
						</LaunchBar>
					</>
				)}
			</Stage>
		)
	} else if (ready && mode === 'campaign') {
		stage = (
			<Stage
				title="Five-Year Mission"
				lede="A campaign of solo games against the Bot with Player 1’s captain. Every win promotes you; after every game you upgrade your deck. It ends at Admiral or after ten games."
			>
				<div className="lr-viewscreen">
					<div className="lr-matchup lr-matchup-one">
						<Dossier
							catalog={catalog}
							deck={you}
							seat={0}
							tag="Your captain"
							role="Human"
							active={null}
							onActivate={() => undefined}
						>
							{sideField(0, 'Your')}
						</Dossier>
						<RankLadder />
					</div>
				</div>
				<Roster
					catalog={catalog}
					decks={decks}
					seated={[you, null]}
					seatTags={['Your captain', '']}
					active={0}
					enabled={() => true}
					onPick={(d) => seatDeck(0, d)}
				/>
				<CampaignSetupPanel catalog={catalog} you={you} side={sides[0]} />
			</Stage>
		)
	} else if (ready && mode === 'online') {
		stage = <OnlinePanel />
	}

	return (
		<main className={`launch lr-mode-${mode}`}>
			<LaunchHead />
			<nav className="lr-rail lr-modes" aria-label="Ways to play">
				{MODES.map((m, i) => (
					<button
						key={m.v}
						type="button"
						className={`lr-block lr-mode-${m.v}${mode === m.v ? ' is-lit' : ''}`}
						style={{ '--i': i } as CSSProperties}
						aria-pressed={mode === m.v}
						onClick={() => setMode(m.v)}
					>
						<span className="lr-block-code">{m.code}</span>
						<span className="lr-block-label">{m.label}</span>
					</button>
				))}
			</nav>
			<Utilities />
			<section className="lr-main" aria-label={label}>
				{stage}
				{error !== null && (
					<p className="error-text lr-error" role="alert">
						{error}
					</p>
				)}
			</section>
			<aside className="lr-log">
				{ready ? <SavedGamesPanel catalog={catalog} /> : null}
			</aside>
			<LaunchFoot note={undoPolicyLabel(savedMode)} />
		</main>
	)
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function LaunchHead() {
	const theme = useTheme()
	const [sd] = useState(() => stardate(new Date()))
	return (
		<header className="lr-head">
			<div className="lr-elbow lr-elbow-top">
				<span className="lr-elbow-label">SD {sd}</span>
			</div>
			<div className="lr-head-body">
				<div className="lr-bar" aria-hidden="true">
					<span className="lr-bar-long" />
					<span className="lr-bar-mode" />
					<span className="lr-bar-end" />
				</div>
				<div className="lr-title-row">
					<div className="lr-title">
						<h1>Ready Room</h1>
						<p>Choose your mission, Captain.</p>
					</div>
					<div className="lr-head-tools">
						<span className="lr-theme-name">
							{THEMES.find((t) => t.v === theme)?.label}
						</span>
						<ThemeSwatches />
					</div>
				</div>
			</div>
		</header>
	)
}

function LaunchFoot({ note }: { note: string }) {
	return (
		<footer className="lr-foot">
			<div className="lr-elbow lr-elbow-bottom" aria-hidden="true" />
			<div className="lr-foot-body">
				<p className="lr-foot-note">
					Games autosave as you play (intent log, ~1 s debounce): refresh
					mid-turn and Continue to resume.{' '}
					<span className="undo-policy-chip">{note}</span>
				</p>
				<div className="lr-bar lr-bar-foot" aria-hidden="true">
					<span className="lr-bar-long" />
					<span className="lr-bar-mode" />
					<span className="lr-bar-end" />
				</div>
			</div>
		</footer>
	)
}

/** The reference blocks at the foot of the rail. */
function Utilities() {
	const store = useGameStore.getState
	const items: { label: string; onClick: () => void }[] = [
		{ label: 'Rules', onClick: () => store().setRulesOpen(true) },
		{ label: 'Card list', onClick: () => store().setCardListOpen(true) },
		{ label: 'Review decks', onClick: () => store().setDeckReviewOpen(true) },
		{ label: 'Card glyphs', onClick: () => store().openGuide() },
		...(isDesktop()
			? [{ label: 'Card database', onClick: () => void openCardDatabase() }]
			: []),
		{ label: 'Settings', onClick: () => store().setSettingsOpen(true) },
	]
	return (
		<nav className="lr-rail lr-utils" aria-label="Reference">
			<span className="lr-block lr-filler" aria-hidden="true" />
			{items.map((it, i) => (
				<button
					key={it.label}
					type="button"
					className="lr-block lr-util"
					style={{ '--i': i + MODES.length } as CSSProperties}
					onClick={it.onClick}
				>
					<span className="lr-block-label">{it.label}</span>
				</button>
			))}
		</nav>
	)
}

// ---------------------------------------------------------------------------
// Stage pieces
// ---------------------------------------------------------------------------

function Stage({
	title,
	lede,
	children,
}: {
	title: string
	lede: string
	children: ReactNode
}) {
	return (
		<div className="lr-stage">
			<header className="lr-stage-head">
				<h2>{title}</h2>
				<p>{lede}</p>
			</header>
			{children}
		</div>
	)
}

function Loading() {
	return (
		<div className="lr-loading" role="status">
			<span className="lr-loading-bar" aria-hidden="true" />
			Loading cards…
		</div>
	)
}

/** The seed and the start buttons, at the foot of a stage. */
function LaunchBar({
	seed,
	onSeed,
	children,
}: {
	seed: number
	onSeed: (n: number) => void
	children: ReactNode
}) {
	return (
		<div className="lr-launchbar">
			<div className="lr-seed">
				<label>
					<span className="lr-field-label">Seed</span>
					<input
						type="number"
						value={seed}
						onChange={(e) => onSeed(Number(e.target.value))}
						aria-label="random seed"
					/>
				</label>
				<button
					type="button"
					className="lr-reroll"
					onClick={() => onSeed(randomSeed())}
					aria-label="New random seed"
					title="New random seed"
				>
					<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
						<rect
							x="3.5"
							y="3.5"
							width="17"
							height="17"
							rx="4"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
						/>
						<circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
						<circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" />
						<circle cx="12" cy="12" r="1.6" fill="currentColor" />
					</svg>
				</button>
				<span className="lr-seed-hint">
					Same seed and captains, same shuffle.
				</span>
			</div>
			<div className="lr-ctas">{children}</div>
		</div>
	)
}

/** The Five-Year Mission's ranks, first game to last. */
function RankLadder() {
	return (
		<div className="lr-ladder">
			<h3>The ranks</h3>
			<ol>
				{RANKS.map((r, i) => (
					<li key={r} style={{ '--i': i } as CSSProperties}>
						<RankPips rank={r} />
						<span>{RANK_LABEL[r]}</span>
					</li>
				))}
			</ol>
			<p>Every win promotes you one rank.</p>
		</div>
	)
}

function OnlinePanel() {
	const [count] = useState(() => loadOnlineSeats().length)
	return (
		<Stage
			title="Online"
			lede="Play another captain over the game server, at your own pace: each of you takes a turn when it suits you, and the game waits."
		>
			<div className="lr-online">
				<button type="button" className="lr-action" onClick={() => go('hails')}>
					<span className="lr-action-code">04·1</span>
					<strong>Hails</strong>
					<span>
						{count === 0
							? 'Your online games and invitations.'
							: `${count} game${count === 1 ? '' : 's'} on this device.`}
					</span>
				</button>
				<button type="button" className="lr-action" onClick={() => go('new')}>
					<span className="lr-action-code">04·2</span>
					<strong>Hail a captain</strong>
					<span>Start a new game: pick your captain, then send the link.</span>
				</button>
			</div>
			<ol className="lr-steps">
				<li>
					<b>Hail</b>
					<span>Pick your captain; you get an invite link to send.</span>
				</li>
				<li>
					<b>Answer</b>
					<span>Your opponent opens the link and picks theirs.</span>
				</li>
				<li>
					<b>Play</b>
					<span>
						Take your turns whenever you like; Hails shows whose move it is.
					</span>
				</li>
			</ol>
		</Stage>
	)
}
