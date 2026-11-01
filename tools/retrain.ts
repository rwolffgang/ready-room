#!/usr/bin/env -S npx tsx
// The learned-value pipeline (house AI, docs/bot.md "Learned value"):
// self-play → train → arena gate. `npm run bot:retrain`.
//
//   1. fast self-play (tools/lib/selfplay.ts, mode fast) → <data>/it0
//   2. train (tools/train-value.ts --search) → <data>/candidate-value.json
//   3. optional Expert Iteration round (--ei-games > 0): ISMCTS self-play
//      with the candidate as its leaf value → <data>/it1, then retrain on
//      it0 + it1
//   4. gate: ismcts:iters=N,value=<candidate> vs ismcts:iters=N,value=<baseline>
//      at equal iterations, --gate-games games over all 56 pairings with seat
//      swaps, on --gate-seed (never a training seed)
//   5. the gate passes at a win rate ≥ 55 % with the 95 % Wilson interval's
//      lower bound above 50 %. Then, and only then, the candidate (with
//      meta.gate) is written to src/bot/weights/value.json. Otherwise it stays
//      in <data>/candidate-value.json and the run still exits 0.
//
// Options
//   --games N         fast self-play games (default 960)
//   --ei-games N      Expert Iteration self-play games (default 0: skip)
//   --ei-iters N      their ISMCTS iterations (default 64)
//   --gate-games N    gate games (default 200)
//   --iters N         gate ISMCTS iterations, both sides (default 100)
//   --jobs J          parallel games / training processes (default 6)
//   --seed S          first self-play seed (default 1001; fast uses S…S+3,
//                     the EI round S+100)
//   --gate-seed G     gate seed (default 9001)
//   --baseline B      the gate opponent's leaf: eval (hand-tuned, default) or
//                     learned (the bundled value.json: "beat the previous best")
//   --data DIR        work directory (default .bot-data)
//   --extra-data P    more record files/directories to train on (comma list)
//   --reuse           keep record files that already exist instead of
//                     playing them again
//   --candidate FILE  skip self-play and training: gate these weights
//   --search          train the train-value.ts --search grid and keep the best
//                     validation MSE instead of the shipped recipe (RECIPE)
//   --mix X           set the candidate's evalMix (the hand-tuned evaluation's
//                     share of the leaf value, 0–1) before gating
//
// Expected runtime on 6 jobs of a loaded 12-core machine: fast self-play
// ~7 min for 960 games, training ~2 min, the gate ~45–60 min for 200 games
// at 100 iterations (both sides search), an EI round of 200 games at 64
// iterations ~35 min more. About 1 h without EI, 1¾ h with one round.

import {
	copyFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

import { loadCatalog } from '../src/data/catalog'
import {
	incompatibility,
	type GateResult,
	type ValueWeights,
} from '../src/bot/learned'
import { BUNDLED_VALUE, gatePassed } from '../src/bot/bundledValue'
import { REPO_ROOT, runArena, summaryLine } from './lib/arenaRun'
import { selfplay, selfplayRuns } from './lib/selfplay'

/** The gate: a win rate of at least GATE_MIN_RATE and a CI lower bound above
 *  GATE_MIN_LOWER. */
export const GATE_MIN_RATE = 0.55
export const GATE_MIN_LOWER = 0.5

const WEIGHTS_FILE = join(REPO_ROOT, 'src', 'bot', 'weights', 'value.json')

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		if (!arg.startsWith('--')) throw new Error(`unexpected argument '${arg}'`)
		const v = argv[i + 1]
		if (v === undefined || v.startsWith('--')) out[arg.slice(2)] = 'true'
		else {
			out[arg.slice(2)] = v
			i++
		}
	}
	return out
}

const KNOWN = [
	'games',
	'ei-games',
	'ei-iters',
	'gate-games',
	'iters',
	'jobs',
	'seed',
	'gate-seed',
	'baseline',
	'data',
	'extra-data',
	'reuse',
	'candidate',
	'mix',
	'search',
]

/** The shipped training recipe (docs/bot.md "Learned value"): it won the
 *  arena screen, although a lower validation MSE did not predict that. */
export const RECIPE = [
	'--layout',
	'diff-masked',
	'--hidden',
	'32,16',
	'--target',
	'blend:0',
]

function train(
	dataSpec: string,
	out: string,
	jobs: number,
	trainedOn: string,
	search: boolean,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				...process.execArgv,
				join(REPO_ROOT, 'tools', 'train-value.ts'),
				'--data',
				dataSpec,
				...(search ? ['--search', '--jobs', String(jobs)] : RECIPE),
				'--out',
				out,
				'--report',
				out.replace(/\.json$/, '.report.json'),
				'--trained-on',
				trainedOn,
			],
			{ cwd: REPO_ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
		)
		child.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`train-value exited ${code}`)),
		)
	})
}

const minutes = (t0: number) =>
	`${((performance.now() - t0) / 60000).toFixed(1)} min`

