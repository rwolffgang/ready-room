// Card rendering (todo/14 §3 + Phase B). The printed card scan is the
// default face: `CardArtFace` shows the def's scan from the fetched STCC
// database (public/stcc/img, see src/ui/stcc.ts) and covers the card box with
// it. The full text card (name, traits, costs, op text via
// `describeOperation`, VP) stays reachable two ways: per-card click/hover
// `CardDetail`, and the global "Details" toggle (`showCardDetails` in the
// store) that switches every card back to text. Cards without a scan
// (Stardate faces, or no data fetched) render text; hidden cards render the
// CSS back; malformed defs render `MalformedCard`; any image-load failure
// falls back to text.
//
// Pieces:
//   - CardFace   — a static printed card (def-driven; also renders card backs)
//   - CardSprite — wraps CardFace with the live instance (exhausted, tokens)
//   - CardStack  — a deck/pile: count badge + click-to-browse for public piles
//   - PileBrowser — modal browse of a public pile
//   - CardDetail — the hover/click overlay: op list with costs + canPlay reasons
//   - OpText     — rich operation text (token chips + rules-keyword links)

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CardDef } from '../data/schema'
import type { ResourceId, SkillIcon } from '../data/ids'
import { describeOperation } from '../engine/describe'
import {
	canPlay,
	canActivate,
	idleOperationReason,
} from '../engine/queries/legality'
import { cardDef } from '../engine/cards'
import { altPlayOperation, type AltPlayRef } from '../engine/altPlay'
import { zoneKey, type GameState } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import type { Operation } from '../engine/resolver/nodes'
import {
	useGameStore,
	useProjected,
	useDetailIid,
	setDetail,
	useSelected,
	useHoverIid,
	useZoomHeld,
	useViewerSeat,
	usePendingChoice,
	useRealState,
} from './store'
import { useDefForIid } from './defs'
import { HIDDEN_DEF } from './projection'
import { RESOURCE_LABEL } from './format'
import type { SpecialtyId } from '../data/ids'
import { cardImageUrl, stccCard, stccIconUrl, tokenView } from './stcc'
import { printedOpFor, printedOps } from '../data/stcc'
import { Icon, SpecialtyLabel, suitIconId } from './icons'
import { ShorthandOp } from './shorthand'
import { GlyphLegend } from './guide/legend'
import { linesOfDef } from './guide/glossary'
import { cardName, withCardNames } from '../data/cardNames'
import { contextOf, foldReason } from './tile/lines'
import { BeamedChips, BeamedOnto, beamedHeading } from './beamed'
import { longPress, type LongPressHandlers } from './console/longPress'

export type CardSize =
	'micro' | 'board' | 'hand' | 'preview' | 'review' | 'zoom'

// ---------------------------------------------------------------------------
// Card art — the fetched card scan, if there is one
// ---------------------------------------------------------------------------

/** Does this def have a printed scan to show? Stardate cards have no card
 *  number and so never match; nor does anything when no data was fetched. */
export function hasRealFace(def: CardDef): boolean {
	return cardImageUrl(def) !== null
}

/** Per-URL load outcome, cached so every copy of a card resolves at once.
 *  Failure caches as false and never throws — the caller falls back to text. */
const imageLoadCache = new Map<string, boolean>()

/** Reset seam for tests (the global Image is mocked per case). */
export function resetImageLoadCache(): void {
	imageLoadCache.clear()
}

function useImageLoaded(url: string): boolean | null {
	const [ok, setOk] = useState<boolean | null>(
		() => imageLoadCache.get(url) ?? null,
	)
	useEffect(() => {
		const cached = imageLoadCache.get(url)
		if (cached !== undefined) {
			setOk(cached)
			return
		}
		let alive = true
		const settle = (v: boolean): void => {
			imageLoadCache.set(url, v)
			if (alive) setOk(v)
		}
		try {
			if (typeof Image === 'undefined') {
				settle(false)
				return
			}
			const img = new Image()
			img.onload = () => settle(img.naturalWidth > 0 && img.naturalHeight > 0)
			img.onerror = () => settle(false)
			img.src = url
		} catch {
			settle(false)
		}
		return () => {
			alive = false
		}
	}, [url])
	return ok
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

// Our describe() tokens ({DIL}, [ATTACK]) and the printed text's [[token]]s.
const TOKEN_RE = /(\{(?:DIL|LAT|GLO|ACTION)\}|\[ATTACK\]|\[\[[^\]]+\]\])/g

/** keyword (lowercase, no spaces) → rules/08 heading id (docs/ui-spec.md §7). */
const KEYWORD_LINKS: Record<string, string> = {
	beam: 'BEAM',
	deploy: 'DEPLOY',
	destroy: 'DESTROY',
	discard: 'DISCARD',
	dismiss: 'DISMISS',
	draw: 'DRAW',
	duplicate: 'DUPLICATE',
	enlist: 'ENLIST_DEVELOPMENT',
	exhaust: 'EXHAUST',
	find: 'FIND',
	force: 'FORCE',
	'free play': 'FREE_PLAY',
	gain: 'GAIN_CARD',
	junk: 'JUNK',
	log: 'LOG',
	market: 'ZONE_MARKET',
	promote: 'PROMOTE',
	put: 'PUT',
	recall: 'RECALL',
	recrystallize: 'RECRYSTALLIZE',
	refresh: 'REFRESH',
	'return an incident': 'RETURN_INCIDENT',
	return: 'RETURN_INCIDENT',
	scan: 'SCAN_N',
	secured: 'QUERY_SECURED',
	send: 'SEND_AWAY_TEAM',
	spend: 'SPEND_RESOURCE',
	steal: 'STEAL',
	take: 'TAKE',
	'take control': 'TAKE_CONTROL',
	token: 'TOKEN',
	trigger: 'TRIGGER_CONTROL',
	warp: 'WARP',
	beamed: 'BEAM',
}

/** A `[[name]]` token from the printed text: the fetched icon (plus a label
 *  for suits/traits/thresholds), or a text chip when no icon is available. */
