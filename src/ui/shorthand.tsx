// Shorthand rendering (docs/shorthand.md): an operation as a line of glyphs.
// The engine compiles the tokens (src/engine/shorthand.ts); this only draws
// them. Glyphs are inline SVG (src/ui/shorthandGlyphs.ts) in currentColor, so
// no sprite has to be mounted and a line renders anywhere — board, modal,
// portal or test.
//
// Accessibility: the line is one `role="img"` whose label is the English
// operation (describeOperation), so a screen reader hears the sentence, not
// forty glyph names. Each glyph keeps a `title` with its word, so hovering
// teaches the language on desktop.

import { memo, useEffect, useMemo, type ReactNode } from 'react'
import type { Operation } from '../engine/resolver/nodes'
import { describeOperation } from '../engine/describe'
import { withLiveValues } from '../engine/shorthandLive'
import type { GameState } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import type { Seat } from '../engine/resolver/queries'
import {
	labelLeads,
	shorthandOperation,
	type GlyphId,
	type ShorthandLine,
	type SpecialtySlot,
	type Tok,
} from '../engine/shorthand'
import type { Suit, TraitId } from '../data/ids'
import { withCardNames } from '../data/cardNames'
import { isGameplayTrait, isSpecies } from '../data/ids'
import {
	printedGlyphUrl,
	printedSuitUrl,
	type SpecialtyAs,
} from './printedIcons'
import {
	GLYPH_WORD,
	SPRITE_ID,
	TIMING_WORD,
	glyphSymbol,
	spriteMarkup,
	suitSymbol,
	timingSymbol,
} from './shorthandGlyphs'

/** Glyphs are symbols in one hidden sprite, drawn with <use>: a board of
 *  cards holds thousands of glyphs, and a two-node reference is much cheaper
 *  to create than parsing each glyph's paths again. */
function Svg({ id }: { id: string }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
			<use href={`#${id}`} />
		</svg>
	)
}

/** A glyph as the game prints it where it has an icon (src/ui/printedIcons.ts),
 *  else our own drawing. */
function GlyphArt({ g, as }: { g: GlyphId; as?: SpecialtyAs | undefined }) {
	const url = printedGlyphUrl(g, as)
	return url !== null ? (
		<img className="sh-img" src={url} alt="" draggable={false} />
	) : (
		<Svg id={glyphSymbol(g)} />
	)
}

/** A suit as its printed shape, in the suit's colour. */
function SuitArt({ suit }: { suit: Suit | 'ANY' }) {
	const url = printedSuitUrl(suit)
	if (url === null) return <Svg id={suitSymbol(suit)} />
	const mask = `url("${url}")`
	return (
		<span
			className="sh-mask"
			style={{ maskImage: mask, WebkitMaskImage: mask }}
		/>
	)
}

/** Mount the sprite once per document (idempotent; a no-op without a DOM). */
function ensureSprite(): void {
	if (typeof document === 'undefined') return
	if (document.getElementById(SPRITE_ID) !== null) return
	const host = document.createElement('div')
	host.id = SPRITE_ID
	host.setAttribute('aria-hidden', 'true')
	host.style.cssText =
		'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
	host.innerHTML = spriteMarkup()
	document.body.appendChild(host)
}

const SPECIALTY_GLYPH: Record<SpecialtySlot, GlyphId> = {
	RESEARCH: 'RESEARCH',
	INFLUENCE: 'INFLUENCE',
	MILITARY: 'MILITARY',
	ANY: 'ANY_SPECIALTY',
}

/** A glyph with its label: amounts lead ("+2", "−1", "≤3"), words trail. */
function Labelled({
	icon,
	label,
	className,
	title,
}: {
	icon: ReactNode
	label?: string | undefined
	className: string
	title: string
}) {
	if (label === undefined || label === '')
		return (
			<span className={`sh-tk ${className}`} title={title}>
				{icon}
			</span>
		)
	const lead = labelLeads(label)
	const text = lead ? (
		<b className="sh-n">{label}</b>
	) : (
		<span className="sh-w">{label}</span>
	)
	return (
		<span className={`sh-tk ${className}`} title={title}>
			{lead ? text : null}
			{icon}
			{lead ? null : text}
		</span>
	)
}

