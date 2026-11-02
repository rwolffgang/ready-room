// tools/game.ts — replay a game you are testing and print a readable summary.
//
// While `npm run dev` runs, every autosave is mirrored to `.debug/games/<id>.json`
// (vite.config.ts `debugGames`), so no copy-pasting of session JSON is needed:
//
//   npm run game                     # the most recently saved game
//   npm run game -- <id>             # a game by id (or a path to any session .json)
//   npm run game -- --list           # every mirrored game, newest first
//   npm run game -- --log 60         # show the last 60 log lines (default 30)
//   npm run game -- --at 42          # replay only the first 42 intents
//   npm run game -- --intents        # also print the intent log
//   npm run game -- --state          # dump the full replayed GameState as JSON
//
// Card ids are shown with their STCC names (joined in at runtime, never stored).

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCatalog } from '../src/data/catalog'
import { cardNameById, withCardNames } from '../src/data/cardNames'
import type { GameState } from '../src/engine/state'
import type { Session } from '../src/session/log'
import { replay, SESSION_VERSION } from '../src/session/log'
import { loadStccNode } from './stcc-node'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const GAMES_DIR = join(ROOT, '.debug', 'games')

interface Args {
	target: string | null
	list: boolean
	logLines: number
	at: number | null
	intents: boolean
	state: boolean
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		target: null,
		list: false,
		logLines: 30,
		at: null,
		intents: false,
		state: false,
	}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!
		if (a === '--list') args.list = true
		else if (a === '--intents') args.intents = true
		else if (a === '--state') args.state = true
		else if (a === '--log') args.logLines = Number(argv[++i])
		else if (a === '--at') args.at = Number(argv[++i])
		else args.target = a
	}
	return args
}

async function readSession(file: string): Promise<Session> {
	const raw = JSON.parse(await readFile(file, 'utf8')) as Session
	if (raw.version !== SESSION_VERSION)
		throw new Error(`${file}: not a v${SESSION_VERSION} session`)
	return raw
}

async function mirroredGames(): Promise<{ file: string; mtime: Date }[]> {
	let names: string[]
	try {
		names = (await readdir(GAMES_DIR)).filter((n) => n.endsWith('.json'))
	} catch {
		return []
	}
	const out = await Promise.all(
		names.map(async (n) => {
			const file = join(GAMES_DIR, n)
			return { file, mtime: (await stat(file)).mtime }
		}),
	)
	return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
}

async function resolveFile(target: string | null): Promise<string> {
	if (target === null) {
		const newest = (await mirroredGames())[0]
		if (newest === undefined) {
			throw new Error(
				`no games in ${GAMES_DIR} — run \`npm run dev\` and make a move`,
			)
		}
		return newest.file
	}
	if (target.endsWith('.json')) return resolve(target)
	return join(GAMES_DIR, `${target}.json`)
}

function label(defId: string): string {
	return `${cardNameById(defId)} (${defId})`
}

function cardLine(state: GameState, iid: string): string {
	const c = state.cards[iid]
	if (c === undefined) return iid
	const flags = [
		c.exhausted ? 'exhausted' : null,
		c.actionTokens > 0 ? `${c.actionTokens} action token(s)` : null,
		c.beamedTo !== null ? `beamed to ${c.beamedTo}` : null,
		...Object.entries(c.resourceTokens)
			.filter(([, n]) => (n ?? 0) > 0)
			.map(([r, n]) => `${n} ${r}`),
	].filter((f) => f !== null)
	return `${label(c.def)} #${iid}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`
}

/** Card names in engine text: `[[card:<def>]]` tokens and bare instance ids. */
function named(state: GameState, text: string): string {
	return withCardNames(text).replace(/\b(?:p\d|cm)#\d+/g, (iid) => {
		const c = state.cards[iid]
		return c === undefined ? iid : `${iid} (${cardNameById(c.def)})`
	})
}

/** Annotate every card instance id inside a value with its card name. */
function withIids(state: GameState, value: unknown): string {
	return JSON.stringify(
		value,
		(_k, v: unknown) =>
			typeof v === 'string' && state.cards[v] !== undefined
				? `${v} = ${label(state.cards[v].def)}`
				: v,
		2,
	)
}

