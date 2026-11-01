// Bot-vs-bot arena core (house AI, todo/15 §4): the schedule, one match and
// the statistics. Pure and DOM-free (no fs, no workers); tools/arena.ts is the
// CLI that runs it in parallel and writes the files.
//
// Schedule. Game index g belongs to pair p = ⌊g/2⌋ and is the swapped half
// when g is odd. Pair p plays deck pairing `pairings[p mod P]` with seed
// `deriveSeed(base, p)`. Both halves of a pair run the SAME setup (decks,
// board sides, seed, so the same starting seat); only the bots trade seats.
// Each bot therefore plays the same deck from the same seat once, which
// cancels first-player and deck advantages over a pair.
//
// Labels. Bot A and bot B are the two contestants; seat 0 holds A unless the
// game is swapped. Every result is reported from A's side.

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { Seat } from '../engine/resolver/queries'
import type { DeckId } from '../data/ids'
import { score } from '../engine/scoring'
import { createSession, refreshMeta, type Session } from '../session/log'
import { playBots, type AutoPlayStop } from './autoPlay'
import { features } from './evaluate'
import type { Bot } from './types'

// ---------------------------------------------------------------------------
// Pairings and schedule
// ---------------------------------------------------------------------------

/** The crew decks, in the order src/engine/fuzz.test.ts uses. */
export const CREW_DECKS = [
	'PIC',
	'SHR',
	'KOL',
	'SIS',
	'SEL',
	'BUR',
	'MAL',
	'SHP',
] as const

export type BoardSide = 'BASIC' | 'ADVANCED'

export interface Pairing {
	decks: [DeckId, DeckId]
	sides: [BoardSide, BoardSide]
}

/** 'PIC-SHR' (Advanced sides) or 'PIC.B-SHR.A' when a side is Basic. */
export function pairingKey(p: Pairing): string {
	const one = (i: 0 | 1) =>
		p.sides[i] === 'ADVANCED' ? p.decks[i] : `${p.decks[i]}.B`
	return `${one(0)}-${one(1)}`
}

/** Every ordered pairing of two different crew decks, Advanced sides (the
 *  fuzz grid: 56 pairings; a crew deck cannot play itself). */
export function allPairings(): Pairing[] {
	const out: Pairing[] = []
	for (const a of CREW_DECKS)
		for (const b of CREW_DECKS)
			if (a !== b) out.push({ decks: [a, b], sides: ['ADVANCED', 'ADVANCED'] })
	return out
}

/** Parse a pairing list: 'all', 'nobur' (all without the BUR deck), or a
 *  comma list of keys such as 'PIC-SHR,KOL.B-SIS'. */
export function parsePairings(spec: string): Pairing[] {
	if (spec === 'all') return allPairings()
	if (spec === 'nobur')
		return allPairings().filter((p) => !p.decks.includes('BUR'))
	return spec.split(',').map((key) => {
		const halves = key.trim().split('-')
		if (halves.length !== 2) throw new Error(`bad pairing '${key}'`)
		const parse = (h: string): [DeckId, BoardSide] => {
			const [deck, side] = h.split('.')
			if (!(CREW_DECKS as readonly string[]).includes(deck!))
				throw new Error(`bad deck '${deck}' in pairing '${key}'`)
			if (side !== undefined && side !== 'A' && side !== 'B')
				throw new Error(`bad board side '${side}' in pairing '${key}'`)
			return [deck as DeckId, side === 'B' ? 'BASIC' : 'ADVANCED']
		}
		const [d0, s0] = parse(halves[0]!)
		const [d1, s1] = parse(halves[1]!)
		if (d0 === d1)
			throw new Error(`pairing '${key}': a deck cannot play itself`)
		return { decks: [d0, d1], sides: [s0, s1] }
	})
}

/** The seed of pair `pair` under base seed `base` (a 32-bit mix, so nearby
 *  bases and pairs give unrelated games). */
export function deriveSeed(base: number, pair: number): number {
	let h =
		(Math.imul(base | 0, 0x9e3779b1) ^ Math.imul(pair + 1, 0x85ebca77)) >>> 0
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
	h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
	return (h ^ (h >>> 16)) >>> 0
}

