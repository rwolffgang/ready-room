// A Fleet SHIP among a choice's cards is drawn as in the Fleet Area
// (TableCard → ShipCard): it says where its token is, so a choice like "beam
// to a SHIP … to send an Away Team where this ship is" names the destination
// on desktop (the phone tile already carries that chip), and a "you may beam"
// confirm shows the ship it would beam onto the same way.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { PendingChoice } from '../engine/resolver/choices'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { cardNameById } from '../data/cardNames'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { ChoicePanel } from './choice'

function startedSession() {
	const catalog = loadBrowserCatalog()
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: 'PIC', boardSide: 'ADVANCED' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed: 25,
			},
			catalog,
		),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

/** Two of seat 0's hand cards stand in as Fleet ships, one warped to a
 *  Neutral Zone Location and one docked; `choice` asks about them. Returns
 *  the ship tabs' texts and the Location's name. */
function shipTabs(
	choice: (warped: CardInstanceId, docked: CardInstanceId) => PendingChoice,
): { tabs: (string | null)[]; locName: string | null } {
	act(() => {
		useGameStore.getState().resumeGame(startedSession())
	})
	const projected = useGameStore.getState().projected!
	const loc = projected.zones['NEUTRAL_ZONE:0']![0]! as CardInstanceId
	const [warped, docked] = Object.values(projected.cards)
		.filter((c) => c.zone.k === 'HAND' && c.owner === 0)
		.map((c) => c.iid)
	const fleet = { k: 'FLEET', seat: 0 } as const
	act(() => {
		useGameStore.setState({
			projected: {
				...projected,
				cards: {
					...projected.cards,
					[warped!]: {
						...projected.cards[warped!]!,
						zone: fleet,
						shipTokenAt: loc,
					},
					[docked!]: {
						...projected.cards[docked!]!,
						zone: fleet,
						shipTokenAt: null,
					},
				},
			},
			pendingChoice: choice(warped!, docked!),
			botToMove: null,
		})
	})
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	act(() => root.render(<ChoicePanel />))
	const tabs = [...host.querySelectorAll('.ship-at-name')].map(
		(el) => el.textContent,
	)
	act(() => root.unmount())
	return { tabs, locName: cardNameById(projected.cards[loc]!.def) }
}

describe('Fleet ships in a choice', () => {
	it('a card choice says at which Location each Fleet ship is', () => {
		const { tabs, locName } = shipTabs((warped, docked) => ({
			k: 'CHOOSE_CARDS',
			id: 'c-test',
			seat: 0,
			prompt: 'Beam onto which card?',
			candidates: [warped, docked],
			min: 1,
			max: 1,
			from: 'IN_PLAY',
			sourceCard: null,
		}))
		expect(tabs).toEqual([`at ${locName}`, 'token on card'])
	})

	it('a "you may beam" confirm shows its ships the same way', () => {
		const { tabs, locName } = shipTabs((warped, docked) => ({
			k: 'CONFIRM',
			id: 'c-test',
			seat: 0,
			prompt: 'You may beam a card to a SHIP?',
			preview: { cards: [], onto: [warped, docked] },
			sourceCard: null,
		}))
		expect(tabs).toEqual([`at ${locName}`, 'token on card'])
	})
})
