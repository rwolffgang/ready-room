// The Play button (quickPlay.tsx) under jsdom: it shows on a card with exactly
// one legal operation for the viewer — on the console's hand and table and on
// the phone's tiles — and nowhere else; the isolinear chip shows exactly when
// that operation costs an action; a click dispatches its PLAY_CARD / ACTIVATE
// and neither opens the card nor its zoom.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { CardCatalog } from '../engine/setup'
import type { CardInstanceId } from '../engine/ids'
import { firstLegalSelection, type Intent } from '../engine/intents'
import type { GameState } from '../engine/state'
import { createSession } from '../session/log'
import { useGameStore, type GameStore } from './store'
import { loadBrowserCatalog } from './browserCatalog'
import { Hand, PlayerArea } from './board'
import { CardTile } from './tile/CardTile'
import { quickAction } from './quickPlay'

let catalog: CardCatalog
let host: HTMLElement
let root: Root
let realDispatch: GameStore['dispatch']
let sent: Intent[]

function start(): GameState {
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().resumeGame(
			createSession(
				{
					mode: 'TWO_PLAYER',
					players: [
						{ deck: 'PIC', boardSide: 'BASIC' },
						{ deck: 'SHR', boardSide: 'BASIC' },
					],
					seed: 7,
				},
				catalog,
			),
		)
	})
	act(() => {
		useGameStore.getState().dispatch({ t: 'START' })
	})
	sent = []
	return useGameStore.getState().state!
}

const find = (s: GameState, def: string): CardInstanceId => {
	const iid = Object.keys(s.cards).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`${def} not in the game`)
	return iid as CardInstanceId
}

/** Play `def`'s first operation from hand and settle what it asks. */
function playOut(def: string) {
	const iid = find(useGameStore.getState().state!, def)
	act(() => {
		useGameStore.getState().dispatch({ t: 'PLAY_CARD', iid, operationIndex: 0 })
	})
	for (let n = 0; useGameStore.getState().state!.pendingChoice !== null; n++) {
		if (n > 10) throw new Error(`${def} keeps asking`)
		const st = useGameStore.getState().state!
		act(() => {
			useGameStore.getState().settle(firstLegalSelection(st))
		})
	}
	expect(useGameStore.getState().error).toBeNull()
}

function render(node: React.ReactNode) {
	act(() => {
		root.render(node)
	})
}

/** The Play button on the card `iid` (console: in the card; phone: in the
 *  tile), or null. */
const button = (iid: CardInstanceId): HTMLButtonElement | null =>
	host.querySelector<HTMLButtonElement>(
		`[data-anchor="card:${iid}"] .quick-play, [data-iid="${iid}"] .quick-play`,
	)

const hasChip = (b: HTMLElement) => b.querySelector('.qp-chip') !== null

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	catalog = loadBrowserCatalog()
	host = document.createElement('div')
	document.body.appendChild(host)
	root = createRoot(host)
	sent = []
	realDispatch = useGameStore.getState().dispatch
	useGameStore.setState({
		dispatch: (intent) => {
			sent.push(intent)
			realDispatch(intent)
		},
	})
})

afterEach(() => {
	act(() => root.unmount())
	useGameStore.setState({ dispatch: realDispatch })
})

