// Cross-checks our card defs against the fetched STCC database by cardId.
// Reports: our cards with no STCC record, field mismatches (name, suit, traits,
// VP, start position, location tier, skills/focus, away teams), the crew-board
// missions vs the STCC mission records (name + vp, by the mission's cardId),
// the solo-only cards (out of scope until a Solo/Bot mode exists), and the
// STCC cards we have not implemented yet.
//
// Run: `npx tsx tools/crosscheck-stcc.ts [--missing]` after `npm run fetch-cards`.

import { loadCatalog } from '../src/data/catalog'
import type { CardDef } from '../src/data/schema'
import type { CardCatalog } from '../src/engine/setup'
import type { MissionState } from '../src/engine/state'
import { normalizeCardNumber, toTraitId, type StccCard } from '../src/data/stcc'
import { loadStccBotsNode, loadStccNode } from './stcc-node'
import { crosscheckBots } from './lib/crosscheckBots'
import { cardName } from '../src/data/cardNames'

const POSITION: Record<string, string | null> = {
	Available: 'AVAILABLE',
	Reserve: 'RESERVE',
	Development: 'DEVELOPMENT',
	Discard: 'DISCARD',
	Deployed: 'DEPLOYED',
	'Controlled Location': 'CONTROLLED_LOCATION',
	'Incident Deck': 'INCIDENT_DECK',
}

/** The STCC database is the source of truth: it carries the designers'
 *  errata, so it is newer than any printed scan. The only accepted
 *  differences are cards we *model* differently while meaning the same
 *  thing, or cannot model yet: `cardId → field → reason`. */
const ACCEPTED: Record<string, Record<string, string>> = {
	'1BUR20/26': {
		skills:
			'two variable skills whose passive reads "has 2 wild skills" — modelled as SKILL_ANY ×2',
	},
}

const sorted = (xs: Iterable<string>) => [...xs].sort().join(',')

function diff(def: CardDef, s: StccCard): string[] {
	const out: string[] = []
	if (def.suit !== s.suit.toUpperCase())
		out.push(`suit: ours ${def.suit} / stcc ${s.suit}`)

	const theirs = new Set(
		[...s.species_traits, ...s.regular_traits, ...s.other_traits].map(
			toTraitId,
		),
	)
	const ours = new Set<string>(def.traits)
	if (sorted(ours) !== sorted(theirs)) {
		const onlyOurs = [...ours].filter((t) => !theirs.has(t))
		const onlyTheirs = [...theirs].filter((t) => !ours.has(t))
		out.push(`traits: only ours [${onlyOurs}] / only stcc [${onlyTheirs}]`)
	}

	const glory = typeof s.glory === 'number' ? s.glory : Number(s.glory) || 0
	if (def.suit !== 'CAPTAIN' && def.vp !== glory)
		out.push(`vp: ours ${def.vp} / stcc ${s.glory ?? 0}`)

	const pos = s.position_indicator ?? ''
	if (pos in POSITION && def.startPosition !== POSITION[pos])
		out.push(`startPosition: ours ${def.startPosition} / stcc ${pos}`)
	if (
		(pos === 'Starting' || pos === 'Advanced') &&
		def.locationTier !== pos.toUpperCase()
	)
		out.push(`locationTier: ours ${def.locationTier} / stcc ${pos}`)

	const skills = s.icons
		.filter((i) => i.type === 'Skill')
		.map((i) => `SKILL_${i.specialty.toUpperCase()}`)
	if (sorted(def.skills) !== sorted(skills))
		out.push(`skills: ours [${def.skills}] / stcc [${skills}]`)
	const focus = s.icons.find((i) => i.type === 'Focus')
	const theirFocus = focus ? `FOCUS_${focus.specialty.toUpperCase()}` : null
	if (def.focus !== theirFocus)
		out.push(`focus: ours ${def.focus} / stcc ${theirFocus}`)

	if (
		s.away_team &&
		def.awayTeams !== undefined &&
		String(def.awayTeams) !== s.away_team.replace('+', '')
	)
		out.push(`awayTeams: ours ${def.awayTeams} / stcc ${s.away_team}`)
	return out
}

/** STCC position indicators of solo-only cards (Directives 1DIR01/02,
 *  2DIR01/02): they need the Solo/Bot mode (todo/15), so they are listed
 *  separately — neither implemented nor "missing". */
const SOLO_ONLY_POSITIONS = new Set(['Solo Campaign', 'Solo Challenge'])

/** A board mission that is only a stand-in (unreachable goal / no reward)
 *  never counts as implementing its STCC mission. */
function isPlaceholder(m: MissionState): boolean {
	return m.reward.k === 'NOOP'
}

/** Board missions vs the STCC mission records (`1PIC/M1` …): vp on the
 *  Advanced side; the Basic side must carry
 *  exactly the Advanced side's first mission with 0 VP (the board photos). */
