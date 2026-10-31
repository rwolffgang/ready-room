// Publish audit: fails if the git index would ship copyrighted material.
//
// The card scans, printed rules text, icons and rulebook are © WizKids/CBS;
// this repo ships only code plus `npm run fetch-cards` (tools/fetch-stcc.ts),
// which pulls the STCC database onto each player's machine. This gate keeps it
// that way:
//   - no tracked images or PDFs (outside an explicit allowlist of our own art)
//   - nothing tracked under the fetched / local-only folders
//   - no printed `text` on card-def operations (src/data/cards, tools/scratch)
//   - no card names in code, tests or card data: cards are referenced by id
//     and named at runtime from STCC (src/data/cardNames.ts). Checked against
//     the fetched STCC names, so it is skipped when nothing has been fetched.
//
// Run: `npx tsx tools/audit-publish.ts` (also part of `npm run build`).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TRAITS } from '../src/data/ids'
import { VENDOR_DIR, loadStccNode } from './stcc-node'

/** Images that may be tracked (paths relative to the repo root). The README
 *  screenshots are taken without fetched STCC data (card ids and our own glyph
 *  drawings only), except board-stcc-cards.png: one deliberate, low-resolution
 *  illustration of the fetched card faces, with a disclaimer in the README. */
const ALLOWED_BINARIES = new Set<string>([
	'docs/screenshots/board-stcc-cards.png',
	'docs/screenshots/board-desktop.png',
	'docs/screenshots/board-phone.png',
	'docs/screenshots/shorthand.png',
	// desktop app icon, rendered from public/icon.svg (`npx tauri icon`)
	'src-tauri/icons/32x32.png',
	'src-tauri/icons/128x128.png',
	'src-tauri/icons/128x128@2x.png',
	'src-tauri/icons/icon.png',
	'src-tauri/icons/icon.icns',
	'src-tauri/icons/icon.ico',
])

const BINARY = /\.(png|jpe?g|gif|webp|bmp|tiff?|pdf|psd|icns|ico)$/i
const LOCAL_ONLY = [
	'node_modules/',
	'vendor/stcc/',
	'public/stcc/',
	'vendor/custom/',
	'public/custom/',
	'cards/',
	'tts/',
	'tmp/',
	'rules/pdf/',
	'src-tauri/target/',
]
const CARD_JSON =
	/^(src\/data\/cards\/(?!boards\/).*|tools\/scratch\/.*)\.json$/

/** Lower-case words: camelCase split, punctuation → single spaces. */
function normalise(s: string): string {
	return s
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

/** Where card names must not appear (code and data; docs are out of scope). */
const NAME_SCOPE = [
	'src/',
	'server/',
	'tools/',
	'public/',
	'src-tauri/',
	'index.html',
]

/** STCC names that are plain English or game vocabulary, not Star Trek names —
 *  they may appear in code. Normalised (see `normalise`). Trait ids (VULCAN,
 *  ORION …) are allowed too: they are rule keywords the engine matches on. */
const GENERIC_NAMES = new Set<string>([
	'advisory',
	'ana', // a player name in tests
	'analyze',
	'data',
	'diplomacy',
	'energy drain',
	'first contact',
	'fleet', // surnames that are plain words ("… the Dahar Master")
	'master',
	'witness',
	'grudge',
	'hostile contact',
	'inspire',
	'political crisis',
	'recover',
	'recruit',
	'red alert',
	'sabotage',
	'second contact',
	'set a course',
	'subspace phenomenon',
	'utilize',
	...TRAITS.map((t) => normalise(t)),
])

/** One regex over every STCC card / mission name, longest first — plus the
 *  surname of every PERSON / CAPTAIN and the part of a name before a comma:
 *  both are names on their own. */
async function nameMatcher(): Promise<RegExp | null> {
	if (!existsSync(join(VENDOR_DIR, 'box1.json'))) return null
	const names = new Set<string>()
	const add = (n: string) => {
		if (n.length >= 3 && !GENERIC_NAMES.has(n)) names.add(n)
	}
	for (const card of (await loadStccNode({ custom: false })).values()) {
		const n = normalise(card.name)
		add(n)
		// "Name (Deck)" — the bare name is a name on its own too
		if (card.name.includes('('))
			add(normalise(card.name.replace(/\s*\(.*?\)/g, '')))
		if (card.name.includes(',')) add(normalise(card.name.split(',')[0]!))
		const words = n.split(' ')
		if (/^(person|captain)$/i.test(card.suit) && words.length > 1)
			add(words[words.length - 1]!)
	}
	const alts = [...names]
		.sort((a, b) => b.length - a.length)
		.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	return new RegExp(`(?:^| )(${alts.join('|')})(?= |$)`)
}

function nameHits(file: string, re: RegExp, out: string[]): void {
	let text: string
	try {
		text = readFileSync(file, 'utf8')
	} catch {
		return // deleted in the working tree
	}
	const inPath = re.exec(normalise(file))
	if (inPath !== null) out.push(`${file}: card name "${inPath[1]}" in the path`)
	text.split('\n').forEach((line, i) => {
		const m = re.exec(normalise(line))
		if (m !== null) out.push(`${file}:${i + 1}: card name "${m[1]}"`)
	})
}

function tracked(): string[] {
	return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
		.split('\0')
		.filter(Boolean)
}

function opsWithText(value: unknown, path: string, out: string[]): void {
	if (Array.isArray(value)) {
		value.forEach((v, i) => opsWithText(v, `${path}[${i}]`, out))
		return
	}
	if (value === null || typeof value !== 'object') return
	const obj = value as Record<string, unknown>
	if (Array.isArray(obj['operations'])) {
		obj['operations'].forEach((op, i) => {
			if (op !== null && typeof op === 'object' && 'text' in op)
				out.push(`${path}.operations[${i}].text`)
		})
	}
}

async function main(): Promise<void> {
	const errors: string[] = []
	const names = await nameMatcher()
	if (names === null)
		console.log('PUBLISH AUDIT: name scan skipped (no STCC data fetched)')
	for (const file of tracked()) {
		if (
			names !== null &&
			NAME_SCOPE.some((p) => file.startsWith(p)) &&
			!BINARY.test(file) &&
			!file.endsWith('.md')
		)
			nameHits(file, names, errors)
		// the folder itself counts too: a worktree's symlink to it is a file
		if (
			LOCAL_ONLY.some(
				(dir) => file.startsWith(dir) || file === dir.slice(0, -1),
			)
		)
			errors.push(`${file}: local-only folder is tracked`)
		else if (BINARY.test(file) && !ALLOWED_BINARIES.has(file))
			errors.push(`${file}: image/PDF is tracked`)
		if (CARD_JSON.test(file)) {
			const hits: string[] = []
			try {
				opsWithText(JSON.parse(readFileSync(file, 'utf8')), '', hits)
			} catch {
				continue // deleted in the working tree, or not JSON we understand
			}
			for (const h of hits)
				errors.push(`${file}:${h}: printed card text in card data`)
		}
	}
	if (errors.length > 0) {
		console.error(
			`PUBLISH AUDIT: ${errors.length} problem(s)\n  ${errors.slice(0, 50).join('\n  ')}`,
		)
		process.exit(1)
	}
	console.log('PUBLISH AUDIT: clean')
}

await main()