describe('the Play button on the console', () => {
	it('shows for exactly one legal operation, with the chip when it costs an action', () => {
		const s = start()
		render(
			<>
				<Hand seat={0} />
				<PlayerArea seat={0} />
			</>,
		)
		// one legal PLAY each, paying an action
		for (const def of ['1PIC20-24', '1PIC24-24']) {
			const b = button(find(s, def))
			expect(b, def).not.toBeNull()
			expect(b!.dataset.quick).toBe('PLAY')
			expect(hasChip(b!), def).toBe(true)
			expect(b!.getAttribute('aria-label')).toMatch(/^Play .*costs an action/)
		}
		// two legal PLAYs (a free one and a paid one) — no button
		expect(button(find(s, '1PIC16-24'))).toBeNull()
		expect(button(find(s, '1PIC22-24'))).toBeNull()
		// three legal ACTIVATIONs on the ship — no button
		expect(button(find(s, '1PIC02-24'))).toBeNull()
		// the Captain has none — no button
		expect(button(find(s, '1PIC01-24'))).toBeNull()
		// never on the opponent's cards
		expect(host.querySelectorAll('.quick-play').length).toBe(3)
	})

	it('a click plays the card, without opening it', () => {
		const s = start()
		const pic24 = find(s, '1PIC24-24')
		render(<Hand seat={0} />)
		act(() => {
			button(pic24)!.click()
		})
		expect(sent).toEqual([{ t: 'PLAY_CARD', iid: pic24, operationIndex: 0 }])
		const after = useGameStore.getState()
		expect(after.error).toBeNull()
		expect(after.state!.cards[pic24]!.zone.k).not.toBe('HAND')
		expect(after.detailIid).toBeNull()
		expect(after.zoomIid).toBeNull()
		// its choice is pending now: no card offers a button meanwhile
		expect(after.pendingChoice).not.toBeNull()
		expect(host.querySelectorAll('.quick-play').length).toBe(0)
	})

	it('no chip on a free operation; a click activates a card on the table', () => {
		start()
		playOut('1PIC24-24')
		playOut('1PIC21-24')
		const s = useGameStore.getState().state!
		const loc = find(s, '1PIC21-24')
		expect(s.cards[loc]!.zone.k).toBe('LOCATION_AREA')
		render(<PlayerArea seat={0} />)
		const b = button(loc)!
		expect(b).not.toBeNull()
		expect(b.dataset.quick).toBe('ACTIVATION')
		expect(hasChip(b)).toBe(false)
		expect(b.getAttribute('aria-label')).toMatch(/^Activate .*no action/)
		act(() => {
			b.click()
		})
		expect(sent.at(-1)).toEqual({ t: 'ACTIVATE', iid: loc, operationIndex: 2 })
		expect(useGameStore.getState().error).toBeNull()
		expect(useGameStore.getState().state!.cards[loc]!.exhausted).toBe(true)
		expect(useGameStore.getState().detailIid).toBeNull()
	})

	it('with no action left, a card whose free PLAY is all that remains gets a chipless button', () => {
		start()
		playOut('1PIC24-24')
		playOut('1PIC21-24')
		playOut('1PIC20-24')
		const s = useGameStore.getState().state!
		expect(s.players[0].actions.available).toBe(0)
		render(<Hand seat={0} />)
		const pic16 = find(s, '1PIC16-24')
		const b = button(pic16)!
		expect(b).not.toBeNull()
		expect(hasChip(b)).toBe(false)
		act(() => {
			b.click()
		})
		expect(sent.at(-1)).toEqual({
			t: 'PLAY_CARD',
			iid: pic16,
			operationIndex: 0,
		})
	})
})

describe('the Play button on the phone and tablet tiles', () => {
	it('shows beside the header and plays the card', () => {
		const s = start()
		const pic20 = find(s, '1PIC20-24')
		render(
			<>
				<CardTile iid={pic20} />
				<CardTile iid={find(s, '1PIC16-24')} />
				<CardTile iid={find(s, '1PIC02-24')} />
			</>,
		)
		expect(host.querySelectorAll('.quick-play').length).toBe(1)
		const b = button(pic20)!
		expect(b.closest('.pb-top')).not.toBeNull()
		expect(b.closest('header')).toBeNull()
		expect(hasChip(b)).toBe(true)
		act(() => {
			b.click()
		})
		expect(sent).toEqual([{ t: 'PLAY_CARD', iid: pic20, operationIndex: 0 }])
		expect(useGameStore.getState().detailIid).toBeNull()
	})

	it('not on a tile that sits inside another button', () => {
		const s = start()
		render(<CardTile iid={find(s, '1PIC20-24')} interactive={false} />)
		expect(host.querySelector('.quick-play')).toBeNull()
	})
})

describe('quickAction', () => {
	it('is null when the intent is not the viewer’s to send', () => {
		const s = start()
		const legal = useGameStore.getState().legal
		const pic20 = find(s, '1PIC20-24')
		expect(quickAction(s, legal, 0, pic20)?.intent).toEqual({
			t: 'PLAY_CARD',
			iid: pic20,
			operationIndex: 0,
		})
		// a bot to move: the store lists nothing
		expect(quickAction(s, [], 0, pic20)).toBeNull()
		// the other seat looking at it
		expect(quickAction(s, legal, 1, pic20)).toBeNull()
		// online: no engine state
		expect(quickAction(null, legal, 0, pic20)).toBeNull()
	})
})