function Glyph({ g, n }: { g: GlyphId; n?: string | undefined }) {
	return (
		<Labelled
			icon={<i className="sh-g">{<GlyphArt g={g} />}</i>}
			label={n}
			className={`sh-${g}`}
			title={GLYPH_WORD[g]}
		/>
	)
}

function SuitGlyph({
	suit,
	n,
	note,
}: {
	suit: Suit | 'ANY'
	n?: string | undefined
	note?: string | undefined
}) {
	// a lone card of a suit reads "+⚠", not "+1 ⚠"
	const label = n === '+1' ? '+' : n === '−1' ? '−' : n
	return (
		<>
			<Labelled
				icon={
					<i className="sh-g">
						<SuitArt suit={suit} />
					</i>
				}
				label={label}
				className={`sh-suit sh-suit-${suit.toLowerCase()}`}
				title={suit === 'ANY' ? 'any card' : suit}
			/>
			{note !== undefined && <span className="sh-note">{note}</span>}
		</>
	)
}

function IconGlyph({
	specialty,
	kind,
}: {
	specialty: SpecialtySlot
	kind: 'skill' | 'focus'
}) {
	const g = SPECIALTY_GLYPH[specialty]
	return (
		<span
			className={`sh-tk sh-${g} sh-${kind}`}
			title={`${specialty === 'ANY' ? 'any' : specialty.toLowerCase()} ${kind} icon`}
		>
			<i className="sh-g">
				<GlyphArt g={g} as={kind} />
			</i>
		</span>
	)
}

function Trait({ trait }: { trait: TraitId }) {
	const kind = isSpecies(trait)
		? ' sh-species'
		: isGameplayTrait(trait)
			? ' sh-gameplay'
			: ''
	return <span className={`sh-trait${kind}`}>{trait.replace(/_/g, ' ')}</span>
}

function Toks({ toks }: { toks: readonly Tok[] }) {
	return (
		<>
			{toks.map((t, i) => (
				<TokView key={i} t={t} />
			))}
		</>
	)
}

function joined(list: readonly Tok[], sep: string): ReactNode {
	return list.map((t, i) => (
		<span key={i} className="sh-seq">
			{i > 0 && <i className="sh-sep">{sep}</i>}
			<TokView t={t} />
		</span>
	))
}

const RULE_TOKEN: Record<string, GlyphId> = {
	'{DIL}': 'DIL',
	'{LAT}': 'LAT',
	'{GLO}': 'GLO',
	'{ACTION}': 'ACT',
}

/** A rule sentence (from the modifier registry) with its {DIL}-style tokens
 *  drawn as glyphs, like everywhere else. */
function RuleText({ text }: { text: string }) {
	const parts = text.split(/(\{DIL\}|\{LAT\}|\{GLO\}|\{ACTION\})/)
	return (
		<span className="sh-rule">
			{parts.map((p, i) => {
				const g = RULE_TOKEN[p]
				return g !== undefined ? (
					<span key={i} className={`sh-tk sh-${g}`} title={GLYPH_WORD[g]}>
						<i className="sh-g">
							<GlyphArt g={g} />
						</i>
					</span>
				) : (
					p
				)
			})}
		</span>
	)
}