export interface ScheduledGame {
	index: number
	pair: number
	pairing: Pairing
	seed: number
	/** true: bot A sits in seat 1. */
	swap: boolean
}

/** The game at schedule index `index`. */
export function scheduleGame(
	index: number,
	baseSeed: number,
	pairings: readonly Pairing[],
): ScheduledGame {
	const pair = Math.floor(index / 2)
	return {
		index,
		pair,
		pairing: pairings[pair % pairings.length]!,
		seed: deriveSeed(baseSeed, pair),
		swap: index % 2 === 1,
	}
}

/** The two-player setup of a pairing. */
export function matchConfig(pairing: Pairing, seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: pairing.decks[0], boardSide: pairing.sides[0] },
			{ deck: pairing.decks[1], boardSide: pairing.sides[1] },
		],
		seed,
	}
}

/** `<pairing>-<seed>-<swap>`: the session file stem and the record game id. */
export function gameName(
	pairing: Pairing,
	seed: number,
	swap: boolean,
): string {
	return `${pairingKey(pairing)}-${seed}-${swap ? 1 : 0}`
}

// ---------------------------------------------------------------------------
// One match
// ---------------------------------------------------------------------------

export type MatchStop = AutoPlayStop | 'CRASH'

/** One training record: a decision of `seat`, its features before deciding,
 *  and the game's eventual outcome and margin from that seat's side. */
export interface DecisionRecord {
	game: string
	seat: Seat
	turn: number
	/** decision index within the game */
	step: number
	features: number[]
	/** the opponent's features at the same state (a value fit wants both) */
	opp: number[]
	outcome: 1 | 0 | -1
	margin: number
}

export interface MatchResult {
	game: string
	pairing: string
	seed: number
	swap: boolean
	/** the seat bot A played */
	aSeat: Seat
	stopped: MatchStop
	/** the error message when stopped === 'CRASH' */
	crash?: string | undefined
	/** the step a CYCLE was first seen */
	cycleStart?: number | undefined
	/** null when the game did not reach GAME_OVER */
	winner: 'A' | 'B' | 'draw' | null
	burn: boolean
	vp: { A: number; B: number }
	/** A − B */
	margin: number
	intents: number
	turns: number
	fallbacks: { A: number; B: number }
	/** ms per decision, per bot */
	decisionMs: { A: number[]; B: number[] }
	/** with opts.session */
	session?: Session | undefined
	/** with opts.recordEvery */
	records?: DecisionRecord[] | undefined
}

export interface PlayMatchOptions {
	cap?: number | undefined
	/** Record features every K-th decision (1 = all); omit for none. */
	recordEvery?: number | undefined
	/** Build the replayable Session; `now` stamps its meta (the arena passes
	 *  a fixed time, so files are reproducible). */
	session?: { now: () => Date } | undefined
	/** Clock for decision timing (default performance.now()). */
	clock?: (() => number) | undefined
}

/** Wrap a bot so each decide() call's duration lands in `sink`. */
function timed(bot: Bot, sink: number[], clock: () => number): Bot {
	return {
		id: bot.id,
		decide(state, seat, legal) {
			const t0 = clock()
			try {
				return bot.decide(state, seat, legal)
			} finally {
				sink.push(clock() - t0)
			}
		},
	}
}

/**
 * Play one game: bot A in seat 0 (seat 1 when `swap`), bot B in the other,
 * on `matchConfig(pairing, seed)`. Never throws: an engine crash is reported
 * as stopped 'CRASH' with the message.
 */
