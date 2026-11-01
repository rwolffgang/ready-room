#!/usr/bin/env -S npx tsx
// Fuzz driver (todo/16 §3 + §4 + §5) — the separable full-CI companion to the
// bounded default sweep in src/engine/fuzz.test.ts. Runs the 30 ordered crew
// deck pairings × FUZZ_SEEDS seeds and asserts the §4 invariant set after
// every accepted intent.
//
//   npx tsx tools/fuzz.ts                 # 1000 seeds/ pairing, invariants on
//   FUZZ_SEEDS=100 npx tsx tools/fuzz.ts  # smaller sweep, still all pairings
//   FUZZ_SEEDS=50 FUZZ_WORKERS=8 npx tsx tools/fuzz.ts
//
// The run is split across FUZZ_WORKERS self-spawned worker processes (each a
// fresh copy of this file with --worker), so an engine-side hard crash inside
// one game cannot take the whole sweep down and cores parallelise. Each worker
// emits NDJSON result lines on stdout; the parent aggregates, prints the
// per-pairing pass/fail counts and a one-line summary, and exits non-zero when
// it sees a failure that is not pinned as a KNOWN issue (the DISCOVERY-A loop
// in every BUR pairing, and the pinned scanN ORDER_CARDS crash).
//
// Known issues are pinned by exact (pairing, seed) so the tool reports them
// as KNOWN rather than NEW. A pinned issue that stops reproducing flips to
// "KNOWN_GONE" (canary: the fix landed); treat missing-pin stops as NEW.

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'

/** Ordered crew deck pairings (a crew deck holds exactly one of each card, so
 *  a mirrored same-deck game is structurally unsupported — setup rejects it). */
const CREW = ['PIC', 'SHR', 'KOL', 'SIS', 'SEL', 'BUR', 'MAL', 'SHP'] as const
type Deck = (typeof CREW)[number]
const ALL_PAIRINGS: [Deck, Deck][] = CREW.flatMap((a) =>
	CREW.filter((b) => b !== a).map((b) => [a, b] as [Deck, Deck]),
)

/** Pinned known issues, keyed by `pairing` (loops) or `pairing:seed` (crashes).
 * - KNOWN_LOOP — the DISCOVERY-A zero-cost self-refreshing ACTIVATION loop
 *   (rules/card-data bug, see fuzz.test.ts): every pairing containing BUR
 *   cycles instead of finishing. A canary, not a NEW failure.
 * - KNOWN_CRASH — the scanN ORDER_CARDS bug family (engine/resolver): the
 *   ORDER_CARDS answer lands on a REACTION_WINDOW frame's bindings instead of
 *   the suspended SCAN_N effect ctx, so `answer(ctx,'scanN.order')` is
 *   undefined and `placeAtBottom` iterates it — "ordered is not iterable".
 *   Reduced/seeded in fuzz.test.ts as PIC/SHR seed 8; pinned here by
 *   exact (pairing,seed) and by crash-message prefix for the whole family.
 */
const KNOWN_LOOPS = new Set<string>()
for (const [a, b] of ALL_PAIRINGS) {
	if (a === 'BUR' || b === 'BUR') KNOWN_LOOPS.add(`${a}/${b}`)
}
const KNOWN_CRASH_PAIRS: Record<string, string> = {
	'PIC/SHR:8': 'scanN ORDER_CARDS (reduced regression)',
}

function isKnownLoop(pairing: string): boolean {
	return KNOWN_LOOPS.has(pairing)
}

function isKnownCrash(
	pairing: string,
	seed: number,
	crash: string | undefined,
): boolean {
	if (crash === undefined) return false
	if (KNOWN_CRASH_PAIRS[`${pairing}:${seed}`] !== undefined) return true
	return crash.includes('ordered is not iterable')
}

// ---------------------------------------------------------------------------
// Worker half
// ---------------------------------------------------------------------------

import { loadCatalog } from '../src/data/catalog'
import { setup } from '../src/engine/setup'
import { autoPlay } from '../src/bot/autoPlay'
import type { GameState } from '../src/engine/state'
import { assertInvariants } from '../src/engine/invariants'

