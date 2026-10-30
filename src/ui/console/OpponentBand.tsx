// The opponent across the table (docs/ui-lcars.md §4): a band along the top
// edge in their seat colour. Left, what they hold — their hand as face-down
// cards, one back per card (so no count), (face up only with the spectator's Reveal hands) beside their Draw and
// Discard; then their pool, ~VP, tracks and missions, with the House AI's
// latest move; below, everything they have in play at the small size, the
// way you see a board from across a table. Hold Option (or long-press) to
// read a card; V, or a click on the band, puts their whole board on screen.

import { useMemo } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import type { GameState } from '../../engine/state'
import { zoneKey } from '../../engine/state'
import type { CardInstanceId } from '../../engine/ids'
import type { Seat } from '../../engine/resolver/queries'
import { estimateScore } from '../../session/log'
import { deckLabel } from '../../data/cardNames'
import { DeckPiles, SpecialtyBar } from '../board'
import { BotTicker } from '../BotTicker'
import { CardSprite } from '../cards'
import { DeltaCounter } from '../delta'
import { Icon } from '../icons'
import { TableCard } from '../tableCard'
import { burnForecast } from '../mobile/facts'
import { RESOURCE_LABEL, seatLabel } from '../format'
import {
	useGameStore,
	useProjected,
	useRealState,
	useViewerSeat,
} from '../store'
import { useConsoleUi } from './consoleUi'
import { useShortcut } from './useShortcut'

const SPECIALTIES = ['RESEARCH', 'INFLUENCE', 'MILITARY'] as const

type BandZone =
	'CAPTAIN' | 'FLEET' | 'DUTY_OFFICER' | 'LOCATION_AREA' | 'STAGING'
const ZONES: { k: BandZone; label: string }[] = [
	{ k: 'CAPTAIN', label: 'Captain' },
	{ k: 'FLEET', label: 'Fleet' },
	{ k: 'DUTY_OFFICER', label: 'Duty' },
	{ k: 'LOCATION_AREA', label: 'Locations' },
	{ k: 'STAGING', label: 'Staging' },
]

export function OpponentBand({ seat }: { seat: Seat }) {
	const projected = useProjected()
	const real = useRealState()
	const viewer = useViewerSeat()
	const viewscreen = useConsoleUi((s) => s.viewscreen)
	const setViewscreen = useConsoleUi((s) => s.setViewscreen)
	useShortcut('v', () => setViewscreen(!viewscreen))
	const vp = useMemo(
		() => (real === null ? null : estimateScore(real, seat, viewer)),
		[real, seat, viewer],
	)
	const incidents = useMemo(
		() => (real === null ? null : burnForecast(real, viewer).theirs),
		[real, viewer],
	)
	if (projected === null) return null
	const state = projected as unknown as GameState
	const p = state.players[seat]
	if (p === undefined) return null
	const hand = projected.zones[zoneKey({ k: 'HAND', seat })] ?? []
	const done = p.missions.filter((m) => m.completed).length
	// the band's empty background opens the viewscreen; its cards and buttons
	// keep their own clicks
	const onBand = (e: MouseEvent) => {
		const t = e.target as Element
		if (t.closest('button, a, .card, .cardstack, .bot-ticker') !== null) return
		setViewscreen(true)
	}
	return (
		<section
			className="panel opp-band"
			aria-label={`Player ${seat + 1} across the table`}
			data-anchor={`seat:${seat}`}
			onClick={onBand}
		>
			<div className="band-hold">
				<div
					className="opp-hand"
					role="group"
					aria-label={`${seatLabel(seat)} hand: ${hand.length} card${hand.length === 1 ? '' : 's'}`}
					style={{ '--n': Math.max(1, hand.length) } as CSSProperties}
				>
					{hand.map((iid) => (
						<CardSprite
							key={iid}
							iid={iid}
							size="micro"
							detailOnHover={false}
						/>
					))}
				</div>
				<DeckPiles seat={seat} />
			</div>
			<div className="band-main">
				<div className="band-head">
					<strong className="band-name">
						{seatLabel(seat)} · {deckLabel(p.deckId)}
					</strong>
					<span
						className="band-pool"
						aria-label={`${seatLabel(seat)} resources`}
					>
						{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
							<DeltaCounter
								key={r}
								pool={`player:${seat}:${r}`}
								label={`${seatLabel(seat)} ${RESOURCE_LABEL[r]}`}
								className={`res-pip pip-${r.toLowerCase()}`}
								title={RESOURCE_LABEL[r]}
							>
								<Icon id={r} label={RESOURCE_LABEL[r]} />{' '}
								<span className="res-n">{p.resources[r]}</span>
							</DeltaCounter>
						))}
						<span
							className="res-pip pip-away"
							title={`${p.awayTeamsInPool} Away Team${p.awayTeamsInPool === 1 ? '' : 's'} on their Captain · ${p.awayTeamsTotal} owned`}
						>
							<Icon id="AWAY_TEAM" label="Away Teams" />{' '}
							<span className="res-n">
								{p.awayTeamsInPool}
								<small>/{p.awayTeamsTotal}</small>
							</span>
						</span>
					</span>
					{vp !== null && (
						<span
							className="band-vp"
							title="Their score so far from public information"
						>
							~{vp} VP
						</span>
					)}
					<span className="band-tracks">
						{SPECIALTIES.map((s) => (
							<SpecialtyBar
								key={s}
								specialty={s}
								position={p.specialties[s]}
								multipliers={p.tracks[s]}
							/>
						))}
					</span>
					<span className="band-fact" title="Missions completed">
						<Icon id="VP" label="Missions" /> {done}/{p.missions.length}
					</span>
					{incidents !== null && (
						<span className="band-fact" title="Incidents they hold">
							{incidents} Incident{incidents === 1 ? '' : 's'}
						</span>
					)}
					<BotTicker variant="console" />
					<button
						type="button"
						className={`btn micro band-screen${viewscreen ? ' btn-active' : ''}`}
						onClick={() => setViewscreen(!viewscreen)}
						aria-pressed={viewscreen}
						title="Their whole board at full size (V)"
					>
						On screen <kbd>V</kbd>
					</button>
				</div>
				<div className="band-tableau">
					{ZONES.map(({ k, label }) => (
						<BandZoneCards key={k} seat={seat} k={k} label={label} />
					))}
				</div>
			</div>
		</section>
	)
}

function BandZoneCards({
	seat,
	k,
	label,
}: {
	seat: Seat
	k: BandZone
	label: string
}) {
	const projected = useProjected()
	const iids = projected?.zones[zoneKey({ k, seat })] ?? []
	if (iids.length === 0 && k !== 'CAPTAIN') return null
	const open = (iid: CardInstanceId) => useGameStore.getState().cardClicked(iid)
	return (
		<div className={`band-zone band-${k.toLowerCase().replace('_', '-')}`}>
			<span className="band-zone-label">{label}</span>
			<div className="band-cards">
				{iids.map((iid) => (
					<TableCard
						key={iid}
						iid={iid}
						size="micro"
						onClick={() => open(iid)}
					/>
				))}
			</div>
		</div>
	)
}
