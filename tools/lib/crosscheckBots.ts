// Crosscheck the solo Bots' Automated Command mechanics
// (src/data/cards/solo/bots.json) against the STCC card text (data/bots.json):
//   - every crew of ours with an STCC Bot has mechanics, and vice versa;
//   - TRAITS rows: same count, order and trait keys;
//   - red (attack) text ⇔ the row has an ATTACK node;
//   - every icon token and number of the printed row appears in our
//     describe() of it — a coarse recall check that catches a dropped step.
// Run through `npx tsx tools/crosscheck-stcc.ts` (and solo/crosscheck.test.ts).

import {
	normalizeCardNumber,
	splitTokens,
	toTraitId,
} from '../../src/data/stcc'
import type { StccBot, StccCard } from '../../src/data/stcc'
import type { BotCard, CardDef } from '../../src/data/schema'
import type { Effect } from '../../src/engine/resolver/nodes'
import { describe } from '../../src/engine/describe'

/** Every node of an effect tree (a shape-only walk over the JSON). */
function containsKind(effect: unknown, k: string): boolean {
	if (Array.isArray(effect)) return effect.some((e) => containsKind(e, k))
	if (effect === null || typeof effect !== 'object') return false
	const obj = effect as Record<string, unknown>
	if (obj['k'] === k) return true
	return Object.values(obj).some((v) => containsKind(v, k))
}

/** How describe() spells a printed `[[token]]` (case-insensitive check). */
function tokenWord(name: string): string {
	switch (name) {
		case 'glory':
			return '{GLO}'
		case 'dilithium':
			return '{DIL}'
		case 'latinum':
			return '{LAT}'
		case 'away team':
			return 'away team'
		case 'res-focus':
			return 'RESEARCH Focus'
		case 'inf-focus':
			return 'INFLUENCE Focus'
		case 'mil-focus':
			return 'MILITARY Focus'
		default:
			return toTraitId(name).replace(/_/g, ' ')
	}
}

/** Printed tokens and numbers of `text` our English for `effect` misses. */
function missingWords(text: string, effect: Effect): string[] {
	const ours = describe(effect).toLowerCase()
	const missing: string[] = []
	for (const part of splitTokens(text)) {
		if (part.k === 'token') {
			const word = tokenWord(part.name).toLowerCase()
			if (!ours.includes(word)) missing.push(`[[${part.name}]]`)
		} else {
			for (const n of part.text.match(/\d+/g) ?? [])
				if (!ours.includes(n)) missing.push(n)
		}
	}
	return missing
}

/** Wording our English renders differently, by row and missing word —
 *  checked by hand, so the crosscheck stays at zero. */
const ACCEPTED: Record<string, string[]> = {
	// "for each PERSON … gain 1": we say "advance by the number of PERSON …"
	'PIC ALLY': ['1'],
	'SHR ALLY': ['1'],
	// "if Bot has 7 or fewer" is the otherwise of "if Bot has 8+"
	'SEL TRAITS 0': ['7'],
}

function checkRow(
	where: string,
	text: string,
	effect: Effect,
	out: string[],
): void {
	const red = text.includes('@')
	if (red !== containsKind(effect, 'ATTACK'))
		out.push(
			`${where}: ${red ? 'printed attack but no ATTACK node' : 'ATTACK node but no printed attack'}`,
		)
	const accepted = ACCEPTED[where] ?? []
	const missing = missingWords(text, effect).filter(
		(w) => !accepted.includes(w),
	)
	if (missing.length > 0) out.push(`${where}: missing ${missing.join(', ')}`)
}

/** The Five-Year Mission rewards (rules/14 §14.3): Option A's suits/traits
 *  and, in printed order, each Option B bonus's kind (a BOOST, or a crew card
 *  moved to the Reinforcement pile from the Reserve deck / the Available
 *  cards). */
