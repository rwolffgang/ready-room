// What the Pocket Bridge works out (docs/ui-mobile.md §4), pinned on real
// games: the secure rule, the Burn forecast, track forecasts, the mission
// checklist, "if the game ended now", Orders and where a choice rings.

import { beforeAll, describe, expect, it } from 'vitest'
import type { CardCatalog } from '../../engine/setup'
import type { CardInstanceId } from '../../engine/ids'
import type { GameState } from '../../engine/state'
import type { PendingChoice } from '../../engine/resolver/choices'
import { legalIntents } from '../../engine/intents'
import { score } from '../../engine/scoring'
import { createSession } from '../../session/log'
import { SessionAdapter } from '../../session/adapter'
import { loadBrowserCatalog } from '../browserCatalog'
import {
	burnForecast,
	missionView,
	orderCount,
	orderGroups,
	ringPlan,
	scoreNow,
	secureCopy,
	secureStatus,
	stationOf,
	trackForecast,
} from './facts'

let catalog: CardCatalog

beforeAll(() => {
	catalog = loadBrowserCatalog()
})

function started(seed = 7): GameState {
	const a = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'PIC', boardSide: 'BASIC' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed,
			},
			catalog,
		),
		catalog,
	})
	a.dispatch({ t: 'START' })
	return structuredClone(a.state)
}

const nz = (s: GameState, slot: 0 | 1 | 2): CardInstanceId =>
	s.zones[`NEUTRAL_ZONE:${slot}`]![0]!

describe('the secure rule', () => {
	it('≥3 tokens and ≥2 more than the opponent', () => {
		const s = started()
		const loc = nz(s, 0)
		const at = (me: number, them: number) => {
			s.awayTeamsAt[loc] = [me, them]
			return secureStatus(s, loc, 0)
		}
		expect(at(3, 1)).toEqual({ mine: 3, theirs: 1, securedBy: 'you', need: 0 })
		expect(at(3, 2)).toMatchObject({ securedBy: null, need: 1 })
		expect(at(1, 2)).toMatchObject({ securedBy: null, need: 3 })
		expect(at(0, 0)).toMatchObject({ securedBy: null, need: 3 })
		expect(at(0, 3)).toMatchObject({ securedBy: 'them', need: 5 })
		// the other seat reads the mirror image
		s.awayTeamsAt[loc] = [0, 3]
		expect(secureStatus(s, loc, 1)).toMatchObject({
			mine: 3,
			theirs: 0,
			securedBy: 'you',
		})
	})

	it('counts Ship tokens as well as Away Teams', () => {
		const s = started()
		const loc = nz(s, 1)
		const ship = s.zones['FLEET:0']![0]!
		s.cards[ship]!.shipTokenAt = loc
		s.awayTeamsAt[loc] = [2, 0]
		expect(secureStatus(s, loc, 0)).toMatchObject({
			mine: 3,
			securedBy: 'you',
		})
	})

	it('words it for the player', () => {
		expect(
			secureCopy({ mine: 3, theirs: 1, securedBy: 'you', need: 0 }, 'SHR').head,
		).toBe('Secured by you · 3 vs 1')
		expect(
			secureCopy({ mine: 1, theirs: 2, securedBy: null, need: 3 }, 'SHR').note,
		).toBe('You need 3 more tokens here to secure it.')
		expect(
			secureCopy({ mine: 0, theirs: 3, securedBy: 'them', need: 5 }, 'SHR')
				.head,
		).toBe('Secured by SHR · 0 vs 3')
	})
})