function PrintedToken({ name }: { name: string }) {
	const view = tokenView(name)
	const src = view.icon !== null ? stccIconUrl(view.icon) : null
	const [broken, setBroken] = useState(false)
	const img =
		src !== null && !broken ? (
			<img
				className="ptoken-icon"
				src={src}
				alt=""
				draggable={false}
				onError={() => setBroken(true)}
			/>
		) : null
	if (view.kind === 'icon' && img !== null) {
		return (
			<span
				className="ptoken ptoken-icon-only"
				title={view.label}
				role="img"
				aria-label={view.label}
			>
				{img}
			</span>
		)
	}
	return (
		<span className="ptoken ptoken-chip" title={view.label}>
			{img}
			<span className="ptoken-label">{view.label}</span>
		</span>
	)
}

function TokenChip({ kind }: { kind: string }) {
	if (kind.startsWith('[['))
		return <PrintedToken name={kind.slice(2, -2).trim().toLowerCase()} />
	if (kind === '{ACTION}')
		return (
			<span className="token token-action" title="costs an action">
				<Icon id="ACTION" label="Action" />
			</span>
		)
	if (kind === '[ATTACK]')
		return (
			<span className="token token-attack" title="ATTACK">
				<Icon id="ATTACK" label="Attack" /> ATTACK
			</span>
		)
	const res = kind.replace(/[{}]/g, '') as ResourceId
	return (
		<span
			className={`token token-res token-${res.toLowerCase()}`}
			title={RESOURCE_LABEL[res]}
		>
			<Icon id={res} label={RESOURCE_LABEL[res]} />
		</span>
	)
}

/** Rules keywords in `text` become links to the rules drawer — or, with no
 *  `onKeyword`, inert highlighted terms, so text inside a clickable card face
 *  never nests a <button> in its button. */
function linkKeywords(
	text: string,
	onKeyword: ((anchor: string, word: string) => void) | undefined,
): ReactNode {
	const words = text.split(/\s+/)
	const out: ReactNode[] = []
	let acc = ''
	let key = 0
	const flush = () => {
		if (acc !== '') {
			out.push(acc)
			acc = ''
		}
	}
	for (const word of words) {
		const cleaned = word.replace(/[^a-z]/gi, '').toLowerCase()
		const anchor =
			KEYWORD_LINKS[cleaned] !== undefined ? KEYWORD_LINKS[cleaned] : undefined
		if (anchor !== undefined) {
			flush()
			const punct = word.replace(/[a-z]/gi, '')
			const label = word.replace(/[^a-z]/gi, '')
			out.push(
				onKeyword === undefined ? (
					<span key={key++} className="keyword-term" title={`rule: ${anchor}`}>
						{label}
					</span>
				) : (
					<button
						key={key++}
						type="button"
						className="keyword-link"
						onClick={() => onKeyword(anchor, word)}
						title={`rule: ${anchor}`}
					>
						{label}
					</button>
				),
			)
			out.push(`${punct} `)
		} else {
			acc += `${word} `
		}
	}
	flush()
	return out
}

/** Render an operation's described text with token chips + keyword links. */
export function OpText({
	text,
	onKeyword,
	plain,
}: {
	text: string
	onKeyword?: ((anchor: string, word: string) => void) | undefined
	/** Icons only, no keyword links — for text inside a button or a prompt. */
	plain?: boolean | undefined
}) {
	const parts = withCardNames(text).split(TOKEN_RE)
	// split() with one capture group: odd indices are the tokens. A resource
	// token takes its count ("2 ", "10+ ", "1/2/3 " before; " x3" after) and
	// trailing punctuation into one unbreakable group.
	const glued: { before: string; after: string }[] = parts.map(() => ({
		before: '',
		after: '',
	}))
	for (let i = 1; i < parts.length; i += 2) {
		if (!RESOURCE_TOKEN_RE.test(parts[i] ?? '')) continue
		const prev = parts[i - 1] ?? ''
		const count = COUNT_BEFORE_RE.exec(prev)?.[0] ?? ''
		parts[i - 1] = prev.slice(0, prev.length - count.length)
		glued[i]!.before = count
		const next = parts[i + 1] ?? ''
		const tail = COUNT_AFTER_RE.exec(next)?.[0] ?? ''
		parts[i + 1] = next.slice(tail.length)
		glued[i]!.after = tail
	}
	return (
		<>
			{parts.map((part, i) => {
				if (i % 2 === 1) {
					const { before, after } = glued[i]!
					return before === '' && after === '' ? (
						<TokenChip key={`${i}-${part}`} kind={part} />
					) : (
						<span key={`${i}-${part}`} className="token-group">
							{before}
							<TokenChip kind={part} />
							{after}
						</span>
					)
				}
				if (part === '') return null
				if (plain === true) return <span key={i}>{part}</span>
				return <span key={i}>{linkKeywords(part, onKeyword)}</span>
			})}
		</>
	)
}

const RESOURCE_TOKEN_RE =
	/^(?:\{(?:DIL|LAT|GLO)\}|\[\[\s*(?:dilithium|latinum|glory)\s*\]\])$/i
/** "2 ", "10+ ", "1/2/3 " right before a resource token. */
const COUNT_BEFORE_RE = /\d+(?:\/\d+)*\+?\s+$/
/** " x3", "+" and punctuation right after a resource token. */
const COUNT_AFTER_RE = /^(?:\s*x\d+)?[.,;:)!?]*/

const PRINTED_SECTIONS = [
	['cost', 'Dev. cost'],
	['hand', 'Hand'],
	['table', 'Table'],
	['goal', 'Goal'],
	['reward', 'Reward'],
] as const

/** The card's printed rules text from the fetched STCC data, by card area;
 *  null when nothing was fetched for it. */
export function PrintedText({
	def,
	onKeyword,
	sections: only,
}: {
	def: CardDef
	onKeyword?: ((anchor: string, word: string) => void) | undefined
	/** Only these card areas (the detail shows operations per operation). */
	sections?: readonly (typeof PRINTED_SECTIONS)[number][0][] | undefined
}) {
	const card = stccCard(def)
	if (card === null) return null
	const sections = PRINTED_SECTIONS.filter(
		([k]) => card.text[k] !== '' && (only === undefined || only.includes(k)),
	)
	if (sections.length === 0) return null
	return (
		<div className="printed-text">
			{sections.map(([k, label]) => (
				<p key={k} className={`printed-section printed-${k}`}>
					<span className="printed-label">{label}</span>{' '}
					<OpText text={card.text[k]} onKeyword={onKeyword} />
				</p>
			))}
		</div>
	)
}

