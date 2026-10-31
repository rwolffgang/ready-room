// Catalog loader (todo/12 §4): turns the card JSON files on disk into the
// `CardCatalog` shape `setup()` consumes (src/engine/setup.ts). Every card
// JSON under `src/data/cards/**/*.json` (excluding the `boards/` directory,
// which is not card JSON — todo/13) is parsed with `CardArraySchema`; a
// malformed or schema-invalid card is a hard failure —
// `tools/validate-cards.ts` is the authoring-time gate, and this loader is the
// runtime gate so a title bug can never silently void a card at game start.
//
// Crew boards (todo/13) live in `src/data/cards/boards/*.json` as
// `CrewBoardSide[]` (one object per BASIC/ADVANCED side). They parse with
// `BoardArraySchema` and land in `catalog.boards` keyed by deck, with the
// missions flattened into the `BoardMissions` shape `setup()` consumes.
//
//   const catalog = await loadCatalog()           // src/data/cards only
//   const withExtra = await loadCatalog(['tools/scratch/dryrun'])  // + scratch
//
// Stardate cards (todo/12 pass 3): common/stardate.json is parsed with
// CardArraySchema like every other card file, but its 32 faces are wrapped into
// `StardateSpec[]` (the sequence/glory/modes live in src/data/stardate.ts, not
// the static CardDef schema) and land in `catalog.stardates` — NOT in `defs`,
// matching the fixture shape setup() consumes.

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CardCatalog } from '../engine/setup'
import { BotArraySchema, CardArraySchema } from './schema'
import type { BotCard, CardDef } from './schema'
import { BoardArraySchema, addBoardSides } from './boards'
import { stardateSpecs } from './stardate'

/** The on-disk root: `<repo>/src/data/cards`. */
const CARDS_ROOT = resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'cards',
)
/** Crew board side files — board JSON is not card JSON (todo/13). */
const BOARDS_DIR = join(CARDS_ROOT, 'boards')
/** The one Stardate deck file — parsed as CardDefs, wrapped into StardateSpecs. */
const STARDate_FILE_SUFFIX = join('common', 'stardate.json')
/** The solo Bots' Automated Command cards — not card JSON (BotArraySchema). */
const BOTS_FILE_SUFFIX = join('solo', 'bots.json')

/** Recursively list every `*.json` under `dir` (sorted, deterministic). */
async function* walkJson(dir: string): AsyncGenerator<string> {
	let entries
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch {
		return // missing/empty dir → nothing to load
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) yield* walkJson(path)
		else if (entry.isFile() && entry.name.endsWith('.json')) yield path
	}
}

export interface CatalogError {
	file: string // repo-relative path for a readable error message
	message: string
}

/** Parse every card JSON (and every crew board side) into a CardCatalog.
 *  Throws (with the full list) when any file fails to parse or validate. */
export async function loadCatalog(
	extraDirs: string[] = [],
): Promise<CardCatalog> {
	const defs: CardDef[] = []
	const stardates: CardCatalog['stardates'] = []
	const boards: CardCatalog['boards'] = {}
	const bots: BotCard[] = []
	const errors: CatalogError[] = []

	const parseCardFile = async (file: string): Promise<void> => {
		const rel = relative(resolve(CARDS_ROOT, '..', '..'), file)
		let raw: unknown
		try {
			raw = JSON.parse(await readFile(file, 'utf8'))
		} catch (err) {
			errors.push({
				file: rel,
				message: `unreadable JSON: ${(err as Error).message}`,
			})
			return
		}
		const parsed = CardArraySchema.safeParse(raw)
		if (!parsed.success) {
			errors.push({
				file: rel,
				message: `schema violation: ${parsed.error.issues.length} issue(s) — ${parsed.error.issues[0]?.path.join('.') ?? ''}`,
			})
			return
		}
		defs.push(...parsed.data)
	}

	const parseStardateFile = async (file: string): Promise<void> => {
		const rel = relative(resolve(CARDS_ROOT, '..', '..'), file)
		let raw: unknown
		try {
			raw = JSON.parse(await readFile(file, 'utf8'))
		} catch (err) {
			errors.push({
				file: rel,
				message: `unreadable JSON: ${(err as Error).message}`,
			})
			return
		}
		const parsed = CardArraySchema.safeParse(raw)
		if (!parsed.success) {
			errors.push({
				file: rel,
				message: `schema violation: ${parsed.error.issues.length} issue(s) — ${parsed.error.issues[0]?.path.join('.') ?? ''}`,
			})
			return
		}
		try {
			stardates.push(...stardateSpecs(parsed.data))
		} catch (err) {
			errors.push({ file: rel, message: (err as Error).message })
		}
	}

	// Card defs — the whole tree EXCEPT the boards directory.
	for (const dir of [CARDS_ROOT, ...extraDirs]) {
		for await (const file of walkJson(dir)) {
			if (file.startsWith(BOARDS_DIR + '/')) continue // boards are not cards
			if (file.endsWith(STARDate_FILE_SUFFIX)) {
				await parseStardateFile(file)
				continue
			}
			if (file.endsWith(BOTS_FILE_SUFFIX)) {
				const rel = relative(resolve(CARDS_ROOT, '..', '..'), file)
				const parsed = BotArraySchema.safeParse(
					JSON.parse(await readFile(file, 'utf8')),
				)
				if (parsed.success) bots.push(...parsed.data)
				else
					errors.push({
						file: rel,
						message: `bot schema violation: ${parsed.error.issues.length} issue(s) — ${parsed.error.issues[0]?.path.join('.') ?? ''}`,
					})
				continue
			}
			await parseCardFile(file)
		}
	}

	// Crew boards — keyed by deck, missions flattened into vp-less MissionState
	// (goal/reward deep-cloned per mission so no two missions alias the same
	// tree — assertSerialisable treats shared refs as a serialisation cycle).
	for await (const file of walkJson(BOARDS_DIR)) {
		const rel = relative(resolve(CARDS_ROOT, '..', '..'), file)
		let raw: unknown
		try {
			raw = JSON.parse(await readFile(file, 'utf8'))
		} catch (err) {
			errors.push({
				file: rel,
				message: `unreadable board JSON: ${(err as Error).message}`,
			})
			continue
		}
		const parsed = BoardArraySchema.safeParse(raw)
		if (!parsed.success) {
			errors.push({
				file: rel,
				message: `board schema violation: ${parsed.error.issues.length} issue(s) — ${parsed.error.issues[0]?.path.join('.') ?? ''}`,
			})
			continue
		}
		addBoardSides(boards, parsed.data)
	}

	if (errors.length > 0) {
		const detail = errors.map((e) => `${e.file}: ${e.message}`).join('\n  ')
		throw new Error(
			`catalog load failed (${errors.length} file(s)):\n  ${detail}`,
		)
	}
	return { defs, stardates, boards, bots }
}
