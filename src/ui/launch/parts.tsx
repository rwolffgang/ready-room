// The pieces of the start screen's matchup stage: a captain's portrait (the
// art of their captain card from the fetched STCC data, or the deck code in
// the code-only builds), the dossier a seat's captain and controls sit in,
// the roster that fills the seat being chosen, and the small controls the
// panels share (segmented buttons, rank pips).

import { useState, type CSSProperties, type ReactNode } from 'react'
import type { CardCatalog } from '../../engine/setup'
import type { DeckId } from '../../data/ids'
import type { CardDef } from '../../data/schema'
import type { Seat } from '../../engine/resolver/queries'
import { deckLabel } from '../../data/cardNames'
import { OpText } from '../cards'
import { cardImageUrl } from '../stcc'
import { FACES, FALLBACK } from './faces'

/** A crew deck's captain card. */
export function captainOf(
	catalog: CardCatalog | null,
	deck: DeckId,
): CardDef | null {
	return (
		catalog?.defs.find((d) => d.deck === deck && d.suit === 'CAPTAIN') ?? null
	)
}

/** The captain's face, framed on its measured position in the card art
 *  (faces.ts; launch.css does the arithmetic per frame); the deck code when
 *  there is no scan (code-only builds) or it fails to load. */
export function Portrait({
	catalog,
	deck,
	className = '',
}: {
	catalog: CardCatalog | null
	deck: DeckId
	className?: string
}) {
	const def = captainOf(catalog, deck)
	const url = def !== null ? cardImageUrl(def) : null
	const [failed, setFailed] = useState<string | null>(null)
	const show = url !== null && failed !== url
	const face = FACES[def?.cardId ?? ''] ?? FALLBACK
	const focus = {
		'--fx': face.x,
		'--fy': face.y,
		'--fh': face.h,
	} as CSSProperties
	return (
		<span className={`lr-portrait ${className}`} aria-hidden="true">
			{show ? (
				<img
					src={url}
					alt=""
					decoding="async"
					style={focus}
					onError={() => setFailed(url)}
				/>
			) : (
				<span className="lr-portrait-code">{deck}</span>
			)}
		</span>
	)
}

/** One seat on the stage. The portrait is the control that makes this the
 *  seat the roster fills. */
export function Dossier({
	catalog,
	deck,
	seat,
	tag,
	role,
	active,
	onActivate,
	children,
}: {
	catalog: CardCatalog | null
	deck: DeckId | null
	seat: Seat
	/** "Player 1", "You", "The Bot" */
	tag: string
	/** who is in the chair: "Human", "House AI · Normal", "Ensign" */
	role: string
	/** the roster fills this seat; null when the stage has one seat only */
	active: boolean | null
	onActivate: () => void
	children?: ReactNode
}) {
	const def = deck !== null ? captainOf(catalog, deck) : null
	return (
		<article
			className={`lr-dossier lr-seat-${seat}${active === true ? ' is-active' : ''}`}
			aria-label={`${tag}: ${deck !== null ? deckLabel(deck) : 'no captain'}`}
		>
			<header className="lr-dossier-tag">
				<span className="lr-tag-pill">{tag}</span>
				<span className="lr-tag-role">{role}</span>
			</header>
			<button
				type="button"
				className="lr-dossier-face"
				onClick={onActivate}
				aria-pressed={active ?? undefined}
				aria-label={`Choose the captain for ${tag}`}
			>
				{deck !== null && <Portrait catalog={catalog} deck={deck} />}
				<span className="lr-dossier-name">
					<span className="lr-dossier-kicker">
						{active === true ? 'Choosing from the roster' : 'Captain'}
					</span>
					<strong>{deck !== null ? deckLabel(deck) : '—'}</strong>
					{def !== null && def.traits.length > 0 && (
						<span className="lr-traits">
							<OpText
								text={def.traits.map((t) => `[[${t.toLowerCase()}]]`).join(' ')}
								plain
							/>
						</span>
					)}
				</span>
			</button>
			{children !== undefined && (
				<div className="lr-dossier-controls">{children}</div>
			)}
		</article>
	)
}

