// Renders the card faces of a fan-made custom pack (src/data/custom/<pack>.json)
// with the card template (tools/custom/card-template.html) and headless Chrome.
//
//   npm run custom-cards                    # the Firefly pack
//   npx tsx tools/custom/render-cards.ts firefly --force   # re-download art
//
// Art sources are listed in tools/custom/<pack>-art.json. Everything fetched or
// rendered stays local (gitignored), like the STCC data:
//   vendor/custom/<pack>/art/        downloaded source images (+ credits.json)
//   vendor/custom/<pack>/likeness/   stills you saved yourself (`file:likeness/…`)
//   vendor/custom/<pack>/override/   your own images, by art key — they win;
//                                    override/faces/<1MAL01-25>.jpg = a whole face
//   public/custom/<pack>/            the rendered faces + template-blank.png
//   vendor/custom/<pack>.images.json card number → face, read by the loaders
// The game icons come from the fetched STCC data (`npm run fetch-cards`).

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GAMEPLAY_TRAITS, SPECIES_TRAITS } from '../../src/data/ids'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const PACK = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'firefly'
const FORCE = process.argv.includes('--force')

const TEMPLATE = join(ROOT, 'tools', 'custom', 'card-template.html')
const ICONS = join(ROOT, 'public', 'stcc', 'icons')
const WORK = join(ROOT, 'vendor', 'custom', PACK)
const ART_DIR = join(WORK, 'art')
const OVERRIDE_DIR = join(WORK, 'override')
const HTML_DIR = join(WORK, 'html')
const OUT_DIR = join(ROOT, 'public', 'custom', PACK)
const IMAGE_MAP = join(ROOT, 'vendor', 'custom', `${PACK}.images.json`)

const CHROME =
	process.env.CHROME_PATH ??
	[
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
	].find((p) => existsSync(p))

const UA =
	'ReadyRoomCustomCards/0.1 (fan-made deck renderer; https://github.com/rwolffgang/ready-room)'

interface PackCard {
	name: string
	suit: string
	card_number: string
	position_indicator?: string
	glory?: number | null
	species_traits?: string[]
	regular_traits?: string[]
	other_traits?: string[]
	icons?: { type: string; specialty: string }[]
	away_team?: string
	text: Record<string, string>
	flavor?: string
	art?: string
}
interface ArtSpec {
	source: string
	search?: string
	position?: string
	size?: string
	backdrop?: string
	/** pre-crop the download to [left, top, right, bottom] fractions (a face
	 *  out of a wider still, so the prompt kit's likeness is tight too) */
	crop?: [number, number, number, number]
	subject?: string
}
interface Fetched {
	file: string
	credit: string
	source?: string
	crop?: string | undefined
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson(url: string): Promise<unknown> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: { 'User-Agent': UA } })
		if (res.ok) return res.json()
		if (attempt >= 4) throw new Error(`${res.status} for ${url}`)
		await sleep(3000 * (attempt + 1))
	}
}

const stripHtml = (s: string) =>
	s
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim()

interface ImageInfo {
	url: string
	thumburl?: string
	extmetadata?: Record<string, { value: string }>
}

/** Resolve `commons:File:…` / `enwiki:File:…` / `tmdb:<image id>` to a
 *  downloadable URL + credit. */
async function resolveSource(
	source: string,
	search?: string,
): Promise<{ url: string; credit: string; ext: string }> {
	const [wiki, title] = source.split(/:(.*)/s) as [string, string]
	if (wiki === 'tmdb')
		return {
			url: `https://image.tmdb.org/t/p/original/${title}`,
			credit: 'Still © its owner, via TMDB (non-free, local use only)',
			ext: 'jpg',
		}
	const host = wiki === 'enwiki' ? 'en.wikipedia.org' : 'commons.wikimedia.org'
	const api = (params: string) =>
		`https://${host}/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=1400&${params}`
	type Pages = {
		query?: { pages?: Record<string, { imageinfo?: ImageInfo[] }> }
	}
	let pages = (
		(await getJson(api(`titles=${encodeURIComponent(title)}`))) as Pages
	).query?.pages
	let info = Object.values(pages ?? {})[0]?.imageinfo?.[0]
	if (info === undefined && search !== undefined) {
		pages = (
			(await getJson(
				api(
					`generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent(search)}`,
				),
			)) as Pages
		).query?.pages
		info = Object.values(pages ?? {})[0]?.imageinfo?.[0]
	}
	if (info === undefined) throw new Error(`no image for ${source}`)
	const url = info.thumburl ?? info.url
	const meta = info.extmetadata ?? {}
	const artist = stripHtml(meta['Artist']?.value ?? '')
	const license = stripHtml(meta['LicenseShortName']?.value ?? '')
	const credit =
		wiki === 'enwiki'
			? 'Still © its owner, via Wikipedia (non-free, local use only)'
			: `Image: ${artist || 'Wikimedia Commons'}${license ? `, ${license}` : ''}`
	const ext = (
		/\.(jpe?g|png|webp|gif)(?:$|\?)/i.exec(url)?.[1] ?? 'jpg'
	).toLowerCase()
	return { url, credit, ext }
}

