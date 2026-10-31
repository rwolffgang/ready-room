// Session replay viewer (todo/17 §3). The intent log IS the replay: stepping
// `log[0..i]` and replaying gives the exact state at that point (engine
// determinism — same seed + same log ⇒ byte-identical state). The viewer
// recomputes a prefix, projects it exactly like the rest of the UI
// (`project(state, viewerSeat)`), and renders a compact summary without
// touching the live game. Export/import as JSON (the bug-report format) live
// here too: "attach the session" beats any description.
//
// Mounted as <ReplayHost/> in the app overlays; the TopBar's "Replay" button
// calls the module-level openReplay() (same pattern as PileBrowserHost).

import { useState } from 'react'
import type { CardDef } from '../data/schema'
import type { GameState } from '../engine/state'
import { player, zoneKey } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { Seat, ZoneRef } from '../engine/resolver/queries'
import { replay, type Session } from '../session/log'
import { useSession, useCatalog, useViewerSeat } from './store'
import { project, HIDDEN_DEF, type ProjectedState } from './projection'
import { phaseLabel, seatLabel, RESOURCE_LABEL } from './format'
import { Icon } from './icons'
import {
	copySession,
	downloadSession,
	syncSession,
	syncServerUrl,
} from './persistence'
import { cardName } from '../data/cardNames'

let replayFn: (() => void) | null = null

/** Module-level open (avoids wiring props through the top bar). */
export function openReplay(): void {
	replayFn?.()
}

export function ReplayHost() {
	const [open, setOpen] = useState(false)
	replayFn = () => setOpen(true)
	if (!open) return null
	return (
		<div className="modal-backdrop" onClick={() => setOpen(false)}>
			<ReplayViewer onClose={() => setOpen(false)} />
		</div>
	)
}

function ReplayViewer({ onClose }: { onClose: () => void }) {
	const session = useSession()
	const catalog = useCatalog()
	const viewer = useViewerSeat()
	// Hooks must be called unconditionally: `session`/`catalog` can be null on
	// the first frame, but a conditional early-return before useState would make
	// React see fewer hooks on later renders. `cursor === null` means "latest".
	const [cursor, setCursor] = useState<number | null>(null)
	const [copied, setCopied] = useState(false)
	const [synced, setSynced] = useState(false)
	const [syncError, setSyncError] = useState<string | null>(null)
	if (session === null || catalog === null) return null
	const log = session.log

	const clamp = (n: number): number => Math.min(log.length, Math.max(0, n))
	const effCursor = cursor === null ? log.length : clamp(cursor)

	let frame:
		{ state: GameState; view: ProjectedState } | { error: string } | null = null
	try {
		const partial: Session = { ...session, log: log.slice(0, effCursor) }
		const state = replay(partial, catalog)
		frame = { state, view: project(state, viewer) }
	} catch (e) {
		frame = { error: (e as Error).message }
	}

	const defIndex = new Map<string, CardDef>(
		(catalog.defs ?? []).map((d) => [d.id, d]),
	)

	return (
		<div
			className="modal replay-modal"
			role="dialog"
			aria-label="Session replay"
			onClick={(e) => e.stopPropagation()}
		>
			<div className="modal-head">
				<strong>Replay — {describeStep(effCursor, log.length)}</strong>
				<button type="button" className="btn" onClick={onClose}>
					Close
				</button>
			</div>

			<div className="replay-controls">
				<button
					type="button"
					className="btn micro"
					onClick={() => setCursor(0)}
					disabled={effCursor === 0}
				>
					⏮ Start
				</button>
				<button
					type="button"
					className="btn micro"
					onClick={() => setCursor(clamp(effCursor - 1))}
					disabled={effCursor === 0}
				>
					‹ Prev
				</button>
				<input
					type="range"
					className="replay-slider"
					min={0}
					max={log.length}
					value={effCursor}
					aria-label="replay position"
					onChange={(e) => setCursor(Number(e.target.value))}
				/>
				<button
					type="button"
					className="btn micro"
					onClick={() => setCursor(clamp(effCursor + 1))}
					disabled={effCursor >= log.length}
				>
					Next ›
				</button>
				<button
					type="button"
					className="btn micro"
					onClick={() => setCursor(log.length)}
					disabled={effCursor >= log.length}
				>
					Latest ⏭
				</button>
			</div>

			<div className="replay-body">
				<div className="replay-intents">
					<strong>Intent log</strong>
					<ol className="replay-log">
						{log.map((it, i) => (
							<li
								key={i}
								className={`replay-intent${i === effCursor - 1 ? ' replay-current' : ''}${i >= effCursor ? ' replay-future' : ''}`}
							>
								<span className="replay-idx">#{i + 1}</span>
								{describeIntent(
									it,
									frame !== null && !('error' in frame)
										? frame.state
										: undefined,
									defIndex,
								)}
							</li>
						))}
						{log.length === 0 && (
							<li className="muted">
								No intents yet — the session is still in SETUP.
							</li>
						)}
					</ol>
				</div>

				<div className="replay-frame">
					{frame !== null && 'error' in frame ? (
						<p className="error-text">
							Replay failed at this prefix: {frame.error}
						</p>
					) : (
						frame !== null && <ReplaySummary frame={frame} />
					)}
				</div>
			</div>

			<div className="modal-foot replay-foot">
				<span className="muted small">
					Replay is recomputed from the intent log ({log.length} intent
					{log.length === 1 ? '' : 's'}) — deterministic.
				</span>
				<div className="error-actions">
					<button
						type="button"
						className="btn"
						onClick={() => {
							void copySession(session).then(() => setCopied(true))
						}}
					>
						{copied ? 'Copied ✓' : 'Copy session'}
					</button>
					<button
						type="button"
						className="btn"
						onClick={() => downloadSession(session)}
					>
						Export .json
					</button>
					<button
						type="button"
						className="btn"
						title={`Push this session to ${syncServerUrl()}`}
						onClick={() => {
							setSynced(false)
							setSyncError(null)
							void syncSession(session).then((outcome) => {
								if (outcome.ok) setSynced(true)
								else setSyncError(outcome.error)
							})
						}}
					>
						{synced ? 'Synced ✓' : 'Sync to server'}
					</button>
				</div>
				{syncError !== null && (
					<p className="error-text sync-error">{syncError}</p>
				)}
			</div>
		</div>
	)
}

