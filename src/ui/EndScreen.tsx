// The end screen (todo/10): who won and why, the two totals, then the scoring
// breakdown side by side in rules/07 §7.4.1 order. The banner takes the
// winner's seat colour (ice = seat 0, salmon = seat 1 — docs/ui-lcars.md §2);
// a tie is lilac (score) and a Cadet Training loss to the Burn is the alert.
// Against the official solo Bot (rules/13) the Burn is the Bot's win and a
// tie on points is too.

import type { ReactNode } from 'react'
import type { GameState } from '../engine/state'
import type { Seat } from '../engine/resolver/queries'
import type {
	FinalScoreboard,
	FocusScore,
	ScoreBreakdown,
} from '../engine/scoring'
import { SPECIALTY_ORDER, cadetBenchmark } from '../engine/scoring'
import {
	BOT_LEVEL_LABEL,
	botFor,
	botLabel,
	humanSeats,
	type Opponents,
} from '../session/opponents'
import type { SpecialtyId } from '../data/ids'
import { deckLabel } from '../data/cardNames'
import { seatLabel } from './format'
import { soloBotLabel } from './solo/labels'
import { CampaignEnd } from './solo/Campaign'
import { Icon, SpecialtyLabel } from './icons'
import { useGameStore, useProjected, useSession, useViewerSeat } from './store'

// ---------------------------------------------------------------------------
// Who is who, and the headline
// ---------------------------------------------------------------------------

/** How the end screen names each seat: "You" for the one human at this
 *  device (a House AI or online game), the AI's level, else Player 1/2. */
export function endSeatNames({
	opponents,
	online,
	viewer,
}: {
	opponents: Opponents | undefined
	/** the online seat names (SeatInfo.name), or null for a local game */
	online: [string | null | undefined, string | null | undefined] | null
	viewer: Seat
}): [string, string] {
	const name = (seat: Seat): string => {
		if (online !== null)
			return seat === viewer ? 'You' : (online[seat] ?? seatLabel(seat))
		const humans = humanSeats(opponents)
		const bot = botFor(opponents, seat)
		if (bot === undefined) return humans.length === 1 ? 'You' : seatLabel(seat)
		// two bots of the same level would read the same: name them by seat
		const other = botFor(opponents, seat === 0 ? 1 : 0)
		return other === bot
			? `${seatLabel(seat)} (${BOT_LEVEL_LABEL[bot]})`
			: botLabel(bot)
	}
	return [name(0), name(1)]
}

export interface EndHeadline {
	tone: 'seat-0' | 'seat-1' | 'tie' | 'alert'
	title: string
	reason: string
}

const CADET_BAND: Record<
	NonNullable<ReturnType<typeof cadetBenchmark>> | 'NONE',
	{ title: string; reason: string }
> = {
	OUTSTANDING: { title: 'Outstanding', reason: 'more than 120 VP' },
	PROFICIENT: {
		title: 'Proficient',
		reason: '100 VP or more: quite proficient with this deck',
	},
	UNDERSTANDING: {
		title: 'Training complete',
		reason: '70 VP or more: you understand how to play',
	},
	NONE: {
		title: 'Keep training',
		reason: '70 VP shows you understand how to play',
	},
}