async function fetchArt(
	key: string,
	source: string,
	search: string | undefined,
	credits: Record<string, Fetched>,
	crop?: ArtSpec['crop'],
): Promise<Fetched> {
	const known = credits[key]
	const fresh = known?.source === source && known.crop === crop?.join(',')
	if (!FORCE && fresh && existsSync(join(ART_DIR, known.file))) return known
	let file: string
	let credit: string
	if (source.startsWith('file:')) {
		// an image you saved yourself, under vendor/custom/<pack>/
		const src = join(WORK, source.slice('file:'.length))
		file = `${key}.${src.split('.').pop() ?? 'jpg'}`
		await copyFile(src, join(ART_DIR, file))
		credit = 'Still © its owner (non-free, local use only)'
	} else {
		const resolved = await resolveSource(source, search)
		const res = await fetch(resolved.url, { headers: { 'User-Agent': UA } })
		if (!res.ok) throw new Error(`${res.status} downloading ${resolved.url}`)
		file = `${key}.${resolved.ext}`
		credit = resolved.credit
		await writeFile(join(ART_DIR, file), Buffer.from(await res.arrayBuffer()))
	}
	if (crop !== undefined) cropImage(join(ART_DIR, file), crop)
	credits[key] = { file, credit, source, crop: crop?.join(',') }
	console.log(`  fetched ${key} ← ${source}`)
	await sleep(1000)
	return credits[key]!
}

/** Crop an image in place with macOS `sips` (fractions of its size). */
function cropImage(
	path: string,
	[l, t, r, b]: [number, number, number, number],
): void {
	const dims = execFileSync(
		'sips',
		['-g', 'pixelWidth', '-g', 'pixelHeight', path],
		{
			encoding: 'utf8',
		},
	)
	const w = Number(/pixelWidth: (\d+)/.exec(dims)?.[1])
	const h = Number(/pixelHeight: (\d+)/.exec(dims)?.[1])
	const [cw, ch] = [Math.round((r - l) * w), Math.round((b - t) * h)]
	execFileSync(
		'sips',
		[
			'-c',
			String(ch),
			String(cw),
			'--cropOffset',
			String(Math.round(t * h)),
			String(Math.round(l * w)),
			path,
		],
		{ stdio: 'ignore' },
	)
}

/** A whole finished face (e.g. from the prompt kit) used as-is:
 *  vendor/custom/<pack>/override/faces/<1MAL01-25>.<jpg|png>. */
async function finishedFace(name: string): Promise<string | null> {
	for (const ext of ['jpg', 'png']) {
		const src = join(OVERRIDE_DIR, 'faces', `${name}.${ext}`)
		if (existsSync(src)) {
			const out = join(OUT_DIR, `${name}.${ext}`)
			await copyFile(src, out)
			return out
		}
	}
	return null
}

async function override(key: string): Promise<string | null> {
	try {
		const hit = (await readdir(OVERRIDE_DIR)).find((f) =>
			new RegExp(`^${key}\\.(jpe?g|png|webp)$`, 'i').test(f),
		)
		return hit === undefined ? null : join(OVERRIDE_DIR, hit)
	} catch {
		return null
	}
}

/** `TIME_TRAVEL` → `time travel`, the spelling of the text's `[[tokens]]`. */
const traitKey = (id: string): string => id.toLowerCase().replace(/_/g, ' ')

const SPEC: Record<string, string> = {
	Research: 'research',
	Influence: 'influence',
	Military: 'military',
	Any: 'any',
}

function screenshot(html: string, png: string, attempt = 0): void {
	try {
		chrome(html, png)
	} catch (err) {
		// a headless Chrome now and then never exits; kill it and try again
		if (attempt >= 2) throw err
		screenshot(html, png, attempt + 1)
	}
}

function chrome(html: string, png: string): void {
	execFileSync(
		CHROME!,
		[
			'--headless=new',
			'--disable-gpu',
			'--hide-scrollbars',
			'--force-device-scale-factor=2',
			'--window-size=585,818',
			'--default-background-color=00000000',
			'--virtual-time-budget=8000',
			'--allow-file-access-from-files',
			`--screenshot=${png}`,
			`--user-data-dir=${join(WORK, 'chrome-profile')}`,
			pathToFileURL(html).href,
		],
		{ stdio: 'ignore', timeout: 45_000, killSignal: 'SIGKILL' },
	)
}

/** PNG → JPEG with macOS `sips` when available (≈10× smaller); else keep PNG. */
function compress(png: string): string {
	const jpg = png.replace(/\.png$/, '.jpg')
	try {
		execFileSync(
			'sips',
			['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', png, '--out', jpg],
			{ stdio: 'ignore' },
		)
		return jpg
	} catch {
		return png
	}
}