function TokView({ t }: { t: Tok }): ReactNode {
	switch (t.k) {
		case 'glyph':
			return <Glyph g={t.g} n={t.n} />
		case 'suit':
			return <SuitGlyph suit={t.suit} n={t.n} note={t.note} />
		case 'skill':
		case 'focus':
			return <IconGlyph specialty={t.specialty} kind={t.k} />
		case 'trait':
			return <Trait trait={t.trait} />
		case 'name':
			return <span className="sh-name">{t.name}</span>
		case 'word':
			return <span className="sh-word">{t.text}</span>
		case 'num':
			return <b className="sh-n">{t.n}</b>
		case 'then':
			return (
				<i className="sh-then" title="then">
					›
				</i>
			)
		case 'sep':
			return <i className="sh-sep">{t.s}</i>
		case 'cost':
			return (
				<span className="sh-cost" title="cost">
					<Toks toks={t.body} />
				</span>
			)
		case 'may':
			return (
				<span className="sh-may" title="optional: you may">
					<Toks toks={t.body} />
				</span>
			)
		case 'or':
			return (
				<span className="sh-or">
					{t.pick > 1 && <em className="sh-pick">pick {t.pick}</em>}
					{t.options.map((o, i) => (
						<span key={i} className="sh-seq">
							{i > 0 && <i className="sh-orw">or</i>}
							<span className="sh-opt">
								{o.length > 0 ? (
									<Toks toks={o} />
								) : (
									<span className="sh-word">nothing</span>
								)}
							</span>
						</span>
					))}
				</span>
			)
		case 'opp':
			return (
				<span className="sh-opp" title="your opponent">
					<Toks toks={t.body} />
				</span>
			)
		case 'if':
			return (
				<span className="sh-if">
					<span
						className={`sh-cond${t.holds === true ? ' sh-holds' : t.holds === false ? ' sh-fails' : ''}`}
						title={
							t.holds === true
								? 'if — met right now'
								: t.holds === false
									? 'if — not met right now'
									: 'if'
						}
					>
						<Toks toks={t.cond} />
					</span>
					<i className="sh-then">→</i>
					<Toks toks={t.then} />
					{t.else !== undefined && (
						<>
							<i className="sh-orw">else</i>
							<Toks toks={t.else} />
						</>
					)}
				</span>
			)
		case 'did':
			return (
				<span className="sh-if">
					<span className="sh-cond sh-did" title="if you did">
						<Glyph g="CHECK" />
					</span>
					<i className="sh-then">→</i>
					<Toks toks={t.then} />
				</span>
			)
		case 'repeat':
			return (
				<span className="sh-repeat">
					<em className="sh-times">
						{t.times === 'each' ? 'each:' : `${t.times}×`}
					</em>
					<Toks toks={t.body} />
				</span>
			)
		case 'per':
			return (
				<span className="sh-per">
					<Toks toks={t.body} />
					<i className="sh-slash" title="per">
						/
					</i>
					<Toks toks={t.per} />
					{t.max !== undefined && <em className="sh-max">max {t.max}</em>}
					{t.live !== undefined && (
						<em className="sh-live" title="on the board right now">
							×{t.live}
						</em>
					)}
				</span>
			)
		case 'qual':
			return (
				<span className="sh-qual">
					<Toks toks={t.body} />
				</span>
			)
		case 'req':
			return (
				<span className="sh-req" title="requirement">
					<Glyph g="LOCK" />
					<Toks toks={t.cond} />
				</span>
			)
		case 'gain':
			return (
				<span className="sh-tk sh-gain" title="gain from the Market">
					<b className="sh-n">+</b>
					{t.suits.map((s, i) => (
						<span key={s} className="sh-seq">
							{i > 0 && <i className="sh-sep">/</i>}
							<i className={`sh-g sh-suit sh-suit-${s.toLowerCase()}`}>
								<SuitArt suit={s} />
							</i>
						</span>
					))}
					{t.junk !== undefined && (
						<span className="sh-note">
							{t.junk === 'ONLY' ? 'from Junk' : '+ Junk'}
						</span>
					)}
				</span>
			)
		case 'scan':
			return (
				<span className="sh-scan">
					<Glyph g="SCAN" n={t.n} />
					<span className="sh-qual">{joined(t.of, '/')}</span>
					{t.junk === true && <span className="sh-note">+ Junk</span>}
					{t.instead === true && <span className="sh-note">instead</span>}
				</span>
			)
		case 'steal':
			return (
				<span className="sh-steal">
					<Glyph g="STEAL" />
					<Toks toks={t.body} />
				</span>
			)
		case 'rule':
			return <RuleText text={t.text} />
		case 'atLeast':
			return (
				<span className="sh-atleast">
					<b className="sh-n">{t.n}</b>
					<Toks toks={t.of} />
				</span>
			)
		case 'is':
			return (
				<span className="sh-is">
					<Toks toks={t.body} />
				</span>
			)
		case 'not':
			return (
				<span className="sh-not">
					<span className="sh-word">non-</span>
					<Toks toks={t.body} />
				</span>
			)
		case 'alt':
			return <>{joined(t.options, '/')}</>
	}
}

