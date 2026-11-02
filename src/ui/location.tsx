// A Location in play as the desktop draws it: the card, its Away Teams stacked
// down the edges (P1 left, P2 right), the ships standing on it, the cards
// beamed to it and, in the Neutral Zone, whether the viewer has it secured.
// Every desktop surface that shows a Location — the Neutral Zone and the
// Location choice directly, the Location Areas and any card choice through
// <TableCard> (tableCard.tsx) — goes through <LocationCard>, so the teams,
// ships and beamed cards are never missing. (The phone's CardTile does the
// same for its Location tiles.)

import type { GameState } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import { isSecured } from '../engine/queries/board'
import { useProjected, useViewerSeat } from './store'
import { CardSprite } from './cards'
import { ShipStandees } from './standees'
import { BeamedChips } from './beamed'
import { Icon } from './icons'

/** Away Teams at a Location, drawn as token icons stacked down the card's
 *  edges — P1 on the left, P2 on the right — each icon half over the card. */
function AwayTeamMarkers({
	teams,
	small,
}: {
	teams: readonly [number, number] | undefined
	small: boolean
}) {
	return (
		<>
			{([0, 1] as const).map((seat) => {
				const n = teams?.[seat] ?? 0
				if (n === 0) return null
				const label = `P${seat + 1}: ${n} Away Team${n === 1 ? '' : 's'}`
				return (
					<div
						key={seat}
						className={`away-stack away-stack-${seat}${n > 5 ? ' away-stack-dense' : ''}`}
						role="img"
						aria-label={label}
						title={label}
					>
						{Array.from({ length: n }, (_, i) => (
							<span key={i} className="away-marker">
								<Icon id="AWAY_TEAM" label={label} size={small ? 'sm' : 'md'} />
							</span>
						))}
					</div>
				)
			})}
		</>
	)
}

/** True for a card in a zone where Locations hold Away Teams and ships. */
export function isLocationInPlay(zone: { k: string } | undefined): boolean {
	return zone?.k === 'LOCATION_AREA' || zone?.k === 'NEUTRAL_ZONE'
}

export function LocationCard({
	iid,
	size = 'board',
	selected,
	dimmed,
	reason,
	onClick,
	quickPlay,
}: {
	iid: CardInstanceId
	size?: 'board' | 'micro' | undefined
	selected?: boolean | undefined
	dimmed?: boolean | undefined
	reason?: string | undefined
	onClick?: (() => void) | undefined
	/** the Play button for one legal operation (quickPlay.tsx) */
	quickPlay?: boolean | undefined
}) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const state = projected as unknown as GameState | null
	const secured =
		state !== null &&
		state.cards[iid]?.zone.k === 'NEUTRAL_ZONE' &&
		isSecured(state, iid, viewer)
	const card = (
		<div
			className={`location-with-teams location-${size}${secured ? ' location-secured' : ''}`}
		>
			<CardSprite
				iid={iid}
				size={size}
				selected={selected}
				dimmed={dimmed}
				reason={reason}
				badge={
					secured && size === 'board' ? (
						<span className="secured-badge">secured</span>
					) : null
				}
				onClick={onClick}
				quickPlay={quickPlay}
			/>
			<AwayTeamMarkers
				teams={state?.awayTeamsAt[iid]}
				small={size === 'micro'}
			/>
			<ShipStandees loc={iid} placement="overlay" />
		</div>
	)
	// the opponent's compact strip stays a strip; its card detail lists them
	if (size === 'micro') return card
	return (
		<div className="location-col">
			{card}
			<BeamedChips host={iid} placement="board" />
		</div>
	)
}
