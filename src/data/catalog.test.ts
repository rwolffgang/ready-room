// Catalog loader test (todo/12 §4 + todo/13): `loadCatalog()` must parse every
// card JSON on disk into a schema-valid CardCatalog with unique ids, load the
// crew boards for all six decks, and throw on malformed input.
//
// Counts are asserted as FLOORS (not exact totals): the todo/13 Phase-B agent
// lands four more crew decks (SIS/SEL/BUR/KOL) after these tests are
// written, so an exact `defs.length` would pin the current corpus forever. The
// floors pin only what this file's scope owns (the common 101 + PIC/SHR)
// and stay true as more cards land.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { BoardArraySchema } from './boards'
import { loadCatalog } from './catalog'
import { CardArraySchema, CardDefSchema } from './schema'

const TMP: string[] = []

afterEach(async () => {
	while (TMP.length > 0) {
		const d = TMP.pop()!
		await rm(d, { recursive: true, force: true })
	}
})

const SIX_DECKS = ['PIC', 'SIS', 'SEL', 'SHR', 'BUR', 'KOL'] as const

describe('loadCatalog', () => {
	it('parses every present card JSON into a valid catalog (ids unique, stardates populated)', async () => {
		const catalog = await loadCatalog()
		expect(catalog.stardates).toHaveLength(32) // SD01–SD32

		const ids = catalog.defs.map((d) => d.id)
		const cardIds = catalog.defs.map((d) => d.cardId)
		expect(new Set(ids).size).toBe(ids.length)
		expect(new Set(cardIds).size).toBe(cardIds.length)

		// The corpus this scope owns: 101 common + the two Phase-A crew decks.
		expect(ids.length).toBeGreaterThanOrEqual(101 + 24 + 24)
	})

	it('every def round-trips CardDefSchema cleanly', async () => {
		const catalog = await loadCatalog()
		const allDefs = [...catalog.defs, ...catalog.stardates.map((st) => st.def)]
		const parsed = CardArraySchema.safeParse(allDefs)
		expect(parsed.success, `whole defs array must be schema-valid`).toBe(true)
		for (const def of allDefs) {
			expect(
				CardDefSchema.safeParse(def).success,
				`def ${def.id} should be schema-valid`,
			).toBe(true)
		}
	})

	it('the 32 Stardate cards (SD01–SD32) split 5×TWO_PLAYER + 2×CADET + 25×SOLO (5 per Bot level), as printed', async () => {
		const catalog = await loadCatalog()
		const two = catalog.stardates
			.filter((st) => st.modes.includes('TWO_PLAYER'))
			.sort((a, b) => a.sequence - b.sequence)
		const cadet = catalog.stardates
			.filter((st) => st.modes.includes('CADET'))
			.sort((a, b) => a.sequence - b.sequence)

		// 2-PLAYER SD01–SD05: 30 Glory in total; #4 holds 6 (rulebook p.12 example)
		expect(two.map((st) => st.id)).toEqual([
			'sd-01',
			'sd-02',
			'sd-03',
			'sd-04',
			'sd-05',
		])
		expect(two.map((st) => st.sequence)).toEqual([1, 2, 3, 4, 5])
		expect(two.map((st) => st.glory)).toEqual([5, 7, 7, 6, 5])
		// #1, #2, #4 wipe the Market; #3 also the bare neutral Locations; #5 is
		// the final card ("Trigger the end of the game") and is never resolved
		const effects = two.map((st) => st.def.operations[0]!.effect)
		expect(effects[0]).toEqual({ k: 'WIPE_MARKET' })
		expect(effects[1]).toEqual({ k: 'WIPE_MARKET' })
		expect(effects[2]).toEqual({
			k: 'SEQ',
			steps: [{ k: 'WIPE_MARKET' }, { k: 'WIPE_NEUTRAL_ZONE' }],
		})
		expect(effects[3]).toEqual({ k: 'WIPE_MARKET' })
		expect(effects[4]).toEqual({ k: 'NOOP' })

		expect(cadet.map((st) => st.id)).toEqual(['sd-06', 'sd-07'])
		expect(cadet.map((st) => st.sequence)).toEqual([1, 2])
		for (const st of cadet) expect(st.glory).toBe(5) // both Cadet Training cards print 5

		// Solo-vs-Bot cards: boxed in every mode, level + Bot actions as data only
		const solo = catalog.stardates.filter((st) => st.solo !== undefined)
		expect(solo).toHaveLength(25)
		for (const st of solo) expect(st.modes).toEqual(['SOLO'])
		const total = (level: string) =>
			solo
				.filter((st) => st.solo!.level === level)
				.reduce((n, st) => n + st.glory, 0)
		expect(
			['ENSIGN', 'LIEUTENANT', 'COMMANDER', 'CAPTAIN', 'ADMIRAL'].map(total),
		).toEqual([31, 30, 30, 29, 27])

		// stardate faces live ONLY in catalog.stardates (the fixture shape), never
		// in catalog.defs where they'd be double-counted as common cards.
		const defIds = new Set(catalog.defs.map((d) => d.id))
		for (const st of catalog.stardates) {
			expect(
				defIds.has(st.id),
				`stardate face ${st.id} must not be a plain catalog.defs card`,
			).toBe(false)
		}
	})

	it('per-suit common floors still hold after the crew decks are added', async () => {
		const catalog = await loadCatalog()
		const bySuit = new Map<string, number>()
		for (const def of catalog.defs)
			bySuit.set(def.suit, (bySuit.get(def.suit) ?? 0) + 1)
		// floors transcribed from rules/01 §1.3 (common only; crew cards add more)
		expect(bySuit.get('PERSON') ?? 0).toBeGreaterThanOrEqual(25)
		expect(bySuit.get('CARGO') ?? 0).toBeGreaterThanOrEqual(16)
		expect(bySuit.get('SHIP') ?? 0).toBeGreaterThanOrEqual(13)
		expect(bySuit.get('ALLY') ?? 0).toBeGreaterThanOrEqual(13)
		expect(bySuit.get('LOCATION') ?? 0).toBeGreaterThanOrEqual(20)
		expect(bySuit.get('ENCOUNTER') ?? 0).toBeGreaterThanOrEqual(8)
		expect(bySuit.get('INCIDENT') ?? 0).toBeGreaterThanOrEqual(6)
	})

	it('PIC and SHR crew decks are present at their face counts (Phase A)', async () => {
		const catalog = await loadCatalog()
		const byDeck = new Map<string, number>()
		for (const def of catalog.defs)
			byDeck.set(def.deck, (byDeck.get(def.deck) ?? 0) + 1)
		expect(byDeck.get('COMMON')).toBeGreaterThanOrEqual(101)
		expect(byDeck.get('PIC')).toBe(24)
		expect(byDeck.get('SHR')).toBe(24)
	})

	it('loads crew boards for all six decks, each with a Basic (1) + Advanced (3) mission set', async () => {
		const catalog = await loadCatalog()
		for (const deck of SIX_DECKS) {
			const board = catalog.boards[deck]
			expect(board, `board for ${deck} is present`).toBeDefined()
			expect(board!.basic).toHaveLength(1)
			expect(board!.advanced).toHaveLength(3)
			for (const m of [...board!.basic, ...board!.advanced]) {
				expect(m.goal).toBeDefined()
				expect(m.reward).toBeDefined()
				expect(typeof m.vp).toBe('number')
			}
			// Basic side carries 0 VP by definition (rules/07 §7.4.1) and prints
			// the crew's first STCC mission (the board photos).
			expect(board!.basic[0]!.vp).toBe(0)
			expect(board!.basic[0]!.cardId).toBe(board!.advanced[0]!.cardId)
			expect(board!.advanced.map((m) => m.cardId?.slice(-2))).toEqual([
				'M1',
				'M2',
				'M3',
			])
			// both sides carry their own track multiplier glyphs
			expect(board!.tracks?.basic.RESEARCH.length).toBeGreaterThan(0)
			expect(board!.tracks?.advanced.RESEARCH.length).toBeGreaterThan(0)
		}
		expect(catalog.boards.PIC!.advanced[0]!.cardId).toBe('1PIC/M1')
	})

	it('a malformed or schema-invalid file makes the loader throw', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'catalog-test-'))
		TMP.push(dir)
		await mkdir(join(dir, 'sub'))
		await writeFile(join(dir, 'sub', 'bad.json'), '{ this is not json', 'utf8')
		await expect(loadCatalog([dir])).rejects.toThrow(/catalog load failed/)
	})

	it('a malformed board side is rejected by BoardArraySchema', () => {
		// The loader only reads boards from the real cards/boards dir, so the gate
		// is tested directly here: a bad side (unknown deck, bad missions) fails.
		const badSide = [
			{ deck: 'PIC', side: 'NOPE', tracks: [], missions: [{ index: 0 }] },
		]
		expect(BoardArraySchema.safeParse(badSide).success).toBe(false)
	})
})
