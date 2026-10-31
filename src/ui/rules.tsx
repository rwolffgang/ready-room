// Rules drawer + Card List reference panel (todo/14 §7, docs/ui-spec.md §5/§7).
//   - the rules markdown files ship as raw strings (Vite ?raw glob) and render
//     with a tiny markdown renderer; keyword links opened from card text (see
//     cards.tsx OpText) jump straight to their rules/08 anchor;
//   - the Card List panel is the "sheet that comes with the box": filter by
//     suit/trait/skill and see what remains in each Market deck (public info).

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CardDef } from '../data/schema'
import type { Suit, TraitId, MarketSuit } from '../data/ids'
import { MARKET_SUITS_FOUR } from '../engine/market'
import { useProjected, useCatalog } from './store'
import { CardFace, useZoomKey } from './cards'
import { useDefIndex } from './defs'
import { HIDDEN_DEF } from './projection'
import { zoneKey } from '../engine/state'
import { cardName } from '../data/cardNames'
import { ReferenceTabs } from './ReferenceTabs'

const RAW_RULES = import.meta.glob('../../rules/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
})

/** rules/<name>.md on disk → display title. */
function ruleTitle(file: string): string {
	return file.replace('../../rules/', '').replace('.md', '')
}

function ruleFiles(): string[] {
	return Object.keys(RAW_RULES).sort((a, b) =>
		ruleTitle(a).localeCompare(ruleTitle(b)),
	)
}

// ---------------------------------------------------------------------------
// tiny markdown renderer (headings, bullets, bold, code, blockquote, hr)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): ReactNode {
	const lines = text.split('\n')
	const out: ReactNode[] = []
	let list: ReactNode[] | null = null
	let key = 0

	const flushList = () => {
		if (list !== null) {
			out.push(<ul key={`l${key++}`}>{list}</ul>)
			list = null
		}
	}

	for (const raw of lines) {
		const line = raw.trimEnd()
		const isHeading = /^#{1,6}\s+/.test(line)
		const isBullet = /^[-*]\s+/.test(line)
		const isOrdered = /^\d+\.\s+/.test(line)
		const isQuote = /^>\s?/.test(line)
		const isHr = /^---+$/.test(line.trim())
		const isPara = line.trim() === ''

		if (isHeading) {
			flushList()
			const match = /^(#{1,6})\s+(.*)$/.exec(line)
			const level = match?.[1]?.length ?? 2
			const headingText = match?.[2] ?? ''
			// rules files carry anchors like "## `beam` · `id: BEAM`"
			const idMatch = /`?id:\s*([A-Z_0-9]+)`?/.exec(headingText)
			const anchor = idMatch?.[1]
			const visible =
				headingText
					.replace(/`?id:\s*[A-Z_0-9]+`?/g, '')
					.replace(/\s*·\s*$/, '')
					.trim() || headingText
			out.push(
				<Heading key={`h${key++}`} level={level} anchor={anchor}>
					{renderInline(visible)}
				</Heading>,
			)
			continue
		}
		if (isBullet || isOrdered) {
			const bullet = (
				isBullet ? line.replace(/^[-*]\s+/, '') : line.replace(/^\d+\.\s+/, '')
			).trim()
			if (list === null) list = []
			list.push(<li key={`li${key++}`}>{renderInline(bullet)}</li>)
			continue
		}
		if (isQuote) {
			flushList()
			out.push(
				<blockquote key={`q${key++}`}>
					{renderInline(line.replace(/^>\s?/, ''))}
				</blockquote>,
			)
			continue
		}
		if (isHr) {
			flushList()
			out.push(<hr key={`hr${key++}`} />)
			continue
		}
		if (isPara) {
			flushList()
			continue
		}
		flushList()
		out.push(<p key={`p${key++}`}>{renderInline(line)}</p>)
	}
	flushList()
	return out
}

function Heading({
	level,
	anchor,
	children,
}: {
	level: number
	anchor?: string | undefined
	children: ReactNode
}) {
	const Tag =
		level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4'
	const props = anchor !== undefined ? { id: anchor } : {}
	switch (Tag) {
		case 'h1':
			return <h1 {...props}>{children}</h1>
		case 'h2':
			return <h2 {...props}>{children}</h2>
		case 'h3':
			return <h3 {...props}>{children}</h3>
		default:
			return <h4 {...props}>{children}</h4>
	}
}

function renderInline(text: string): ReactNode {
	const parts: ReactNode[] = []
	let key = 0
	// code spans
	const codeSplits = text.split('`')
	codeSplits.forEach((part, i) => {
		if (part === '') return
		if (i % 2 === 1) {
			parts.push(
				<code key={`c${key++}`} className="rule-code">
					{part}
				</code>,
			)
			return
		}
		// bold **x**
		const boldSplits = part.split('**')
		boldSplits.forEach((bp, bi) => {
			if (bp === '') return
			if (bi % 2 === 1) {
				parts.push(<strong key={`b${key++}`}>{bp}</strong>)
			} else {
				parts.push(<span key={`s${key++}`}>{bp}</span>)
			}
		})
	})
	return parts
}

// ---------------------------------------------------------------------------
// RulesDrawer
// ---------------------------------------------------------------------------