const TIMING_CLASS: Record<ShorthandLine['timing'], string> = {
	PLAY: 'play',
	ACTIVATION: 'table',
	PASSIVE: 'table',
	REACTION: 'table',
	RESUPPLY: 'turn',
	CLEANUP: 'turn',
	CONTROL: 'turn',
	ENDGAME: 'end',
	SPECIAL: 'special',
	SURPRISE: 'special',
	DEVELOPMENT: 'dev',
}

export type ShorthandSize = 'sm' | 'md' | 'lg'

/** One mark of the language on its own: a glyph, a suit, a timing mark, or a
 *  skill / focus icon (the Shorthand guide's lexicon, glyph legends, glyphs
 *  inside English sentences). */
export type GlyphRef =
	| { k: 'glyph'; g: GlyphId }
	| { k: 'suit'; suit: Suit | 'ANY' }
	| { k: 'timing'; timing: ShorthandLine['timing'] }
	| { k: 'skill' | 'focus'; specialty: SpecialtySlot }

/** A single mark, inline with text. Decorative: the word beside it is the
 *  content, so it is hidden from assistive tech and titled for hover. */
export function GlyphMark({
	mark,
	className = '',
}: {
	mark: GlyphRef
	className?: string | undefined
}) {
	useEffect(ensureSprite, [])
	switch (mark.k) {
		case 'glyph':
			return (
				<span
					className={`sh-mark sh-tk sh-${mark.g} ${className}`}
					title={GLYPH_WORD[mark.g]}
					aria-hidden="true"
				>
					<i className="sh-g">
						<GlyphArt g={mark.g} />
					</i>
				</span>
			)
		case 'suit':
			return (
				<span
					className={`sh-mark sh-tk sh-suit sh-suit-${mark.suit.toLowerCase()} ${className}`}
					title={mark.suit === 'ANY' ? 'any card' : mark.suit}
					aria-hidden="true"
				>
					<i className="sh-g">
						<SuitArt suit={mark.suit} />
					</i>
				</span>
			)
		case 'timing':
			return (
				<i
					className={`sh-mark sh-tm sh-tm-${TIMING_CLASS[mark.timing]} ${className}`}
					title={TIMING_WORD[mark.timing]}
					aria-hidden="true"
				>
					<Svg id={timingSymbol(mark.timing)} />
				</i>
			)
		case 'skill':
		case 'focus': {
			const g = SPECIALTY_GLYPH[mark.specialty]
			return (
				<span
					className={`sh-mark sh-tk sh-${g} sh-${mark.k} ${className}`}
					title={`${mark.specialty === 'ANY' ? 'any' : mark.specialty.toLowerCase()} ${mark.k} icon`}
					aria-hidden="true"
				>
					<i className="sh-g">
						<GlyphArt g={g} as={mark.k} />
					</i>
				</span>
			)
		}
	}
}

/** One compiled line: timing mark, then action/attack/requirement/trigger,
 *  then the body. `label` is the English for assistive tech. */
