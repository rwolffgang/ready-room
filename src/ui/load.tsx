// "Continue a saved game" panel (todo/17 §1). Browsable from the setup screen
// without replaying anything — each save carries its full meta (deck names,
// board sides, turn number, phase, timestamp, score estimate), so the list is
// just `listSessions()` + the stored meta. A card-data hash mismatch labels a
// save as stale instead of silently replaying it under different card data.
// The one replay: a finished save from before `meta.final` existed, once, to
// store its result (backfillFinal).
// Import-from-file (todo/17 §3) also lives here: `importSession` + resume.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardCatalog } from '../engine/setup'
import { useGameStore } from './store'
import { backfillFinal, type Session } from '../session/log'
import { cardDataDrift, getSessionStore, readSessionFile } from './persistence'
import { seatLabel } from './format'
import { shortUpdatedAt } from './format'
import {
	botFor,
	botLabel,
	humanSeats,
	opponentsLabel,
} from '../session/opponents'
import { soloBotLabel } from './solo/labels'
import { Portrait } from './launch/parts'

export function SavedGamesPanel({ catalog }: { catalog: CardCatalog | null }) {
	const resume = useGameStore((s) => s.resumeGame)
	const [saves, setSaves] = useState<Session[] | null>(null)
	const [listError, setListError] = useState<string | null>(null)
	const [importError, setImportError] = useState<string | null>(null)
	const [copiedId, setCopiedId] = useState<string | null>(null)
	const fileRef = useRef<HTMLInputElement | null>(null)

	const refresh = useCallback(() => {
		const store = getSessionStore()
		void store
			.list()
			.then((list) => {
				const filled =
					catalog === null ? list : list.map((s) => backfillFinal(s, catalog))
				filled.forEach((s, i) => {
					if (s !== list[i]) void store.save(s).catch(() => undefined)
				})
				setSaves(filled)
				setListError(null)
			})
			.catch((e: unknown) => {
				setSaves([])
				setListError((e as Error).message)
			})
	}, [catalog])

	useEffect(() => {
		refresh()
	}, [refresh])

	const onImportFile = useCallback(
		async (file: File | undefined) => {
			if (file === undefined) return
			setImportError(null)
			try {
				const imported = await readSessionFile(file)
				// Importing replaces the current (none — we're on the setup screen).
				resume(imported)
			} catch (e) {
				setImportError(`Import failed — ${(e as Error).message}`)
			}
		},
		[resume],
	)

	return (
		<section className="saved-games" aria-label="Continue a saved game">
			<div className="saved-head">
				<h3>Continue a saved game</h3>
				<div className="saved-tools">
					<button type="button" className="btn micro" onClick={refresh}>
						Refresh
					</button>
					<label className="btn micro file-btn">
						Import…
						<input
							ref={fileRef}
							type="file"
							accept=".json,application/json"
							className="hidden-file"
							aria-label="import a session JSON"
							onChange={(e) => {
								void onImportFile(e.target.files?.[0])
								e.target.value = ''
							}}
						/>
					</label>
				</div>
			</div>

			{importError !== null && <p className="error-text">{importError}</p>}
			{listError !== null && <p className="error-text">{listError}</p>}

			{saves === null ? (
				<p className="muted small">Loading saves…</p>
			) : saves.length === 0 ? (
				<p className="saved-empty">
					No saved games yet. A game autosaves after you start it, so you can
					pick it up here after a refresh.
				</p>
			) : (
				<ul className="save-list">
					{saves.map((s) => (
						<SaveRow
							key={s.id}
							session={s}
							catalog={catalog}
							onResume={() => resume(s)}
							onDelete={() => {
								void getSessionStore().remove(s.id).then(refresh)
							}}
							onCopy={async () => {
								const { copySession } = await import('./persistence')
								void copySession(s).then(() => setCopiedId(s.id))
							}}
							copied={copiedId === s.id}
						/>
					))}
				</ul>
			)}
			<p className="saved-foot">
				<strong>Save format:</strong> intent log + seed + setup (a few KB).
				Loading replays it byte-exactly — undo, replay and export all read the
				same log.
			</p>
		</section>
	)
}

