// The Market close up (M, Closeup.tsx): the four faceup cards at a size you
// can read, each under its suit and over what comes with it — the resource
// tokens on it, which whoever gains it takes and which keep it from being
// junked (rules/05 §5.4.4, §5.6), the cards left in its deck, and that suit's
// cards in the Junk, which `gain from the Junk` and `scan including the Junk`
// reach.

import type { MarketSuit, ResourceId } from '../../data/ids'
import { MARKET_SUITS_FOUR } from '../../engine/market'
import { zoneKey } from '../../engine/state'
import { CardSprite } from '../cards'
import { useDefIndex } from '../defs'
import { RESOURCE_LABEL } from '../format'
import { Icon, suitIconId } from '../icons'
import { useProjected } from '../store'

export function MarketCloseup() {
	return (
		<div className="closeup-row closeup-market-row">
			{MARKET_SUITS_FOUR.map((suit) => (
				<MarketSlot key={suit} suit={suit} />
			))}
		</div>
	)
}

function MarketSlot({ suit }: { suit: MarketSuit }) {
	const projected = useProjected()
	const defs = useDefIndex()
	if (projected === null) return null
	const zone = (key: string) => projected.zones[key] ?? []
	const offers = zone(zoneKey({ k: 'MARKET_OFFER', suit }))
	const deck = zone(zoneKey({ k: 'MARKET_DECK', suit })).length
	const junk = zone('JUNK').filter(
		(iid) => defs.get(projected.cards[iid]?.def ?? '')?.suit === suit,
	).length
	const tokens = new Map<ResourceId, number>()
	for (const iid of offers)
		for (const [r, n] of Object.entries(
			projected.cards[iid]?.resourceTokens ?? {},
		) as [ResourceId, number][])
			if (n > 0) tokens.set(r, (tokens.get(r) ?? 0) + n)
	const note =
		offers.length === 0
			? deck === 0
				? 'Nothing left of this suit in the Market or its deck.'
				: 'Nothing on offer.'
			: [
					tokens.size > 0 &&
						'Whoever gains it takes its tokens too, and while it carries them it can’t be junked.',
					deck === 0
						? 'Its deck is empty: once it goes, the slot stays empty.'
						: tokens.size === 0 &&
							'Once it goes, the next card of the deck takes its place.',
				]
					.filter(Boolean)
					.join(' ')
	return (
		<div className="closeup-slot">
			<span
				className={`suit-pill suit-banner closeup-suit card-suit-${suit.toLowerCase()}`}
			>
				<Icon id={suitIconId(suit)} label={suit} size="md" />
				{suit}
			</span>
			{offers.length > 0 ? (
				offers.map((iid) => <CardSprite key={iid} iid={iid} size="board" />)
			) : (
				<div className="empty-slot muted">empty</div>
			)}
			<div className="closeup-readout">
				<strong className="closeup-status">
					{deck === 0 ? 'Deck empty' : `${deck} in the deck`}
				</strong>
				<div className="closeup-side">
					<span className="closeup-who">Tokens on it</span>
					{tokens.size === 0 ? (
						<span className="closeup-count">none</span>
					) : (
						[...tokens].map(([r, n]) => (
							<span
								key={r}
								className="closeup-count"
								title={`${n} ${RESOURCE_LABEL[r]}`}
							>
								<Icon id={r} label={RESOURCE_LABEL[r]} /> {n}
							</span>
						))
					)}
				</div>
				<div className="closeup-side">
					<span className="closeup-who">In the Junk</span>
					<span className="closeup-count">{junk}</span>
				</div>
				<p className="closeup-note">{note}</p>
			</div>
		</div>
	)
}
