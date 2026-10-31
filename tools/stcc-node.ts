// Node-side loader for the fetched STCC data (vendor/stcc/, see tools/fetch-stcc.ts).
// Returns an empty index when nothing has been fetched. Also installs the
// index as the card-name source (src/data/cardNames.ts). Fan-made custom packs
// (src/data/custom/, with their locally rendered art map) join it too.

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	STCC_BOXES,
	addCustomPacks,
	buildStccIndex,
	parseStccBots,
	type StccBot,
	type StccBox,
	type StccCard,
} from '../src/data/stcc'
import { setCardNameIndex } from '../src/data/cardNames'

/** The fetched Automated Command card text (vendor/stcc/bots.json) by STCC bot
 *  id, or an empty map when it hasn't been fetched. */
export async function loadStccBotsNode(): Promise<Map<string, StccBot>> {
	try {
		return parseStccBots(
			JSON.parse(await readFile(join(VENDOR_DIR, 'bots.json'), 'utf8')),
		)
	} catch {
		return new Map()
	}
}

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

export const VENDOR_DIR = join(ROOT, 'vendor', 'stcc')

/** Fan-made custom packs (src/data/custom/) and their local art map. */
const CUSTOM_DIR = join(ROOT, 'src', 'data', 'custom')
const CUSTOM_IMAGES_DIR = join(ROOT, 'vendor', 'custom')

async function readJsonDir(dir: string, suffix: string): Promise<unknown[]> {
	let names: string[]
	try {
		names = (await readdir(dir)).filter((n) => n.endsWith(suffix)).sort()
	} catch {
		return []
	}
	return Promise.all(
		names.map(
			async (n) => JSON.parse(await readFile(join(dir, n), 'utf8')) as unknown,
		),
	)
}

/** Load the fetched STCC data, plus the custom packs unless `custom: false`
 *  (the publish audit checks against real STCC names only). */
export async function loadStccNode({
	custom = true,
}: { custom?: boolean } = {}): Promise<Map<string, StccCard>> {
	const boxes: Partial<Record<StccBox, unknown>> = {}
	for (const box of STCC_BOXES) {
		try {
			boxes[box] = JSON.parse(
				await readFile(join(VENDOR_DIR, `${box}.json`), 'utf8'),
			)
		} catch {
			// not fetched
		}
	}
	const index = buildStccIndex(boxes)
	if (custom) {
		const images = Object.assign(
			{},
			...((await readJsonDir(CUSTOM_IMAGES_DIR, '.images.json')) as Record<
				string,
				string
			>[]),
		) as Record<string, string>
		addCustomPacks(index, await readJsonDir(CUSTOM_DIR, '.json'), images)
	}
	setCardNameIndex(index)
	return index
}
