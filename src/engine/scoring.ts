// Final scoring (todo/10, rules/07 §7.4, rules/12 §12.27–§12.29). Implements
// the scoring pass deterministically and stores the result record on GameState
// via `finalizeGame` — idempotent, enters exactly once, and never mutates
// "playing the game" state (no cards move, no resources change; only the
// result record and the provisional `scoreVp` totals are written).
//
// Component order (rules/07 §7.4.1 table — the breakdown reads in this order):
//   1 Glory, 2 tokens on neutral Locations, 3 ENDGAME ops on in-play cards,
//   4 printed VP (incl. asterisk-VP via SPECIAL), 5 Focus × multiplier,
//   6 completed-mission VP (Advanced board side only).
//
// Step 0 removes the Reserve deck and the Development pile from consideration
// (§7.4 / §12.29) — they contribute nothing, not even printed VP or Focus.

import { cardDef } from './cards'
import {
	player,
	owned,
	zoneProps,
	type GameState,
	type EffectCtx,
} from './state'
import { evalAmount, resolveQuery, countIcons } from './queries/resolveQuery'
import { shipTokensAt } from './queries/board'
import { countIncidents } from './endgame'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'
import type { Effect } from './resolver/nodes'
import type { SpecialtyId } from '../data/ids'
import { describeOperation } from './describe'

// ---------------------------------------------------------------------------
// Result record shapes
// ---------------------------------------------------------------------------

export interface EndgameScore {
	card: CardInstanceId
	label: string
	vp: number
}

export interface PrintedVpEntry {
	card: CardInstanceId
	vp: number
}

export interface FocusScore {
	specialty: SpecialtyId
	multiplier: number
	cards: number
	vp: number
}

export interface ScoreBreakdown {
	total: number
	glory: number
	neutralTokens: { count: number; vp: number }
	endgame: EndgameScore[]
	printedVp: PrintedVpEntry[]
	focus: FocusScore[]
	/** Every specialty's icons × multiplier, also when `focusSuppressed` — set
	 *  by `finalizeGame` for the end screen, never part of `total`. Absent on
	 *  results finalised before it existed. */
	focusBySpecialty?: FocusScore[] | undefined
	missions: { index: number; vp: number }[]
	missionsCompleted: number
	focusSuppressed: boolean
}

export interface FinalScoreboard {
	breakdown: [ScoreBreakdown, ScoreBreakdown]
	winners: Seat[]
	/** BURN-only: owned INCIDENT counts (hand + discard + draw + log). */
	incidentCounts?: [number, number] | undefined
	/** CADET: the Burn is a loss (rules/10 §10.2 #5) — no winner. */
	cadetLoss: boolean
}

// ---------------------------------------------------------------------------
// Specialty track multipliers (rules/07 §7.1.4, §7.4.1 #5).
//
// The glyphs are printed per crew AND per board side (src/data/cards/boards/
// *.json → `PlayerState.tracks`, copied at setup). Scoring uses the *value* of
// the highest-reached glyph, not the step index (the p.25 worked example's
// "past the ×4 multiplier" → 4 × n Focus cards). The Basic side prints ×1 at
// step 0; the Advanced side prints no glyph there, so an Advanced track below
// its first glyph multiplies by 0.
// ---------------------------------------------------------------------------

export const SPECIALTY_ORDER: SpecialtyId[] = [
	'RESEARCH',
	'INFLUENCE',
	'MILITARY',
]

/** Highest multiplier VALUE reached on `specialty`'s track (rules/07 §7.1.4:
 *  the value, not the step index). 0 when no glyph is reached. */
export function highestMultiplierReached(
	state: GameState,
	seat: Seat,
	specialty: SpecialtyId,
): number {
	const p = player(state, seat)
	const pos = p.specialties[specialty]
	let value = 0
	for (const { step, value: v } of p.tracks[specialty]) {
		if (pos >= step && v > value) value = v
	}
	return value
}

// ---------------------------------------------------------------------------
// Scoring-local counting (step 0: Reserve + Development score nothing)
// ---------------------------------------------------------------------------

