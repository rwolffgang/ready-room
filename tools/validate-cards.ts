// Card validation CLI (todo/03 §4, replacing the stub): schema-parse every
// card file, collect ALL errors, check global ID uniqueness and the rules/01 §1.3 group counts.
//
// Output format: `path:cardId: message` — the editor click-through contract.
// Exit code is non-zero iff at least one hard error was found.

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CardArraySchema, type CardDef } from '../src/data/schema'
import {
	NOT_IN_THIS_BOX,
	NOT_IN_THIS_BOX_SUITS,
	NOT_IN_THIS_BOX_TRAITS,
} from '../src/data/ids'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const dataDir = resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'../src/data',
)
const cardsDir = join(dataDir, 'cards')

// ---------------------------------------------------------------------------
// Group expectations, transcribed from rules/01 §1.3. Keyed by cards-relative
// file path so Stardate (no single suit) and crew decks (mixed suits) aggregate
// cleanly. The overall total (~300 incl. captains/boards/solo, which are not
// individually counted here) is the DoD's "0 / 300".
// ---------------------------------------------------------------------------

const GROUPS: ReadonlyArray<{ file: string; label: string; expected: number }> =
	[
		{ file: 'common/person.json', label: 'COMMON PERSON', expected: 25 },
		{ file: 'common/cargo.json', label: 'COMMON CARGO', expected: 16 },
		{ file: 'common/ship.json', label: 'COMMON SHIP', expected: 13 },
		{ file: 'common/ally.json', label: 'COMMON ALLY', expected: 13 },
		{ file: 'common/location.json', label: 'COMMON LOCATION', expected: 20 },
		{ file: 'common/encounter.json', label: 'COMMON ENCOUNTER', expected: 8 },
		{ file: 'common/incident.json', label: 'COMMON INCIDENT', expected: 6 },
		{ file: 'common/stardate.json', label: 'COMMON STARDATE', expected: 32 },
		{ file: 'crew/pic.json', label: 'PIC', expected: 24 },
		{ file: 'crew/sis.json', label: 'SIS', expected: 25 },
		{ file: 'crew/sel.json', label: 'SEL', expected: 24 },
		{ file: 'crew/shr.json', label: 'SHR', expected: 24 },
		{ file: 'crew/bur.json', label: 'BUR', expected: 26 },
		{ file: 'crew/kol.json', label: 'KOL', expected: 24 },
		// fan-made custom deck (src/data/custom/firefly.json)
		{ file: 'crew/mal.json', label: 'MAL', expected: 25 },
	]

const OVERALL_EXPECTED = 325

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findJsonFiles(dir: string): Promise<string[]> {
	const found: string[] = []
	let entries
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch {
		return found
	}
	for (const entry of entries) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			found.push(...(await findJsonFiles(path)))
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			found.push(path)
		}
	}
	return found
}

