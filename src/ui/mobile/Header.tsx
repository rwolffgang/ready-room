// The pinned header (docs/ui-mobile.md §4): turn and phase rail, actions left
// as chips, your pool and ~VP, the opponent pill, the Stardate meter and
// the Burn meter. It never scrolls away; on a phone on its side it becomes
// the left rail (mobile.css).

import { useMemo } from 'react'
import type { GameState } from '../../engine/state'
import { otherSeat } from '../../engine/state'
import { useCatalog, useProjected, useRealState, useViewerSeat } from '../store'
import { HIDDEN_DEF } from '../projection'
import { Gl, SuitGl } from '../tile/glyph'
import { burnForecast, scoreNow } from './facts'
import { useBridgeUi } from './bridgeUi'
import { deckLabel } from '../../data/cardNames'

const RAIL = ['RESUPPLY', 'CONTROL', 'ACTION', 'CLEANUP'] as const
const RAIL_WORD: Record<(typeof RAIL)[number], string> = {
	RESUPPLY: 'Resupply',
	CONTROL: 'Control',
	ACTION: 'Action',
	CLEANUP: 'Clean-up',
}

export function phaseWord(phase: GameState['phase']['k']): string {
	switch (phase) {
		case 'SETUP':
			return 'Setup'
		case 'GAME_OVER':
			return 'Game over'
		case 'BOT':
			return "Bot's turn"
		default:
			return RAIL_WORD[phase]
	}
}

/** ~VP for both seats from the scoring function ("if the game ended now").
 *  Scoring reads every owned card, hidden ones too, so it is an extra shown
 *  only when the client holds the real state (local play); null otherwise. */
export function useVpNow(): [number, number] | null {
	const real = useRealState()
	return useMemo(() => {
		if (real === null) return null
		try {
			return [
				scoreNow(real, 0).breakdown.total,
				scoreNow(real, 1).breakdown.total,
			]
		} catch {
			return null
		}
	}, [real])
}

export function Header({ onMenu }: { onMenu: () => void }) {
	const projected = useProjected()
	const real = useRealState()
	const viewer = useViewerSeat()
	const catalog = useCatalog()
	const vp = useVpNow()
	const setScreen = useBridgeUi((s) => s.setScreen)
	const burn = useMemo(
		() => (real !== null ? burnForecast(real, viewer) : null),
		[real, viewer],
	)
	if (projected === null) return null
	const state = projected as unknown as GameState
	const me = state.players[viewer]
	const opp = otherSeat(viewer)
	const them = state.players[opp]
	const phase = state.phase.k
	const at = RAIL.indexOf(phase as (typeof RAIL)[number])
	const { available, spent } = me.actions
	const top = state.stardates.pile[0]
	const topDef = top !== undefined ? state.cards[top]?.def : undefined
	const seq =
		topDef !== undefined && topDef !== HIDDEN_DEF
			? catalog?.stardates.find((s) => s.id === topDef)?.sequence
			: undefined
	const after = Math.max(0, state.stardates.pile.length - 1)
	const oppName = deckLabel(them.deckId)

	return (
		<header className="pb-hdr" aria-label="Bridge status">
			<div className="pb-hrow">
				<span className="pb-turn">Turn {state.turnNumber}</span>
				<span className="pb-phase">{phaseWord(phase)}</span>
				<ol
					className="pb-rail"
					aria-label={`Phase: ${phaseWord(phase)} (Resupply, Control, Action, Clean-up)`}
				>
					{RAIL.map((p, i) => (
						<li
							key={p}
							className={
								phase === 'GAME_OVER' || (at >= 0 && i < at)
									? 'done'
									: i === at
										? 'on'
										: ''
							}
						/>
					))}
				</ol>
				<span
					className="pb-acts"
					aria-label={`${available} action${available === 1 ? '' : 's'} left, ${spent} used`}
				>
					{Array.from({ length: spent }, (_, i) => (
						<Gl key={`s${i}`} g="ACT" className="pb-used" />
					))}
					{Array.from({ length: available }, (_, i) => (
						<Gl key={`a${i}`} g="ACT" />
					))}
					<b>{available} left</b>
				</span>
				<button
					type="button"
					className="pb-menu-btn"
					onClick={onMenu}
					aria-label="Menu"
				>
					<span aria-hidden="true">≡</span>
				</button>
			</div>
			<div className="pb-hrow">
				<span className="pb-pool" aria-label="Your pool">
					{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
						<span key={r} className={`pb-res pb-res-${r}`} title={r}>
							<Gl g={r} />
							<b>{me.resources[r]}</b>
						</span>
					))}
				</span>
				{vp !== null && (
					<span className="pb-vpc" title="If the game ended now">
						~{vp[viewer]} VP
					</span>
				)}
				<button
					type="button"
					className="pb-them"
					onClick={() => setScreen('opponent')}
					aria-label={`Opponent ${oppName}${vp !== null ? `, about ${vp[opp]} VP` : ''}: open their view`}
				>
					<SuitGl suit="CAPTAIN" />
					{oppName}
					{vp !== null && ` · ${vp[opp]} VP`} ›
				</button>
			</div>
			<div className="pb-meters">
				<div className="pb-meter">
					<Gl g="STARDATE" />
					<span>
						<b>
							{seq !== undefined ? `SD ${seq}` : 'Stardate'} · <Gl g="GLO" />{' '}
							{state.stardates.gloryOnTop}
						</b>
						<span className="pb-sub">
							{state.resolutionTriggered
								? 'Resolution triggered'
								: after === 0
									? 'Last Stardate'
									: `${after} more Stardate${after === 1 ? '' : 's'} after this`}
						</span>
					</span>
				</div>
				<div
					className={`pb-meter pb-burn${burn !== null && burn.left <= 2 ? ' pb-alert' : ''}`}
				>
					<SuitGl suit="INCIDENT" />
					<span>
						<b>
							{burn?.left ?? state.zones['INCIDENT_DECK']?.length ?? 0} to the
							Burn
						</b>
						{burn !== null && (
							<span className="pb-sub">
								{state.mode === 'SOLO'
									? 'If it comes, the Bot wins'
									: burn.leader === 'you'
										? `You'd win it now: ${burn.mine} vs ${burn.theirs}`
										: burn.leader === 'them'
											? `${oppName} would win it: ${burn.mine} vs ${burn.theirs}`
											: `Tied ${burn.mine} vs ${burn.theirs}: scoring decides`}
							</span>
						)}
					</span>
				</div>
			</div>
		</header>
	)
}