async function main(): Promise<void> {
	if (CHROME === undefined)
		throw new Error('Chrome/Chromium not found — set CHROME_PATH')
	if (!existsSync(join(ICONS, 'suit', 'person.svg')))
		throw new Error('STCC icons missing — run `npm run fetch-cards` first')

	const pack = JSON.parse(
		await readFile(join(ROOT, 'src', 'data', 'custom', `${PACK}.json`), 'utf8'),
	) as { cards: PackCard[] }
	const arts = (
		JSON.parse(
			await readFile(join(ROOT, 'tools', 'custom', `${PACK}-art.json`), 'utf8'),
		) as { art: Record<string, ArtSpec> }
	).art

	for (const dir of [ART_DIR, HTML_DIR, OUT_DIR])
		await mkdir(dir, { recursive: true })
	const creditsFile = join(ART_DIR, 'credits.json')
	const credits: Record<string, Fetched> = existsSync(creditsFile)
		? (JSON.parse(await readFile(creditsFile, 'utf8')) as Record<
				string,
				Fetched
			>)
		: {}

	// the trait groups colour the trait tags and the trait chips in the text
	const traitGroup: Record<string, string> = {}
	for (const t of SPECIES_TRAITS) traitGroup[traitKey(t)] = 'species'
	for (const t of GAMEPLAY_TRAITS)
		traitGroup[traitKey(t)] = t === 'WILDCARD' ? 'variable' : 'other'

	const template = await readFile(TEMPLATE, 'utf8')
	const render = async (data: unknown, name: string): Promise<string> => {
		const inject = `<script>window.ICON_BASE=${JSON.stringify(pathToFileURL(ICONS).href)};window.TRAIT_GROUP=${JSON.stringify(traitGroup)};window.CARD=${JSON.stringify(data)}</script>`
		const html = join(HTML_DIR, `${name}.html`)
		await writeFile(html, template.replace('<body>', `<body>${inject}`))
		const png = join(OUT_DIR, `${name}.png`)
		screenshot(html, png)
		const out = compress(png)
		if (out !== png) await rm(png, { force: true })
		return out
	}

	console.log(`blank template → ${await render(null, 'template-blank')}`)

	const images: Record<string, string> = {}
	for (const card of pack.cards) {
		if (card.suit === 'Mission') continue
		let art: string | null = null
		let artFull = false
		let backdrop: string | null = null
		let credit = ''
		const spec = card.art !== undefined ? arts[card.art] : undefined
		if (card.art !== undefined) {
			const own = await override(card.art)
			if (own !== null) {
				art = pathToFileURL(own).href
				artFull = true
			} else if (spec !== undefined) {
				const got = await fetchArt(
					card.art,
					spec.source,
					spec.search,
					credits,
					spec.crop,
				)
				art = pathToFileURL(join(ART_DIR, got.file)).href
				credit = got.credit
				if (spec.backdrop !== undefined) {
					const bg = await fetchArt(
						`${card.art}-backdrop`,
						spec.backdrop,
						undefined,
						credits,
					)
					backdrop = pathToFileURL(join(ART_DIR, bg.file)).href
					credit += ` · ${bg.credit}`
				}
			}
			await writeFile(creditsFile, JSON.stringify(credits, null, '\t'))
		}
		const traits = [
			...(card.species_traits ?? []),
			...(card.regular_traits ?? []),
			...(card.other_traits ?? []),
		]
		const data = {
			name: card.name,
			suit: card.suit,
			number: card.card_number,
			position: card.position_indicator ?? '',
			vp: typeof card.glory === 'number' ? card.glory : 0,
			awayTeams: card.away_team,
			traits,
			skills: (card.icons ?? [])
				.filter((i) => i.type === 'Skill')
				.map((i) => SPEC[i.specialty]),
			focus:
				(card.icons ?? [])
					.filter((i) => i.type === 'Focus')
					.map((i) => SPEC[i.specialty])[0] ?? null,
			text: card.text,
			flavor: card.flavor,
			art,
			backdrop,
			artFull,
			artPosition: artFull ? '50% 0%' : spec?.position,
			artSize: artFull ? 'cover' : spec?.size,
			credit: `Fan-made card · not affiliated with any rights holder${artFull ? ' · Art: generated with ChatGPT' : credit ? ` · ${credit}` : ''}`,
		}
		const name = card.card_number.replace('/', '-')
		const out = (await finishedFace(name)) ?? (await render(data, name))
		images[card.card_number] = `${PACK}/${out.split('/').pop()}`
		console.log(`  ${card.card_number} ${card.name}`)
	}

	await writeFile(IMAGE_MAP, `${JSON.stringify(images, null, '\t')}\n`)
	console.log(`${Object.keys(images).length} faces → public/custom/${PACK}/`)
}

main().catch((err: unknown) => {
	console.error(err)
	process.exitCode = 1
})
