// The opponent view (docs/ui-mobile.md §5): reference, not a second board.
// Their tiles in the salmon seat colour, read-only; resources, specialties,
// Incident count; hidden information as locked counts (hand N as face-down
// backs, Log N), never as a gap.

import { useMemo } from 'react'
import type { GameState } from '../../engine/state'
import { otherSeat, zoneKey } from '../../engine/state'
import type { SpecialtyId } from '../../data/ids'
import { useProjected, useRealState, useViewerSeat } from '../store'
import { useDefIndex } from '../defs'
import { captainName } from '../tile/CardTile'
import { Gl, SuitGl } from '../tile/glyph'
import { burnForecast } from './facts'
import { useBridgeUi } from './bridgeUi'
import { useVpNow } from './Header'
import { SecH, Tableau } from './stations'
import { deckLabel } from '../../data/cardNames'
import { isSoloBot } from '../../engine/solo/seat'
import { AcCards } from '../solo/AutomatedCommand'

const SPEC: SpecialtyId[] = ['RESEARCH', 'INFLUENCE', 'MILITARY']

export function OpponentView() {
	const projected = useProjected()
	const real = useRealState()
	const viewer = useViewerSeat()
	const index = useDefIndex()
	const vp = useVpNow()
	const setScreen = useBridgeUi((s) => s.setScreen)
	const openSheet = useBridgeUi((s) => s.openSheet)
	const opp = otherSeat(viewer)
	const burn = useMemo(
		() => (real !== null ? burnForecast(real, viewer) : null),
		[real, viewer],
	)
	if (projected === null) return null
	const state = projected as unknown as GameState
	const p = state.players[opp]
	const z = (k: string) => projected.zones[k] ?? []
	// the official solo Bot (rules/13): a face-down row instead of a hand, a
	// Bot deck and a Supplement instead of the Reserve and Development
	const bot = isSoloBot(state, opp)
	const hand = z(zoneKey({ k: bot ? 'BOT_ROW' : 'HAND', seat: opp })).length
	const log = z(zoneKey({ k: 'LOG', seat: opp })).length
	const discard = z(zoneKey({ k: 'DISCARD', seat: opp }))
	const draw = z(zoneKey({ k: 'DRAW', seat: opp })).length
	return (
		<div className="pb-oppview">
			<div className="pb-opp-h">
				<button
					type="button"
					className="pb-back"
					onClick={() => setScreen('bridge')}
				>
					‹ Bridge
				</button>
				<h2>{captainName(projected, opp, index)}</h2>
				<div className="pb-hrow">
					<span className="pb-pool" aria-label="Their pool">
						{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
							<span key={r} className={`pb-res pb-res-${r}`} title={r}>
								<Gl g={r} />
								<b>{p.resources[r]}</b>
							</span>
						))}
					</span>
					{vp !== null && <span className="pb-vpc">~{vp[opp]} VP</span>}
					<span className="pb-chip pb-chip-opp pb-push">
						<SuitGl suit="INCIDENT" />
						{burn?.theirs ?? 0} Incident{burn?.theirs === 1 ? '' : 's'}
					</span>
				</div>
				<div className="pb-hrow">
					<span className="pb-lbl">
						{bot ? 'Row' : 'Hand'} {hand}
					</span>
					<span
						className="pb-handbacks"
						aria-label={`${hand} cards, face down`}
					>
						{Array.from({ length: hand }, (_, i) => (
							<i key={i} />
						))}
					</span>
					<span className="pb-chip pb-push">
						<Gl g="LOCK" />
						Log {log} · hidden
					</span>
				</div>
				<div className="pb-minibars">
					{SPEC.map((s) => (
						<div key={s} className={`pb-mini pb-track-${s}`}>
							<span>
								<Gl g={s} /> {s.slice(0, 3)} {p.specialties[s]}
							</span>
							<span className="pb-mb">
								<i style={{ width: `${(p.specialties[s] / 15) * 100}%` }} />
							</span>
						</div>
					))}
				</div>
			</div>
			<div className="pb-scroll pb-opp-scroll">
				<section className="pb-station pb-opp" aria-label="Opponent's tableau">
					<Tableau seat={opp} />
					<SecH icon={<Gl g="DECK" />}>Piles</SecH>
					<div className="pb-piles">
						<div className="pb-pile">
							<Gl g="DECK" />
							<b>{draw}</b>
							{bot ? 'Bot deck' : 'Draw'}
							<Gl g="LOCK" className="pb-lock" />
						</div>
						<button
							type="button"
							className="pb-pile"
							disabled={discard.length === 0}
							onClick={() =>
								openSheet({
									k: 'pile',
									label: `${deckLabel(p.deckId)} discard`,
									iids: [...discard],
								})
							}
						>
							<Gl g="DISCARD_PILE" />
							<b>{discard.length}</b>Discard
						</button>
						{bot ? (
							<div className="pb-pile">
								<Gl g="RESERVE" />
								<b>{z(zoneKey({ k: 'SUPPLEMENT', seat: opp })).length}</b>
								Supplement
								<Gl g="LOCK" className="pb-lock" />
							</div>
						) : (
							<>
								<div className="pb-pile">
									<Gl g="RESERVE" />
									<b>{z(zoneKey({ k: 'RESERVE', seat: opp })).length}</b>Reserve
									<Gl g="LOCK" className="pb-lock" />
								</div>
								<div className="pb-pile">
									<Gl g="DEVELOP" />
									<b>{z(zoneKey({ k: 'DEVELOPMENT', seat: opp })).length}</b>
									Develop
								</div>
							</>
						)}
						<div className="pb-pile">
							<Gl g="LOG" />
							<b>{log}</b>Log
							<Gl g="LOCK" className="pb-lock" />
						</div>
					</div>
					{bot && (
						<>
							<SecH icon={<Gl g="DECK" />}>Automated Command</SecH>
							<AcCards compact />
						</>
					)}
				</section>
			</div>
		</div>
	)
}
