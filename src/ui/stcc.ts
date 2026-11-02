// Browser-side access to the fetched STCC card database (src/data/stcc.ts).
//
// Vite bundles vendor/stcc/*.json when it exists (after `npm run fetch-cards`);
// when it doesn't, the glob is empty and every lookup returns null, so the UI
// falls back to its text faces. The desktop and hosted builds ship without
// it; the desktop app installs its own copy at startup with `loadStccFrom`
// (src/desktop/). Tests start with
// an empty index for determinism and inject one through `setStccIndex`.
//
// Custom packs (fan-made crew decks, src/data/custom/*.json) are our own data
// and join the index in every build but tests. Their card art is rendered
// locally (`npm run custom-cards`) into public/custom/, listed by the
// gitignored vendor/custom/*.images.json, and never shipped by code-only builds.
// A desktop app finds the faces that `npm run custom-cards:desktop` copied into
// its data folder through `loadStccFrom`.

import { setCardNameIndex } from '../data/cardNames'
import type { CardDef } from '../data/schema'
import {
	STCC_BOXES,
	addCustomPacks,
	buildStccIndex,
	customPackName,
	normalizeCardNumber,
	parseCustomImageMap,
	parseStccBots,
	stccBotForSource,
	type StccBot,
	type StccBox,
	type StccCard,
} from '../data/stcc'

const modules: Record<string, unknown> = ['test', 'desktop', 'hosted'].includes(
	import.meta.env.MODE,
)
	? {}
	: import.meta.glob('../../vendor/stcc/*.json', {
			eager: true,
			import: 'default',
		})

const customPacks: unknown[] =
	import.meta.env.MODE === 'test'
		? []
		: Object.values(
				import.meta.glob('../data/custom/*.json', {
					eager: true,
					import: 'default',
				}),
			)

const customImages: Record<string, string> = Object.assign(
	{},
	...Object.values(
		['test', 'desktop', 'hosted'].includes(import.meta.env.MODE)
			? {}
			: import.meta.glob<Record<string, string>>(
					'../../vendor/custom/*.images.json',
					{ eager: true, import: 'default' },
				),
	),
)

/** Where scans and icons are served from: public/stcc/ for the web build. */
let assetBase = `${import.meta.env.BASE_URL}stcc`

/** The index plus every custom pack (custom cards never replace STCC ones).
 *  A pack's faces installed at runtime (`installed`: pack → face map, served
 *  from `installedBase`) win over the bundled ones. */
function withCustomPacks(
	index: Map<string, StccCard>,
	installed: Readonly<Record<string, Record<string, string>>> = {},
	installedBase = '',
): Map<string, StccCard> {
	for (const pack of customPacks) {
		const name = customPackName(pack)
		const own = name === null ? undefined : installed[name]
		if (own !== undefined) addCustomPacks(index, [pack], own, installedBase)
		else
			addCustomPacks(
				index,
				[pack],
				customImages,
				`${import.meta.env.BASE_URL}custom`,
			)
	}
	return index
}

function fromModules(): Map<string, StccCard> {
	const boxes: Partial<Record<StccBox, unknown>> = {}
	for (const box of STCC_BOXES) {
		const key = `../../vendor/stcc/${box}.json`
		if (key in modules) boxes[box] = modules[key]
	}
	return withCustomPacks(buildStccIndex(boxes, assetBase))
}

let index: Map<string, StccCard> = fromModules()
setCardNameIndex(index)

/** "group/name" → path under /stcc/, written by the fetch script. */
let icons: Record<string, string> =
	(modules['../../vendor/stcc/icons.json'] as
		Record<string, string> | undefined) ?? {}

/** The solo Bots' Automated Command card text, by STCC bot id. */
let bots: Map<string, StccBot> = parseStccBots(
	modules['../../vendor/stcc/bots.json'],
)

/** Install STCC data read at runtime: `readJson` reads a fetched JSON file by
 *  its name (`box1.json`, `icons.json`) or returns null; scans and icons are
 *  then served from `base`. Missing files leave those lookups empty. Custom
 *  pack faces installed next to them (`custom/<pack>.images.json`, faces under
 *  `base`/custom/) replace the bundled ones. */
export async function loadStccFrom(
	base: string,
	readJson: (name: string) => Promise<unknown>,
): Promise<void> {
	const boxes: Partial<Record<StccBox, unknown>> = {}
	for (const box of STCC_BOXES) {
		const data = await readJson(`${box}.json`)
		if (data !== null) boxes[box] = data
	}
	const nextIcons = await readJson('icons.json')
	const installed: Record<string, Record<string, string>> = {}
	for (const pack of customPacks) {
		const name = customPackName(pack)
		if (name === null) continue
		const map = parseCustomImageMap(
			await readJson(`custom/${name}.images.json`),
		)
		if (map !== null) installed[name] = map
	}
	assetBase = base
	setStccIndex(
		withCustomPacks(buildStccIndex(boxes, base), installed, `${base}/custom`),
		(nextIcons as Record<string, string> | null) ?? {},
	)
	setStccBots(parseStccBots(await readJson('bots.json')))
}

