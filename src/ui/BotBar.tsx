// The house-AI strip (todo/15 §4) shown in a local game against the house AI.
// On the phone shells it is one strip; the LCARS console splits it — the
// status sits in the head bar (BotStatus), the ticker in the opponent band,
// and the strip itself is only the spectator's controls:
//
//   - the "thinking" indicator: which seat's bot is deciding, at what level
//     (nothing while it is your move — the top bar already says so);
//   - spectator games (both seats bots): Pause / Resume, Step (one bot
//     intent), whose side the view shows, and a reveal-both-hands toggle.
//
// The phone variant fits one row at 375 px: a short status ("P2 · Hard" with
// a pulsing dot while it thinks; the full sentence stays for screen readers)
// and icon buttons with labels in aria-label/title.
//
// The move speed (per device) lives in the settings (src/ui/SettingsPanel.tsx,
// the phone menu).
//
// Below the strip sits the AI move ticker, and the strip's Moves button opens
// the move history with its "Why?" panels (src/ui/BotTicker.tsx).
//
// It reads and drives only the store; the bots themselves run in the store's
// BotRunner (src/ui/botRunner.ts).

import type { BotId } from '../bot/types'
import type { Seat } from '../engine/resolver/queries'
import {
	BOT_LEVEL_LABEL,
	botLabel,
	hasBots,
	isSpectator,
} from '../session/opponents'
import { seatLabel } from './format'
import { useGameStore, type BotSpeed } from './store'
import {
	BotHighlight,
	BotHistory,
	BotHistoryButton,
	BotTicker,
} from './BotTicker'
import { BotBeatStrip } from './solo/AutomatedCommand'

export const SPEED_LABEL: Record<BotSpeed, string> = {
	slow: 'Slow',
	normal: 'Normal',
	fast: 'Fast',
	instant: 'Instant',
}

const seatShort = (seat: Seat): string => (seat === 0 ? 'P1' : 'P2')

/** The phone's one-word-ish status. */
function shortStatus(
	thinking: { seat: Seat; botId: BotId } | null,
	botToMove: BotId | null,
	over: boolean,
): string {
	if (over) return 'Game over'
	if (thinking !== null)
		return `${seatShort(thinking.seat)} · ${BOT_LEVEL_LABEL[thinking.botId]}…`
	if (botToMove !== null) return BOT_LEVEL_LABEL[botToMove]
	return ''
}

/** Tiny inline glyphs for the phone's icon buttons (currentColor). */
function Glyph({ k }: { k: 'pause' | 'play' | 'step' | 'eye' }) {
	return (
		<svg
			className="bot-glyph"
			viewBox="0 0 16 16"
			width="14"
			height="14"
			aria-hidden="true"
			focusable="false"
		>
			{k === 'pause' && (
				<path d="M4 2h3v12H4zM9 2h3v12H9z" fill="currentColor" />
			)}
			{k === 'play' && <path d="M4 2l10 6-10 6z" fill="currentColor" />}
			{k === 'step' && (
				<path d="M2 2l8 6-8 6zM11 2h3v12h-3z" fill="currentColor" />
			)}
			{k === 'eye' && (
				<g fill="none" stroke="currentColor" strokeWidth="1.6">
					<path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" />
					<circle cx="8" cy="8" r="2.2" fill="currentColor" />
				</g>
			)}
		</svg>
	)
}

function status(
	thinking: { seat: Seat; botId: BotId } | null,
	botToMove: BotId | null,
	paused: boolean,
	over: boolean,
): string {
	if (over) return 'Game over'
	if (thinking !== null)
		return `${botLabel(thinking.botId)} · ${seatLabel(thinking.seat)} is thinking…`
	if (botToMove !== null)
		return `${botLabel(botToMove)} to move${paused ? ' · paused' : ''}`
	return ''
}

