// Fetches the STCC card database (https://periodic-agent.github.io/stcc-strategy/)
// onto this machine: card JSON, errata/FAQ, card scans and the cardface icon set.
//
// Environment-neutral: the Node CLI (tools/fetch-stcc.ts) and the desktop app
// (src/desktop/) supply the IO. Paths are logical — `vendor/…` for the JSON the
// app reads, `public/…` for the files it serves (scans, icons) — and each host
// maps them to its own folders.
//
// The upstream repo carries no license and the card scans are © WizKids, so
// nothing fetched here is ever committed or shipped: every player pulls their
// own copy. Re-runnable: scans already on disk are skipped.

import { STCC_BOXES } from './stcc'

const DATA_FILES = ['errata', 'faq', 'tokens', 'bots'] as const
// Be gentle with their host.
const CONCURRENCY = 6

export interface StccSource {
	repo: string
	site: string
	sha: string
}

export interface StccManifest {
	repo: string
	sha: string
	fetchedAt: string
	cards: Record<string, number>
	/** scans on disk */
	images: number
	/** scans the boxes reference */
	imagesTotal: number
	icons: number
	/** Bots in data/bots.json; absent in a fetch from before the solo mode,
	 *  which therefore counts as out of date (stccUpToDate). */
	bots?: number
}

export interface StccIo {
	fetchText(url: string): Promise<string>
	/** Fetch `url` and write the body to `rel`. */
	download(url: string, rel: string): Promise<void>
	writeText(rel: string, text: string): Promise<void>
	writeBytes(rel: string, bytes: Uint8Array): Promise<void>
	exists(rel: string): Promise<boolean>
}

export interface StccProgress {
	phase: 'data' | 'icons' | 'images'
	done: number
	total: number
}

export interface StccFetchResult {
	manifest: StccManifest
	/** scans fetched in this run */
	fetched: number
	failed: string[]
}

/** Transient upstream errors carry a 5xx status in their message. */
function isTransient(e: unknown): boolean {
	return /\b5\d\d\b/.test(String(e))
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn()
		} catch (e) {
			// raw.githubusercontent.com throws the odd transient 5xx; back off and retry.
			if (!isTransient(e) || i >= attempts) throw e
			await new Promise((r) => setTimeout(r, 1000 * i))
		}
	}
}

async function pool<T>(
	items: T[],
	n: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0
	const worker = async () => {
		while (next < items.length) await fn(items[next++] as T)
	}
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

/** `const CARDFACE={group: {name: dataUri}}` — the object literal is plain
 *  JSON, so it is parsed, never evaluated. */
export function parseCardface(
	js: string,
): Record<string, Record<string, string>> {
	const start = js.indexOf('{')
	const end = js.lastIndexOf('}')
	if (
		!/^\s*(?:const|var|let)\s+CARDFACE\s*=/.test(js) ||
		start < 0 ||
		end < start
	)
		throw new Error('cardface-assets.js: unexpected format')
	return JSON.parse(js.slice(start, end + 1)) as Record<
		string,
		Record<string, string>
	>
}

function decodeBase64(b64: string): Uint8Array {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

export function rawUrl(source: StccSource, path: string): string {
	return `https://raw.githubusercontent.com/${source.repo}/${source.sha}/${path}`
}

export async function fetchStcc(
	source: StccSource,
	io: StccIo,
	opts: { now: () => string; onProgress?: (p: StccProgress) => void },
): Promise<StccFetchResult> {
	const raw = (path: string) => rawUrl(source, path)
	const progress = opts.onProgress ?? (() => {})
	const dataTotal = STCC_BOXES.length + DATA_FILES.length
	let dataDone = 0
	progress({ phase: 'data', done: 0, total: dataTotal })

	// Card JSON, one file per box.
	const images: { url: string; out: string }[] = []
	const counts: Record<string, number> = {}
	for (const box of STCC_BOXES) {
		const text = await retry(() => io.fetchText(raw(`${box}.json`)))
		await io.writeText(`vendor/${box}.json`, text)
		const cards = JSON.parse(text) as { filename?: string }[]
		counts[box] = cards.length
		for (const c of cards) {
			if (!c.filename) continue
			images.push({
				url: raw(`img/${box}/${c.filename}`),
				out: `public/img/${box}/${c.filename}`,
			})
		}
		progress({ phase: 'data', done: ++dataDone, total: dataTotal })
	}

	let bots = 0
	for (const name of DATA_FILES) {
		const text = await retry(() => io.fetchText(raw(`data/${name}.json`)))
		await io.writeText(`vendor/${name}.json`, text)
		if (name === 'bots') {
			const parsed = JSON.parse(text) as unknown
			bots = Array.isArray(parsed) ? parsed.length : 0
		}
		progress({ phase: 'data', done: ++dataDone, total: dataTotal })
	}

	// Cardface icons, decoded from data URIs into files.
	const cardface = parseCardface(
		await retry(() => io.fetchText(raw('cardface-assets.js'))),
	)
	const iconIndex: Record<string, string> = {}
	const iconEntries = Object.entries(cardface).flatMap(([group, entries]) =>
		Object.entries(entries).map(([name, uri]) => ({ group, name, uri })),
	)
	let iconsDone = 0
	for (const { group, name, uri } of iconEntries) {
		const m = /^data:image\/(\w+)(?:\+xml)?;base64,(.*)$/s.exec(uri)
		if (m) {
			const ext = m[1] === 'svg' ? 'svg' : (m[1] ?? 'png')
			await io.writeBytes(
				`public/icons/${group}/${name}.${ext}`,
				decodeBase64(m[2] ?? ''),
			)
			iconIndex[`${group}/${name}`] = `icons/${group}/${name}.${ext}`
		}
		progress({ phase: 'icons', done: ++iconsDone, total: iconEntries.length })
	}
	// "group/name" → path under public/, for the UI (formats vary: svg/png).
	await io.writeText(
		'vendor/icons.json',
		JSON.stringify(iconIndex, null, 2) + '\n',
	)
	const icons = Object.keys(iconIndex).length

	// Card scans, skipping any already on disk.
	const missing: typeof images = []
	for (const img of images) if (!(await io.exists(img.out))) missing.push(img)
	const failed: string[] = []
	let done = 0
	progress({ phase: 'images', done: 0, total: missing.length })
	await pool(missing, CONCURRENCY, async (img) => {
		try {
			await retry(() => io.download(img.url, img.out))
		} catch (e) {
			failed.push(String(e))
		}
		progress({ phase: 'images', done: ++done, total: missing.length })
	})

	const manifest: StccManifest = {
		repo: source.repo,
		sha: source.sha,
		fetchedAt: opts.now(),
		cards: counts,
		images: images.length - failed.length,
		imagesTotal: images.length,
		icons,
		bots,
	}
	await io.writeText(
		'vendor/manifest.json',
		JSON.stringify(manifest, null, 2) + '\n',
	)
	return { manifest, fetched: missing.length - failed.length, failed }
}

/** Whether a stored manifest is a complete fetch of `source`. */
export function stccUpToDate(
	manifest: StccManifest | null,
	source: StccSource,
): boolean {
	return (
		manifest !== null &&
		manifest.sha === source.sha &&
		manifest.bots !== undefined &&
		manifest.imagesTotal !== undefined &&
		manifest.images >= manifest.imagesTotal
	)
}