function crosscheckMissions(
	boards: CardCatalog['boards'],
	stcc: Map<string, StccCard>,
	seen: Set<string>,
): string[] {
	const out: string[] = []
	for (const [deck, board] of Object.entries(boards)) {
		if (board === undefined) continue
		for (const m of board.advanced) {
			if (m.cardId === undefined || isPlaceholder(m)) continue
			const key = normalizeCardNumber(m.cardId)
			const s = stcc.get(key)
			if (s === undefined) {
				out.push(`${deck} advanced M${m.index + 1}: no STCC record ${m.cardId}`)
				continue
			}
			if (seen.has(key)) {
				out.push(`${deck}: ${m.cardId} used twice`)
				continue
			}
			seen.add(key)
			if (m.vp !== (s.vp ?? 0))
				out.push(`${m.cardId} vp: ours ${m.vp} / stcc ${s.vp ?? 0}`)
		}
		const first = board.advanced[0]
		if (board.basic.length !== 1)
			out.push(`${deck} basic: ${board.basic.length} missions (expected 1)`)
		const basic = board.basic[0]
		if (basic !== undefined && !isPlaceholder(basic)) {
			if (basic.cardId !== first?.cardId)
				out.push(
					`${deck} basic: ${basic.cardId} is not the Advanced side's first mission ${first?.cardId}`,
				)
			if (basic.vp !== 0) out.push(`${deck} basic: vp ${basic.vp} (expected 0)`)
		}
	}
	return out
}

async function main(): Promise<void> {
	const stcc = await loadStccNode()
	if (stcc.size === 0) {
		console.error('No STCC data found — run `npm run fetch-cards` first.')
		process.exit(1)
	}
	const { defs, boards, bots } = await loadCatalog()

	const unmatched: CardDef[] = []
	const mismatches: [CardDef, string[]][] = []
	const seen = new Set<string>()
	for (const def of defs) {
		if (def.cardId === null) continue
		const key = normalizeCardNumber(def.cardId)
		const s = stcc.get(key)
		if (!s) {
			unmatched.push(def)
			continue
		}
		seen.add(key)
		const accepted = ACCEPTED[def.cardId] ?? {}
		const d = diff(def, s).filter((line) => !(line.split(':')[0]! in accepted))
		if (d.length) mismatches.push([def, d])
	}

	console.log(
		`our defs with cardId: ${defs.filter((d) => d.cardId).length}, matched ${seen.size}`,
	)
	if (unmatched.length) {
		console.log(`\nNO STCC RECORD (${unmatched.length}):`)
		for (const d of unmatched) console.log(`  ${d.cardId} ${cardName(d)}`)
	}
	const acceptedCount = Object.values(ACCEPTED).reduce(
		(n, f) => n + Object.keys(f).length,
		0,
	)
	console.log(
		`\nMISMATCHES (${mismatches.length} cards; ${acceptedCount} modelling differences accepted, see ACCEPTED):`,
	)
	for (const [def, d] of mismatches) {
		console.log(`  ${def.cardId} ${cardName(def)}`)
		for (const line of d) console.log(`    ${line}`)
	}

	const missionIssues = crosscheckMissions(boards, stcc, seen)
	const missionCount = Object.values(boards).reduce(
		(n, b) =>
			n +
			(b?.advanced.filter((m) => m.cardId !== undefined && !isPlaceholder(m))
				.length ?? 0),
		0,
	)
	console.log(
		`\nMISSIONS (${missionCount} board missions with cardId; ${missionIssues.length} issue(s)):`,
	)
	for (const line of missionIssues) console.log(`  ${line}`)

	const botIssues = crosscheckBots(
		bots ?? [],
		await loadStccBotsNode(),
		defs,
		stcc,
	)
	console.log(
		`\nSOLO BOTS (${(bots ?? []).length} crews; ${botIssues.length} issue(s)):`,
	)
	for (const line of botIssues) console.log(`  ${line}`)

	const unseen = [...stcc.entries()].filter(([k]) => !seen.has(k))
	const soloOnly = unseen.filter(([, s]) =>
		SOLO_ONLY_POSITIONS.has(s.position_indicator ?? ''),
	)
	const missing = unseen.filter(
		([, s]) => !SOLO_ONLY_POSITIONS.has(s.position_indicator ?? ''),
	)
	console.log(`\nOUT OF SCOPE (solo/Bot, see todo/15) (${soloOnly.length}):`)
	for (const [k, s] of soloOnly)
		console.log(`  ${k} ${s.suit} ${s.name} (${s.position_indicator})`)

	const bySource = new Map<string, number>()
	for (const [, s] of missing)
		bySource.set(
			`${s.box}/${s.source}`,
			(bySource.get(`${s.box}/${s.source}`) ?? 0) + 1,
		)
	console.log(`\nNOT IMPLEMENTED (${missing.length}):`)
	for (const [src, n] of [...bySource].sort()) console.log(`  ${src}: ${n}`)
	if (process.argv.includes('--missing'))
		for (const [k, s] of missing) console.log(`    ${k} ${s.suit} ${s.name}`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