const SKILL_CHIP: Partial<Record<SkillIcon, string>> = {
	SKILL_RESEARCH: 'R',
	SKILL_INFLUENCE: 'I',
	SKILL_MILITARY: 'M',
	SKILL_ANY: 'Any',
	SKILL_VARIABLE: 'Var',
}

function specialtyClasses(s: SpecialtyId): string {
	return `s-${s.toLowerCase()}`
}

// ---------------------------------------------------------------------------
// Malformed-card safety (todo/17 §5)
// ---------------------------------------------------------------------------

/** describeOperation can throw on a card tree that slipped past validation
 *  (e.g. an unknown effect node). Never let that reach a render — emit a
 *  readable placeholder instead. */
export function safeDescribe(op: CardDef['operations'][number]): string | null {
	try {
		const text = describeOperation(op)
		return typeof text === 'string' && text !== '' ? text : null
	} catch {
		return null
	}
}

/** Does this def look broken enough that the normal face render would crash?
 *  Structural fields plus every operation description must be healthy. */
function isMalformedDef(def: CardDef): boolean {
	if (typeof def.id !== 'string' || def.id === '') return true
	if (
		!Array.isArray(def.operations) ||
		!Array.isArray(def.traits) ||
		!Array.isArray(def.skills)
	)
		return true
	return def.operations.some((op) => safeDescribe(op) === null)
}

/** Text-only fallback: shows whatever is readable, plus a warning badge, and
 *  never throws — the game keeps running around it (todo/17 §5). */
function MalformedCard({
	def,
	badge,
}: {
	def: CardDef
	badge?: ReactNode | undefined
}) {
	const ops = Array.isArray(def.operations) ? def.operations : []
	const lines = ops.map((op) => safeDescribe(op) ?? '<unreadable operation>')
	let name: string
	try {
		name = cardName(def)
	} catch {
		name = `id ${String(def.id)}`
	}
	return (
		<div className="card-malformed" aria-label={`${name} (malformed)`}>
			<span
				className="malformed-badge"
				title="This card's data is malformed — rendered as text only, game continues"
			>
				⚠ malformed
			</span>
			<div className="card-name">{name}</div>
			<div className="card-traits">
				{(Array.isArray(def.traits) ? def.traits : []).map((t) => (
					<span key={t} className="trait">
						{t}
					</span>
				))}
			</div>
			<div className="card-ops">
				{lines.map((line, i) => (
					<p key={i} className="op-text">
						{line}
					</p>
				))}
			</div>
			{badge !== undefined && <div className="card-badge">{badge}</div>}
		</div>
	)
}

// ---------------------------------------------------------------------------
// CardFace — static printed face / card back
// ---------------------------------------------------------------------------

export interface CardFaceProps {
	def: CardDef | null
	hidden?: boolean | undefined
	size?: CardSize | undefined
	dimmed?: boolean | undefined
	reason?: string | null | undefined
	selected?: boolean | undefined
	highlight?: boolean | undefined
	onClick?: (() => void) | undefined
	actionTokens?: number | undefined
	resourceTokens?: Partial<Record<ResourceId, number>> | undefined
	exhausted?: boolean | undefined
	badge?: ReactNode | undefined
	/** Force the printed card art even when the global Details toggle is on
	 *  (deck review page needs the art unconditionally). */
	forceArt?: boolean | undefined
	/** Rules-drawer keyword links — ignored on a clickable face, which can't
	 *  hold buttons of its own. */
	onKeyword?: ((anchor: string, word: string) => void) | undefined
	onMouseEnter?: (() => void) | undefined
	onMouseLeave?: (() => void) | undefined
	/** `data-anchor` for token flights (flight.tsx) — live instances only. */
	anchor?: string | undefined
	/** Touch long-press handlers (console/longPress.ts). */
	press?: LongPressHandlers | undefined
}

/** A single named "ship" chip used at Locations (docs/ui-spec.md §3). */
export function ShipChip({ name }: { name: string }) {
	return <span className="ship-chip">✚ {name}</span>
}

export function CardFace({
	def,
	hidden,
	size = 'board',
	dimmed,
	reason,
	selected,
	highlight,
	onClick,
	actionTokens = 0,
	resourceTokens,
	exhausted,
	badge,
	forceArt,
	onKeyword,
	onMouseEnter,
	onMouseLeave,
	anchor,
	press,
}: CardFaceProps) {
	const classes = [
		'card',
		`card-${size}`,
		hidden
			? 'card-hidden'
			: def
				? `card-suit-${def.suit.toLowerCase()}`
				: 'card-unknown',
		dimmed ? 'card-dimmed' : '',
		selected ? 'card-selected' : '',
		highlight ? 'card-highlight' : '',
		onClick !== undefined ? 'card-clickable' : '',
		exhausted ? 'card-exhausted' : '',
	]
		.filter(Boolean)
		.join(' ')

	const body =
		onClick === undefined ? (
			<div
				className="card-inner"
				aria-label={cardName(def) ?? 'face-down card'}
			>
				<CardFaceBody
					def={def}
					hidden={hidden}
					size={size}
					actionTokens={actionTokens}
					resourceTokens={resourceTokens}
					badge={badge}
					forceArt={forceArt}
					onKeyword={onKeyword}
				/>
			</div>
		) : (
			<button
				type="button"
				className="card-inner"
				onClick={onClick}
				aria-label={reason ?? cardName(def) ?? 'face-down card'}
				title={reason ?? undefined}
			>
				<CardFaceBody
					def={def}
					hidden={hidden}
					size={size}
					actionTokens={actionTokens}
					resourceTokens={resourceTokens}
					badge={badge}
					forceArt={forceArt}
					// No keyword buttons inside this button: its terms stay inert
					// and the click opens the detail, whose op text links them.
					onKeyword={undefined}
				/>
			</button>
		)

	return (
		<div
			className={classes}
			data-anchor={anchor}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			{...press}
		>
			{body}
		</div>
	)
}

