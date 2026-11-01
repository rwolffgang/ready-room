#!/usr/bin/env -S npx tsx
// Quick house-AI regression (`npm run bot:check`, about 1–2 min): run it after
// any card, expansion or rule change (docs/bot.md "Maintaining the house AI").
//
//   1. normal vs easy and normal vs normal over ALL 56 pairings with seat swaps
//   2. a few low-iteration ISMCTS games (hand-tuned leaf, and the learned leaf
//      when the bundled weights are compatible)
//   3. the bundled learned value's compatibility (featureHash, cardDataHash)
//   4. normal (as you) against the official solo Bot, every Bot crew × level
//
// It fails (exit 1) on any first-legal fallback by a house bot, any game that
// stops other than GAME_OVER (CYCLE / CAP / STALL / CRASH), or a crash of the
// tool itself. Incompatible weights are a warning only: Hard then falls back
// to the hand-tuned leaf, and `npm run bot:retrain` refreshes them.
//
// Options: --jobs J (default 6), --seed S (default 4242), --ismcts-games N
// (default 4 per spec), --out DIR (default .bot-data/check).

import { join } from 'node:path'

import { loadCatalog } from '../src/data/catalog'
import { cardDataHash } from '../src/data/cardDataHash'
import {
	featureHash,
	incompatibility,
	type ValueWeights,
} from '../src/bot/learned'
import { BUNDLED_VALUE, gatePassed } from '../src/bot/bundledValue'
import { runArena, summaryLine, type ArenaRunSummary } from './lib/arenaRun'
import { botFromSpec } from '../src/bot/registry'
import { playSolo, soloSchedule, summarizeSolo } from '../src/bot/soloArena'

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {}
	for (let i = 0; i < argv.length; i += 2) {
		const k = argv[i]!
		if (!k.startsWith('--') || argv[i + 1] === undefined)
			throw new Error(`bad argument '${k}'`)
		out[k.slice(2)] = argv[i + 1]!
	}
	return out
}

async function main(): Promise<void> {
	const t0 = performance.now()
	const a = parseArgs(process.argv.slice(2))
	const jobs = Number(a['jobs'] ?? 6)
	const seed = Number(a['seed'] ?? 4242)
	const ismctsGames = Number(a['ismcts-games'] ?? 4)
	const out = a['out'] ?? '.bot-data/check'
	const catalog = await loadCatalog()

	// the bundled learned value
	const problem = incompatibility(BUNDLED_VALUE, catalog)
	const w = BUNDLED_VALUE as Partial<ValueWeights>
	console.log('learned value (src/bot/weights/value.json):')
	if (w.format !== 1)
		console.log('  none shipped: Hard uses the hand-tuned leaf')
	else {
		console.log(
			`  layout ${w.layout}; featureHash ${w.featureHash} (current ${featureHash(w.layout!)}); cardDataHash ${w.cardDataHash} (current ${cardDataHash(catalog)})`,
		)
		const g = w.meta?.gate
		console.log(
			`  gate: ${g === undefined ? 'none' : `${g.passed ? 'passed' : 'NOT passed'}, ${(100 * g.winRate).toFixed(1)} % [${(100 * g.ci[0]).toFixed(1)}, ${(100 * g.ci[1]).toFixed(1)}] vs ${g.vs} over ${g.games} games`}`,
		)
		if (problem !== null)
			console.log(
				`  !! WARNING: incompatible (${problem}). Hard falls back to the hand-tuned leaf: run \`npm run bot:retrain\`.`,
			)
		else
			console.log(
				`  compatible; Hard ${gatePassed(BUNDLED_VALUE) ? 'uses it' : 'does not use it (gate not passed)'}`,
			)
	}
	const usable = w.format === 1 && problem === null

	const runs: { a: string; b: string; games: number; house: ('A' | 'B')[] }[] =
		[
			{ a: 'normal', b: 'easy', games: 112, house: ['A', 'B'] },
			{ a: 'normal', b: 'normal', games: 112, house: ['A', 'B'] },
			{
				a: 'ismcts:iters=16',
				b: 'normal',
				games: ismctsGames,
				house: ['A', 'B'],
			},
		]
	if (usable)
		runs.push({
			a: 'ismcts:iters=16,value=learned',
			b: 'normal',
			games: ismctsGames,
			house: ['A', 'B'],
		})
	const failures: string[] = []
	for (const [k, r] of runs.entries()) {
		const s: ArenaRunSummary = await runArena({
			a: r.a,
			b: r.b,
			games: r.games,
			seed: seed + k,
			jobs,
			out: join(out, `run${k}`),
		})
		console.log(summaryLine(s))
		for (const x of s.abnormal)
			failures.push(
				`${r.a} vs ${r.b}: ${x.game} stopped ${x.stopped}${x.crash !== undefined ? ` (${x.crash})` : ''}`,
			)
		for (const who of r.house) {
			const fb = s.timing[who].fallbacks
			if (fb > 0)
				failures.push(
					`${r.a} vs ${r.b}: bot ${who} needed ${fb} first-legal fallback(s) (${s.fallbackGames.map((g) => g.game).join(', ')})`,
				)
		}
	}
	// the official solo Bot: normal (as you) against every Bot crew × level
	const house = botFromSpec('normal', { catalog })
	const solo = soloSchedule(catalog, 1, seed).map((g) =>
		playSolo(catalog, house, g),
	)
	const levels = summarizeSolo(solo)
		.map((l) => `${l.level} ${l.wins}/${l.games}`)
		.join(', ')
	console.log(
		`solo vs the official Bot (normal as you): ${solo.length} games — ${levels}`,
	)
	for (const r of solo) {
		if (r.stopped !== 'GAME_OVER')
			failures.push(
				`solo ${r.bot} ${r.level} vs ${r.human}: stopped ${r.stopped}${r.crash !== undefined ? ` (${r.crash})` : ''}`,
			)
		if (r.fallbacks > 0)
			failures.push(
				`solo ${r.bot} ${r.level} vs ${r.human}: ${r.fallbacks} first-legal fallback(s)`,
			)
	}
	const secs = (performance.now() - t0) / 1000
	if (failures.length > 0) {
		console.log(`\nbot:check FAILED (${secs.toFixed(0)} s):`)
		for (const f of failures) console.log(`  !! ${f}`)
		process.exit(1)
	}
	console.log(
		`\nbot:check passed: 0 fallbacks, 0 abnormal stops (${secs.toFixed(0)} s)${usable ? '' : '; learned value not in use (see above)'}`,
	)
}

main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