function describeStep(cursor: number, total: number): string {
	return cursor === total
		? 'Latest state'
		: `${cursor} / ${total} intent${total === 1 ? '' : 's'} applied`
}

/** Human label for one log intent (used by the replay step list). */
export function describeIntent(
	intent: Intent,
	state: GameState | undefined,
	defIndex: Map<string, CardDef> | undefined,
): string {
	const name = (iid: string): string => {
		const defId = state?.cards[iid]?.def
		if (defId === undefined || defId === HIDDEN_DEF) return 'a card'
		return cardName(defIndex?.get(defId)) ?? defId
	}
	switch (intent.t) {
		case 'START':
			return 'Start the game'
		case 'PASS':
			return 'Pass — advance the phase'
		case 'END_TURN':
			return 'End turn'
		case 'PLAY_CARD':
			return `Play ${name(intent.iid)}`
		case 'ACTIVATE':
			return `Activate ${name(intent.iid)}`
		case 'COMPLETE_MISSION':
			return `Complete mission ${intent.index + 1}`
		case 'RESOLVE_CHOICE':
			return `Resolve ${intent.choiceId}`
		case 'BOT_STEP':
			return 'Bot step'
	}
}

function ReplaySummary({
	frame,
}: {
	frame: { state: GameState; view: ProjectedState }
}) {
	const state = frame.state
	const view = frame.view
	return (
		<section className="panel replay-state" aria-label="Replayed state">
			<p className="replay-headline">
				<strong>Turn {state.turnNumber}</strong> · {phaseLabel(state.phase)} ·
				awaiting {seatLabel(state.activeSeat)}
				{state.pendingChoice !== null ? (
					<span className="chip pending-chip">
						choice pending ({state.pendingChoice.k})
					</span>
				) : null}
				{state.result !== null ? (
					<span className="chip pending-chip">result: {state.result.kind}</span>
				) : null}
			</p>
			<div className="replay-seats">
				{([0, 1] as const).map((seat) => (
					<ReplaySeat key={seat} seat={seat} view={view} />
				))}
			</div>
		</section>
	)
}

function ReplaySeat({ seat, view }: { seat: Seat; view: ProjectedState }) {
	// The projection is an immutable deep copy — safe to query with the engine's
	// read-only helpers (player() just indexes state.players).
	const st = view as unknown as GameState
	const pl = player(st, seat)
	const handCount = zoneLen(view, { k: 'HAND', seat })
	const viewer = useViewerSeat()
	return (
		<div className={`replay-seat replay-seat-${seat}`}>
			<strong>
				{seatLabel(seat)} {seat === viewer ? '(you) ' : ''}
			</strong>
			<span className="muted small">
				hand {handCount} · actions {pl.actions.available}/
				{pl.actions.available + pl.actions.spent}
			</span>
			<span className="area-resources">
				{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
					<span
						key={r}
						className={`res-pip pip-${r.toLowerCase()}`}
						title={RESOURCE_LABEL[r]}
					>
						<Icon id={r} label={RESOURCE_LABEL[r]} /> {pl.resources[r]}
					</span>
				))}
			</span>
			<span className="muted small">
				tracks {pl.specialties.RESEARCH}/{pl.specialties.INFLUENCE}/
				{pl.specialties.MILITARY}
			</span>
		</div>
	)
}

function zoneLen(view: ProjectedState, ref: ZoneRef): number {
	const zone = (view as unknown as GameState).zones[zoneKey(ref)]
	return Array.isArray(zone) ? zone.length : 0
}