function CardFaceBody({
	def,
	hidden,
	size,
	actionTokens,
	resourceTokens,
	badge,
	forceArt,
	onKeyword,
}: {
	def: CardDef | null
	hidden?: boolean | undefined
	size: CardSize
	actionTokens: number
	resourceTokens?: Partial<Record<ResourceId, number>> | undefined
	badge?: ReactNode | undefined
	forceArt?: boolean | undefined
	onKeyword?: ((anchor: string, word: string) => void) | undefined
}) {
	const showDetails = useGameStore((s) => s.showCardDetails)
	if (hidden || def === null) {
		return (
			<div className="card-back">
				<span>✦</span>
			</div>
		)
	}
	if (isMalformedDef(def)) {
		return <MalformedCard def={def} badge={badge} />
	}
	const textFace = (
		<TextFace
			def={def}
			size={size}
			actionTokens={actionTokens}
			resourceTokens={resourceTokens}
			badge={badge}
			onKeyword={onKeyword}
		/>
	)
	if ((!forceArt && showDetails) || !hasRealFace(def)) return textFace
	return (
		<ArtOrText
			def={def}
			size={size}
			actionTokens={actionTokens}
			resourceTokens={resourceTokens}
			badge={badge}
			fallback={textFace}
		/>
	)
}

/** Sizes big enough to print each operation's English under its Shorthand. */
const ROSETTA_SIZES: ReadonlySet<CardSize> = new Set([
	'zoom',
	'preview',
	'review',
])

/** The full text card (name, traits, Shorthand lines, VP). Used when the
 *  Details toggle is on, or when a def has no printed face. */