function checkCampaign(bot: BotCard, s: StccBot, out: string[]): void {
	if (s.campaign == null) return
	if (bot.campaign === undefined) {
		out.push(`${bot.deck}: no campaign rewards`)
		return
	}
	for (const side of ['win', 'loss'] as const) {
		const theirs = s.campaign[side]
		const ours = bot.campaign[side]
		const where = `${bot.deck} campaign ${side}`
		const keys = splitTokens(theirs.cards)
			.flatMap((p) => (p.k === 'token' ? [toTraitId(p.name)] : []))
			.sort()
		if (JSON.stringify(keys) !== JSON.stringify([...ours.match].sort()))
			out.push(
				`${where}: matches ${ours.match.join('/')}, STCC ${keys.join('/')}`,
			)
		// every printed bonus is "BOOST: …" or a move to the pile
		const kinds = theirs.bonus.map((b) =>
			/^\s*BOOST:/i.test(b)
				? 'BOOST'
				: /reserve/i.test(b)
					? 'TO_RESERVE'
					: 'TO_AVAILABLE',
		)
		const mine = ours.bonus.map((b) =>
			b.k === 'BOOST'
				? 'BOOST'
				: b.from === 'RESERVE'
					? 'TO_RESERVE'
					: 'TO_AVAILABLE',
		)
		if (JSON.stringify(kinds) !== JSON.stringify(mine))
			out.push(`${where}: bonuses ${mine.join(', ')}, STCC ${kinds.join(', ')}`)
	}
}

/** The issues found (empty = in step). `defs` + `stcc` link each of our
 *  crews to its STCC Bot through the cards' `source`. */
export function crosscheckBots(
	bots: readonly BotCard[],
	stccBots: ReadonlyMap<string, StccBot>,
	defs: readonly CardDef[],
	stcc: ReadonlyMap<string, StccCard>,
): string[] {
	const out: string[] = []
	const sourceOf = (deck: string): string | undefined => {
		for (const def of defs) {
			if (def.deck !== deck || def.cardId === null) continue
			const rec = stcc.get(normalizeCardNumber(def.cardId))
			if (rec !== undefined) return rec.source
		}
		return undefined
	}
	const linked = new Set<string>()
	for (const bot of bots) {
		const source = sourceOf(bot.deck)
		const s = [...stccBots.values()].find(
			(b) => b.captain === source && (b.variant ?? null) === null,
		)
		if (s === undefined) {
			out.push(`${bot.deck}: no STCC Bot`)
			continue
		}
		linked.add(s.id)
		if (s.traits.length !== bot.traits.length)
			out.push(
				`${bot.deck}: ${bot.traits.length} TRAITS rows, STCC prints ${s.traits.length}`,
			)
		s.traits.forEach((row, i) => {
			const ours = bot.traits[i]
			if (ours === undefined) return
			const keys = splitTokens(row.key)
				.flatMap((p) => (p.k === 'token' ? [toTraitId(p.name)] : []))
				.sort()
			if (JSON.stringify(keys) !== JSON.stringify([...ours.match].sort()))
				out.push(
					`${bot.deck} TRAITS ${i}: matches ${ours.match.join('/')}, STCC ${keys.join('/')}`,
				)
			checkRow(`${bot.deck} TRAITS ${i}`, row.text, ours.effect, out)
		})
		for (const row of s.suits) {
			const suit = row.suit.toUpperCase() as keyof BotCard['suits']
			const ours = bot.suits[suit]
			if (ours === undefined) {
				out.push(`${bot.deck}: no ${suit} row`)
				continue
			}
			checkRow(`${bot.deck} ${suit}`, row.text, ours.noDo, out)
			checkRow(`${bot.deck} ${suit} (DO)`, row.do_text, ours.do, out)
		}
		checkCampaign(bot, s, out)
	}
	// crews we have decks for whose STCC Bot has no mechanics yet
	for (const s of stccBots.values()) {
		if (linked.has(s.id) || (s.variant ?? null) !== null) continue
		const ours = defs.find((d) => {
			if (d.cardId === null) return false
			return stcc.get(normalizeCardNumber(d.cardId))?.source === s.captain
		})
		if (ours !== undefined)
			out.push(`${ours.deck}: STCC has a Bot, but bots.json has no mechanics`)
	}
	return out
}