function printZones(state: GameState, filter: (key: string) => boolean): void {
	for (const [key, iids] of Object.entries(state.zones)) {
		if (!filter(key) || iids.length === 0) continue
		console.log(`  ${key} (${iids.length})`)
		for (const iid of iids) console.log(`    ${cardLine(state, iid)}`)
	}
}

function summarise(session: Session, state: GameState, args: Args): void {
	const m = session.meta
	console.log(`Game ${session.id}  (${m.deckNames.join(' vs ')})`)
	console.log(
		`  seed ${session.setup.seed}, ${session.log.length} intents, saved ${m.updatedAt}`,
	)
	if (session.opponents !== undefined)
		console.log(`  house AI: ${JSON.stringify(session.opponents)}`)
	console.log(
		`Turn ${state.turnNumber}, ${state.phase.k === 'CLEANUP' ? `CLEANUP/${state.phase.sub}` : state.phase.k}, seat ${state.activeSeat} to act` +
			(state.result === null ? '' : `, result ${state.result.kind}`),
	)

	for (const p of state.players) {
		console.log(`\nSeat ${p.seat}: ${p.deckId} (${p.boardSide})`)
		console.log(
			`  resources DIL ${p.resources.DIL} LAT ${p.resources.LAT} GLO ${p.resources.GLO}` +
				`  actions ${p.actions.available} left, ${p.actions.spent} spent` +
				`  specialties R${p.specialties.RESEARCH} I${p.specialties.INFLUENCE} M${p.specialties.MILITARY}` +
				`  away teams ${p.awayTeamsInPool}/${p.awayTeamsTotal}  VP ${state.scoreVp[p.seat]}`,
		)
		printZones(
			state,
			(k) =>
				k.endsWith(`:${p.seat}`) &&
				!k.startsWith('DRAW') &&
				!k.startsWith('NEUTRAL_ZONE'),
		)
		const draw = state.zones[`DRAW:${p.seat}`] ?? []
		console.log(`  DRAW (${draw.length}, top first)`)
	}

	console.log('\nShared')
	printZones(
		state,
		(k) =>
			k.startsWith('MARKET_OFFER') ||
			k.startsWith('NEUTRAL_ZONE') ||
			k === 'STARDATE_PILE',
	)
	const at = Object.entries(state.awayTeamsAt).filter(([, [a, b]]) => a + b > 0)
	if (at.length > 0) {
		console.log('  Away Teams')
		for (const [loc, [a, b]] of at)
			console.log(
				`    ${state.cards[loc] !== undefined ? cardLine(state, loc) : loc}: seat0 ${a}, seat1 ${b}`,
			)
	}

	if (state.pendingChoice !== null) {
		const { prompt, ...rest } = state.pendingChoice
		console.log(`\nPending choice: ${named(state, prompt)}`)
		console.log(withIids(state, rest))
	} else if (state.stack.length > 0) {
		console.log(`\nStack: ${state.stack.length} frame(s) (no pending choice)`)
	}

	const log = state.log.slice(-args.logLines)
	console.log(`\nLog (last ${log.length} of ${state.log.length})`)
	for (const e of log) {
		const seat = e.seat === undefined ? '  ' : `s${e.seat}`
		console.log(`  ${seat} ${e.kind.padEnd(10)} ${named(state, e.message)}`)
	}

	if (args.intents) {
		console.log('\nIntents')
		session.log.forEach((intent, i) =>
			console.log(
				`  ${String(i).padStart(4)} ${withIids(state, intent).replace(/\s+/g, ' ')}`,
			),
		)
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	if (args.list) {
		for (const { file, mtime } of await mirroredGames()) {
			const s = await readSession(file)
			console.log(
				`${s.id}  ${mtime.toISOString()}  ${s.meta.deckNames.join(' vs ')}  turn ${s.meta.turnNumber}, ${s.log.length} intents`,
			)
		}
		return
	}
	const file = await resolveFile(args.target)
	const saved = await readSession(file)
	const session =
		args.at === null ? saved : { ...saved, log: saved.log.slice(0, args.at) }
	await loadStccNode()
	const state = replay(session, await loadCatalog())
	if (args.state) {
		console.log(JSON.stringify(state, null, 2))
		return
	}
	summarise(session, state, args)
}

// piping into `head` closes stdout early; that is not an error
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EPIPE') process.exit(0)
	throw err
})

main().catch((err: unknown) => {
	console.error((err as Error).message)
	process.exit(1)
})
