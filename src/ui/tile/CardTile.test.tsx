// <CardTile> under jsdom. jsdom does not evaluate container queries, so the
// densities are pinned as markup: every part is in the DOM and tile.css hides
// what a density does not show. Behaviour: a lit line is a button that
// dispatches; the header opens the detail; a candidate rings and toggles.

import { beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { CardCatalog } from '../../engine/setup'
import type { CardInstanceId } from '../../engine/ids'
import type { GameState } from '../../engine/state'
import { cardDef } from '../../engine/cards'
import { createSession } from '../../session/log'
import { useGameStore } from '../store'
import { loadBrowserCatalog } from '../browserCatalog'
import { CardTile, candidateState } from './CardTile'

let catalog: CardCatalog
let host: HTMLElement
let root: Root

function start(seed = 7, side: 'BASIC' | 'ADVANCED' = 'BASIC'): GameState {
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().resumeGame(
			createSession(
				{
					mode: 'TWO_PLAYER',
					players: [
						{ deck: 'PIC', boardSide: side },
						{ deck: 'SHR', boardSide: 'BASIC' },
					],
					seed,
				},
				catalog,
			),
		)
	})
	act(() => {
		useGameStore.getState().dispatch({ t: 'START' })
	})
	return useGameStore.getState().state!
}

const inZone = (s: GameState, key: string, def: string): CardInstanceId => {
	const iid = (s.zones[key] ?? []).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`${def} not in ${key}`)
	return iid
}

function render(node: React.ReactNode) {
	act(() => {
		root.render(node)
	})
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	catalog = loadBrowserCatalog()
	host = document.createElement('div')
	document.body.appendChild(host)
	root = createRoot(host)
})

