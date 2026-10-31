// What the Pocket Bridge works out for the player (docs/ui-mobile.md §4):
// the secure rule at each Location, who would win the Burn now, steps to the
// next multiplier, mission goals as a checklist, "if the game ended now", the
// Orders list, and which station holds a choice's candidates.
//
// Every answer comes from the engine's own rules — isSecured / tokensAt,
// countIncidents, highestMultiplierReached, evalPredicate, score,
// legalIntents — never a re-implementation. Pure functions over a GameState,
// so they test without a DOM and an online source can feed them later.

import type { GameState, PlayerState } from '../../engine/state'
import { otherSeat } from '../../engine/state'
import type { CardInstanceId } from '../../engine/ids'
import type { Intent } from '../../engine/intents'
import type { PendingChoice } from '../../engine/resolver/choices'
import type { Predicate, Seat, ZoneRef } from '../../engine/resolver/queries'
import type { SpecialtyId } from '../../data/ids'
import { isSecured, tokensAt } from '../../engine/queries/board'
import { evalPredicate } from '../../engine/queries/resolveQuery'
import { countIncidents } from '../../engine/endgame'
import {
	highestMultiplierReached,
	score,
	type ScoreBreakdown,
} from '../../engine/scoring'
import {
	describePredicate,
	describe as describeEffect,
} from '../../engine/describe'
import { shorthand, shorthandCondition, type Tok } from '../../engine/shorthand'
import { SKIP_LOCATION } from '../../engine/resolver/choices'
import { missionTitle } from '../../data/cardNames'

// ---------------------------------------------------------------------------
// Neutral Zone: the secure rule (rules/03 §3.4.1)
// ---------------------------------------------------------------------------

export interface SecureStatus {
	mine: number
	theirs: number
	securedBy: 'you' | 'them' | null
	/** tokens you still need here to secure it (0 once you have) */
	need: number
}

/** ≥3 tokens and ≥2 more than the opponent — through the engine's isSecured
 *  and tokensAt, read for both seats. */
export function secureStatus(
	state: GameState,
	loc: CardInstanceId,
	viewer: Seat,
): SecureStatus {
	const opp = otherSeat(viewer)
	const mine = tokensAt(state, loc, viewer)
	const theirs = tokensAt(state, loc, opp)
	const securedBy = isSecured(state, loc, viewer)
		? 'you'
		: isSecured(state, loc, opp)
			? 'them'
			: null
	const need =
		securedBy === 'you' ? 0 : Math.max(3 - mine, theirs + 2 - mine, 0)
	return { mine, theirs, securedBy, need }
}

/** The secure status in words: a headline and what it takes from here (the
 *  phone's Sector tiles and the console's Neutral Zone close-up). */
export function secureCopy(
	s: SecureStatus,
	oppName: string,
): { cls: string; head: string; note: string } {
	const score = `${s.mine} vs ${s.theirs}`
	if (s.securedBy === 'you')
		return {
			cls: 'me',
			head: `Secured by you · ${score}`,
			note: 'At your next Control step you may take control of it.',
		}
	if (s.securedBy === 'them')
		return {
			cls: 'them',
			head: `Secured by ${oppName} · ${score}`,
			note: `${oppName} may take it at their next Control step. You need ${s.need} more token${s.need === 1 ? '' : 's'} here.`,
		}
	return {
		cls: 'none',
		head: `${s.mine > 0 && s.theirs > 0 ? 'Contested' : s.mine + s.theirs === 0 ? 'Open' : 'Not secured'} · ${score}`,
		note: `You need ${s.need} more token${s.need === 1 ? '' : 's'} here to secure it.`,
	}
}

// ---------------------------------------------------------------------------
// The Burn: fewer Incidents wins (rules/03 §3.1)
// ---------------------------------------------------------------------------

export interface BurnForecast {
	/** cards left in the Incident deck */
	left: number
	mine: number
	theirs: number
	leader: 'you' | 'them' | 'tie'
}

/** Needs the real state: countIncidents reads every owned card, and the
 *  count is public (every Incident is taken in the open). */
