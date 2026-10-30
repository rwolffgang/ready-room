// A card as the desktop table draws it, with what belongs to it: a Location in
// play with its Away Teams, ships and beamed cards (<LocationCard>), a Fleet
// ship with the Location its standee stands on and the cards beamed aboard
// (<ShipCard>), any other card as its sprite. Every desktop surface that may
// show a card in play — the player areas, the opponent's band, a card choice's
// candidates, a "you may …" preview, witness sets — goes through <TableCard>,
// so a ship never loses its position or its crew. (The phone's CardTile does
// the same for its tiles.)

import type { CardInstanceId } from '../engine/ids'
import { useProjected } from './store'
import { CardSprite } from './cards'
import { LocationCard, isLocationInPlay } from './location'
import { ShipPosition } from './standees'
import { BeamedChips } from './beamed'

interface TableCardProps {
	iid: CardInstanceId
	size?: 'board' | 'micro' | undefined
	selected?: boolean | undefined
	dimmed?: boolean | undefined
	reason?: string | undefined
	onClick?: (() => void) | undefined
}

/** A Fleet ship: the card, the tab naming where its standee stands, and the
 *  cards beamed aboard. The opponent's compact strip stays a strip, as for a
 *  Location; its card detail lists them. */
export function ShipCard({
	iid,
	size = 'board',
	selected,
	dimmed,
	reason,
	onClick,
}: TableCardProps) {
	const sprite = (
		<CardSprite
			iid={iid}
			size={size}
			selected={selected}
			dimmed={dimmed}
			reason={reason}
			onClick={onClick}
		/>
	)
	if (size === 'micro') return sprite
	return (
		<div className="fleet-col">
			<div className="fleet-ship">
				{sprite}
				<ShipPosition ship={iid} />
			</div>
			<BeamedChips host={iid} placement="board" />
		</div>
	)
}

export function TableCard(props: TableCardProps) {
	const projected = useProjected()
	const zone = projected?.cards[props.iid]?.zone
	if (isLocationInPlay(zone)) return <LocationCard {...props} />
	if (zone?.k === 'FLEET') return <ShipCard {...props} />
	return <CardSprite {...props} />
}