export function playMatch(
	catalog: CardCatalog,
	pairing: Pairing,
	seed: number,
	botA: Bot,
	botB: Bot,
	swap: boolean,
	opts: PlayMatchOptions = {},
): MatchResult {
	const clock = opts.clock ?? (() => performance.now())
	const aSeat: Seat = swap ? 1 : 0
	const msA: number[] = []
	const msB: number[] = []
	const a = timed(botA, msA, clock)
	const b = timed(botB, msB, clock)
	const bots: [Bot, Bot] = swap ? [b, a] : [a, b]
	const config = matchConfig(pairing, seed)
	const game = gameName(pairing, seed, swap)
	const every = opts.recordEvery
	const pending: Omit<DecisionRecord, 'outcome' | 'margin'>[] = []
	const log: Intent[] = []

	let final: GameState
	let stopped: MatchStop
	let crash: string | undefined
	let cycleStart: number | undefined
	const fb: [number, number] = [0, 0]
	const start = setup(config, catalog)
	let prev = start
	final = start
	try {
		const r = playBots(start, bots, {
			cap: opts.cap,
			onStep(s, intent, step, { seat }) {
				log.push(intent)
				if (every !== undefined && step % every === 0) {
					pending.push({
						game,
						seat,
						turn: prev.turnNumber,
						step,
						features: features(prev, seat),
						opp: features(prev, (1 - seat) as Seat),
					})
				}
				prev = s
				final = s
			},
		})
		final = r.state
		stopped = r.stopped
		cycleStart = r.cycle?.startStep
		fb[0] = r.fallbacksBySeat[0]
		fb[1] = r.fallbacksBySeat[1]
		// the cycle-detecting step is not passed to onStep
		if (r.intents.length > log.length) log.push(...r.intents.slice(log.length))
	} catch (e) {
		stopped = 'CRASH'
		crash = (e as Error).message
	}

	const res = final.result
	let vp: [number, number]
	let winner: MatchResult['winner'] = null
	let burn = false
	if (res !== null && res.kind === 'COMPLETE') {
		const board = res.scoreboard
		vp = [board.breakdown[0].total, board.breakdown[1].total]
		burn = board.incidentCounts !== undefined
		if (board.winners.length === 1)
			winner = board.winners[0] === aSeat ? 'A' : 'B'
		else if (board.winners.length === 2) winner = 'draw'
	} else {
		vp = [score(final, 0).total, score(final, 1).total]
	}
	const bSeat = (1 - aSeat) as Seat
	const result: MatchResult = {
		game,
		pairing: pairingKey(pairing),
		seed,
		swap,
		aSeat,
		stopped,
		...(crash !== undefined ? { crash } : {}),
		...(cycleStart !== undefined ? { cycleStart } : {}),
		winner,
		burn,
		vp: { A: vp[aSeat], B: vp[bSeat] },
		margin: vp[aSeat] - vp[bSeat],
		intents: log.length,
		turns: final.turnNumber,
		fallbacks: { A: fb[aSeat], B: fb[bSeat] },
		decisionMs: { A: msA, B: msB },
	}
	if (every !== undefined) {
		result.records = pending.map((p) => {
			const mine = p.seat === aSeat ? 'A' : 'B'
			const outcome: 1 | 0 | -1 =
				winner === null || winner === 'draw' ? 0 : winner === mine ? 1 : -1
			const margin = vp[p.seat] - vp[(1 - p.seat) as Seat]
			return { ...p, outcome, margin }
		})
	}
	if (opts.session !== undefined) {
		const now = opts.session.now
		const fresh = createSession(config, catalog, { id: `arena-${game}`, now })
		result.session = refreshMeta({ ...fresh, log }, final, catalog, now)
	}
	return result
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
	if (xs.length === 0) return NaN
	let s = 0
	for (const x of xs) s += x
	return s / xs.length
}

/** Standard error of the mean (sample standard deviation / √n). */
export function stdErr(xs: readonly number[]): number {
	const n = xs.length
	if (n < 2) return NaN
	const m = mean(xs)
	let ss = 0
	for (const x of xs) ss += (x - m) * (x - m)
	return Math.sqrt(ss / (n - 1) / n)
}

/** The q-quantile (0..1) by linear interpolation between order statistics. */
export function quantile(xs: readonly number[], q: number): number {
	if (xs.length === 0) return NaN
	const s = [...xs].sort((x, y) => x - y)
	const pos = (s.length - 1) * Math.min(1, Math.max(0, q))
	const lo = Math.floor(pos)
	const hi = Math.ceil(pos)
	return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo)
}