export function burnForecast(state: GameState, viewer: Seat): BurnForecast {
	const mine = countIncidents(state, viewer)
	const theirs = countIncidents(state, otherSeat(viewer))
	return {
		left: state.zones['INCIDENT_DECK']?.length ?? 0,
		mine,
		theirs,
		leader: mine < theirs ? 'you' : theirs < mine ? 'them' : 'tie',
	}
}

// ---------------------------------------------------------------------------
// Specialty tracks
// ---------------------------------------------------------------------------

export interface TrackForecast {
	specialty: SpecialtyId
	level: number
	/** the multiplier Focus icons score at right now */
	current: number
	/** the next printed glyph above the current value, if any */
	next: { step: number; value: number } | null
	stepsToNext: number | null
	notches: { step: number; value: number }[]
}

export function trackForecast(
	state: GameState,
	seat: Seat,
	specialty: SpecialtyId,
): TrackForecast {
	const p: PlayerState = state.players[seat]
	const level = p.specialties[specialty]
	const current = highestMultiplierReached(state, seat, specialty)
	const notches = [...p.tracks[specialty]].sort((a, b) => a.step - b.step)
	const next = notches.find((n) => n.step > level && n.value > current) ?? null
	return {
		specialty,
		level,
		current,
		next,
		stepsToNext: next === null ? null : next.step - level,
		notches,
	}
}

// ---------------------------------------------------------------------------
// Missions as a checklist
// ---------------------------------------------------------------------------

export interface GoalItem {
	toks: Tok[]
	english: string
	met: boolean
}

export interface MissionView {
	index: number
	title: string
	completed: boolean
	/** legal to complete right now: a COMPLETE_MISSION intent is listed */
	ready: boolean
	goals: GoalItem[]
	reward: Tok[]
	rewardEnglish: string
	vp: number
}

function safe<T>(fn: () => T, fallback: T): T {
	try {
		return fn()
	} catch {
		return fallback
	}
}

/** One row per top-level AND term of the goal predicate, each evaluated by
 *  the engine's own evalPredicate on the view the viewer is shown (goals read
 *  specialties and cards in play, which the view keeps) — the checklist
 *  cannot drift from the rules. Whether it can be completed now is the legal
 *  list's to say. */
export function missionView(
	state: GameState,
	seat: Seat,
	index: number,
	legal: readonly Intent[] = [],
): MissionView | null {
	const m = state.players[seat].missions[index]
	if (m === undefined) return null
	const terms: Predicate[] = m.goal.k === 'AND' ? m.goal.terms : [m.goal]
	const ctx = { actor: seat, source: '' as CardInstanceId, bindings: {} }
	const goals = terms.map((t) => ({
		toks: safe(() => shorthandCondition(t), []),
		english: safe(() => describePredicate(t), ''),
		met: safe(() => evalPredicate(state, t, ctx), false),
	}))
	return {
		index,
		title: missionTitle(m),
		completed: m.completed,
		ready:
			!m.completed &&
			legal.some((it) => it.t === 'COMPLETE_MISSION' && it.index === index),
		goals,
		reward: safe(() => shorthand(m.reward), []),
		rewardEnglish: safe(() => describeEffect(m.reward), ''),
		vp: m.vp,
	}
}

// ---------------------------------------------------------------------------
// If the game ended now
// ---------------------------------------------------------------------------

export interface ScoreNow {
	breakdown: ScoreBreakdown
	/** Focus VP the same cards would score once a mission is completed — the
	 *  "Focus scores 0 until a mission is completed" warning (rules/12 §12.27) */
	focusWouldBe: number
}

export function scoreNow(state: GameState, seat: Seat): ScoreNow {
	const breakdown = score(state, seat)
	let focusWouldBe = breakdown.focus.reduce((a, f) => a + f.vp, 0)
	if (breakdown.focusSuppressed) {
		const p = state.players[seat]
		const done = {
			...p,
			missions: p.missions.map((m, i) =>
				i === 0 ? { ...m, completed: true } : m,
			),
		}
		const players: GameState['players'] =
			seat === 0 ? [done, state.players[1]] : [state.players[0], done]
		focusWouldBe = score({ ...state, players }, seat).focus.reduce(
			(a, f) => a + f.vp,
			0,
		)
	}
	return { breakdown, focusWouldBe }
}

