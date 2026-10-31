import { describe, expect, it } from 'vitest'

import {
	fetchStcc,
	parseCardface,
	rawUrl,
	stccUpToDate,
	type StccIo,
	type StccSource,
} from './stccFetch'

const SOURCE: StccSource = { repo: 'o/r', site: '', sha: 'abc' }

function fakeIo(responses: Record<string, string>, onDisk: string[] = []) {
	const files = new Map<string, string | Uint8Array>(
		onDisk.map((p) => [p, 'old']),
	)
	const downloads: string[] = []
	const io: StccIo = {
		fetchText: async (url) => {
			const path = url.replace(rawUrl(SOURCE, ''), '')
			const body = responses[path]
			if (body === undefined) throw new Error(`404 Not Found: ${url}`)
			return body
		},
		download: async (url, rel) => {
			if (url.includes('broken')) throw new Error(`404 Not Found: ${url}`)
			downloads.push(rel)
			files.set(rel, 'scan')
		},
		writeText: async (rel, text) => void files.set(rel, text),
		writeBytes: async (rel, bytes) => void files.set(rel, bytes),
		exists: async (rel) => files.has(rel),
	}
	return { io, files, downloads }
}

const PNG = btoa('png!')
const RESPONSES: Record<string, string> = {
	'box1.json': JSON.stringify([
		{ filename: 'a.jpg' },
		{ filename: 'b.jpg' },
		{},
	]),
	'box2.json': JSON.stringify([{ filename: 'broken.jpg' }]),
	'box3.json': '[]',
	'promo1.json': '[]',
	'promo2.json': '[]',
	'data/errata.json': '{}',
	'data/faq.json': '{}',
	'data/tokens.json': '{}',
	'data/bots.json': '[{"id":"x"},{"id":"y"}]',
	'cardface-assets.js': `const CARDFACE={"token": {"vp": "data:image/png;base64,${PNG}"}, "suit": {"ship": "data:image/svg+xml;base64,${PNG}", "bad": "nope"}};`,
}

describe('fetchStcc', () => {
	it('writes JSON, icons and scans under logical paths, skipping scans on disk', async () => {
		const { io, files, downloads } = fakeIo(RESPONSES, [
			'public/img/box1/a.jpg',
		])
		const res = await fetchStcc(SOURCE, io, { now: () => 'T' })

		expect(files.get('vendor/box1.json')).toBe(RESPONSES['box1.json'])
		expect(files.has('vendor/faq.json')).toBe(true)
		expect(files.get('vendor/bots.json')).toBe(RESPONSES['data/bots.json'])
		expect(
			new TextDecoder().decode(
				files.get('public/icons/token/vp.png') as Uint8Array,
			),
		).toBe('png!')
		expect(JSON.parse(files.get('vendor/icons.json') as string)).toEqual({
			'token/vp': 'icons/token/vp.png',
			'suit/ship': 'icons/suit/ship.svg',
		})
		expect(downloads).toEqual(['public/img/box1/b.jpg'])
		expect(res.fetched).toBe(1)
		expect(res.failed).toHaveLength(1)
		expect(res.manifest).toMatchObject({
			sha: 'abc',
			fetchedAt: 'T',
			cards: { box1: 3, box2: 1, box3: 0 },
			images: 2,
			imagesTotal: 3,
			icons: 2,
			bots: 2,
		})
		expect(JSON.parse(files.get('vendor/manifest.json') as string)).toEqual(
			res.manifest,
		)
		expect(stccUpToDate(res.manifest, SOURCE)).toBe(false)
	})

	it('reports progress through each phase', async () => {
		const phases = new Set<string>()
		const { io } = fakeIo(RESPONSES)
		await fetchStcc(SOURCE, io, {
			now: () => 'T',
			onProgress: (p) => phases.add(p.phase),
		})
		expect([...phases]).toEqual(['data', 'icons', 'images'])
	})
})

describe('parseCardface', () => {
	it('parses the object literal without evaluating it', () => {
		expect(parseCardface('const CARDFACE={"a": {"b": "c"}};\n')).toEqual({
			a: { b: 'c' },
		})
		expect(() => parseCardface('alert(1)')).toThrow()
	})
})

describe('stccUpToDate', () => {
	const m = {
		repo: 'o/r',
		sha: 'abc',
		fetchedAt: '',
		cards: {},
		images: 3,
		imagesTotal: 3,
		icons: 1,
		bots: 16,
	}
	it('needs the pinned sha and every scan', () => {
		expect(stccUpToDate(m, SOURCE)).toBe(true)
		expect(stccUpToDate({ ...m, sha: 'old' }, SOURCE)).toBe(false)
		expect(stccUpToDate(null, SOURCE)).toBe(false)
	})
	it('treats a fetch from before the solo Bots as out of date', () => {
		const { bots: _bots, ...before } = m
		expect(stccUpToDate(before, SOURCE)).toBe(false)
	})
})