/** Wilson score interval of `k` successes in `n` trials (z = 1.96 → 95 %).
 *  `k` may be fractional (a draw counted as half a win). */
export function wilson(
	k: number,
	n: number,
	z = 1.96,
): { p: number; lo: number; hi: number } {
	if (n <= 0) return { p: NaN, lo: 0, hi: 1 }
	const p = k / n
	const z2 = z * z
	const denom = 1 + z2 / n
	const centre = (p + z2 / (2 * n)) / denom
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
	return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

export interface Tally {
	games: number
	/** games that reached GAME_OVER */
	finished: number
	aWins: number
	bWins: number
	draws: number
	/** (A wins + draws/2) / finished, with its 95 % Wilson interval */
	aRate: { p: number; lo: number; hi: number }
	marginMean: number
	marginSe: number
	intentsMean: number
	burns: number
}

export function tally(results: readonly MatchResult[]): Tally {
	const done = results.filter((r) => r.winner !== null)
	const aWins = done.filter((r) => r.winner === 'A').length
	const bWins = done.filter((r) => r.winner === 'B').length
	const draws = done.filter((r) => r.winner === 'draw').length
	const margins = done.map((r) => r.margin)
	return {
		games: results.length,
		finished: done.length,
		aWins,
		bWins,
		draws,
		aRate: wilson(aWins + draws / 2, done.length),
		marginMean: mean(margins),
		marginSe: stdErr(margins),
		intentsMean: mean(results.map((r) => r.intents)),
		burns: done.filter((r) => r.burn).length,
	}
}

export interface BotTiming {
	decisions: number
	msMean: number
	msP90: number
	msMax: number
	fallbacks: number
}

export interface ArenaSummary {
	a: string
	b: string
	total: Tally
	timing: { A: BotTiming; B: BotTiming }
	stops: Record<string, number>
	/** every game that did not reach GAME_OVER */
	abnormal: {
		game: string
		stopped: MatchStop
		crash?: string | undefined
		cycleStart?: number | undefined
	}[]
	/** games where a bot needed the first-legal fallback */
	fallbackGames: { game: string; A: number; B: number }[]
	byPairing: Record<string, Tally>
	/** by A's seat */
	bySeat: { 0: Tally; 1: Tally }
}

function botTiming(results: readonly MatchResult[], who: 'A' | 'B'): BotTiming {
	const all: number[] = []
	let fallbacks = 0
	for (const r of results) {
		for (const x of r.decisionMs[who]) all.push(x)
		fallbacks += r.fallbacks[who]
	}
	let max = 0
	for (const x of all) if (x > max) max = x
	return {
		decisions: all.length,
		msMean: mean(all),
		msP90: quantile(all, 0.9),
		msMax: max,
		fallbacks,
	}
}

export function summarize(
	a: string,
	b: string,
	results: readonly MatchResult[],
): ArenaSummary {
	const stops: Record<string, number> = {}
	for (const r of results) stops[r.stopped] = (stops[r.stopped] ?? 0) + 1
	const groups = new Map<string, MatchResult[]>()
	for (const r of results) {
		const g = groups.get(r.pairing) ?? []
		g.push(r)
		groups.set(r.pairing, g)
	}
	const byPairing: Record<string, Tally> = {}
	for (const [k, g] of groups) byPairing[k] = tally(g)
	return {
		a,
		b,
		total: tally(results),
		timing: { A: botTiming(results, 'A'), B: botTiming(results, 'B') },
		stops,
		abnormal: results
			.filter((r) => r.stopped !== 'GAME_OVER')
			.map((r) => ({
				game: r.game,
				stopped: r.stopped,
				...(r.crash !== undefined ? { crash: r.crash } : {}),
				...(r.cycleStart !== undefined ? { cycleStart: r.cycleStart } : {}),
			})),
		fallbackGames: results
			.filter((r) => r.fallbacks.A + r.fallbacks.B > 0)
			.map((r) => ({ game: r.game, ...r.fallbacks })),
		byPairing,
		bySeat: {
			0: tally(results.filter((r) => r.aSeat === 0)),
			1: tally(results.filter((r) => r.aSeat === 1)),
		},
	}
}
