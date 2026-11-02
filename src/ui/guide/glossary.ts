// The Shorthand guide's content (docs/shorthand.md), built from the same code
// the game draws with, so the guide cannot drift from the cards: the lexicon
// lists every glyph of src/engine/shorthand.ts (a test checks none is missing),
// the grammar shows each rule on a real card's compiled line, and the practice
// questions are real operations with their describe() English.

import { withCardNames } from '../../data/cardNames'
import type { CardDef } from '../../data/schema'
import type { Suit } from '../../data/ids'
import type { Operation } from '../../engine/resolver/nodes'
import { describeOperation } from '../../engine/describe'
import {
	shorthandOperation,
	shorthandWeight,
	type GlyphId,
	type ShorthandLine,
	type Tok,
} from '../../engine/shorthand'
import type { GlyphRef } from '../shorthand'
import { GLYPH_WORD, TIMING_WORD } from '../shorthandGlyphs'

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

export interface LexiconEntry {
	mark: GlyphRef
	word: string
}

export interface LexiconGroup {
	title: string
	entries: LexiconEntry[]
}

const TIMINGS: ShorthandLine['timing'][] = [
	'PLAY',
	'ACTIVATION',
	'PASSIVE',
	'REACTION',
	'RESUPPLY',
	'CLEANUP',
	'CONTROL',
	'ENDGAME',
	'SPECIAL',
	'DEVELOPMENT',
]

const SUITS: Suit[] = [
	'PERSON',
	'CARGO',
	'SHIP',
	'ALLY',
	'LOCATION',
	'DIRECTIVE',
	'INCIDENT',
	'ENCOUNTER',
	'CAPTAIN',
	'STATUS',
]

/** Glyph groups, in the order a new player needs them. */
const GLYPH_GROUPS: { title: string; glyphs: GlyphId[] }[] = [
	{
		title: 'Resources and tokens',
		glyphs: ['DIL', 'LAT', 'GLO', 'ACT', 'VP', 'AWAY', 'STARDATE'],
	},
	{
		title: 'Your hand and decks',
		glyphs: [
			'CARD',
			'DECK',
			'TOP_DECK',
			'PUT',
			'FIND',
			'FROM_DISCARD',
			'DISCARD_PILE',
			'LOG',
			'ENLIST',
			'DEVELOP',
			'HAND',
			'RESERVE',
		],
	},
	{
		title: 'In play',
		glyphs: [
			'PLAY',
			'FREE_PLAY',
			'DEPLOY',
			'PROMOTE',
			'RECALL',
			'DISMISS',
			'DESTROY',
			'EXHAUST',
			'REFRESH',
			'DUPLICATE',
			'REVEAL',
			'ENTER',
			'FLEET',
			'DUTY',
			'STAGING',
		],
	},
	{
		title: 'The Market',
		glyphs: ['MARKET', 'JUNK', 'SCAN', 'WIPE_MARKET', 'STEAL'],
	},
	{
		title: 'Space',
		glyphs: ['WARP', 'BEAM', 'SEND', 'CONTROL', 'WIPE_NEUTRAL_ZONE', 'ARRANGE'],
	},
	{
		title: 'Specialties and checks',
		glyphs: [
			'RESEARCH',
			'INFLUENCE',
			'MILITARY',
			'ANY_SPECIALTY',
			'LOWEST_SPECIALTY',
			'LOCK',
			'CHECK',
			'SHIELD',
			'ATTACK',
			'MISSION',
			'RECRYSTALLIZE',
			'OPERATION',
			'ENDGAME',
		],
	},
]

/** The glyphs every group lists (the test compares this with GLYPHS). */
export const LEXICON_GLYPHS: readonly GlyphId[] = GLYPH_GROUPS.flatMap(
	(g) => g.glyphs,
)

export const LEXICON: LexiconGroup[] = [
	{
		title: 'When a line happens',
		entries: TIMINGS.map((timing) => ({
			mark: { k: 'timing', timing },
			word: TIMING_WORD[timing],
		})),
	},
	{
		title: 'Card suits',
		entries: SUITS.map((suit) => ({ mark: { k: 'suit', suit }, word: suit })),
	},
	...GLYPH_GROUPS.map((group) => ({
		title: group.title,
		entries: group.glyphs.map((g): LexiconEntry => ({
			mark: { k: 'glyph', g },
			word: GLYPH_WORD[g],
		})),
	})),
	{
		title: 'Icons printed on cards',
		entries: [
			{
				mark: { k: 'skill', specialty: 'RESEARCH' },
				word: 'Skill icon (boxed)',
			},
			{
				mark: { k: 'focus', specialty: 'RESEARCH' },
				word: 'Focus icon (ringed)',
			},
			{ mark: { k: 'skill', specialty: 'ANY' }, word: 'a wild Skill icon' },
		],
	},
]