export function BotBar({ variant }: { variant: 'console' | 'mobile' }) {
	const opponents = useGameStore((s) => s.session?.opponents)
	const local = useGameStore((s) => s.online === null)
	const over = useGameStore((s) => s.state !== null && s.state.result !== null)
	const thinking = useGameStore((s) => s.botThinking)
	const botToMove = useGameStore((s) => s.botToMove)
	const paused = useGameStore((s) => s.botPaused)
	const viewer = useGameStore((s) => s.viewerSeat)
	const revealAll = useGameStore((s) => s.revealAll)
	const solo = useGameStore((s) => s.state?.mode === 'SOLO')
	// against the official solo Bot the phone shows its beat strip instead
	// (the console carries it in the opponent band)
	if (solo) return variant === 'mobile' ? <BotBeatStrip /> : null
	if (!local || !hasBots(opponents)) return null
	const spectator = isSpectator(opponents)
	const store = useGameStore.getState
	if (variant === 'mobile')
		return (
			<>
				<div
					className="bot-bar bot-bar-mobile"
					role="group"
					aria-label="House AI"
				>
					<span
						className={`bot-status${thinking !== null ? ' bot-thinking' : ''}`}
						title={status(thinking, botToMove, paused, over)}
					>
						{thinking !== null ? (
							<span className="bot-pulse" aria-hidden="true" />
						) : (
							paused && botToMove !== null && !over && <Glyph k="pause" />
						)}
						<span aria-hidden="true">
							{shortStatus(thinking, botToMove, over)}
						</span>
						<span className="sr-only" role="status" aria-live="polite">
							{status(thinking, botToMove, paused, over)}
						</span>
					</span>
					{spectator && (
						<span className="bot-controls">
							<button
								type="button"
								className="btn micro bot-icon"
								onClick={() => store().setBotPaused(!paused)}
								disabled={over}
								aria-label={paused ? 'Resume' : 'Pause'}
								title={paused ? 'Resume' : 'Pause'}
							>
								<Glyph k={paused ? 'play' : 'pause'} />
							</button>
							<button
								type="button"
								className="btn micro bot-icon"
								onClick={() => store().stepBot()}
								disabled={!paused || over || botToMove === null}
								aria-label="Step"
								title="Play one House AI move"
							>
								<Glyph k="step" />
							</button>
							<span className="bot-seg" role="group" aria-label="View">
								{([0, 1] as const).map((seat) => (
									<button
										key={seat}
										type="button"
										className={`btn micro bot-icon${viewer === seat ? ' btn-active' : ''}`}
										aria-pressed={viewer === seat}
										aria-label={seatLabel(seat)}
										onClick={() => store().setViewer(seat)}
									>
										{seatShort(seat)}
									</button>
								))}
							</span>
							<button
								type="button"
								className={`btn micro bot-icon${revealAll ? ' btn-active' : ''}`}
								aria-pressed={revealAll}
								onClick={() => store().setRevealAll(!revealAll)}
								aria-label="Reveal hands"
								title="Show both captains' hands"
							>
								<Glyph k="eye" />
							</button>
						</span>
					)}
					<BotHistoryButton compact />
				</div>
				<BotTicker variant="mobile" />
				<BotHistory />
				<BotHighlight />
			</>
		)
	// The console carries the status in its head bar (BotStatus) and the
	// ticker in the opponent band; this strip is only the spectator's controls.
	if (!spectator) return null
	return (
		<div
			className="bot-bar bot-bar-console"
			role="group"
			aria-label="House AI controls"
		>
			<span className="bot-controls">
				<button
					type="button"
					className="btn micro"
					onClick={() => store().setBotPaused(!paused)}
					disabled={over}
				>
					{paused ? 'Resume' : 'Pause'}
				</button>
				<button
					type="button"
					className="btn micro"
					onClick={() => store().stepBot()}
					disabled={!paused || over || botToMove === null}
					title="Play one House AI move"
				>
					Step
				</button>
				<span className="bot-seg" role="group" aria-label="View">
					{([0, 1] as const).map((seat) => (
						<button
							key={seat}
							type="button"
							className={`btn micro${viewer === seat ? ' btn-active' : ''}`}
							aria-pressed={viewer === seat}
							onClick={() => store().setViewer(seat)}
						>
							{seatLabel(seat)}
						</button>
					))}
				</span>
				<button
					type="button"
					className={`btn micro${revealAll ? ' btn-active' : ''}`}
					aria-pressed={revealAll}
					onClick={() => store().setRevealAll(!revealAll)}
					title="Show both captains' hands"
				>
					Reveal hands
				</button>
			</span>
		</div>
	)
}

/** The console head bar's House AI segment: a pulse and "P2 · Normal…" while
 *  it thinks (the full sentence for screen readers), and the Moves button. */
export function BotStatus() {
	const opponents = useGameStore((s) => s.session?.opponents)
	const local = useGameStore((s) => s.online === null)
	const over = useGameStore((s) => s.state !== null && s.state.result !== null)
	const thinking = useGameStore((s) => s.botThinking)
	const botToMove = useGameStore((s) => s.botToMove)
	const paused = useGameStore((s) => s.botPaused)
	if (!local || !hasBots(opponents)) return null
	const full = status(thinking, botToMove, paused, over)
	return (
		<span className="head-bot" role="group" aria-label="House AI">
			<span
				className={`bot-status${thinking !== null ? ' bot-thinking' : ''}`}
				title={full}
			>
				{thinking !== null ? (
					<span className="bot-pulse" aria-hidden="true" />
				) : (
					paused && botToMove !== null && !over && <Glyph k="pause" />
				)}
				<span aria-hidden="true">{shortStatus(thinking, botToMove, over)}</span>
				<span className="sr-only" role="status" aria-live="polite">
					{full}
				</span>
			</span>
			<BotHistoryButton compact />
		</span>
	)
}