/** Test seam: replace the Automated Command text (an empty Map clears it). */
export function setStccBots(next: Map<string, StccBot>): void {
	bots = next
}

/** The Automated Command card text of the crew that `crewCard` (any card of
 *  that crew deck, e.g. its Captain) belongs to, or null when the fetched data
 *  has none (hosted build, an older fetch): the UI then renders our own
 *  mechanics with describe(). */
export function stccBotFor(crewCard: Pick<CardDef, 'cardId'>): StccBot | null {
	const source = stccCard(crewCard)?.source
	return source === undefined ? null : stccBotForSource(bots, source)
}

/** Test seam: replace the index (pass an empty Map to clear it). */
export function setStccIndex(
	next: Map<string, StccCard>,
	nextIcons: Record<string, string> = {},
): void {
	index = next
	icons = nextIcons
	setCardNameIndex(next)
}

export function stccCard(def: Pick<CardDef, 'cardId'>): StccCard | null {
	if (def.cardId === null) return null
	return index.get(normalizeCardNumber(def.cardId)) ?? null
}

/** The card scan URL for a def, or null (no fetched data / no scan). */
export function cardImageUrl(def: Pick<CardDef, 'cardId'>): string | null {
	return stccCard(def)?.image ?? null
}

/** Public URL of a fetched cardface icon, e.g. `stccIconUrl('token/dilithium')`, or null. */
export function stccIconUrl(key: string): string | null {
	const path = icons[key]
	return path === undefined ? null : `${assetBase}/${path}`
}

// ---------------------------------------------------------------------------
// [[token]] → icon + label
// ---------------------------------------------------------------------------

export interface TokenView {
	/** Icon key into the fetched icon set ("token/dilithium"), if one exists. */
	icon: string | null
	label: string
	/** icon: glyph only (resources); chip: icon + label (suits, traits, thresholds). */
	kind: 'icon' | 'chip'
}

const SPEC: Record<string, string> = {
	inf: 'influence',
	res: 'research',
	mil: 'military',
	wild: 'any',
}

const TOKEN_ICON: Record<string, [string, string]> = {
	dilithium: ['token/dilithium', 'Dilithium'],
	latinum: ['token/latinum', 'Latinum'],
	glory: ['token/glory-token', 'Glory'],
	action: ['token/action', 'Action'],
	'away team': ['token/away-team', 'Away Team'],
	treachery: ['token/treachery', 'Treachery'],
	collective: ['token/borg-collective', 'Collective'],
	drone: ['token/borg-drone', 'Drone'],
	research: ['skill/research', 'Research'],
	influence: ['skill/influence', 'Influence'],
	military: ['skill/military', 'Military'],
}

const SUITS = new Set([
	'ally',
	'captain',
	'cargo',
	'directive',
	'encounter',
	'incident',
	'location',
	'person',
	'ship',
	'mission',
])

/** How to draw one `[[name]]` token from their rules text. */
export function tokenView(name: string): TokenView {
	const known = TOKEN_ICON[name]
	if (known !== undefined)
		return { icon: known[0], label: known[1], kind: 'icon' }
	if (SUITS.has(name))
		return {
			icon: stccIconUrl(`suit/${name}`) ? `suit/${name}` : `suitFont/${name}`,
			label: name.toUpperCase(),
			kind: 'chip',
		}
	let m = /^(-?\d+|\?)vp$/.exec(name)
	if (m) return { icon: 'token/vp', label: `${m[1]} VP`, kind: 'chip' }
	m = /^(inf|res|mil|wild)-(skill|focus|restriction)$/.exec(name)
	if (m) {
		const spec = SPEC[m[1] ?? ''] ?? 'any'
		const group = m[2] === 'focus' ? 'focus' : 'skill'
		return { icon: `${group}/${spec}`, label: `${spec} ${m[2]}`, kind: 'icon' }
	}
	m = /^(inf|res|mil)(\d+)$/.exec(name)
	if (m)
		return {
			icon: `skill/${SPEC[m[1] ?? ''] ?? 'any'}`,
			label: `${m[2]}+`,
			kind: 'chip',
		}
	const trait = name.replace(/\s+/g, '-')
	return { icon: `trait/${trait}`, label: name.toUpperCase(), kind: 'chip' }
}