async function main(): Promise<void> {
	const a = parseArgs(process.argv.slice(2))
	for (const k of Object.keys(a))
		if (!KNOWN.includes(k)) throw new Error(`unknown option --${k}`)
	const n = (k: string, d: number) => (a[k] === undefined ? d : Number(a[k]))
	const games = n('games', 960)
	const eiGames = n('ei-games', 0)
	const eiIters = n('ei-iters', 64)
	const gateGames = n('gate-games', 200)
	const iters = n('iters', 100)
	const jobs = n('jobs', 6)
	const seed = n('seed', 1001)
	const gateSeed = n('gate-seed', 9001)
	const baseline = a['baseline'] ?? 'eval'
	const data = a['data'] ?? '.bot-data'
	const reuse = a['reuse'] === 'true'
	const extra = (a['extra-data'] ?? '').split(',').filter(Boolean)
	if (baseline !== 'eval' && baseline !== 'learned')
		throw new Error('--baseline must be eval|learned')
	const trainingSeeds = new Set([
		...selfplayRuns('fast', games, seed).map((r) => r.seed),
		seed + 100,
	])
	if (trainingSeeds.has(gateSeed))
		throw new Error(`--gate-seed ${gateSeed} is a training seed`)
	const catalog = await loadCatalog()
	if (baseline === 'learned') {
		const problem = incompatibility(BUNDLED_VALUE, catalog)
		if (problem !== null || !gatePassed(BUNDLED_VALUE))
			throw new Error(
				`--baseline learned: the bundled weights are not usable (${problem ?? 'their gate did not pass'})`,
			)
	}
	mkdirSync(data, { recursive: true })
	const t0 = performance.now()

	const given = a['candidate']
	const candidate = given ?? join(data, 'candidate-value.json')
	if (given === undefined) {
		// 1. fast self-play
		const it0 = join(data, 'it0')
		const fastFiles = selfplayRuns('fast', games, seed).map((r) =>
			join(it0, `${r.name}.jsonl`),
		)
		if (reuse && fastFiles.every((f) => existsSync(f)))
			console.log(`self-play: reusing ${it0}`)
		else await selfplay({ mode: 'fast', games, seed, jobs, out: it0 })
		console.log(`[${minutes(t0)}] self-play done`)

		// 2. train
		const sources = [it0, ...extra]
		await train(
			sources.join(','),
			candidate,
			jobs,
			`iteration 0: ${games} fast self-play games (heuristics), seeds ${seed}–${seed + 3}${extra.length > 0 ? ` + ${extra.join(', ')}` : ''}`,
			a['search'] === 'true',
		)
		console.log(`[${minutes(t0)}] trained`)

		// 3. Expert Iteration round
		if (eiGames > 0) {
			const it1 = join(data, 'it1')
			const eiFile = join(
				it1,
				`${selfplayRuns('ismcts', eiGames, seed + 100, eiIters)[0]!.name}.jsonl`,
			)
			const eiWeights = join(data, 'ei-value.json')
			copyFileSync(candidate, eiWeights)
			if (reuse && existsSync(eiFile))
				console.log(`EI self-play: reusing ${eiFile}`)
			else
				await selfplay({
					mode: 'ismcts',
					games: eiGames,
					seed: seed + 100,
					jobs,
					out: it1,
					iters: eiIters,
					weights: eiWeights,
				})
			console.log(`[${minutes(t0)}] EI self-play done`)
			sources.push(it1)
			await train(
				sources.join(','),
				candidate,
				jobs,
				`expert iteration 1: ${games} fast self-play games + ${eiGames} ISMCTS (${eiIters} iterations, learned leaf vs hand-tuned leaf) games, seeds ${seed}–${seed + 3}, ${seed + 100}`,
				a['search'] === 'true',
			)
			console.log(`[${minutes(t0)}] retrained`)
		}
	} else console.log(`gating ${given} (no self-play, no training)`)

	// 4. gate
	const weights = JSON.parse(readFileSync(candidate, 'utf8')) as ValueWeights
	if (a['mix'] !== undefined) weights.evalMix = Number(a['mix'])
	if (weights.evalMix !== undefined)
		console.log(`evalMix ${weights.evalMix}: the hand-tuned share of the value`)
	writeFileSync(candidate, `${JSON.stringify(weights)}\n`)
	const problem = incompatibility(weights, catalog)
	if (problem !== null)
		throw new Error(`the candidate is not usable: ${problem}`)
	const specA = `ismcts:iters=${iters},value=cand`
	const specB = `ismcts:iters=${iters},value=${baseline}`
	console.log(
		`gate: ${specA} vs ${specB}, ${gateGames} games, seed ${gateSeed}`,
	)
	const s = await runArena({
		a: specA,
		b: specB,
		games: gateGames,
		seed: gateSeed,
		jobs,
		out: join(data, `gate-${gateSeed}`),
		weights: { cand: candidate },
		echo: true,
	})
	console.log(summaryLine(s))
	const stops = Object.entries(s.stops).filter(([k]) => k !== 'GAME_OVER')
	const r = s.total.aRate
	const passed =
		r.p >= GATE_MIN_RATE && r.lo > GATE_MIN_LOWER && stops.length === 0
	const gate: GateResult = {
		vs: specB.replace('value=learned', 'value=learned(previous)'),
		spec: specA,
		games: s.total.finished,
		seed: gateSeed,
		winRate: Number(r.p.toFixed(4)),
		ci: [Number(r.lo.toFixed(4)), Number(r.hi.toFixed(4))],
		passed,
	}
	weights.meta.gate = gate
	const json = `${JSON.stringify(weights)}\n`
	writeFileSync(candidate, json)
	if (passed) {
		writeFileSync(WEIGHTS_FILE, json)
		console.log(
			`PASSED (≥ ${Math.round(100 * GATE_MIN_RATE)} %, CI lower bound > ${Math.round(100 * GATE_MIN_LOWER)} %): wrote ${WEIGHTS_FILE} (${(json.length / 1024).toFixed(0)} KB). The Hard level now uses it.`,
		)
	} else {
		console.log(
			`NOT PASSED (needs ≥ ${Math.round(100 * GATE_MIN_RATE)} % with the CI lower bound > ${Math.round(100 * GATE_MIN_LOWER)} %${stops.length > 0 ? ', and no abnormal stops' : ''}): src/bot/weights/value.json is unchanged; the candidate is in ${candidate}.`,
		)
	}
	console.log(`[${minutes(t0)}] done`)
}

main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