// ---------------------------------------------------------------------------
// Grammar — each rule on a real card
// ---------------------------------------------------------------------------

/** A card operation to show: the card id prefix (`1PIC02`) and op index. */
export interface CardOpRef {
	card: string
	op: number
}

export interface GrammarRule {
	title: string
	text: string
	/** the example line; 'timing' shows every timing mark instead */
	example: CardOpRef | 'timing'
}

export const GRAMMAR: GrammarRule[] = [
	{
		title: 'Timing comes first',
		text: 'The square that opens a line says when it happens, in the colour of the printed strip: play from your hand, activate a card in play (it exhausts), always on, a reaction, at Resupply, at Clean-up, when you take control, at the end of the game, a special rule, or a Development cost.',
		example: 'timing',
	},
	{
		title: 'Cost, then ›, then the payoff',
		text: 'Everything left of the chevron sits on a darker plate and is paid first. If you cannot pay it, the line cannot run.',
		example: { card: '1PIC02', op: 1 },
	},
	{
		title: 'Plus and minus are your hand and your pool',
		text: 'The same arithmetic covers cards, resources and Incidents: +2 cards draws two, −1 card discards one, +1 Incident takes one, −1 Incident returns one.',
		example: { card: '1PIC16', op: 0 },
	},
	{
		title: 'The orange chip costs an action',
		text: 'A line that starts with the chip spends one of your actions. No chip, no action.',
		example: { card: '1SHR18', op: 1 },
	},
	{
		title: 'A dashed outline means “you may”',
		text: 'Optional parts are dashed. The game only offers them when they could change something.',
		example: { card: '1PIC14', op: 1 },
	},
	{
		title: 'Salmon hatching is your opponent',
		text: 'Whatever sits in the hatched salmon frame happens to, or is chosen by, the other captain. Red crossed blades mark an ATTACK. A green ✓ means “if you did”.',
		example: { card: '1PIC23', op: 1 },
	},
	{
		title: '“or” splits a choice',
		text: 'Each option sits on its own plate. You are only offered the options you can fully carry out.',
		example: { card: '1SIS09', op: 0 },
	},
	{
		title: 'A slash means “per”',
		text: 'A slash counts something on the board; a small “max” caps it. In a game, a blue ×N shows what it counts right now.',
		example: { card: '1PER03', op: 1 },
	},
	{
		title: 'A “?” pill is a condition',
		text: 'The condition sits in a pill ending in a question mark; the arrow leads to what it unlocks. In a game the pill turns green when it already holds.',
		example: { card: '1INC01', op: 0 },
	},
	{
		title: 'A lock is a requirement',
		text: 'A padlock with a specialty and a number gates the whole line: you need that level to use it.',
		example: { card: '1PIC03', op: 1 },
	},
	{
		title: 'Reactions say what they wait for',
		text: 'Before the colon is the event the reaction answers; after it, what it does. The salmon frame there means it answers your opponent.',
		example: { card: '1PIC13', op: 1 },
	},
	{
		title: 'Rule changes stay words',
		text: 'A passive that changes a rule is written out after a § sign. Each one is unique, so a glyph would only hide it.',
		example: { card: '1PIC07', op: 2 },
	},
]

/** The def and operation a reference points at, if the catalogue has it. */
export function resolveRef(
	defs: readonly CardDef[],
	ref: CardOpRef,
): { def: CardDef; op: Operation } | null {
	const def = defs.find((d) => d.id.startsWith(`${ref.card}-`))
	const op = def?.operations[ref.op]
	return def !== undefined && op !== undefined ? { def, op } : null
}

// ---------------------------------------------------------------------------
// Glyphs used by a card (the legend under a card's detail)
// ---------------------------------------------------------------------------

function markKey(m: GlyphRef): string {
	switch (m.k) {
		case 'glyph':
			return `g:${m.g}`
		case 'suit':
			return `s:${m.suit}`
		case 'timing':
			return `t:${m.timing}`
		case 'skill':
		case 'focus':
			return `${m.k}:${m.specialty}`
	}
}

function wordOf(m: GlyphRef): string {
	switch (m.k) {
		case 'glyph':
			return GLYPH_WORD[m.g]
		case 'suit':
			return m.suit === 'ANY' ? 'any card' : m.suit
		case 'timing':
			return TIMING_WORD[m.timing]
		case 'skill':
			return `${m.specialty === 'ANY' ? 'any' : m.specialty.toLowerCase()} Skill icon`
		case 'focus':
			return `${m.specialty === 'ANY' ? 'any' : m.specialty.toLowerCase()} Focus icon`
	}
}