function TextFace({
	def,
	size,
	actionTokens,
	resourceTokens,
	badge,
	onKeyword,
}: {
	def: CardDef
	size: CardSize
	actionTokens: number
	resourceTokens?: Partial<Record<ResourceId, number>> | undefined
	badge?: ReactNode | undefined
	onKeyword?: ((anchor: string, word: string) => void) | undefined
}) {
	const tokenList = (
		Object.entries(resourceTokens ?? {}) as [ResourceId, number][]
	).filter(([, n]) => n > 0)
	return (
		<>
			<div className="card-head">
				<span
					className={`card-suit suit-banner card-suit-${def.suit.toLowerCase()}`}
				>
					<Icon id={suitIconId(def.suit)} label={def.suit} />
					{def.suit}
				</span>
				<span className="card-vp">
					{def.vp !== 0 || def.vpAsterisk
						? `${def.vpAsterisk ? '*' : ''}${def.vp} VP`
						: ''}
				</span>
			</div>
			<div className="card-name" title={cardName(def)}>
				{cardName(def)}
			</div>
			<div className="card-traits">
				{def.traits.map((t) => (
					<span key={t} className="trait">
						{t}
					</span>
				))}
				{def.skills.map((s, i) => (
					<span key={`${s}-${i}`} className="skill-chip">
						<Icon id={`SKILL:${s}`} label={s.replace(/^SKILL_/, '')} />
						{SKILL_CHIP[s] ?? s}
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
			</div>
			<div className="card-ops">
				{size === 'micro' ? (
					<span className="op-line micro-truncate">
						{def.operations[0] !== undefined && (
							<ShorthandOp op={def.operations[0]} size="sm" />
						)}
					</span>
				) : (
					// Shorthand at glance sizes; the big views add the English under
					// each line — the Rosetta view (docs/shorthand.md)
					def.operations.map((op, i) => (
						<div key={i} className="op-block">
							<ShorthandOp op={op} size="sm" />
							{ROSETTA_SIZES.has(size) && (
								<p className="op-text">
									<OpText text={describeOperation(op)} onKeyword={onKeyword} />
								</p>
							)}
						</div>
					))
				)}
			</div>
			{badge !== undefined && <div className="card-badge">{badge}</div>}
			{actionTokens > 0 && (
				<div className="card-tokens action-token-chips">
					{Array.from({ length: actionTokens }).map((_, i) => (
						<span key={i} className="action-chip" title="action token">
							<Icon id="ACTION" label="Action token" />
						</span>
					))}
				</div>
			)}
			{tokenList.length > 0 && (
				<div className="card-tokens resource-pips">
					{tokenList.map(([res, n]) => (
						<span
							key={res}
							className={`res-pip pip-${res.toLowerCase()}`}
							title={`${RESOURCE_LABEL[res]} ×${n}`}
						>
							<Icon id={res} label={RESOURCE_LABEL[res]} />
							{n > 1 ? `×${n}` : ''}
						</span>
					))}
				</div>
			)}
		</>
	)
}

/** Card scan once it has loaded; while loading or after a failure it renders
 *  the text card instead — never a broken image. */
function ArtOrText({
	def,
	size,
	actionTokens,
	resourceTokens,
	badge,
	fallback,
}: {
	def: CardDef
	size: CardSize
	actionTokens: number
	resourceTokens?: Partial<Record<ResourceId, number>> | undefined
	badge?: ReactNode | undefined
	fallback: ReactNode
}) {
	const url = cardImageUrl(def) ?? ''
	const loaded = useImageLoaded(url)
	if (loaded !== true) return <>{fallback}</>
	return (
		<CardArtFace
			def={def}
			url={url}
			size={size}
			actionTokens={actionTokens}
			resourceTokens={resourceTokens}
			badge={badge}
		/>
	)
}

/** The scan fills the card box (`object-fit: cover`), overlays on top. */
function CardArtFace({
	def,
	url,
	size,
	actionTokens,
	resourceTokens,
	badge,
}: {
	def: CardDef
	url: string
	size: CardSize
	actionTokens: number
	resourceTokens?: Partial<Record<ResourceId, number>> | undefined
	badge?: ReactNode | undefined
}) {
	const tokenList = (
		Object.entries(resourceTokens ?? {}) as [ResourceId, number][]
	).filter(([, n]) => n > 0)
	return (
		<div
			className={`card-art card-art-${size}`}
			role="img"
			aria-label={cardName(def)}
		>
			<img src={url} alt="" className="card-art-img" draggable={false} />
			{badge !== undefined && <div className="card-badge">{badge}</div>}
			{actionTokens > 0 && (
				<div className="card-tokens action-token-chips">
					{Array.from({ length: actionTokens }).map((_, i) => (
						<span key={i} className="action-chip" title="action token">
							<Icon id="ACTION" label="Action token" />
						</span>
					))}
				</div>
			)}
			{tokenList.length > 0 && (
				<div className="card-tokens resource-pips">
					{tokenList.map(([res, n]) => (
						<span
							key={res}
							className={`res-pip pip-${res.toLowerCase()}`}
							title={`${RESOURCE_LABEL[res]} ×${n}`}
						>
							<Icon id={res} label={RESOURCE_LABEL[res]} />
							{n > 1 ? `×${n}` : ''}
						</span>
					))}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// CardSprite — live instance (reads the projected state)
// ---------------------------------------------------------------------------

export interface CardSpriteProps {
	iid: CardInstanceId
	size?: CardSize | undefined
	dimmed?: boolean | undefined
	reason?: string | null | undefined
	/** Forced selection ring (in-situ choice candidates). */
	selected?: boolean | undefined
	highlight?: boolean | undefined
	onClick?: (() => void) | undefined
	badge?: ReactNode | undefined
	/** Show a detail affordance on hover (default true). */
	detailOnHover?: boolean | undefined
	/** Report hover into the shared preview area (default true). */
	hoverable?: boolean | undefined
}

export function CardSprite({
	iid,
	size = 'board',
	dimmed,
	reason,
	selected,
	highlight,
	onClick,
	badge,
	detailOnHover = true,
	hoverable = true,
}: CardSpriteProps) {
	const projected = useProjected()
	const card = projected?.cards[iid]
	const def = useDefForIid(iid)
	const isHidden = card?.def === HIDDEN_DEF
	const selectedSet = useSelected()
	const storeSelected = selectedSet.includes(iid)
	const hoverIid = useHoverIid()
	const isHovered = detailOnHover && hoverIid === iid
	const setHoverIid = useGameStore((s) => s.setHoverIid)

	return (
		<CardFace
			def={def}
			hidden={isHidden}
			size={size}
			dimmed={dimmed}
			reason={reason}
			selected={selected ?? storeSelected}
			highlight={highlight ?? isHovered}
			onClick={onClick}
			actionTokens={card?.actionTokens ?? 0}
			resourceTokens={card?.resourceTokens}
			exhausted={card?.exhausted}
			badge={badge}
			onMouseEnter={hoverable ? () => setHoverIid(iid) : undefined}
			onMouseLeave={hoverable ? () => setHoverIid(null) : undefined}
			anchor={`card:${iid}`}
			press={hoverable && !isHidden ? longPress(iid) : undefined}
		/>
	)
}

// ---------------------------------------------------------------------------
// CardStack — a deck / pile (count + optional browse)
// ---------------------------------------------------------------------------

export interface CardStackProps {
	label: string
	count: number
	/** iids to browse (public piles) — null means "not browseable / count only". */
	browse?: readonly CardInstanceId[] | null | undefined
	warn?: boolean | undefined
	extra?: ReactNode | undefined
	/** Drawn as a deck on the table: a small stacked back with the count on
	 *  it and the label under it (the console's piles, docs/ui-lcars.md §4). */
	deck?: boolean | undefined
}

export function CardStack({
	label,
	count,
	browse,
	warn,
	extra,
	deck,
}: CardStackProps) {
	const browseable =
		browse !== undefined && browse !== null && browse.length > 0
	const openBrowse = () => {
		if (!browseable || browse === undefined) return
		useGameStore.getState().setDetail(null)
		openPile(label, browse)
	}
	return (
		<div
			className={`cardstack${deck === true ? ' cardstack-deck' : ''}${warn ? ' cardstack-warn' : ''}${count === 0 ? ' cardstack-empty' : ''}`}
			title={browseable ? `browse ${label}` : `${label}: ${count}`}
		>
			<button
				type="button"
				className="stack-back"
				onClick={openBrowse}
				disabled={!browseable}
				aria-label={`${label} (${count})`}
			>
				{deck === true ? (
					<span className="stack-n">{count}</span>
				) : (
					<span className="stack-glyph">✦</span>
				)}
			</button>
			<div className="stack-count">
				{deck === true ? label : `${label} · ${count}`}
			</div>
			{extra !== undefined && <div className="stack-extra">{extra}</div>}
		</div>
	)
}

// ---------------------------------------------------------------------------
// PileBrowser — modal grid over a public pile
// ---------------------------------------------------------------------------

let pileFn: ((label: string, iids: readonly CardInstanceId[]) => void) | null =
	null
function openPile(label: string, iids: readonly CardInstanceId[]) {
	if (pileFn !== null) pileFn(label, iids)
}

/** Open a public pile in the browser (closing any card detail first) — for
 *  pile counters that are not drawn as a CardStack, like the crew console's. */
export function browsePile(label: string, iids: readonly CardInstanceId[]) {
	useGameStore.getState().setDetail(null)
	openPile(label, iids)
}

export function PileBrowserHost() {
	const [pile, setPile] = usePileState()
	if (pile === null) return null
	const iids = pile.iids
	return (
		<div className="modal-backdrop" onClick={() => setPile(null)}>
			<div
				className="modal pile-modal"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-label={`${pile.label} pile`}
			>
				<div className="modal-head">
					<strong>{pile.label}</strong>
					<button type="button" className="btn" onClick={() => setPile(null)}>
						Close
					</button>
				</div>
				<div className="pile-grid">
					{iids.map((iid) => (
						<CardSprite
							key={iid}
							iid={iid}
							size="board"
							detailOnHover={false}
						/>
					))}
				</div>
				<div className="modal-foot muted">
					{iids.length} card{iids.length === 1 ? '' : 's'} — public information
					(docs/ui-spec.md §5)
				</div>
			</div>
		</div>
	)
}

function usePileState(): [
	{ label: string; iids: CardInstanceId[] } | null,
	(p: { label: string; iids: CardInstanceId[] } | null) => void,
] {
	const [pile, setPile] = useState<{
		label: string
		iids: CardInstanceId[]
	} | null>(null)
	pileFn = (label, iids) => setPile({ label, iids: [...iids] })
	return [pile, setPile]
}

// ---------------------------------------------------------------------------
// CardDetail — the "what can I do and why not" overlay
// ---------------------------------------------------------------------------

/**
 * Hold Option and hover (or long-press on a touch screen): the card lifts to
 * the middle of the screen at 3× the board size. Hover alone does nothing — the board is dense enough that a
 * preview firing on every pointer move is noise, and it cost a permanent panel
 * in the side column for something wanted a few times a turn.
 */
export function CardZoom() {
	const hoverIid = useHoverIid()
	const zoomHeld = useZoomKey()
	// a card held under a finger (console/longPress.ts) — the touch twin
	const pressedIid = useGameStore((s) => s.zoomIid)

	const iid = pressedIid ?? (zoomHeld ? hoverIid : null)
	if (iid === null) return null
	return (
		<div className="zoom-layer" role="presentation">
			<CardSprite
				iid={iid}
				size="zoom"
				detailOnHover={false}
				hoverable={false}
			/>
		</div>
	)
}

/**
 * Whether Option is held, tracked into the store while the caller is mounted
 * (the board's CardZoom, and the Card list, which can be open without a game).
 *
 * The key is held, never toggled: releasing Option, leaving the window, or
 * hiding the tab all drop it, so the overlay cannot get stuck open after an
 * Option-Tab away.
 */
export function useZoomKey(): boolean {
	const setZoomHeld = useGameStore((s) => s.setZoomHeld)
	useEffect(() => {
		const sync = (e: KeyboardEvent) => setZoomHeld(e.altKey)
		const drop = () => setZoomHeld(false)
		window.addEventListener('keydown', sync)
		window.addEventListener('keyup', sync)
		window.addEventListener('blur', drop)
		document.addEventListener('visibilitychange', drop)
		return () => {
			window.removeEventListener('keydown', sync)
			window.removeEventListener('keyup', sync)
			window.removeEventListener('blur', drop)
			document.removeEventListener('visibilitychange', drop)
			drop()
		}
	}, [setZoomHeld])
	return useZoomHeld()
}

export function CardDetailHost() {
	const projected = useProjected()
	// Playability/activation probes run on the real engine state — the
	// projection hides facedown decks, which starves the canPlay probe of the
	// candidate cards a PLAY effect needs (e.g. RECRUIT's "gain a PERSON/ALLY").
	const realState = useRealState()
	const detailIid = useDetailIid()
	const card = detailIid !== null ? projected?.cards[detailIid] : undefined
	const def = useDefForIid(detailIid)
	const viewer = useViewerSeat()
	const pendingChoice = usePendingChoice()
	// Glyphs belong to the full-text card; over the printed art they repeat
	// what the English already says (Settings → Card faces).
	const glyphs = useGameStore((s) => s.showCardDetails)
	const printed = useMemo(() => {
		const stcc = def === null ? null : stccCard(def)
		return stcc === null ? [] : printedOps(stcc.text)
	}, [def])
	// After an Activate the card stays open behind the activation's choices
	// (its text helps to answer them) and closes once the activation has
	// resolved — unless another card's detail has been opened meanwhile.
	const [closeAfter, setCloseAfter] = useState<CardInstanceId | null>(null)
	useEffect(() => {
		if (closeAfter === null || pendingChoice !== null) return
		setCloseAfter(null)
		if (useGameStore.getState().detailIid === closeAfter) setDetail(null)
	}, [closeAfter, pendingChoice])
	if (
		detailIid === null ||
		card === undefined ||
		projected === null ||
		realState === null
	)
		return null

	const close = () => setDetail(null)
	const beamedHere =
		projected.zones[zoneKey({ k: 'BEAMED', host: detailIid })] ?? []
	// ACTIVATION is an ACTION-phase action by the ACTIVE seat (rules/03 §3.5.5),
	// so the gate mirrors reduceActivate: ACTION phase + your turn (the viewer
	// is the active seat) + no pending choice + canActivate for that seat. When
	// a card is only blocked by phase/turn/choice, surface a reason instead of a
	// dead-looking ACTIVATION row (a card can look "usable" to its owner while
	// the active seat cannot act on it).
	const activeSeat = realState.activeSeat
	const turnOpen =
		realState.phase.k === 'ACTION' &&
		activeSeat === viewer &&
		pendingChoice === null
	const turnBlockReason =
		pendingChoice !== null
			? 'Resolve the open choice first'
			: realState.phase.k !== 'ACTION'
				? 'Activations only run in the ACTION phase'
				: 'Not your turn'
	// operations that cannot run from this zone (a deployed card's PLAY
	// lines, the activations of a card in hand) fold away below the ones
	// that can
	const ctx = contextOf(card.zone)
	const defOps = def?.operations ?? []
	const ops = defOps.map((op, i) => ({
		op,
		i,
		notHere: foldReason(ctx, op.type),
	}))
	const here = ops.filter((o) => o.notHere === undefined)
	const away = ops.filter((o) => o.notHere !== undefined)
	const opBlock = (op: Operation, i: number, notHere?: string) => {
		const usable =
			notHere !== undefined
				? { ok: false, message: notHere, idle: null }
				: opUsable(realState, activeSeat, detailIid, i)
		const activatable = op.type === 'ACTIVATION' && turnOpen && usable.ok
		const playable = op.type === 'PLAY' && turnOpen && usable.ok
		const run =
			activatable || playable
				? {
						label: activatable ? 'Activate' : 'Play',
						costsAction: op.costsAction,
						idle: usable.idle,
						onRun: () => {
							useGameStore.getState().dispatch(
								activatable
									? {
											t: 'ACTIVATE',
											iid: detailIid,
											operationIndex: i,
										}
									: {
											t: 'PLAY_CARD',
											iid: detailIid,
											operationIndex: i,
										},
							)
							if (playable) setDetail(null)
							else setCloseAfter(detailIid)
						},
					}
				: null
		const why =
			notHere ??
			(op.type !== 'ACTIVATION' && op.type !== 'PLAY'
				? usable.ok
					? null
					: usable.message
				: !turnOpen
					? turnBlockReason
					: usable.message)
		return (
			<OpBlock key={i} blocked={!usable.ok} run={run}>
				<div className="op-detail-head">
					<span className={`op-type op-type-${op.type.toLowerCase()}`}>
						{op.type}
					</span>
					{op.costsAction ? (
						<span className="chip">costs an action</span>
					) : null}
					{op.isAttack ? <span className="chip">attack</span> : null}
					{op.requires !== undefined ? (
						<span className={`chip ${specialtyClasses(op.requires.specialty)}`}>
							<SpecialtyLabel specialty={op.requires.specialty} />{' '}
							{op.requires.min}
						</span>
					) : null}
				</div>
				{glyphs && (
					<ShorthandOp
						op={op}
						size="md"
						className="op-shorthand"
						live={
							card.owner === null
								? undefined
								: {
										state: realState,
										seat: card.owner,
										iid: detailIid,
									}
						}
					/>
				)}
				<p className="op-text">
					<OpText
						text={
							printedOpFor(printed, defOps, i)?.text ??
							safeDescribe(op) ??
							'<unreadable operation>'
						}
						onKeyword={openRulesFor}
					/>
				</p>
				{run === null && why !== null && (
					<p className="op-reason muted">Why not: {why}</p>
				)}
			</OpBlock>
		)
	}

	return (
		<div className="modal-backdrop" onClick={close}>
			<div
				className="modal detail-modal"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-label={`${cardName(def) ?? 'card'} detail`}
			>
				<div className="modal-head">
					<strong>{cardName(def) ?? 'Face-down card'}</strong>
					<button type="button" className="btn" onClick={close}>
						Close
					</button>
				</div>
				<div className="detail-body">
					<div className="detail-card">
						<CardSprite iid={detailIid} size="hand" detailOnHover={false} />
					</div>
					<div className="detail-text">
						{def === null ? (
							<p className="muted">Face-down — no information.</p>
						) : (
							<>
								<p className="detail-line">
									<strong>Zone:</strong>{' '}
									{card.zone.k === 'BEAMED' ? (
										<BeamedOnto host={card.zone.host as CardInstanceId} />
									) : (
										describeZone(card.zone)
									)}{' '}
									· <strong>Owner:</strong>{' '}
									{card.owner === null ? '—' : `P${card.owner + 1}`}
								</p>
								{beamedHere.length > 0 && (
									<div className="detail-line detail-beamed">
										<strong>{beamedHeading(card)}:</strong>
										<BeamedChips host={detailIid} placement="inline" />
									</div>
								)}
								<p className="detail-line">
									<strong>Traits:</strong> {def.traits.join(', ') || '—'} ·{' '}
									<strong>VP:</strong> {def.vp}
									{def.vpAsterisk ? '*' : ''}
								</p>
								<PrintedText
									def={def}
									onKeyword={openRulesFor}
									sections={['cost']}
								/>
								{printed
									.filter((p) => p.type === null)
									.map((p, i) => (
										<p key={`lead-${i}`} className="op-text detail-lead">
											<OpText text={p.text} onKeyword={openRulesFor} />
										</p>
									))}
								{here.map(({ op, i }) => opBlock(op, i))}
								{turnOpen && (
									<AltPlays
										state={realState}
										seat={activeSeat}
										iid={detailIid}
										onPlayed={close}
									/>
								)}
								<PrintedText
									def={def}
									onKeyword={openRulesFor}
									sections={['reward']}
								/>
								{away.length > 0 && (
									<details className="op-away">
										<summary>Not usable from here ({away.length})</summary>
										{away.map(({ op, i, notHere }) => opBlock(op, i, notHere))}
									</details>
								)}
								{glyphs && (
									<GlyphLegend
										lines={linesOfDef(def)}
										onLearn={() => useGameStore.getState().openGuide()}
										collapsible
									/>
								)}
								<p
									className="detail-line detail-ids"
									title="Card ids for debugging"
								>
									<strong>def:</strong> {def.id} · <strong>cardId:</strong>{' '}
									{def.cardId ?? '—'} · <strong>iid:</strong> {detailIid}
								</p>
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

/** ALT_PLAY grants (1PIC08 "treat any INCIDENT's play operation
 *  as …"): each currently resolvable grant is an extra way to play the card. */
function AltPlays({
	state,
	seat,
	iid,
	onPlayed,
}: {
	state: GameState
	seat: Seat
	iid: CardInstanceId
	onPlayed: () => void
}) {
	let refs: AltPlayRef[] = []
	let treated = -1
	try {
		const card = state.cards[iid]
		if (card === undefined) return null
		refs = canPlay(state, seat, iid).altPlays
		treated = cardDef(card.def).operations.findIndex((o) => o.type === 'PLAY')
	} catch {
		return null
	}
	return (
		<>
			{refs.map((via) => {
				const op = altPlayOperation(state, via)
				if (op === null) return null
				const source = cardName(cardDef(state.cards[via.source]!.def))
				return (
					<div key={`${via.source}#${via.opIndex}`} className="op-detail">
						<div className="op-detail-head">
							<span className="op-type op-type-play">PLAY</span>
							<span className="chip">via {source}</span>
						</div>
						<p className="op-text">
							<OpText
								text={safeDescribe(op) ?? '<unreadable operation>'}
								onKeyword={openRulesFor}
							/>
						</p>
						<button
							type="button"
							className="btn op-activate"
							onClick={() => {
								useGameStore.getState().dispatch({
									t: 'PLAY_CARD',
									iid,
									operationIndex: treated,
									via,
								})
								onPlayed()
							}}
						>
							<RunLabel label="Play" costsAction={op.costsAction} />
						</button>
					</div>
				)
			})}
		</>
	)
}

/** One legal PLAY_CARD / ACTIVATE intent as a runnable operation block, for
 *  the Orders drawer: the card's name (opens its detail), the operation's
 *  printed text and the same Play / Activate button and idle warning as the
 *  card detail. `state` is the real state, as for the detail's probes. */
export function OrderOp({
	intent,
	state,
	where,
	onDone,
}: {
	intent: Extract<Intent, { t: 'PLAY_CARD' } | { t: 'ACTIVATE' }>
	state: GameState
	where: string
	onDone: () => void
}) {
	const card = state.cards[intent.iid]
	if (card === undefined) return null
	let def: CardDef
	try {
		def = cardDef(card.def)
	} catch {
		return null
	}
	const i = intent.operationIndex
	const via = intent.t === 'PLAY_CARD' ? intent.via : undefined
	const op =
		via !== undefined ? altPlayOperation(state, via) : def.operations[i]
	if (op === null || op === undefined) return null
	const stcc = stccCard(def)
	const printed =
		via === undefined && stcc !== null
			? printedOpFor(printedOps(stcc.text), def.operations, i)
			: undefined
	const usable =
		via === undefined
			? opUsable(state, state.activeSeat, intent.iid, i)
			: { idle: null }
	const name = cardName(def) ?? intent.iid
	return (
		<OpBlock
			blocked={false}
			run={{
				label: intent.t === 'ACTIVATE' ? 'Activate' : 'Play',
				costsAction: op.costsAction,
				idle: usable.idle,
				onRun: () => {
					onDone()
					useGameStore.getState().dispatch(intent)
				},
			}}
		>
			<div className="op-detail-head">
				<button
					type="button"
					className="order-name"
					onClick={() => {
						onDone()
						setDetail(intent.iid)
					}}
					title="Open the card"
				>
					{name}
				</button>
				<span className="muted small">{where}</span>
				<span className={`op-type op-type-${op.type.toLowerCase()}`}>
					{op.type}
				</span>
				{via !== undefined && (
					<span className="chip">
						via {cardName(cardDef(state.cards[via.source]!.def))}
					</span>
				)}
				{op.costsAction ? <span className="chip">costs an action</span> : null}
				{op.isAttack ? <span className="chip">attack</span> : null}
				{op.requires !== undefined ? (
					<span className={`chip ${specialtyClasses(op.requires.specialty)}`}>
						<SpecialtyLabel specialty={op.requires.specialty} />{' '}
						{op.requires.min}
					</span>
				) : null}
			</div>
			<p className="op-text">
				<OpText
					text={printed?.text ?? safeDescribe(op) ?? '<unreadable operation>'}
					onKeyword={openRulesFor}
				/>
			</p>
		</OpBlock>
	)
}

/** Detail-side usability probe: PLAY ops via canPlay, ACTIVATION via
 *  canActivate, everything else is automatic. `seat` is the acting seat the
 *  op would run as (the active seat) — restrictions such as "not your card"
 *  or "not in your hand" fall out of the same gates the engine uses. */
function opUsable(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
	opIndex: number,
): { ok: boolean; message: string | null; idle: string | null } {
	const usable = opUsableBase(state, seat, iid, opIndex)
	if (!usable.ok) return { ...usable, idle: null }
	let idle: string | null = null
	try {
		idle = idleOperationReason(state, seat, iid, opIndex)
	} catch {
		idle = null
	}
	return { ...usable, idle }
}

function opUsableBase(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
	opIndex: number,
): { ok: boolean; message: string | null } {
	try {
		const card = state.cards[iid]
		if (card === undefined) return { ok: false, message: null }
		const def = cardDef(card.def)
		const op = def.operations[opIndex]
		if (op === undefined) return { ok: false, message: null }
		if (op.type === 'PLAY') {
			const check = canPlay(state, seat, iid)
			if (check.ok && check.operations.includes(opIndex))
				return { ok: true, message: null }
			return {
				ok: false,
				message: check.reasons.join('; ') || 'not currently playable',
			}
		}
		if (op.type === 'ACTIVATION') {
			const check = canActivate(state, seat, iid, opIndex)
			if (check.ok) return { ok: true, message: null }
			return { ok: false, message: check.reason ?? 'not currently resolvable' }
		}
		return { ok: true, message: null }
	} catch {
		return { ok: false, message: 'this card def is unreadable' }
	}
}

/** One operation in the detail. When it can run now, the whole block is the
 *  control — keyword links and other buttons inside keep their own clicks.
 *  An operation that would do nothing (idleOperationReason) says so and asks
 *  "Are you sure?" before it runs. */
export function OpBlock({
	blocked,
	run,
	children,
}: {
	blocked: boolean
	run: {
		label: string
		/** running it spends an action: the button carries the action token */
		costsAction?: boolean
		idle: string | null
		onRun: () => void
	} | null
	children: ReactNode
}) {
	const [confirm, setConfirm] = useState(false)
	const trigger = () => {
		if (run === null) return
		if (run.idle !== null && !confirm) {
			setConfirm(true)
			return
		}
		setConfirm(false)
		run.onRun()
	}
	return (
		<div
			className={`op-detail${blocked ? ' op-detail-blocked' : ''}${run !== null ? ' op-detail-run' : ''}`}
			onClick={
				run === null
					? undefined
					: (e) => {
							const t = e.target as HTMLElement
							if (t.closest('button, a, input, select, textarea') !== null)
								return
							trigger()
						}
			}
		>
			{children}
			{run !== null && (
				<>
					<IdleWarning reason={run.idle} />
					<button type="button" className="btn op-activate" onClick={trigger}>
						<RunLabel
							label={confirm ? 'Are you sure?' : run.label}
							costsAction={run.costsAction === true}
						/>
					</button>
				</>
			)}
		</div>
	)
}

/** A Play / Activate button's label, led by the printed action token when
 *  running the operation spends an action. */
export function RunLabel({
	label,
	costsAction,
}: {
	label: string
	costsAction: boolean
}) {
	return (
		<>
			{costsAction && <Icon id="ACTION" label="Spends an action" />}
			{label}
		</>
	)
}

/** A legal operation that would do nothing right now: it still costs what it
 *  costs, so say so before the button (rules/12 §12.1 — legal, but useless). */
function IdleWarning({ reason }: { reason: string | null }) {
	if (reason === null) return null
	return (
		<p className="op-reason op-idle" role="note">
			Does nothing right now: “{reason}” can’t happen, so it would be skipped.
			Any cost is still paid.
		</p>
	)
}

function openRulesFor(anchor: string, _word: string): void {
	useGameStore.getState().setRulesOpen(true)
	window.dispatchEvent(new CustomEvent('codex:open-rule', { detail: anchor }))
}

function describeZone(zone: {
	k: string
	seat?: number
	suit?: string
}): string {
	let s = zone.k.replace(/_/g, ' ')
	if (zone.seat !== undefined) s += ` · P${zone.seat + 1}`
	if (zone.suit !== undefined) s += ` · ${zone.suit}`
	return s
}
