// Ship standees: the physical game stands a ship's miniature on the Location it
// has set a course for, while the ship card stays in its owner's Fleet. The
// engine records the position as the ship's `shipTokenAt` (a Location iid while
// the ship is deployed); these components draw it on the Location — a small
// plaque with the printed SHIP icon in the owner's colour — and, on the Fleet
// card, where the ship is.

import type { MouseEvent } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { Seat } from '../engine/resolver/queries'
import type { ProjectedState } from './projection'
import { HIDDEN_DEF } from './projection'
import { useProjected, useViewerSeat, setDetail } from './store'
import { useDefIndex, type CardDef } from './defs'
import { cardName } from '../data/cardNames'
import { seatLabel } from './format'
import { printedSuitUrl } from './printedIcons'
import './standees.css'

export interface ShipAt {
	iid: CardInstanceId
	owner: Seat
}

/** Deployed ships whose token sits at `loc`, P1's first (same membership as
 *  the engine's shipTokensAt: only a ship in its Fleet counts). */
export function shipsAt(
	projected: ProjectedState,
	loc: CardInstanceId,
): ShipAt[] {
	const out: ShipAt[] = []
	for (const [iid, card] of Object.entries(projected.cards)) {
		if (
			card.zone.k === 'FLEET' &&
			card.shipTokenAt === loc &&
			card.owner !== null
		)
			out.push({ iid: iid as CardInstanceId, owner: card.owner })
	}
	return out.sort((a, b) => a.owner - b.owner || a.iid.localeCompare(b.iid))
}

function nameOf(
	projected: ProjectedState,
	index: Map<string, CardDef>,
	iid: string,
): string {
	const d = projected.cards[iid]?.def
	if (d === undefined || d === HIDDEN_DEF) return 'a ship'
	return cardName(index.get(d)) ?? iid
}

function ownerLabel(owner: Seat, viewer: Seat): string {
	return owner === viewer
		? `${seatLabel(owner)} (you)`
		: `${seatLabel(owner)} (opponent)`
}

/** The printed SHIP icon as a mask, so it takes the owner's colour. */
function ShipIcon() {
	const url = printedSuitUrl('SHIP')
	return url === null ? (
		<span className="standee-glyph" aria-hidden="true">
			▲
		</span>
	) : (
		<span
			className="standee-icon"
			aria-hidden="true"
			style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }}
		/>
	)
}

/**
 * The ships at a Location, one standee each. `placement` picks the desktop
 * overlay (along the card's bottom edge) or an inline row (phone tiles).
 * A click opens the ship's card detail and never reaches the Location card;
 * `interactive={false}` draws them without buttons (the tile sits in one).
 */
export function ShipStandees({
	loc,
	placement,
	interactive = true,
}: {
	loc: CardInstanceId
	placement: 'overlay' | 'inline'
	interactive?: boolean | undefined
}) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const index = useDefIndex()
	if (projected === null) return null
	const ships = shipsAt(projected, loc)
	if (ships.length === 0) return null
	return (
		<div
			className={`standees standees-${placement}${ships.length > 4 ? ' standees-dense' : ''}`}
			role="group"
			aria-label="Ships here"
		>
			{ships.map(({ iid, owner }) => {
				const name = nameOf(projected, index, iid)
				const who = owner === viewer ? 'me' : 'them'
				const label = `${name} · ${ownerLabel(owner, viewer)}`
				const body = (
					<>
						<ShipIcon />
						{placement === 'inline' && (
							<span className="standee-name">{name}</span>
						)}
					</>
				)
				const cls = `standee standee-seat-${owner} standee-${who}`
				return interactive ? (
					<button
						key={iid}
						type="button"
						className={cls}
						title={label}
						aria-label={`Ship: ${label}`}
						onClick={(e: MouseEvent) => {
							e.stopPropagation()
							setDetail(iid)
						}}
					>
						{body}
					</button>
				) : (
					<span
						key={iid}
						className={cls}
						title={label}
						aria-label={`Ship: ${label}`}
					>
						{body}
					</span>
				)
			})}
		</div>
	)
}

/** On a Fleet ship card (desktop, via ShipCard): which Location its standee
 *  stands on — a click opens that Location's detail. Nothing while the token
 *  is on the card or in the supply, and nothing on a Fleet card that is not a
 *  ship (a deployed Cargo). Same words as the phone tile's chip
 *  (tile/CardTile.tsx). */
export function ShipPosition({ ship }: { ship: CardInstanceId }) {
	const projected = useProjected()
	const index = useDefIndex()
	const card = projected?.cards[ship]
	if (projected === null || card === undefined) return null
	const at = card.shipTokenAt
	const owner = card.owner ?? 0
	if (at === null || at === 'SUPPLY') return null
	const name = nameOf(projected, index, at)
	return (
		<button
			type="button"
			className={`ship-at standee-seat-${owner}`}
			title={`At ${name}`}
			aria-label={`At ${name}`}
			onClick={(e: MouseEvent) => {
				e.stopPropagation()
				setDetail(at)
			}}
		>
			<ShipIcon />
			<span className="ship-at-name">at {name}</span>
		</button>
	)
}