/** The badge between the two dossiers. */
export function VsBadge({ label = 'vs' }: { label?: string }) {
	return (
		<div className="lr-vs" aria-hidden="true">
			<span>{label}</span>
		</div>
	)
}

/** Every crew deck as a portrait tile; a click puts that captain in the seat
 *  being chosen. Tiles carry the seat badges of the captains already seated. */
export function Roster({
	catalog,
	decks,
	seated,
	seatTags,
	active,
	enabled,
	onPick,
}: {
	catalog: CardCatalog | null
	decks: readonly DeckId[]
	/** the deck in each seat (null: that seat isn't on this stage) */
	seated: readonly [DeckId | null, DeckId | null]
	seatTags: readonly [string, string]
	active: Seat
	enabled: (deck: DeckId) => boolean
	onPick: (deck: DeckId) => void
}) {
	return (
		<section className={`lr-roster lr-roster-for-${active}`}>
			<h3 className="lr-roster-head">
				<span>Roster</span>
				<span className="lr-roster-for">
					choosing for <b>{seatTags[active]}</b>
				</span>
			</h3>
			<ul className="lr-roster-grid">
				{decks.map((d) => {
					const at = ([0, 1] as const).filter((s) => seated[s] === d)
					const ok = enabled(d)
					return (
						<li key={d}>
							<button
								type="button"
								className={`lr-tile${seated[active] === d ? ' is-picked' : ''}`}
								disabled={!ok}
								aria-pressed={seated[active] === d}
								aria-label={`${deckLabel(d)} for ${seatTags[active]}`}
								onClick={() => onPick(d)}
							>
								<Portrait catalog={catalog} deck={d} />
								<span className="lr-tile-name">{deckLabel(d)}</span>
								{at.length > 0 && (
									<span className="lr-tile-badges">
										{at.map((s) => (
											<span key={s} className={`lr-badge lr-seat-${s}`}>
												{seatTags[s]}
											</span>
										))}
									</span>
								)}
							</button>
						</li>
					)
				})}
			</ul>
		</section>
	)
}

/** A row of pressed/unpressed buttons for one choice. */
export function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
	className = '',
}: {
	/** the group's accessible name */
	label: string
	value: T
	options: readonly {
		v: T
		text: ReactNode
		/** accessible name, when the visible text is short */
		name?: string
		/** a caption over a run of options ("House AI") */
		group?: string
		title?: string
	}[]
	onChange: (v: T) => void
	className?: string
}) {
	return (
		<div className={`lr-seg ${className}`} role="group" aria-label={label}>
			{options.map((o, i) => {
				const prev = options[i - 1]
				const opens = o.group !== undefined && prev?.group !== o.group
				return (
					<button
						key={o.v}
						type="button"
						className={`lr-seg-btn${opens ? ' opens-group' : ''}`}
						data-group={opens ? o.group : undefined}
						aria-pressed={value === o.v}
						aria-label={o.name}
						title={o.title ?? o.name}
						onClick={() => onChange(o.v)}
					>
						{o.text}
					</button>
				)
			})}
		</div>
	)
}

/** A labelled control in a dossier or panel. */
export function Field({
	label,
	children,
}: {
	label: ReactNode
	children: ReactNode
}) {
	return (
		<div className="lr-field">
			<span className="lr-field-label">{label}</span>
			{children}
		</div>
	)
}

/** Rank insignia: pips for Ensign to Captain, a bar with pips above that.
 *  Shared by the Bot's difficulty and the Five-Year Mission's ranks. */
const PIPS: Record<string, { n: number; bar: boolean }> = {
	ENSIGN: { n: 1, bar: false },
	LIEUTENANT: { n: 2, bar: false },
	COMMANDER: { n: 3, bar: false },
	CAPTAIN: { n: 4, bar: false },
	COMMODORE: { n: 1, bar: true },
	ADMIRAL: { n: 4, bar: true },
}

export function RankPips({ rank }: { rank: string }) {
	const p = PIPS[rank] ?? { n: 0, bar: false }
	return (
		<span
			className={`lr-pips${p.bar ? ' lr-pips-bar' : ''}`}
			aria-hidden="true"
		>
			{Array.from({ length: p.n }, (_, i) => (
				<i key={i} />
			))}
		</span>
	)
}