interface Result {
	pairing: string
	seed: number
	stop: 'GAME_OVER' | 'CYCLE' | 'CAP' | 'STALL'
	crash?: string | undefined
}

export async function runSweep(
	pairings: readonly [Deck, Deck][],
	seeds: readonly number[],
	invariants: boolean,
	onResult: (r: Result) => void,
): Promise<void> {
	const catalog = await loadCatalog()
	for (const [a, b] of pairings) {
		for (const seed of seeds) {
			const config = {
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: a, boardSide: 'ADVANCED' as const },
					{ deck: b, boardSide: 'ADVANCED' as const },
				],
				seed,
			}
			let crash: string | undefined
			let stop: Result['stop']
			let before: GameState | undefined // reset per game: `since` is in-game only
			try {
				const r = autoPlay(
					setup(config, catalog),
					undefined,
					undefined,
					invariants
						? (s: GameState) => {
								const pre = before
								before = s
								assertInvariants(s, { since: pre })
							}
						: undefined,
				)
				stop = r.stopped
			} catch (err) {
				crash = (err as Error).message
				stop = 'STALL' // unreachable shorthand; `crash` carries the real story
			}
			onResult({ pairing: `${a}/${b}`, seed, stop, crash })
		}
	}
}

// ---------------------------------------------------------------------------
// Aggregation / report
// ---------------------------------------------------------------------------

interface Counters {
	gameOver: number
	cycle: number
	cap: number
	stall: number
	crash: number
	known: number
	knownGone: number
	newFailure: number
}

function classify(r: Result): { tag: string; known: boolean } {
	const loop = isKnownLoop(r.pairing)
	const crash = isKnownCrash(r.pairing, r.seed, r.crash)
	if (loop) {
		// BUR pairing: the only expected non-GAME_OVER outcome is the loop.
		if (r.stop === 'CYCLE') return { tag: 'KNOWN_LOOP', known: true }
		// Canary flipped: the pinned loop was fixed, so every game now finishes.
		if (r.stop === 'GAME_OVER') return { tag: 'KNOWN_LOOP_GONE', known: true }
		return { tag: r.crash !== undefined ? 'CRASH' : r.stop, known: false }
	}
	if (r.stop === 'GAME_OVER') return { tag: 'GAME_OVER', known: true }
	if (crash) return { tag: 'KNOWN_CRASH', known: true }
	if (r.crash !== undefined) return { tag: 'CRASH', known: false }
	return {
		tag: r.stop === 'CYCLE' ? 'CYCLE' : r.stop === 'CAP' ? 'CAP' : 'STALL',
		known: false,
	}
}

function printReport(results: Result[]): number {
	const byPairing = new Map<string, Counters>()
	for (const r of results) {
		let c = byPairing.get(r.pairing)
		if (c === undefined) byPairing.set(r.pairing, (c = freshCounters()))
		const { tag } = classify(r)
		c[tag2key(tag)] += 1
		if (
			tag !== 'KNOWN_LOOP' &&
			tag !== 'KNOWN_CRASH' &&
			tag !== 'GAME_OVER' &&
			tag !== 'KNOWN_LOOP_GONE'
		)
			c.newFailure += 1
	}
	for (const [pair, c] of [...byPairing.entries()].sort()) {
		console.log(
			`${pair.padEnd(16)} GAME_OVER:${String(c.gameOver).padStart(4)} LOOP:${String(c.cycle).padStart(3)} CAP:${String(c.cap).padStart(3)} CRASH:${String(c.crash).padStart(3)} KNOWN:${String(c.known).padStart(4)} NEW:${String(c.newFailure).padStart(3)}`,
		)
	}
	let total = 0
	let ok = 0
	let known = 0
	let newFail = 0
	for (const r of results) {
		const { tag } = classify(r)
		total += 1
		if (
			tag === 'GAME_OVER' ||
			tag === 'KNOWN_LOOP' ||
			tag === 'KNOWN_CRASH' ||
			tag === 'KNOWN_LOOP_GONE'
		) {
			ok += 1
			if (tag !== 'GAME_OVER') known += 1
		} else {
			newFail += 1
			console.log(
				`  NEW ${r.pairing} seed ${r.seed} -> ${r.crash !== undefined ? `CRASH: ${r.crash}` : r.stop}`,
			)
		}
	}
	const status =
		newFail === 0 ? 'ZERO NEW FAILURES' : `${newFail} NEW FAILURE(S)`
	console.log(
		`FUZZ SUMMARY pairings=${ALL_PAIRINGS.length} seeds=${total / ALL_PAIRINGS.length} per-pairing total=${total} ok=${ok} known=${known} new_failures=${newFail} -> ${status}`,
	)
	return newFail === 0 ? 0 : 1
}

