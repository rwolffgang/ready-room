// Copies the rendered faces of the fan-made custom packs into the desktop app's
// data folder, next to its STCC download. The installers never ship them (they
// stay local, like public/custom/), so a desktop app on this machine shows them
// only after this, and again after each re-render:
//
//   npm run custom-cards:desktop                       # every rendered pack
//   npx tsx tools/custom/install-desktop.ts atlantis   # just one
//
// Under <app data>/stcc/ the layout mirrors the repo, and the app reads it at
// startup (src/ui/stcc.ts `loadStccFrom`):
//   vendor/custom/<pack>.images.json   card number → face
//   public/custom/<pack>/              the faces that map names
// Restart the app to pick them up. Deleting those two removes them again.

import { existsSync } from 'node:fs'
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCustomImageMap } from '../../src/data/stcc'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const MAPS = join(ROOT, 'vendor', 'custom')
const FACES = join(ROOT, 'public', 'custom')

/** Tauri's app-data folder for the app's identifier (src-tauri/tauri.conf.json). */
async function appDataDir(): Promise<string> {
	const conf = JSON.parse(
		await readFile(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
	) as { identifier: string }
	if (process.platform === 'darwin')
		return join(homedir(), 'Library', 'Application Support', conf.identifier)
	if (process.platform === 'win32')
		return join(
			process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
			conf.identifier,
		)
	return join(
		process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
		conf.identifier,
	)
}

async function renderedPacks(): Promise<string[]> {
	if (!existsSync(MAPS)) return []
	return (await readdir(MAPS))
		.filter((f) => f.endsWith('.images.json'))
		.map((f) => f.slice(0, -'.images.json'.length))
}

async function main(): Promise<void> {
	const named = process.argv.slice(2).filter((a) => !a.startsWith('--'))
	const packs = named.length > 0 ? named : await renderedPacks()
	if (packs.length === 0)
		throw new Error('No rendered packs: run `npm run custom-cards` first.')
	const target = join(await appDataDir(), 'stcc')

	for (const pack of packs) {
		const mapFile = join(MAPS, `${pack}.images.json`)
		if (!existsSync(mapFile))
			throw new Error(`${pack}: no face map, render it first (${mapFile})`)
		const map = parseCustomImageMap(JSON.parse(await readFile(mapFile, 'utf8')))
		if (map === null) throw new Error(`${pack}: ${mapFile} is not a face map`)
		const files = Object.values(map)
		for (const file of files)
			if (!existsSync(join(FACES, file)))
				throw new Error(`${pack}: ${file} is missing from public/custom/`)

		// replace the pack wholesale, so faces dropped from the map go too
		await rm(join(target, 'public', 'custom', pack), {
			recursive: true,
			force: true,
		})
		for (const file of files) {
			const to = join(target, 'public', 'custom', file)
			await mkdir(dirname(to), { recursive: true })
			await copyFile(join(FACES, file), to)
		}
		await mkdir(join(target, 'vendor', 'custom'), { recursive: true })
		await writeFile(
			join(target, 'vendor', 'custom', `${pack}.images.json`),
			`${JSON.stringify(map, null, '\t')}\n`,
		)
		console.log(`${pack}: ${files.length} faces`)
	}
	console.log(`→ ${target}`)
	console.log('Restart the desktop app to see them.')
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
})