/** Is this card excluded from scoring — in the Reserve deck or Development
 *  pile (rules/12 §12.29), or back in a shared supply it left the player for?
 *  A returned INCIDENT sits at the bottom of the Incident deck (rules/08 →
 *  `return an INCIDENT`) but keeps its `owner` until someone takes it again
 *  (setOwner), so without this its −VP would still count against the player
 *  who returned it. The Burn count (endgame.countIncidents) already ignores
 *  it. Everything else a player owns counts. */
function excludedFromScoring(card: GameState['cards'][string]): boolean {
	switch (card.zone.k) {
		case 'RESERVE':
		case 'DEVELOPMENT':
		case 'INCIDENT_DECK':
		case 'ENCOUNTER_DECK':
		case 'MARKET_DECK':
		case 'MARKET_OFFER':
		case 'LOCATION_DECK':
			return true
		default:
			return false
	}
}

/** Focus icons over the scoring-relevant owned cards (Reserve/Development
 *  excluded — §12.29; rules/07 §7.4.1 #5 counts "your cards"). */
function countScoringFocusIcons(
	state: GameState,
	seat: Seat,
	specialty: SpecialtyId,
): number {
	let n = 0
	for (const iid of owned(state, seat)) {
		const card = state.cards[iid]
		if (!card || excludedFromScoring(card)) continue
		if (cardDef(card.def).focus === `FOCUS_${specialty}`) n++
	}
	return n
}

/** Focus icons × highest-reached multiplier for every specialty, whether or
 *  not a mission is completed (rules/07 §7.4.1 #5 without the §12.27 gate). */
export function focusBySpecialty(state: GameState, seat: Seat): FocusScore[] {
	return SPECIALTY_ORDER.map((specialty) => {
		const cards = countScoringFocusIcons(state, seat, specialty)
		const multiplier = highestMultiplierReached(state, seat, specialty)
		return { specialty, multiplier, cards, vp: cards * multiplier }
	})
}

/** Away Team + Ship tokens of `seat` at neutral (uncontrolled) Locations —
 *  1 VP each (rules/07 §7.4.1 #2). Controlled Locations (LOCATION_AREA) score
 *  nothing; only NEUTRAL_ZONE slots count. */
export function countNeutralTokens(state: GameState, seat: Seat): number {
	let count = 0
	for (const [iid, card] of Object.entries(state.cards)) {
		if (!card || card.zone.k !== 'NEUTRAL_ZONE') continue
		const loc = iid as CardInstanceId
		count += state.awayTeamsAt[loc]?.[seat] ?? 0
		count += shipTokensAt(state, loc, seat)
	}
	return count
}

// ---------------------------------------------------------------------------
// Operation evaluation (steps 3 & 4): walk the effect tree, sum SCORE_VP
// amounts with allowWildcard=false (rules/12 §12.12 — a WILDCARD satisfies no
// scoring predicate).
// ---------------------------------------------------------------------------

function* effectChildren(effect: Effect): Iterable<Effect> {
	switch (effect.k) {
		case 'SEQ':
			for (const step of effect.steps) yield step
			break
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
			yield effect.body
			break
		case 'CHOOSE_ONE':
			for (const option of effect.options) yield option.body
			break
		case 'PAY_THEN':
			yield effect.cost
			yield effect.body
			break
		case 'IF':
			yield effect.then
			if (effect.else !== undefined) yield effect.else
			break
		case 'REPEAT':
		case 'FOR_EACH':
		case 'LET':
			yield effect.body
			break
		case 'ATTACK':
			yield effect.body
			break
		case 'TRY':
			yield effect.body
			if (effect.otherwise !== undefined) yield effect.otherwise
			if (effect.test !== undefined) yield effect.test
			break
		default:
			break
	}
}

/** Sum the SCORE_VP amounts in an ENDGAME/SPECIAL operation's effect tree,
 *  evaluated for final scoring (wildcards count for nothing). IF conditions
 *  keep the default evaluation — real ENDGAME ops are flat SCORE_VP strips
 *  (docs/effect-dsl.md §7). */
function evalScoringOperation(
	state: GameState,
	effect: Effect,
	ctx: EffectCtx,
): number {
	let total = 0
	const visit = (node: Effect): void => {
		if (node.k === 'SCORE_VP') {
			total += scoreVpAmount(state, node, ctx)
			return
		}
		for (const child of effectChildren(node)) visit(child)
	}
	visit(effect)
	return total
}