describe('forecasts', () => {
	it('the Burn: fewer Incidents wins', () => {
		const s = started()
		const b = burnForecast(s, 0)
		expect(b.left).toBe(s.zones['INCIDENT_DECK']!.length)
		// both starting decks carry the same number of Incidents
		expect(b.mine).toBe(b.theirs)
		expect(b.leader).toBe('tie')
		// hand an Incident from the deck to seat 1
		const inc = s.zones['INCIDENT_DECK']![0]!
		s.cards[inc] = { ...s.cards[inc]!, owner: 1, zone: { k: 'HAND', seat: 1 } }
		expect(burnForecast(s, 0)).toMatchObject({
			mine: b.mine,
			theirs: b.theirs + 1,
			leader: 'you',
		})
		expect(burnForecast(s, 1).leader).toBe('them')
	})

	it('steps to the next multiplier, from the board side’s own glyphs', () => {
		const s = started()
		s.players[0].specialties.RESEARCH = 6 // PIC Basic: ×1@0 ×2@2 ×3@7
		const t = trackForecast(s, 0, 'RESEARCH')
		expect(t).toMatchObject({
			level: 6,
			current: 2,
			next: { step: 7, value: 3 },
			stepsToNext: 1,
		})
		s.players[0].specialties.RESEARCH = 15
		expect(trackForecast(s, 0, 'RESEARCH')).toMatchObject({
			next: null,
			stepsToNext: null,
		})
	})

	it('mission goals are a checklist evaluated by the engine', () => {
		const s = started()
		const m = missionView(s, 0, 0)!
		expect(m.title).toBe('1PIC/M1') // no STCC data in tests
		expect(m.goals.length).toBe(2)
		expect(m.goals.every((g) => !g.met)).toBe(true)
		expect(m.goals.every((g) => g.toks.length > 0)).toBe(true)
		expect(m.reward.length).toBeGreaterThan(0)
		s.players[0].specialties.RESEARCH = 4
		s.players[0].specialties.INFLUENCE = 4
		const after = missionView(s, 0, 0)!
		expect(after.goals.map((g) => g.met)).toEqual([false, true])
		expect(after.ready).toBe(false)
	})

	it('"if the game ended now" is the scoring function, with the Focus warning', () => {
		const s = started()
		const before = JSON.stringify(s)
		const now = scoreNow(s, 0)
		expect(now.breakdown).toEqual(score(s, 0))
		expect(now.breakdown.focusSuppressed).toBe(true)
		const done = structuredClone(s)
		done.players[0].missions[0]!.completed = true
		expect(now.focusWouldBe).toBe(
			score(done, 0).focus.reduce((a, f) => a + f.vp, 0),
		)
		expect(JSON.stringify(s)).toBe(before) // the forecast never mutates
	})
})

describe('orders and stations', () => {
	it('groups every legal move by where the card is', () => {
		const s = started()
		const legal = legalIntents(s)
		const groups = orderGroups(legal, s)
		expect(groups.map((g) => g.label)).toEqual(['From hand', 'Fleet'])
		const rows = groups.flatMap((g) => g.rows)
		expect(rows.length).toBe(orderCount(legal))
		expect(rows.every((r) => r.t === 'PLAY_CARD' || r.t === 'ACTIVATE')).toBe(
			true,
		)
	})

	it('knows which station draws a zone', () => {
		expect(stationOf({ k: 'MARKET_OFFER', suit: 'ALLY' }, 0)).toBe('sector')
		expect(stationOf({ k: 'NEUTRAL_ZONE', slot: 2 }, 0)).toBe('sector')
		expect(stationOf({ k: 'FLEET', seat: 0 }, 0)).toBe('ship')
		expect(stationOf({ k: 'FLEET', seat: 1 }, 0)).toBeNull()
		expect(stationOf({ k: 'HAND', seat: 0 }, 0)).toBeNull()
		expect(stationOf({ k: 'DISCARD', seat: 0 }, 0)).toBeNull()
	})

	it('rings what a station shows and repeats the rest in the sheet', () => {
		const s = started()
		const hand = s.zones['HAND:0']![0]!
		const offer = s.zones['MARKET_OFFER:PERSON']![0]!
		const ship = s.zones['FLEET:0']![0]!
		const choice: PendingChoice = {
			k: 'CHOOSE_CARDS',
			id: 'c1',
			seat: 0,
			prompt: 'Pick one',
			sourceCard: null,
			candidates: [hand, offer, ship],
			min: 1,
			max: 1,
			from: 'test',
		}
		const plan = ringPlan(choice, s, 0)
		expect(plan).toEqual({
			sector: [offer],
			ship: [ship],
			sheet: [hand],
			focus: 'sector',
		})
		// a face-down candidate can never be ringed on the board
		expect(ringPlan(choice, s, 0, new Set([offer])).sheet).toEqual([
			hand,
			offer,
		])
		expect(ringPlan(choice, s, 1).sheet.length).toBe(2)
	})
})