export function endHeadline(
	board: FinalScoreboard,
	cadet: boolean,
	names: [string, string],
	/** the official solo Bot's seat, in a solo game */
	soloBot: Seat | null = null,
): EndHeadline {
	const totals = [board.breakdown[0].total, board.breakdown[1].total]
	const incidents = board.incidentCounts
	if (board.cadetLoss)
		return {
			tone: 'alert',
			title: 'Training failed',
			reason: 'The Burn was triggered: in Cadet Training that is a loss.',
		}
	if (soloBot !== null && incidents !== undefined)
		return {
			tone: 'alert',
			title: `${names[soloBot]} wins`,
			reason: 'The Burn was triggered: against the Bot that is a loss.',
		}
	if (soloBot !== null && totals[0] === totals[1])
		return {
			tone: soloBot === 0 ? 'seat-0' : 'seat-1',
			title: `${names[soloBot]} wins`,
			reason: `${totals[0]} – ${totals[1]} VP · a tie goes to the Bot`,
		}
	if (cadet) {
		const band = CADET_BAND[cadetBenchmark(totals[0]!) ?? 'NONE']
		return {
			tone: 'seat-0',
			title: band.title,
			reason: `${totals[0]} VP · ${band.reason}`,
		}
	}
	if (board.winners.length !== 1) {
		const burn =
			incidents !== undefined
				? `The Burn · Incidents tied ${incidents[0]}–${incidents[1]} · `
				: ''
		return {
			tone: 'tie',
			title: 'Tie: both players win',
			reason: `${burn}${totals[0]} – ${totals[1]} VP`,
		}
	}
	const w = board.winners[0]!
	const l: Seat = w === 0 ? 1 : 0
	const title = names[w] === 'You' ? 'You win' : `${names[w]} wins`
	let reason = `${totals[w]} – ${totals[l]} VP · won by ${totals[w]! - totals[l]!}`
	if (incidents !== undefined)
		reason =
			incidents[0] === incidents[1]
				? `The Burn · Incidents tied ${incidents[w]}–${incidents[l]}, decided on points: ${totals[w]} – ${totals[l]} VP`
				: `The Burn · fewer Incidents: ${incidents[w]} to ${incidents[l]}`
	return { tone: w === 0 ? 'seat-0' : 'seat-1', title, reason }
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function EndScreen({ onNewGame }: { onNewGame: () => void }) {
	const projected = useProjected()
	const session = useSession()
	const viewer = useViewerSeat()
	const onlineView = useGameStore((s) => s.online?.view ?? null)
	const state = projected as unknown as GameState | null
	const board =
		state !== null && state.result !== null && state.result.kind === 'COMPLETE'
			? state.result.scoreboard
			: null
	if (state === null || board === null) {
		return (
			<main className="end-screen">
				<h1>Game over</h1>
				<button type="button" className="btn btn-primary" onClick={onNewGame}>
					New game
				</button>
			</main>
		)
	}
	const cadet = state.mode === 'CADET'
	// Cadet Training is solo: the virtual opponent has no score to show
	const seats: Seat[] = cadet ? [0] : [0, 1]
	const names = endSeatNames({
		opponents: session?.opponents,
		online:
			onlineView === null
				? null
				: [onlineView.players[0].name, onlineView.players[1].name],
		viewer,
	})
	const soloBot = state.mode === 'SOLO' ? (state.solo?.bot ?? 1) : null
	if (soloBot !== null && state.solo !== undefined)
		names[soloBot] = soloBotLabel(state.solo.level)
	const head = endHeadline(board, cadet, names, soloBot)
	return (
		<main className="end-screen">
			<header className={`end-banner tone-${head.tone}`} role="status">
				<span className="end-cap" aria-hidden="true" />
				<div className="end-banner-body">
					<span className="end-kicker">
						Final score · turn {state.turnNumber}
					</span>
					<h1>{head.title}</h1>
					<p className="end-reason">{head.reason}</p>
				</div>
				<span className="end-tail" aria-hidden="true" />
			</header>

			<div className={`end-versus${cadet ? ' solo' : ''}`}>
				{seats.map((seat) => {
					const won = !board.cadetLoss && board.winners.includes(seat)
					return (
						<section
							key={seat}
							className={`end-seat seat-${seat}${won ? ' is-winner' : ''}`}
							aria-label={`${names[seat]}: ${board.breakdown[seat].total} VP`}
						>
							<div className="end-seat-head">
								<span className="end-seat-name">{names[seat]}</span>
								{won && !cadet && (
									<span className="end-seat-badge">Winner</span>
								)}
							</div>
							<span className="end-seat-captain">
								{deckLabel(state.players[seat].deckId)}
							</span>
							<span className="end-seat-total">
								{board.breakdown[seat].total}
								<small>VP</small>
							</span>
							{board.incidentCounts !== undefined && (
								<span className="end-seat-incidents">
									{board.incidentCounts[seat]} Incidents
								</span>
							)}
						</section>
					)
				})}
			</div>

			<ScoreBreakdownTable
				seats={seats}
				names={names}
				breakdown={board.breakdown}
			/>

			<CampaignEnd />

			<button
				type="button"
				className="btn btn-primary btn-lg"
				onClick={onNewGame}
			>
				New game
			</button>
		</main>
	)
}

// ---------------------------------------------------------------------------
// Breakdown table
// ---------------------------------------------------------------------------

const sum = (xs: readonly { vp: number }[]): number =>
	xs.reduce((a, x) => a + x.vp, 0)

/** One score cell: the working (dim) beside the VP it adds. */
function Cell({
	vp,
	calc,
	title,
}: {
	vp: number
	calc?: ReactNode
	title?: string | undefined
}) {
	return (
		<td title={title}>
			<span className="end-cell">
				{calc !== undefined && <span className="end-calc">{calc}</span>}
				<span className="end-vp">{vp}</span>
			</span>
		</td>
	)
}

function Row({
	label,
	className,
	children,
}: {
	label: ReactNode
	className?: string
	children: ReactNode
}) {
	return (
		<tr className={className}>
			<th scope="row">{label}</th>
			{children}
		</tr>
	)
}

/** A specialty's line: every specialty when the result carries
 *  focusBySpecialty, else only the scored ones (older results). */
function focusLine(
	b: ScoreBreakdown,
	specialty: SpecialtyId,
): FocusScore | null {
	return (
		(b.focusBySpecialty ?? b.focus).find((f) => f.specialty === specialty) ??
		null
	)
}

const SUPPRESSED_TITLE =
	'Not counted: Focus scores nothing when no mission was completed (rules/12 §12.27)'

function ScoreBreakdownTable({
	seats,
	names,
	breakdown,
}: {
	seats: Seat[]
	names: [string, string]
	breakdown: [ScoreBreakdown, ScoreBreakdown]
}) {
	const anySuppressed = seats.some((s) => breakdown[s].focusSuppressed)
	return (
		<section className="panel end-breakdown" aria-label="Score breakdown">
			<h3>Breakdown</h3>
			<table className="end-table">
				<thead>
					<tr>
						<td />
						{seats.map((s) => (
							<th key={s} scope="col" className={`seat-${s}`}>
								{names[s]}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					<Row label={<IconText icon="GLO" text="Glory" />}>
						{seats.map((s) => (
							<Cell key={s} vp={breakdown[s].glory} />
						))}
					</Row>
					<Row
						label={
							<IconText icon="AWAY_TEAM" text="Tokens on neutral Locations" />
						}
					>
						{seats.map((s) => (
							<Cell key={s} vp={breakdown[s].neutralTokens.vp} />
						))}
					</Row>
					<Row label="Endgame operations">
						{seats.map((s) => {
							const n = breakdown[s].endgame.length
							return (
								<Cell
									key={s}
									vp={sum(breakdown[s].endgame)}
									calc={n > 0 ? `${n} card${n === 1 ? '' : 's'}` : undefined}
								/>
							)
						})}
					</Row>
					<Row label={<IconText icon="VP" text="Printed VP" />}>
						{seats.map((s) => (
							<Cell key={s} vp={sum(breakdown[s].printedVp)} />
						))}
					</Row>
					<Row
						label={
							<>
								Focus × multiplier
								{anySuppressed && (
									<span className="end-hint">
										Not counted when no mission was completed
									</span>
								)}
							</>
						}
						className="end-group"
					>
						{seats.map((s) => (
							<Cell
								key={s}
								vp={sum(breakdown[s].focus)}
								calc={
									breakdown[s].focusSuppressed ? (
										<span className="end-warn">not counted</span>
									) : undefined
								}
								title={
									breakdown[s].focusSuppressed ? SUPPRESSED_TITLE : undefined
								}
							/>
						))}
					</Row>
					{SPECIALTY_ORDER.map((sp, i) => (
						<Row
							key={sp}
							className={`end-sub${i === SPECIALTY_ORDER.length - 1 ? ' end-sub-last' : ''}`}
							label={<SpecialtyLabel specialty={sp} focus />}
						>
							{seats.map((s) => {
								const b = breakdown[s]
								const f = focusLine(b, sp)
								if (f === null) return <Cell key={s} vp={0} />
								const calc = `${f.cards} × ${f.multiplier}`
								return b.focusSuppressed ? (
									<Cell
										key={s}
										vp={0}
										calc={
											<>
												{calc} = <s>{f.vp}</s>
											</>
										}
										title={SUPPRESSED_TITLE}
									/>
								) : (
									<Cell key={s} vp={f.vp} calc={calc} />
								)
							})}
						</Row>
					))}
					{seats.some((s) => breakdown[s].resourcesVp !== undefined) && (
						<Row label={<IconText icon="DIL" text="Dilithium and Latinum" />}>
							{seats.map((s) => (
								<Cell key={s} vp={breakdown[s].resourcesVp ?? 0} />
							))}
						</Row>
					)}
					<Row label="Completed missions">
						{seats.map((s) => (
							<Cell
								key={s}
								vp={sum(breakdown[s].missions)}
								calc={`${breakdown[s].missionsCompleted} done`}
							/>
						))}
					</Row>
					<Row label="Total" className="end-total">
						{seats.map((s) => (
							<td key={s} className={`seat-${s}`}>
								{breakdown[s].total}
							</td>
						))}
					</Row>
				</tbody>
			</table>
			{anySuppressed && (
				<p className="end-note">
					Struck-out values show what Focus would have scored with a completed
					mission (rules/12 §12.27).
				</p>
			)}
		</section>
	)
}

function IconText({
	icon,
	text,
}: {
	icon: Parameters<typeof Icon>[0]['id']
	text: string
}) {
	return (
		<span className="icon-label">
			<Icon id={icon} label={text} />
			{text}
		</span>
	)
}
