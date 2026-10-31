import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StccIo, StccManifest } from '../data/stccFetch'
import { cardImageUrl, setStccIndex, stccIconUrl } from '../ui/stcc'

// An in-memory app-data folder standing in for the Rust side.
const disk = new Map<string, string>()
const SHA = 'pinned'
const raw = (path: string) =>
	`https://raw.githubusercontent.com/o/r/${SHA}/${path}`
const upstream: Record<string, string> = {
	[raw('box1.json')]: JSON.stringify([
		{
			id: 'x',
			name: 'X',
			suit: 'SHIP',
			source: '',
			game_box: '',
			card_number: '1PIC01/24',
			filename: 'x.jpg',
		},
	]),
	[raw('cardface-assets.js')]:
		`const CARDFACE={"token": {"vp": "data:image/png;base64,${btoa('p')}"}};`,
}

vi.mock('./bridge', () => {
	const io: StccIo = {
		fetchText: async (url) => upstream[url] ?? '[]',
		download: async (_url, rel) => void disk.set(rel, 'scan'),
		writeText: async (rel, text) => void disk.set(rel, text),
		writeBytes: async (rel) => void disk.set(rel, 'bytes'),
		exists: async (rel) => disk.has(rel),
	}
	const readVendorJson = async (name: string) => {
		const text = disk.get(`vendor/${name}`)
		return text === undefined ? null : (JSON.parse(text) as unknown)
	}
	return {
		STCC_SOURCE: { repo: 'o/r', site: 'https://site', sha: SHA },
		OPEN_CARD_DATABASE: 'ready-room:card-database',
		tauriIo: io,
		readVendorJson,
		readManifest: async () =>
			(await readVendorJson('manifest.json')) as StccManifest | null,
		stccBase: () => 'stcc://localhost',
		stccFolder: async () => '/data/stcc',
	}
})

const { DesktopRoot } = await import('./DesktopRoot')

let root: Root
let host: HTMLElement

async function mount(): Promise<void> {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	await act(async () => {
		root.render(
			<DesktopRoot>
				<p>the app</p>
			</DesktopRoot>,
		)
	})
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await act(async () => {})
}

function button(label: RegExp): HTMLButtonElement {
	const b = [...host.querySelectorAll('button')].find((el) =>
		label.test(el.textContent ?? ''),
	)
	if (b === undefined) throw new Error(`no button ${label}`)
	return b
}

beforeEach(() => disk.clear())
afterEach(() => {
	act(() => root.unmount())
	host.remove()
	setStccIndex(new Map())
})

describe('DesktopRoot', () => {
	it('downloads the card database on first launch, then shows the app with it', async () => {
		await mount()
		await settle()
		expect(host.textContent).toContain('Not downloaded yet')
		await act(async () => button(/Download card database/).click())
		await settle()

		expect(host.textContent).toContain('the app')
		expect(disk.has('public/img/box1/x.jpg')).toBe(true)
		expect(cardImageUrl({ cardId: '1PIC01/24' })).toBe(
			'stcc://localhost/public/img/box1/x.jpg',
		)
		expect(stccIconUrl('token/vp')).toBe(
			'stcc://localhost/public/icons/token/vp.png',
		)
	})

	it('goes straight to the app when the data is complete', async () => {
		disk.set(
			'vendor/manifest.json',
			JSON.stringify({ sha: SHA, images: 1, imagesTotal: 1, bots: 16 }),
		)
		await mount()
		await settle()
		expect(host.textContent).toContain('the app')
	})

	it('can be skipped to play with text cards', async () => {
		await mount()
		await settle()
		await act(async () => button(/Skip/).click())
		await settle()
		expect(host.textContent).toContain('the app')
		expect(cardImageUrl({ cardId: '1PIC01/24' })).toBeNull()
	})
})