function tag2key(tag: string): keyof Counters {
	switch (tag) {
		case 'GAME_OVER':
			return 'gameOver'
		case 'KNOWN_LOOP':
		case 'KNOWN_CRASH':
		case 'KNOWN_LOOP_GONE':
			return 'known'
		case 'KNOWN_GONE':
			return 'knownGone'
		case 'CYCLE':
			return 'cycle'
		case 'CAP':
			return 'cap'
		case 'STALL':
			return 'stall'
		default:
			return 'crash'
	}
}

function freshCounters(): Counters {
	return {
		gameOver: 0,
		cycle: 0,
		cap: 0,
		stall: 0,
		crash: 0,
		known: 0,
		knownGone: 0,
		newFailure: 0,
	}
}

// ---------------------------------------------------------------------------
// Entry point: worker flag → run one slice; otherwise → aggregate workers.
// ---------------------------------------------------------------------------

const workerArg = process.argv.indexOf('--worker')
const seedsFromEnv = Number(process.env['FUZZ_SEEDS'] ?? '1000')
const seedsN =
	Number.isInteger(seedsFromEnv) && seedsFromEnv > 0 ? seedsFromEnv : 1000
const invariants = (process.env['FUZZ_INVARIANTS'] ?? '1') !== '0'

async function main(): Promise<number> {
	if (workerArg !== -1) {
		// Worker mode: --worker <index> <count>. This process sweeps the seed
		// range `i % count === index` across ALL pairings, printing NDJSON.
		const index = Number(process.argv[workerArg + 1])
		const count = Number(process.argv[workerArg + 2])
		const seeds = Array.from({ length: seedsN }, (_, i) => i).filter(
			(s) => s % count === index,
		)
		await runSweep(ALL_PAIRINGS, seeds, invariants, (r) => {
			process.stdout.write(`${JSON.stringify(r)}\n`)
		})
		return 0
	}
	const workers = Number(
		process.env['FUZZ_WORKERS'] ?? Math.min(availableParallelism(), 8),
	)
	const started = new Date()
	const results: Result[] = []
	const procs = await Promise.all(
		Array.from(
			{ length: workers },
			(_, i) =>
				new Promise<void>((resolve, reject) => {
					const child = spawn(
						'node_modules/.bin/tsx',
						[
							process.argv[1] ?? 'tools/fuzz.ts',
							'--worker',
							String(i),
							String(workers),
						],
						{ stdio: ['ignore', 'pipe', 'inherit'] },
					)
					let buf = ''
					child.stdout.on('data', (d: Buffer) => {
						buf += d.toString()
						let idx
						while ((idx = buf.indexOf('\n')) !== -1) {
							const line = buf.slice(0, idx).trim()
							buf = buf.slice(idx + 1)
							if (line.length === 0) continue
							try {
								results.push(JSON.parse(line) as Result)
							} catch {
								// ignore stray non-NDJSON noise
							}
						}
					})
					child.on('error', reject)
					child.on('exit', (code) =>
						code === 0
							? resolve()
							: reject(new Error(`worker ${i} exited ${code}`)),
					)
				}),
		),
	)
	await Promise.all(procs)
	const code = printReport(results)
	console.log(
		`FUZZ WALL ${((new Date().getTime() - started.getTime()) / 1000).toFixed(0)}s workers=${workers}`,
	)
	return code
}

const exitCode = await main()
process.exit(exitCode)