export function ShorthandLineView({
	line,
	label,
	size = 'md',
	className = '',
}: {
	line: ShorthandLine
	label?: string | undefined
	size?: ShorthandSize | undefined
	className?: string | undefined
}) {
	useEffect(ensureSprite, [])
	return (
		<div
			className={`sh-line sh-${size} ${className}`}
			role="img"
			aria-label={label ?? TIMING_WORD[line.timing]}
		>
			<i
				className={`sh-tm sh-tm-${TIMING_CLASS[line.timing]}`}
				title={TIMING_WORD[line.timing]}
			>
				<Svg id={timingSymbol(line.timing)} />
			</i>
			<span className="sh-body">
				{line.action && <Glyph g="ACT" />}
				{line.attack && (
					<span className="sh-attack">
						<Glyph g="ATTACK" />
					</span>
				)}
				{line.requires !== undefined && (
					<span className="sh-req" title="requirement">
						<Glyph g="LOCK" />
						<Glyph g={line.requires.specialty} n={`≥${line.requires.min}`} />
					</span>
				)}
				{line.trigger.length > 0 && (
					<>
						<span className="sh-trigger">
							<Toks toks={line.trigger} />
						</span>
						<i className="sh-colon">:</i>
					</>
				)}
				<Toks toks={line.body} />
			</span>
		</div>
	)
}

/** Tokens with no timing mark — a mission goal, a reward: the same glyphs
 *  outside an operation strip. `label` is the English for assistive tech. */
export function ShorthandTokens({
	toks,
	label,
	size = 'md',
	className = '',
}: {
	toks: readonly Tok[]
	label?: string | undefined
	size?: ShorthandSize | undefined
	className?: string | undefined
}) {
	useEffect(ensureSprite, [])
	return (
		<div
			className={`sh-line sh-bare sh-${size} ${className}`}
			role="img"
			aria-label={label}
		>
			<span className="sh-body">
				<Toks toks={toks} />
			</span>
		</div>
	)
}

// Operations are the catalogue's own objects and never change, so a line and
// its English are compiled once per operation, not once per render.
const compiledLines = new WeakMap<Operation, ShorthandLine | null>()
const englishLines = new WeakMap<Operation, string | undefined>()

/** The compiled line; a malformed tree must not take the card down. */
function lineOf(op: Operation): ShorthandLine | null {
	if (!compiledLines.has(op)) {
		let line: ShorthandLine | null
		try {
			line = shorthandOperation(op)
		} catch {
			line = null
		}
		compiledLines.set(op, line)
	}
	return compiledLines.get(op) ?? null
}

/** English for the label. */
function englishOf(op: Operation): string | undefined {
	if (!englishLines.has(op)) {
		let text: string | undefined
		try {
			text = withCardNames(describeOperation(op))
		} catch {
			text = undefined
		}
		englishLines.set(op, text)
	}
	return englishLines.get(op)
}

/** Compile and render one printed operation. */
/** The board a line is read against, for live values: the card that owns
 *  the line, its owner, and the state (engine state, not a projection). */
export interface ShorthandLiveContext {
	state: GameState
	seat: Seat
	iid: CardInstanceId
}

export const ShorthandOp = memo(function ShorthandOp({
	op,
	size,
	className,
	live,
}: {
	op: Operation
	size?: ShorthandSize | undefined
	className?: string | undefined
	/** evaluate counted amounts and conditions on this board */
	live?: ShorthandLiveContext | undefined
}) {
	const line = useMemo(() => {
		const compiled = lineOf(op)
		if (compiled === null || live === undefined) return compiled
		try {
			return withLiveValues(compiled, live.state, live.seat, live.iid)
		} catch {
			return compiled
		}
	}, [op, live])
	const label = englishOf(op)
	if (line === null) return null
	return (
		<ShorthandLineView
			line={line}
			label={label}
			size={size}
			className={className}
		/>
	)
})