/** ENDGAME/SPECIAL SCORE_VP amount with §12.29 applied. A COUNT over ALL_OWNED
 *  (e.g. PIC's "1 VP per ALLY you own") must exclude cards still sitting in
 *  the Reserve deck or Development pile — they were removed at step 0 and
 *  "score nothing". The generic ALL_OWNED query is zone-agnostic because
 *  mid-game counts legitimately include the piles (they are still your cards),
 *  so the setup-pile exclusion is applied only here, in the scoring pass. */
function scoreVpAmount(
	state: GameState,
	node: Extract<Effect, { k: 'SCORE_VP' }>,
	ctx: EffectCtx,
): number {
	const q = node.amount
	if (
		q !== null &&
		typeof q === 'object' &&
		q.k === 'COUNT' &&
		q.query.zones.length === 1 &&
		q.query.zones[0] === 'ALL_OWNED'
	) {
		const eligible = resolveQuery(state, q.query, ctx, {
			allowWildcard: false,
			actorMayOptIn: true,
		}).filter((iid) => !excludedFromScoring(state.cards[iid]!))
		return q.query.countIcons !== undefined
			? countIcons(state, eligible, q.query.countIcons)
			: eligible.length
	}
	return evalAmount(state, node.amount, ctx, { allowWildcard: false })
}

// ---------------------------------------------------------------------------
// The scoring pass
// ---------------------------------------------------------------------------

const emptyBreakdown = (): ScoreBreakdown => ({
	total: 0,
	glory: 0,
	neutralTokens: { count: 0, vp: 0 },
	endgame: [],
	printedVp: [],
	focus: [],
	missions: [],
	missionsCompleted: 0,
	focusSuppressed: false,
})

/** Final score for `seat` — deterministic, side-effect free (rules/07 §7.4).
 *  Reserve + Development are removed at step 0. */
export function score(state: GameState, seat: Seat): ScoreBreakdown {
	const b = emptyBreakdown()
	const p = player(state, seat)
	const ctx: EffectCtx = {
		actor: seat,
		source: '' as CardInstanceId,
		bindings: {},
	}

	// Step 1 — Glory: 1 VP per token in your pool.
	b.glory = p.resources.GLO
	b.total += b.glory

	// Step 2 — tokens on neutral Locations (not controlled ones).
	const neutralCount = countNeutralTokens(state, seat)
	b.neutralTokens = { count: neutralCount, vp: neutralCount }
	b.total += neutralCount

	// Step 3 — ENDGAME operations on in-play cards. A logged (or deck/hand)
	// card is NOT evaluated here — see step 4 (rules/12 §12.28).
	for (const iid of owned(state, seat)) {
		const card = state.cards[iid]
		if (!card || excludedFromScoring(card)) continue
		if (!zoneProps(card.zone).inPlay) continue
		const def = cardDef(card.def)
		def.operations.forEach((op) => {
			if (op.type !== 'ENDGAME') return
			// An ENDGAME restriction gates availability like any other restriction
			// (rules/07 §7.1.2) — unevaluated when the track is too low.
			if (
				op.requires !== undefined &&
				p.specialties[op.requires.specialty] < op.requires.min
			)
				return
			const vp = evalScoringOperation(state, op.effect, { ...ctx, source: iid })
			if (vp <= 0) return
			b.endgame.push({ card: iid, label: op.text ?? describeOperation(op), vp })
			b.total += vp
		})
	}

	// Step 4 — printed VP on all owned cards (hand/deck/discard/log/in play/
	// beamed); a vpAsterisk card's SPECIAL operation defines its value and
	// applies even out of play (rules/12 §12.28). Reserve/Development: nothing.
	for (const iid of owned(state, seat)) {
		const card = state.cards[iid]
		if (!card || excludedFromScoring(card)) continue
		const def = cardDef(card.def)
		let vp: number
		if (def.vpAsterisk) {
			let special = 0
			def.operations.forEach((op) => {
				if (op.type !== 'SPECIAL') return
				special += evalScoringOperation(state, op.effect, {
					...ctx,
					source: iid,
				})
			})
			vp = special
		} else {
			vp = def.vp
		}
		// INCIDENTs print negative VP (−2) and subtract from the total
		if (vp === 0) continue
		b.printedVp.push({ card: iid, vp })
		b.total += vp
	}

	// Step 5 — Focus icons × highest-reached multiplier value. Skipped entirely
	// when no mission is completed (rules/12 §12.27); surface `focusSuppressed`.
	b.missionsCompleted = p.missions.filter((m) => m.completed).length
	b.focusSuppressed = b.missionsCompleted === 0
	if (b.missionsCompleted > 0) {
		for (const f of focusBySpecialty(state, seat)) {
			if (f.cards === 0) continue
			b.focus.push(f)
			b.total += f.vp
		}
	}

	// Step 6 — completed-mission VP, Advanced board side only (rules/07 §7.4.1 #6).
	if (p.boardSide === 'ADVANCED') {
		for (const m of p.missions) {
			if (!m.completed) continue
			b.missions.push({ index: m.index, vp: m.vp })
			b.total += m.vp
		}
	}

	return b
}

