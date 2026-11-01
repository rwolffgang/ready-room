// Deck Review page (special overview): review every card deck side-by-side
// with the printed art and the rules as the engine actually interprets them.
//
//   - grouped by captain deck (then the COMMON market pool), and within each
//     deck by suit ("type")
//   - each card shows the printed card art face next to a structured summary,
//     the printed rules text (from the fetched STCC data, matched to our
//     operations by type and order), and the interpreted operation text
//     (describeOperation — what the effect tree actually does)
//
// This is the authoring/review surface for catching "the card says X but the
// game does Y": the Printed/Interpreted columns make the diff visible.

import { useMemo, useState } from 'react'
import type { CardDef } from '../data/schema'
import type { SpecialtyId, Suit } from '../data/ids'
import { describe } from '../engine/describe'
import type { Effect } from '../engine/resolver/nodes'
import { useCatalog } from './store'
import { CardFace, OpText, PrintedText, safeDescribe } from './cards'
import { printedOpFor, printedOps } from '../data/stcc'
import { stccCard } from './stcc'
import { SpecialtyLabel } from './icons'
import { cardName, deckLabel } from '../data/cardNames'
import { ReferenceTabs } from './ReferenceTabs'

/** Physical deck order for display: the six captain decks, then the shared
 *  COMMON pool. Decks not in this list appear afterwards alphabetically. */
const DECK_ORDER = [
	'PIC',
	'SIS',
	'SEL',
	'SHR',
	'BUR',
	'KOL',
	'MAL',
	'SHP',
	'COMMON',
] as const

/** Suit ("type") order within a deck — captain first, then the rest in a
 *  stable reading order; unknown suits sort alphabetically after the list. */
const SUIT_ORDER: string[] = [
	'CAPTAIN',
	'SHIP',
	'PERSON',
	'ALLY',
	'CARGO',
	'DIRECTIVE',
	'ENCOUNTER',
	'INCIDENT',
	'LOCATION',
	'STATUS',
]

function orderIndex(list: readonly string[], value: string): number {
	const i = list.indexOf(value)
	return i === -1 ? list.length : i
}