describe('CardTile', () => {
	it('carries every density part in its markup', () => {
		const s = start()
		const ent = inZone(s, 'FLEET:0', '1PIC02-24')
		render(<CardTile iid={ent} />)
		const slot = host.querySelector('.pb-slot')!
		expect(slot).not.toBeNull()
		const tile = slot.querySelector('.pb-tile.s-SHIP')!
		expect(tile).not.toBeNull()
		// pip: suit glyph + VP · chip: name · tile: lines · wide: traits + chips
		expect(tile.querySelector('.pb-sg')).not.toBeNull()
		expect(tile.querySelector('.pb-th h4')?.textContent).toBe('1PIC02/24')
		expect(tile.querySelector('.pb-traits')).not.toBeNull()
		// a docked ship (token on its card) says nothing about its position
		expect(tile.querySelector('.pb-meta')).not.toBeNull()
		expect(tile.querySelector('.pb-meta')?.textContent).not.toMatch(/token/)
		expect(tile.querySelectorAll('.pb-ln').length).toBe(3)
		// each line is still the accessible English sentence
		for (const img of tile.querySelectorAll('.pb-ln [role="img"]'))
			expect(img.getAttribute('aria-label')?.length).toBeGreaterThan(5)
	})

	it('a lit line is a button that activates the card', () => {
		const s = start()
		const ent = inZone(s, 'FLEET:0', '1PIC02-24')
		render(<CardTile iid={ent} />)
		const lit = host.querySelectorAll<HTMLElement>('.pb-ln.pb-lit')
		expect(lit.length).toBe(3)
		expect(lit[0]!.getAttribute('role')).toBe('button')
		expect(lit[0]!.tabIndex).toBe(0)
		act(() => {
			lit[0]!.click()
		})
		const after = useGameStore.getState()
		expect(after.error).toBeNull()
		expect(after.state!.cards[ent]!.exhausted).toBe(true)
	})

	it('Enter on a lit PLAY line plays the card from hand', () => {
		const s = start()
		const pic24 = inZone(s, 'HAND:0', '1PIC24-24')
		render(<CardTile iid={pic24} />)
		const lines = host.querySelectorAll<HTMLElement>('.pb-ln')
		expect(lines[0]!.className).toContain('pb-lit')
		expect(lines[1]!.className).toContain('pb-later')
		expect(lines[1]!.getAttribute('role')).toBeNull()
		act(() => {
			lines[0]!.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
			)
		})
		const after = useGameStore.getState().state!
		expect(after.cards[pic24]!.zone.k).not.toBe('HAND')
	})

	it('the header opens the card detail', () => {
		const s = start()
		const pic24 = inZone(s, 'HAND:0', '1PIC24-24')
		render(<CardTile iid={pic24} />)
		const header = host.querySelector<HTMLElement>('.pb-th[role="button"]')!
		act(() => {
			header.click()
		})
		expect(useGameStore.getState().detailIid).toBe(pic24)
	})

	it('non-interactive tiles render no buttons (safe inside a button)', () => {
		const s = start()
		const pic24 = inZone(s, 'HAND:0', '1PIC24-24')
		render(<CardTile iid={pic24} interactive={false} />)
		expect(host.querySelector('[role="button"]')).toBeNull()
		expect(host.querySelector('button')).toBeNull()
		expect(host.querySelector('.pb-lit')).not.toBeNull()
	})

	it('dim lines say why when the card is the reason, not the turn', () => {
		const s = start()
		const ent = inZone(s, 'FLEET:0', '1PIC02-24')
		act(() => {
			useGameStore
				.getState()
				.dispatch({ t: 'ACTIVATE', iid: ent, operationIndex: 2 })
		})
		act(() => {
			useGameStore.getState().setSelected([])
		})
		// settle whatever the activation asked with the engine's first pick
		while (useGameStore.getState().pendingChoice !== null) {
			const r = useGameStore
				.getState()
				.legal.find((i) => i.t === 'RESOLVE_CHOICE')
			if (r === undefined || r.t !== 'RESOLVE_CHOICE') break
			act(() => useGameStore.getState().settle(r.selection))
		}
		render(<CardTile iid={ent} />)
		const whys = [...host.querySelectorAll('.pb-dim .pb-why')].map(
			(e) => e.textContent,
		)
		expect(whys.length).toBe(3)
		expect(new Set(whys)).toEqual(new Set(['Exhausted until Clean-up']))
		// a turn gate only dims: seat 1 looking at its own fleet on seat 0's turn
		const shipOfShr = (s.zones['FLEET:1'] ?? [])[0]!
		act(() => {
			useGameStore.getState().setViewer(1)
		})
		render(<CardTile iid={shipOfShr} />)
		expect(host.querySelector('.pb-dim')).not.toBeNull()
		expect(host.querySelector('.pb-dim .pb-why')).toBeNull()
	})

	it('renders a bare def with every line, its VP and no state', () => {
		start()
		const def = cardDef('1PIC21-24') // 1PIC21: PLAY, CONTROL, ACTIVATION
		render(<CardTile def={def} />)
		expect(host.querySelectorAll('.pb-ln').length).toBe(3)
		expect(host.querySelector('.pb-lit')).toBeNull()
		if (def.vp !== 0)
			expect(host.querySelector('.pb-vp')?.textContent).toBe(String(def.vp))
		const withVp = catalog.defs.find((d) => d.vp > 0 && !d.vpAsterisk)!
		render(<CardTile def={withVp} />)
		expect(host.querySelector('.pb-vp')?.textContent).toBe(String(withVp.vp))
	})

	it('rings a candidate of the pending choice and toggles the selection', () => {
		const s = start(25, 'ADVANCED')
		const pic23 = inZone(s, 'HAND:0', '1PIC23-24') // PLAY: send an Away Team
		act(() => {
			useGameStore
				.getState()
				.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
		})
		const st = useGameStore.getState()
		const choice = st.pendingChoice
		expect(choice?.k).toBe('CHOOSE_LOCATION')
		if (choice?.k !== 'CHOOSE_LOCATION') return
		const loc = choice.candidates[0]!
		expect(candidateState(choice, 0, loc).candidate).toBe(true)
		expect(candidateState(choice, 1, loc).candidate).toBe(false)
		render(<CardTile iid={loc} />)
		const tile = host.querySelector<HTMLElement>('.pb-tile')!
		expect(tile.className).toContain('pb-cand')
		expect(tile.getAttribute('role')).toBe('button')
		// the header is not a second button inside the candidate button
		expect(tile.querySelector('.pb-th')!.getAttribute('role')).toBeNull()
		act(() => {
			tile.click()
		})
		expect(useGameStore.getState().selected).toEqual([loc])
		expect(host.querySelector('.pb-tile')!.className).toContain('pb-picked')
	})
})
