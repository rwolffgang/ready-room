#!/usr/bin/env -S npx tsx
// Solo arena CLI: a house bot (as the human) against the official solo Bot,
// over every Bot crew × difficulty level (src/bot/soloArena.ts).
//
//   npx tsx tools/solo-arena.ts --bot normal --games 4 --seed 7
//
// Prints the win rate per level (Wilson 95 %) and the mean VP margin. Exits 1
// on any abnormal stop (CYCLE / CAP / STALL / CRASH) or first-legal fallback.

import { loadCatalog } from '../src/data/catalog'
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
	const a = parseArgs(process.argv.slice(2))
	const spec = a['bot'] ?? 'normal'
	const games = Number(a['games'] ?? 2)
	const seed = Number(a['seed'] ?? 1)
	const catalog = await loadCatalog()
	const house = botFromSpec(spec, { catalog })
	const schedule = soloSchedule(catalog, games, seed)
	const t0 = performance.now()
	const results = schedule.map((g) => playSolo(catalog, house, g))
	const secs = (performance.now() - t0) / 1000
	console.log(
		`solo arena: ${spec} (as you) vs the official Bot — ${results.length} games, ${secs.toFixed(0)} s`,
	)
	for (const l of summarizeSolo(results))
		console.log(
			`  ${l.level.padEnd(10)} ${l.wins}/${l.games} won  ${(100 * l.winRate.p).toFixed(0)} % [${(100 * l.winRate.lo).toFixed(0)}, ${(100 * l.winRate.hi).toFixed(0)}]  mean margin ${l.meanMargin.toFixed(1)}`,
		)
	const bad = results.filter((r) => r.stopped !== 'GAME_OVER' || r.fallbacks > 0)
	for (const r of bad)
		console.log(
			`  !! ${r.bot} ${r.level} vs ${r.human} seed ${r.seed}: ${r.stopped}${r.crash !== undefined ? ` (${r.crash})` : ''}, ${r.fallbacks} fallback(s)`,
		)
	if (bad.length > 0) process.exit(1)
}

main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