export function RulesDrawer({
	openAnchor,
	onClose,
}: {
	openAnchor: string | null
	onClose: () => void
}) {
	const [file, setFile] = useState<string>(() => {
		const files = ruleFiles()
		return files.find((f) => f.includes('08-keywords')) ?? files[0] ?? ''
	})
	const content = RAW_RULES[file] as string | undefined

	useEffect(() => {
		if (openAnchor !== null && file.includes('08-keywords') === false) {
			setFile(ruleFiles().find((f) => f.includes('08-keywords')) ?? file)
		}
		if (openAnchor !== null) {
			// after paint, scroll the anchor into view
			requestAnimationFrame(() => {
				const el = document.getElementById(openAnchor)
				el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
			})
		}
	}, [openAnchor])

	return (
		<div className="drawer-backdrop" onClick={onClose}>
			<aside
				className="drawer rules-drawer"
				onClick={(e) => e.stopPropagation()}
				aria-label="Rules drawer"
			>
				<div className="drawer-head">
					<ReferenceTabs current="rules" />
					<button type="button" className="btn" onClick={onClose}>
						Close
					</button>
				</div>
				<div className="drawer-tabs">
					{ruleFiles().map((f) => (
						<button
							key={f}
							type="button"
							className={`btn micro${file === f ? ' btn-active' : ''}`}
							onClick={() => setFile(f)}
						>
							{ruleTitle(f)}
						</button>
					))}
				</div>
				<div className="rules-content" key={file}>
					{content !== undefined ? (
						renderMarkdown(content)
					) : (
						<p className="muted">no content</p>
					)}
				</div>
			</aside>
		</div>
	)
}

// ---------------------------------------------------------------------------
// CardList — the box insert: filter by suit/trait/skill, market remaining
// ---------------------------------------------------------------------------

export function CardListPanel({ onClose }: { onClose: () => void }) {
	const catalog = useCatalog()
	const index = useDefIndex()
	const projected = useProjected()
	const [query, setQuery] = useState('')
	const [suit, setSuit] = useState<Suit | 'ALL'>('ALL')
	const [trait, setTrait] = useState<TraitId | 'ALL'>('ALL')
	// Option + hover lifts a card to 3×, as on the board (cards.tsx CardZoom)
	const zoomHeld = useZoomKey()
	const [hovered, setHovered] = useState<CardDef | null>(null)

	const common: CardDef[] = useMemo(
		() => (catalog?.defs ?? []).filter((d) => d.deck === 'COMMON'),
		[catalog],
	)
	const allTraits = useMemo(() => {
		const s = new Set<TraitId>()
		for (const d of common) for (const t of d.traits) s.add(t)
		return [...s].sort((a, b) => a.localeCompare(b))
	}, [common])

	// Remaining per Market deck (from the projected faces — publicly known).
	const remains = useMemo(() => {
		const m = new Map<MarketSuit, number>()
		if (projected === null) return m
		for (const suit of MARKET_SUITS_FOUR) {
			const zone = projected.zones[zoneKey({ k: 'MARKET_DECK', suit })] ?? []
			const n = zone.filter((iid) => {
				const c = projected.cards[iid]
				return c !== undefined && c.def !== HIDDEN_DEF
			}).length
			m.set(suit, n)
		}
		return m
	}, [projected])

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return common.filter((d) => {
			if (suit !== 'ALL' && d.suit !== suit) return false
			if (trait !== 'ALL' && !d.traits.includes(trait)) return false
			if (q !== '') {
				const hay = (
					cardName(d) +
					' ' +
					d.traits.join(' ') +
					' ' +
					d.suit
				).toLowerCase()
				if (!hay.includes(q)) return false
			}
			return true
		})
	}, [common, suit, trait, query])

	return (
		<>
			<div className="drawer-backdrop" onClick={onClose}>
				<aside
					className="drawer cardlist-drawer"
					onClick={(e) => e.stopPropagation()}
					aria-label="Card list"
				>
					<div className="drawer-head">
						<ReferenceTabs current="cards" />
						<button type="button" className="btn" onClick={onClose}>
							Close
						</button>
					</div>
					<div className="cardlist-controls">
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="filter by name / trait / suit"
							aria-label="filter cards"
						/>
						<select
							value={suit}
							onChange={(e) => setSuit(e.target.value as Suit | 'ALL')}
							aria-label="filter by suit"
						>
							<option value="ALL">all suits</option>
							{Array.from(new Set(common.map((d) => d.suit))).map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
						<select
							value={trait}
							onChange={(e) => setTrait(e.target.value as TraitId | 'ALL')}
							aria-label="filter by trait"
						>
							<option value="ALL">all traits</option>
							{allTraits.map((t) => (
								<option key={t} value={t}>
									{t}
								</option>
							))}
						</select>
					</div>
					<div className="cardlist-remaining">
						<span className="muted small">Remaining in each Market deck:</span>
						{MARKET_SUITS_FOUR.map((s) => (
							<span key={s} className="remaining-chip">
								{s}: {remains.get(s) ?? 0}
							</span>
						))}
					</div>
					<div className="cardlist-grid">
						{filtered.length === 0 && (
							<p className="muted small">No cards match.</p>
						)}
						{filtered.map((d) => {
							const def = index.get(d.id) ?? d
							return (
								<CardFace
									key={d.id}
									def={def}
									size="micro"
									onMouseEnter={() => setHovered(def)}
									onMouseLeave={() => setHovered(null)}
								/>
							)
						})}
					</div>
				</aside>
			</div>
			{/* outside the backdrop's stacking context, so it tops the choice bar too */}
			{zoomHeld && hovered !== null && (
				<div className="zoom-layer" role="presentation">
					<CardFace def={hovered} size="zoom" />
				</div>
			)}
		</>
	)
}
