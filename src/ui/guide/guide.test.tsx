// The Shorthand guide teaches exactly what the board draws: its lexicon lists
// every glyph the compiler can emit, every grammar example is a real card's
// operation, and the practice questions are real lines with their English.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { cardNameById } from '../../data/cardNames'
import { GLYPHS, shorthandOperation } from '../../engine/shorthand'
import { useGameStore } from '../store'
import { loadBrowserCatalog } from '../browserCatalog'
import {
	GRAMMAR,
	LEXICON,
	LEXICON_GLYPHS,
	glyphsOfLines,
	makeQuestion,
	quizPool,
	englishOf,
	resolveRef,
} from './glossary'
import { ShorthandGuide, type GuideSection } from './ShorthandGuide'

const catalog = loadBrowserCatalog()

/** A small deterministic random source for the quiz. */
function seeded(seed: number): () => number {
	let s = seed >>> 0
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0
		return s / 2 ** 32
	}
}

describe('glossary', () => {
	it('lists every glyph the compiler can draw, exactly once', () => {
		expect([...LEXICON_GLYPHS].sort()).toEqual([...GLYPHS].sort())
		expect(new Set(LEXICON_GLYPHS).size).toBe(LEXICON_GLYPHS.length)
	})

	it('lists all ten timing marks', () => {
		expect(LEXICON[0]!.entries).toHaveLength(10)
	})

	it('shows every grammar rule on a real card operation that compiles', () => {
		for (const rule of GRAMMAR) {
			if (rule.example === 'timing') continue
			const hit = resolveRef(catalog.defs, rule.example)
			expect(hit, rule.title).not.toBeNull()
			expect(
				shorthandOperation(hit!.op).body.length,
				rule.title,
			).toBeGreaterThan(0)
		}
	})

	it('builds a card legend from the glyphs its lines use', () => {
		const hit = resolveRef(catalog.defs, { card: '1PIC23', op: 1 })!
		const words = glyphsOfLines([shorthandOperation(hit.op)]).map((e) => e.word)
		expect(words[0]).toMatch(/^Activation/)
		expect(words).toEqual(
			expect.arrayContaining(['attack', 'Away Team', 'if you did', 'Glory']),
		)
		expect(new Set(words).size).toBe(words.length)
	})

	// describe() itself reads cleanly (describe.test.ts sweeps every card);
	// the guide only names the cards its tokens stand for
	it('names the cards in its English', () => {
		const hit = resolveRef(catalog.defs, { card: '1SHP22', op: 1 })!
		const english = englishOf(hit.op)!
		expect(english).not.toContain('[[card:')
		expect(english).toContain(
			`If you have at least 1 ${cardNameById('1SHP14-25')} in play`,
		)
	})

	it('asks one right and two wrong sentences of the same timing', () => {
		const pool = quizPool(catalog.defs)
		expect(pool.length).toBeGreaterThan(100)
		const random = seeded(7)
		for (let i = 0; i < 25; i++) {
			const q = makeQuestion(pool, random)!
			expect(q.options).toHaveLength(3)
			expect(new Set(q.options).size).toBe(3)
			expect(q.options).toContain(q.item.english)
			const timings = q.options.map(
				(o) => pool.find((p) => p.english === o)!.line.timing,
			)
			expect(new Set(timings).size).toBe(1)
		}
	})
})

describe('<ShorthandGuide>', () => {
	let root: Root | null = null
	let host: HTMLElement

	beforeAll(() => {
		useGameStore.getState().loadCatalog()
	})
	afterEach(async () => {
		await act(async () => root?.unmount())
		root = null
		host?.remove()
	})

	async function open(section: GuideSection): Promise<HTMLElement> {
		host = document.createElement('div')
		document.body.appendChild(host)
		root = createRoot(host)
		const onSection = (s: GuideSection) =>
			void act(() => root!.render(<Guide section={s} />))
		function Guide({ section: s }: { section: GuideSection }) {
			return (
				<ShorthandGuide section={s} onSection={onSection} onClose={() => {}} />
			)
		}
		await act(async () => root!.render(<Guide section={section} />))
		return host
	}

	it('Learn: the translator and every grammar rule, each with its example', async () => {
		const el = await open('learn')
		expect(el.querySelector('.sg-translator .sh-line')).not.toBeNull()
		expect(el.querySelectorAll('.sg-rule')).toHaveLength(GRAMMAR.length)
		expect(el.querySelectorAll('.sg-example').length).toBe(GRAMMAR.length - 1)
	})

	it('Lexicon: every mark with its word', async () => {
		const el = await open('lexicon')
		const total = LEXICON.reduce((n, g) => n + g.entries.length, 0)
		expect(el.querySelectorAll('.sg-lex-item')).toHaveLength(total)
	})

	it('Cards: a tile opens its Rosetta view with the card legend', async () => {
		const el = await open('cards')
		const header = el.querySelector<HTMLElement>(
			'.sg-grid [aria-label^="Open"]',
		)
		expect(header).not.toBeNull()
		await act(async () => header!.click())
		const rosetta = el.querySelector('.sg-rosetta')
		expect(rosetta).not.toBeNull()
		expect(rosetta!.querySelector('.sg-legend')).not.toBeNull()
	})

	it('Practice: a pick gets a verdict and reveals the right sentence', async () => {
		const el = await open('practice')
		const options = [...el.querySelectorAll<HTMLButtonElement>('.sg-option')]
		expect(options).toHaveLength(3)
		expect(el.querySelector('.sg-quiz-line [role="img"]')).not.toBeNull()
		await act(async () => options[0]!.click())
		const feedback = el.querySelector('.sg-feedback')!
		const right = options[0]!.classList.contains('is-right')
		expect(feedback.textContent).toContain(right ? 'Right.' : 'Not quite.')
		// the right answer is always revealed after a pick
		expect(el.querySelector('.sg-option.is-right')).not.toBeNull()
	})
})