/** Every distinct mark in these lines, in reading order, with its word. */
export function glyphsOfLines(lines: readonly ShorthandLine[]): LexiconEntry[] {
	const seen = new Map<string, LexiconEntry>()
	const add = (mark: GlyphRef) => {
		const key = markKey(mark)
		if (!seen.has(key)) seen.set(key, { mark, word: wordOf(mark) })
	}
	const walk = (toks: readonly Tok[]): void => {
		for (const t of toks) {
			switch (t.k) {
				case 'glyph':
					add({ k: 'glyph', g: t.g })
					break
				case 'suit':
					add({ k: 'suit', suit: t.suit })
					break
				case 'skill':
				case 'focus':
					add({ k: t.k, specialty: t.specialty })
					break
				case 'gain':
					for (const s of t.suits) add({ k: 'suit', suit: s })
					break
				case 'scan':
					add({ k: 'glyph', g: 'SCAN' })
					walk(t.of)
					break
				case 'steal':
					add({ k: 'glyph', g: 'STEAL' })
					walk(t.body)
					break
				case 'req':
					add({ k: 'glyph', g: 'LOCK' })
					walk(t.cond)
					break
				case 'did':
					add({ k: 'glyph', g: 'CHECK' })
					walk(t.then)
					break
				case 'cost':
				case 'may':
				case 'opp':
				case 'qual':
				case 'is':
				case 'not':
				case 'repeat':
					walk(t.body)
					break
				case 'or':
					for (const o of t.options) walk(o)
					break
				case 'if':
					walk(t.cond)
					walk(t.then)
					if (t.else !== undefined) walk(t.else)
					break
				case 'per':
					walk(t.body)
					walk(t.per)
					break
				case 'atLeast':
					walk(t.of)
					break
				case 'alt':
					walk(t.options)
					break
				default:
					break
			}
		}
	}
	for (const line of lines) {
		add({ k: 'timing', timing: line.timing })
		if (line.action) add({ k: 'glyph', g: 'ACT' })
		if (line.attack) add({ k: 'glyph', g: 'ATTACK' })
		if (line.requires !== undefined) {
			add({ k: 'glyph', g: 'LOCK' })
			add({ k: 'glyph', g: line.requires.specialty })
		}
		walk(line.trigger)
		walk(line.body)
	}
	return [...seen.values()]
}

/** Every operation of a card, compiled (unreadable trees are skipped). */
export function linesOfDef(def: CardDef): ShorthandLine[] {
	const out: ShorthandLine[] = []
	for (const op of def.operations) {
		try {
			out.push(shorthandOperation(op))
		} catch {
			// no line for a malformed tree
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

/** The English of an operation, with card names, or null for a tree
 *  describe() can't read. */
export function englishOf(op: Operation): string | null {
	try {
		return withCardNames(describeOperation(op))
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------

export interface QuizItem {
	def: CardDef
	op: Operation
	line: ShorthandLine
	english: string
}

export interface QuizQuestion {
	item: QuizItem
	/** three English sentences, one of them `item.english` */
	options: string[]
}

/** Operations fair to quiz on: short enough to read, not rule sentences
 *  (those already are English), and with English to match against. */
export function quizPool(defs: readonly CardDef[]): QuizItem[] {
	const out: QuizItem[] = []
	const seen = new Set<string>()
	for (const def of defs) {
		for (const op of def.operations) {
			let line: ShorthandLine
			try {
				line = shorthandOperation(op)
			} catch {
				continue
			}
			if (line.body.length === 0) continue
			if (line.body.some((t) => t.k === 'rule')) continue
			const weight = shorthandWeight(line)
			if (weight < 2 || weight > 7) continue
			const english = englishOf(op)
			if (english === null || seen.has(english)) continue
			seen.add(english)
			out.push({ def, op, line, english })
		}
	}
	return out
}

/** One question: a line, and its English among two others of the same
 *  timing (so the timing mark alone doesn't give it away). */
export function makeQuestion(
	pool: readonly QuizItem[],
	random: () => number,
): QuizQuestion | null {
	if (pool.length < 3) return null
	const item = pool[Math.floor(random() * pool.length)]!
	const same = pool.filter(
		(p) => p !== item && p.line.timing === item.line.timing,
	)
	const others = same.length >= 2 ? same : pool.filter((p) => p !== item)
	const picked: string[] = []
	while (picked.length < 2 && picked.length < others.length) {
		const o = others[Math.floor(random() * others.length)]!
		if (!picked.includes(o.english) && o.english !== item.english)
			picked.push(o.english)
	}
	const options = [item.english, ...picked]
	for (let i = options.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[options[i], options[j]] = [options[j]!, options[i]!]
	}
	return { item, options }
}