function cardLabel(raw: unknown): string {
	if (raw !== null && typeof raw === 'object') {
		const o = raw as Record<string, unknown>
		const cardId = typeof o['cardId'] === 'string' ? o['cardId'] : undefined
		const id = typeof o['id'] === 'string' ? o['id'] : undefined
		return cardId ?? id ?? '<unknown>'
	}
	return '<unknown>'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const errors: string[] = []
	const warnings: string[] = []

	const files = (await findJsonFiles(cardsDir)).sort()
	const counts = new Map<string, number>() // relCards -> card count
	const seenIds = new Map<string, { file: string; label: string }>()

	interface CardWithLocation {
		card: CardDef
		file: string
		relCards: string
		id: string
	}

	const allCards: CardWithLocation[] = []

	for (const file of files) {
		const rel = relative(process.cwd(), file)
		const relCards = relative(cardsDir, file).split('\\').join('/')
		// Crew board JSON is not card JSON (todo/13): the boards live under
		// cards/boards and are loaded separately by src/data/catalog.ts.
		if (relCards.startsWith('boards/')) continue
		// the solo Bots' Automated Command cards are not card JSON (BotArraySchema,
		// parsed by the catalog loader)
		if (relCards === 'solo/bots.json') continue
		let text: string
		try {
			text = await readFile(file, 'utf8')
		} catch (err) {
			errors.push(`${rel}:<file>: cannot read: ${String(err)}`)
			continue
		}

		let raw: unknown
		try {
			raw = JSON.parse(text)
		} catch (err) {
			errors.push(`${rel}:<file>: invalid JSON: ${String(err)}`)
			continue
		}

		const parsed = CardArraySchema.safeParse(raw)
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				// A leading numeric path segment means "card index within the array";
				// drop it — the cardId already identifies the card.
				const hasIndex = typeof issue.path[0] === 'number'
				const index = hasIndex ? (issue.path[0] as number) : -1
				const id =
					Array.isArray(raw) && index >= 0 ? cardLabel(raw[index]) : '<file>'
				const where = (hasIndex ? issue.path.slice(1) : issue.path)
					.map((segment) =>
						typeof segment === 'number' ? `[${segment}]` : segment,
					)
					.join('.')
				const prefix =
					where.length > 0 ? `${rel}:${id}: ${where}: ` : `${rel}:${id}: `
				errors.push(`${prefix}${issue.message}`)
			}
			continue
		}

		const cards = parsed.data
		counts.set(relCards, cards.length)
		for (const card of cards) {
			allCards.push({ card, file: rel, relCards, id: card.cardId ?? card.id })
		}
	}

	// ---- global ID uniqueness ----
	for (const { card, file, id } of allCards) {
		const prior = seenIds.get(card.id)
		if (prior) {
			errors.push(
				`${file}:${id}: duplicate card id "${card.id}" (first seen in ${prior.file} as ${prior.label})`,
			)
		} else {
			seenIds.set(card.id, { file, label: id })
		}
	}

	// ---- per-card warns & file↔group consistency ----
	for (const { card, file, relCards, id } of allCards) {
		if (
			card.traits.includes('ATTACK') &&
			!card.operations.some((o) => o.isAttack)
		) {
			warnings.push(
				`${file}:${id}: trait ATTACK present but no operation has isAttack: true (rules/05 §5.2.2)`,
			)
		}
		for (const trait of card.traits) {
			if (NOT_IN_THIS_BOX.has(trait)) {
				warnings.push(
					`${file}:${id}: trait ${trait} is not used in this box (rules/12 §12.30)`,
				)
			}
			if (NOT_IN_THIS_BOX_TRAITS.has(trait)) {
				warnings.push(
					`${file}:${id}: trait ${trait} is solo-play only (rules/12 §12.30)`,
				)
			}
		}
		if (NOT_IN_THIS_BOX_SUITS.has(card.suit)) {
			warnings.push(
				`${file}:${id}: suit ${card.suit} is not used in this box (rules/12 §12.30)`,
			)
		}

		const group = GROUPS.find((g) => g.file === relCards)
		if (group === undefined) {
			warnings.push(
				`${file}:${id}: file is outside the 14 counted groups (expected counts do not cover it)`,
			)
		} else if (group.file.startsWith('common/')) {
			if (card.deck !== 'COMMON') {
				warnings.push(
					`${file}:${id}: deck ${card.deck} does not match the common/ file grouping`,
				)
			}
			const expectedSuit = group.file
				.replace('common/', '')
				.replace('.json', '')
				.toUpperCase()
			// The Stardate group has no single suit (DIRECTIVE faces) — skip the check.
			if (expectedSuit !== 'STARDATE' && card.suit !== expectedSuit) {
				warnings.push(
					`${file}:${id}: suit ${card.suit} does not match the ${expectedSuit} file grouping`,
				)
			}
		} else if (card.deck !== group.label) {
			warnings.push(
				`${file}:${id}: deck ${card.deck} does not match the ${group.label} file grouping`,
			)
		}
	}

	// ---- count report: all 14 expected groups, actual / expected ----
	const width = Math.max(...GROUPS.map((g) => g.label.length), 5)
	for (const group of GROUPS) {
		const actual = counts.get(group.file) ?? 0
		console.log(
			`COUNT  ${group.label.padEnd(width)}  ${actual} / ${group.expected}`,
		)
	}
	for (const [file, count] of [...counts.entries()].sort()) {
		if (GROUPS.some((g) => g.file === file)) continue
		console.log(`COUNT  ${file.padEnd(width)}  ${count} / 0`)
	}

	const total = [...counts.values()].reduce((a, b) => a + b, 0)
	console.log(`COUNT  ${'TOTAL'.padEnd(width)}  ${total} / ${OVERALL_EXPECTED}`)
	console.log('')
	console.log(
		`CARD VALIDATION: ${errors.length} error(s), ${warnings.length} warning(s)`,
	)

	for (const warning of warnings) console.warn(`WARN  ${warning}`)
	for (const error of errors) console.error(`ERROR ${error}`)

	if (errors.length > 0) process.exitCode = 1
}

void main()
