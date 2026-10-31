// The Neutral Zone close up (N, or the button over the three Locations; the
// frame is Closeup.tsx): the Locations at a size you can read, each with its
// Away Teams, ships and beamed cards as on the table, and under it the secure
// rule worked out for both sides (rules/03 §3.4.1) — who holds it, the token
// count, what it takes from here.

import type { GameState } from '../../engine/state'
import { otherSeat, zoneKey } from '../../engine/state'
import type { CardInstanceId } from '../../engine/ids'
import type { Seat } from '../../engine/resolver/queries'
import { shipTokensAt } from '../../engine/queries/board'
import { useGameStore, useProjected, useViewerSeat } from '../store'
import { LocationCard } from '../location'
import { Icon } from '../icons'
import { seatLabel } from '../format'
import { secureCopy, secureStatus } from '../mobile/facts'

export function NeutralCloseup() {
	return (
		<div className="closeup-row">
			{([0, 1, 2] as const).map((slot) => (
				<CloseupSlot key={slot} slot={slot} />
			))}
		</div>
	)
}

function CloseupSlot({ slot }: { slot: 0 | 1 | 2 }) {
	const projected = useProjected()
	const loc = projected?.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot })]?.[0]
	if (projected === null) return null
	return (
		<div className="closeup-slot">
			{loc === undefined ? (
				<div className="empty-slot muted">no Location</div>
			) : (
				<>
					<LocationCard
						iid={loc}
						onClick={() => useGameStore.getState().cardClicked(loc)}
					/>
					<SecureReadout state={projected as unknown as GameState} loc={loc} />
				</>
			)}
		</div>
	)
}

/** Who holds the Location, and each side's tokens there by kind. */
function SecureReadout({
	state,
	loc,
}: {
	state: GameState
	loc: CardInstanceId
}) {
	const viewer = useViewerSeat()
	const opp = otherSeat(viewer)
	const s = secureStatus(state, loc, viewer)
	const copy = secureCopy(s, seatLabel(opp))
	const holder =
		s.securedBy === 'you' ? viewer : s.securedBy === 'them' ? opp : null
	return (
		<div
			className={`closeup-readout${holder === null ? '' : ` closeup-seat-${holder}`}`}
		>
			<strong className="closeup-status">{copy.head}</strong>
			{([0, 1] as const).map((seat) => (
				<SideTokens
					key={seat}
					seat={seat}
					you={seat === viewer}
					teams={state.awayTeamsAt[loc]?.[seat] ?? 0}
					ships={shipTokensAt(state, loc, seat)}
				/>
			))}
			<p className="closeup-note">{copy.note}</p>
		</div>
	)
}

function SideTokens({
	seat,
	you,
	teams,
	ships,
}: {
	seat: Seat
	you: boolean
	teams: number
	ships: number
}) {
	const who = `${seatLabel(seat)}${you ? ' (you)' : ''}`
	const teamsLabel = `${teams} Away Team${teams === 1 ? '' : 's'}`
	const shipsLabel = `${ships} ship${ships === 1 ? '' : 's'}`
	return (
		<div
			className={`closeup-side closeup-seat-${seat}`}
			aria-label={`${who}: ${teamsLabel}, ${shipsLabel}`}
		>
			<span className="closeup-who">{who}</span>
			<span className="closeup-count" title={teamsLabel}>
				<Icon id="AWAY_TEAM" label="Away Teams" /> {teams}
			</span>
			<span className="closeup-count" title={shipsLabel}>
				<Icon id="SUIT:SHIP" label="Ships" /> {ships}
			</span>
		</div>
	)
}