// ---------------------------------------------------------------------------
// Orders: every legal move right now, grouped by where the card is
// ---------------------------------------------------------------------------

export interface OrderGroup {
	label: string
	rows: Intent[]
}

const ZONE_GROUP: Partial<Record<ZoneRef['k'], string>> = {
	HAND: 'From hand',
	CAPTAIN: 'Captain',
	DUTY_OFFICER: 'Duty Officer',
	FLEET: 'Fleet',
	LOCATION_AREA: 'Locations',
	STATUS: 'Status',
}

/** PLAY / ACTIVATE / COMPLETE_MISSION rows from legalIntents; the step
 *  boundary (PASS / END_TURN) is the dock's primary button, not a row. */
export function orderGroups(
	legal: readonly Intent[],
	state: GameState,
): OrderGroup[] {
	const groups = new Map<string, Intent[]>()
	const push = (label: string, it: Intent) => {
		const arr = groups.get(label) ?? []
		arr.push(it)
		groups.set(label, arr)
	}
	for (const it of legal) {
		if (it.t === 'PLAY_CARD' || it.t === 'ACTIVATE') {
			const z = state.cards[it.iid]?.zone
			push(
				(z !== undefined ? ZONE_GROUP[z.k] : undefined) ?? 'On the table',
				it,
			)
		} else if (it.t === 'COMPLETE_MISSION') {
			push('Missions', it)
		}
	}
	const order = [
		'From hand',
		'Captain',
		'Duty Officer',
		'Fleet',
		'Locations',
		'Status',
		'On the table',
		'Missions',
	]
	return order
		.filter((l) => groups.has(l))
		.map((label) => ({ label, rows: groups.get(label)! }))
}

export function orderCount(legal: readonly Intent[]): number {
	return legal.filter(
		(it) =>
			it.t === 'PLAY_CARD' ||
			it.t === 'ACTIVATE' ||
			it.t === 'COMPLETE_MISSION',
	).length
}

// ---------------------------------------------------------------------------
// Stations and the candidates of a choice
// ---------------------------------------------------------------------------

export type Station = 'sector' | 'ship' | 'crew'

/** The station that draws a card in `zone` as a tile (null: nowhere). */
export function stationOf(zone: ZoneRef, viewer: Seat): Station | null {
	switch (zone.k) {
		case 'MARKET_OFFER':
		case 'NEUTRAL_ZONE':
			return 'sector'
		case 'CAPTAIN':
		case 'DUTY_OFFICER':
		case 'FLEET':
		case 'LOCATION_AREA':
		case 'STAGING':
			return zone.seat === viewer ? 'ship' : null
		default:
			return null
	}
}

/** Every card a choice asks about, once each, in the order the engine listed
 *  them (a greyed card may also be among the candidates). */
export function choiceCards(choice: PendingChoice): CardInstanceId[] {
	switch (choice.k) {
		case 'CHOOSE_CARDS':
			return [
				...new Set([
					...choice.candidates,
					...(choice.disabled ?? []).map((d) => d.iid),
				]),
			]
		case 'CHOOSE_LOCATION':
			return choice.candidates.filter((c) => c !== SKIP_LOCATION)
		default:
			return []
	}
}

export interface RingPlan {
	sector: CardInstanceId[]
	ship: CardInstanceId[]
	/** not drawn on any station: the sheet repeats these as tiles */
	sheet: CardInstanceId[]
	/** the station to show first (most candidates), or null */
	focus: Station | null
}

export function ringPlan(
	choice: PendingChoice,
	state: Pick<GameState, 'cards'>,
	viewer: Seat,
	hidden: ReadonlySet<string> = new Set(),
): RingPlan {
	const plan: RingPlan = { sector: [], ship: [], sheet: [], focus: null }
	for (const iid of choiceCards(choice)) {
		const z = state.cards[iid]?.zone
		const st = z !== undefined && !hidden.has(iid) ? stationOf(z, viewer) : null
		if (st === 'sector') plan.sector.push(iid)
		else if (st === 'ship') plan.ship.push(iid)
		else plan.sheet.push(iid)
	}
	if (plan.sector.length > 0 || plan.ship.length > 0)
		plan.focus = plan.ship.length > plan.sector.length ? 'ship' : 'sector'
	return plan
}