// ---------------------------------------------------------------------------
// Game-end finalisation (idempotent)
// ---------------------------------------------------------------------------

function winningSeats(a: number, b: number): Seat[] {
	if (a > b) return [0]
	if (b > a) return [1]
	return [0, 1]
}

/** Compute the final result record for a finished game. Idempotent: no-ops on
 *  a null result or an already-finalised (COMPLETE) one, so it enters exactly
 *  once and stores the winner/scoreboard for the end screen. Never mutates
 *  play-state — only `result` and the provisional `scoreVp` totals are set.
 *
 *  Call whenever the game reaches GAME_OVER (the intent layer does this after
 *  every handled turn); the raw Burn/Resolution trigger stays observable on
 *  states that skip this step (unit tests of checkEndgame / handOffTurn). */
export function finalizeGame(state: GameState): GameState {
	if (state.result === null || state.result.kind === 'COMPLETE') return state

	const b0 = {
		...score(state, 0),
		focusBySpecialty: focusBySpecialty(state, 0),
	}
	const b1 = {
		...score(state, 1),
		focusBySpecialty: focusBySpecialty(state, 1),
	}
	const scoreboard: FinalScoreboard = {
		breakdown: [b0, b1],
		winners: [],
		cadetLoss: false,
	}

	if (state.result.kind === 'BURN') {
		const counts: [number, number] = [
			countIncidents(state, 0),
			countIncidents(state, 1),
		]
		scoreboard.incidentCounts = counts
		if (state.mode === 'CADET') {
			// rules/10 §10.2 #5: if the Burn is ever triggered, you lose.
			scoreboard.cadetLoss = true
			scoreboard.winners = []
		} else if (counts[0] !== counts[1]) {
			scoreboard.winners = [counts[0]! < counts[1]! ? 0 : 1]
		} else {
			// Burn tie → final scoring decides (rules/03 §3.1, rules/07 §7.4).
			scoreboard.winners = winningSeats(b0.total, b1.total)
		}
	} else {
		// FINAL_SCORING — the Resolution path. Cadet Training is solo: the virtual
		// opponent exists only as a query interceptor, so the human (seat 0) is the
		// sole participant — it "wins" by making the benchmark band on its own
		// score (rules/10 §10.4), never by outscoring the cadet.
		if (state.mode === 'CADET') {
			scoreboard.winners = [0]
			scoreboard.cadetLoss = false
		} else {
			scoreboard.winners = winningSeats(b0.total, b1.total)
		}
	}

	const scoreVp: GameState['scoreVp'] = { 0: b0.total, 1: b1.total }
	return { ...state, scoreVp, result: { kind: 'COMPLETE', scoreboard } }
}

/** Cadet Training benchmark band (rules/10 §10.4): ≥70 understanding,
 *  ≥100 proficient, >120 outstanding. */
export function cadetBenchmark(
	total: number,
): 'UNDERSTANDING' | 'PROFICIENT' | 'OUTSTANDING' | null {
	if (total >= 70 && total < 100) return 'UNDERSTANDING'
	if (total >= 100 && total <= 120) return 'PROFICIENT'
	if (total > 120) return 'OUTSTANDING'
	return null
}