/** A finished save's result line: "Game over · You won · 43–20". The score
 *  reads in seat order, like the "A vs B" title above it. A save without
 *  `meta.final` that backfillFinal could not fill says only "Game over". */
export function endedLine(session: Session): string {
	const f = session.meta.final
	if (f === undefined) return 'Game over'
	const [a, b] = f.score
	if (session.setup.mode === 'CADET')
		return f.winners.length === 0
			? 'Game over · lost to the Burn'
			: `Game over · ${a} VP`
	if (f.winners.length !== 1) return `Game over · tie · ${a}–${b}`
	const w = f.winners[0]!
	const solo = session.setup.solo
	if (session.setup.mode === 'SOLO' && solo !== undefined)
		// seat 1 is the official solo Bot (rules/13)
		return `Game over · ${w === 1 ? soloBotLabel(solo.level) : 'You'} won · ${a}–${b}`
	const bot = botFor(session.opponents, w)
	const who =
		bot !== undefined
			? botLabel(bot)
			: humanSeats(session.opponents).length === 1
				? 'You'
				: session.meta.deckNames[w]
	return `Game over · ${who} won · ${a}–${b}`
}

function SaveRow({
	session,
	catalog,
	onResume,
	onDelete,
	onCopy,
	copied,
}: {
	session: Session
	catalog: CardCatalog | null
	onResume: () => void
	onDelete: () => void
	onCopy: () => void
	copied: boolean
}) {
	const m = session.meta
	const drift = catalog !== null ? cardDataDrift(session, catalog) : null
	const ended = m.result === 'COMPLETE'
	const sitsAt =
		m.phase === 'SETUP'
			? 'setup'
			: ended
				? `ended on turn ${m.turnNumber}`
				: `turn ${m.turnNumber} · ${m.phase}`
	const solo = session.setup.mode === 'SOLO' ? session.setup.solo : undefined
	const vs =
		solo !== undefined
			? `vs ${soloBotLabel(solo.level)}${solo.conspiringAdmirals === true ? ' · Conspiring Admirals' : ''}${session.campaignId !== undefined ? ' · Five-Year Mission' : ''}`
			: opponentsLabel(session.opponents)
	return (
		<li
			className={`save-row${ended ? ' save-ended' : ''}${drift !== null && !drift.ok ? ' save-drift' : ''}`}
		>
			<span className="save-faces" aria-hidden="true">
				{session.setup.players.map((p, i) => (
					<Portrait
						key={i}
						catalog={catalog}
						deck={p.deck}
						className={`lr-avatar lr-seat-${i}`}
					/>
				))}
			</span>
			<div className="save-meta">
				<strong className="save-title">
					{m.deckNames[0]} <span className="save-vs-word">vs</span>{' '}
					{m.deckNames[1]}
				</strong>
				{vs !== null && <span className="small save-vs">{vs}</span>}
				<span className="save-chips">
					<span className="save-chip">{sitsAt}</span>
					<span className="save-chip">
						{m.boardSides[0]} / {m.boardSides[1]}
					</span>
				</span>
				{ended ? (
					<span className="small save-result">{endedLine(session)}</span>
				) : (
					<span className="muted small">
						score est. {m.scoreEstimate[0]}–{m.scoreEstimate[1]} · awaiting{' '}
						{seatLabel(m.activeSeat)}
					</span>
				)}
				<span className="muted small">
					{m.intentCount} intent{m.intentCount === 1 ? '' : 's'} · updated{' '}
					{shortUpdatedAt(m.updatedAt)}
				</span>
				{drift !== null && !drift.ok && (
					<span
						className="save-warn-badge"
						title={`stored card-data hash ${drift.stored} ≠ now ${drift.current}`}
					>
						⚠ card data changed since this save — the log may replay differently
					</span>
				)}
			</div>
			<div className="save-actions">
				<button
					type="button"
					className="btn micro btn-primary"
					onClick={onResume}
				>
					{ended ? 'View result' : 'Continue'}
				</button>
				<button type="button" className="btn micro" onClick={onCopy}>
					{copied ? 'Copied ✓' : 'Copy JSON'}
				</button>
				<button
					type="button"
					className="btn micro btn-warn"
					onClick={onDelete}
					aria-label={`delete save ${session.id}`}
				>
					Delete
				</button>
			</div>
		</li>
	)
}