export function DeckReview({ onClose }: { onClose: () => void }) {
	const catalog = useCatalog()
	const [query, setQuery] = useState('')
	const [deck, setDeck] = useState<string>('ALL')
	const [suit, setSuit] = useState<string>('ALL')

	const allDecks = useMemo(() => {
		const present = new Set<string>()
		for (const d of catalog?.defs ?? [])
			if (d.deck !== undefined) present.add(d.deck)
		return [...present].sort(
			(a, b) =>
				orderIndex(DECK_ORDER, a) - orderIndex(DECK_ORDER, b) ||
				a.localeCompare(b),
		)
	}, [catalog])

	const allSuits = useMemo(() => {
		const present = new Set<Suit>()
		for (const d of catalog?.defs ?? []) present.add(d.suit)
		return [...present].sort(
			(a, b) =>
				orderIndex(SUIT_ORDER, a) - orderIndex(SUIT_ORDER, b) ||
				a.localeCompare(b),
		)
	}, [catalog])

	const sections = useMemo(() => {
		const q = query.trim().toLowerCase()
		const match = (d: CardDef): boolean => {
			if (deck !== 'ALL' && d.deck !== deck) return false
			if (suit !== 'ALL' && d.suit !== suit) return false
			if (q === '') return true
			const hay = [
				d.id,
				d.cardId ?? '',
				cardName(d),
				d.suit,
				d.deck,
				...d.traits,
				...d.skills,
				...Object.values(stccCard(d)?.text ?? {}),
				...d.operations.flatMap((o) => safeDescribe(o) ?? []),
			]
				.join(' ')
				.toLowerCase()
			return hay.includes(q)
		}
		const sections = allDecks
			.map((deckName) => {
				const cards = (catalog?.defs ?? [])
					.filter((d) => d.deck === deckName && match(d))
					.sort(
						(a, b) =>
							orderIndex(SUIT_ORDER, a.suit) - orderIndex(SUIT_ORDER, b.suit) ||
							a.id.localeCompare(b.id),
					)
				if (cards.length === 0) return null
				const bySuit = new Map<string, CardDef[]>()
				for (const d of cards) {
					const list = bySuit.get(d.suit)
					if (list === undefined) bySuit.set(d.suit, [d])
					else list.push(d)
				}
				return {
					deck: deckName,
					total: cards.length,
					suits: [...bySuit.entries()],
				}
			})
			.filter((s): s is NonNullable<typeof s> => s !== null)
		return sections
	}, [catalog, allDecks, query, deck, suit])

	const total = useMemo(
		() => sections.reduce((n, s) => n + s.total, 0),
		[sections],
	)

	return (
		<div className="drawer-backdrop deck-review-backdrop" onClick={onClose}>
			<aside
				className="deck-review"
				onClick={(e) => e.stopPropagation()}
				aria-label="Deck review"
			>
				<div className="drawer-head">
					<ReferenceTabs current="decks" />
					<span className="muted small">
						{total} card{total === 1 ? '' : 's'}
					</span>
					<button type="button" className="btn" onClick={onClose}>
						Close
					</button>
				</div>
				<div className="deck-review-controls">
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="filter by name / id / trait / keyword"
						aria-label="filter cards"
					/>
					<select
						value={deck}
						onChange={(e) => setDeck(e.target.value)}
						aria-label="filter by deck"
					>
						<option value="ALL">all decks</option>
						{allDecks.map((d) => (
							<option key={d} value={d}>
								{deckLabel(d)}
							</option>
						))}
					</select>
					<select
						value={suit}
						onChange={(e) => setSuit(e.target.value)}
						aria-label="filter by type"
					>
						<option value="ALL">all types</option>
						{allSuits.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</div>
				<nav className="deck-review-nav" aria-label="jump to deck">
					{sections.map((s) => (
						<a
							key={s.deck}
							href={`#deck-${s.deck}`}
							className="deck-review-jump"
						>
							{deckLabel(s.deck)}
							<span className="muted small"> {s.total}</span>
						</a>
					))}
				</nav>
				<div className="deck-review-body">
					{sections.length === 0 && (
						<p className="muted deck-review-empty">
							No cards match the current filters.
						</p>
					)}
					{sections.map((section) => (
						<section
							key={section.deck}
							className="deck-section"
							id={`deck-${section.deck}`}
						>
							<h2 className="deck-section-head">
								{deckLabel(section.deck)}{' '}
								<span className="muted small">· {section.total} cards</span>
							</h2>
							{section.suits.map(([suitName, cards]) => (
								<div key={suitName} className="deck-suit">
									<h3 className="deck-suit-head">
										{suitName}{' '}
										<span className="muted small">· {cards.length}</span>
									</h3>
									{cards.map((def) => (
										<ReviewCard key={def.id} def={def} />
									))}
								</div>
							))}
						</section>
					))}
				</div>
			</aside>
		</div>
	)
}

// ---------------------------------------------------------------------------
// One card: printed card art + structured summary + printed/interpreted ops
// ---------------------------------------------------------------------------

function ReviewCard({ def }: { def: CardDef }) {
	const stcc = stccCard(def)
	const printed = stcc !== null ? printedOps(stcc.text) : []
	const hasSpecial =
		def.suit === 'SHIP' ||
		def.awayTeams !== undefined ||
		def.locationTier !== undefined
	return (
		<div className="review-card">
			<div className="review-art">
				<CardFace def={def} size="review" forceArt />
			</div>
			<div className="review-detail">
				<div className="review-title">
					<h4>{cardName(def)}</h4>
					<span className="review-id">
						{' '}
						{deckLabel(def.deck)} · {def.suit} · {def.cardId ?? def.id}
					</span>
				</div>
				<div className="review-facts">
					{def.traits.length > 0 && (
						<span className="fact-group">
							{def.traits.map((t) => (
								<span key={t} className="trait">
									{t}
								</span>
							))}
						</span>
					)}
					{def.skills.map((s, i) => (
						<span key={`${s}-${i}`} className="skill-chip">
							{s.replaceAll('_', ' ')}
						</span>
					))}
					{def.focus !== null && def.focus !== undefined && (
						<span className="skill-chip focus-chip">
							<SpecialtyLabel
								specialty={
									def.focus.replace(/^FOCUS_/, '').toUpperCase() as SpecialtyId
								}
								focus
							/>
						</span>
					)}
					<span className="chip review-vp">
						{def.vpAsterisk ? '*' : ''}
						{def.vp} VP
					</span>
					<span className="chip">
						{def.startPosition ?? 'no start position'}
					</span>
					{hasSpecial && (
						<span className="chip">
							{[
								def.suit === 'SHIP' ? 'ship token' : null,
								def.awayTeams !== undefined
									? `${def.awayTeams} away team${def.awayTeams === 1 ? '' : 's'}`
									: null,
								def.locationTier !== undefined
									? `${def.locationTier} location`
									: null,
							]
								.filter((s): s is string => s !== null)
								.join(' · ')}
						</span>
					)}
				</div>
				<PrintedText def={def} />
				{def.developmentCost !== null && def.developmentCost !== undefined && (
					<p className="review-dev muted small">
						<strong>Development</strong> —{' '}
						<OpText text={describeDevelopment(def.developmentCost)} />
					</p>
				)}
				{def.operations.map((op, i) => {
					const interpreted = safeDescribe(op)
					return (
						<div key={i} className="review-op">
							<div className="review-op-head">
								<span className={`op-type op-type-${op.type.toLowerCase()}`}>
									{op.type}
								</span>
								{op.costsAction ? (
									<span className="chip">costs an action</span>
								) : null}
								{op.isAttack ? <span className="chip">attack</span> : null}
								{op.requires !== undefined ? (
									<span
										className={`chip ${specialtyClasses(op.requires.specialty)}`}
									>
										<SpecialtyLabel specialty={op.requires.specialty} />{' '}
										{op.requires.min}
									</span>
								) : null}
							</div>
							<div className="review-op-cols">
								<OpColumn
									label="Printed"
									text={printedOpFor(printed, def.operations, i)?.text ?? '—'}
								/>
								<OpColumn
									label="Interpreted"
									text={interpreted ?? '<unreadable operation>'}
								/>
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function OpColumn({ label, text }: { label: string; text: string }) {
	return (
		<div className={`review-col review-col-${label.toLowerCase()}`}>
			<span className="review-col-label">{label}</span>
			<p className="op-text">
				<OpText text={text} />
			</p>
		</div>
	)
}

function specialtyClasses(s: string): string {
	return `s-${s.toLowerCase()}`
}

/** Render a developmentCost (an Effect) as a snippet sentence. */
function describeDevelopment(effect: Effect): string {
	const text = describe(effect)
	return text === '' ? '(no effect)' : text
}
