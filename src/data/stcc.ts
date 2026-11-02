// The STCC card database (periodic-agent/stcc-strategy), joined to our card
// defs by printed card number. It is fetched onto the player's machine by
// `npm run fetch-cards` (tools/fetch-stcc.ts) and is never committed, so every
// consumer must cope with it being absent: the index is then simply empty.
//
// This module is environment-neutral (no node:fs, no import.meta.glob); the
// Node and browser loaders hand it the parsed box files.

import { z } from 'zod'

export const STCC_BOXES = ['box1', 'box2', 'box3', 'promo1', 'promo2'] as const
export type StccBox = (typeof STCC_BOXES)[number]

const StccTextSchema = z.object({
	cost: z.string().default(''),
	hand: z.string().default(''),
	table: z.string().default(''),
	goal: z.string().default(''),
	reward: z.string().default(''),
})
export type StccText = z.infer<typeof StccTextSchema>

export const StccCardSchema = z.object({
	id: z.string(),
	name: z.string(),
	suit: z.string(),
	source: z.string(),
	game_box: z.string(),
	card_number: z.string(),
	variant: z.string().optional(),
	glory: z.union([z.number(), z.string()]).nullable().optional(),
	/** missions (virtual records, `1PIC/M1`) print VP, not Glory */
	vp: z.number().nullable().optional(),
	position_indicator: z.string().nullable().optional(),
	species_traits: z.array(z.string()).default([]),
	regular_traits: z.array(z.string()).default([]),
	other_traits: z.array(z.string()).default([]),
	filename: z.string().optional(),
	icons: z
		.array(z.object({ type: z.string(), specialty: z.string() }))
		.default([]),
	away_team: z.string().optional(),
	text: StccTextSchema.default({
		cost: '',
		hand: '',
		table: '',
		goal: '',
		reward: '',
	}),
})
export type StccCardRecord = z.infer<typeof StccCardSchema>

export interface StccCard extends StccCardRecord {
	/** The STCC box that prints it, or 'custom' for a fan-made pack card. */
	box: StccBox | 'custom'
	/** Public URL of the card scan (under public/stcc/), or null if none. */
	image: string | null
}

// ---------------------------------------------------------------------------
// Custom packs: fan-made crew decks (src/data/custom/*.json). Not STCC data:
// the records are our own, written in the STCC record shape so names, printed
// text and art join the same index. Card art is rendered locally
// (tools/custom/) into public/custom/ and listed in a gitignored image map.
// ---------------------------------------------------------------------------

const CustomPackSchema = z.object({
	pack: z.string(),
	deck: z.string(),
	title: z.string(),
	cards: z.array(z.unknown()),
})

/** Add custom pack records to `index` (in place, never replacing an STCC
 *  record). `images` maps a card number to its file under `base`. */
export function addCustomPacks(
	index: Map<string, StccCard>,
	packs: readonly unknown[],
	images: Readonly<Record<string, string>> = {},
	base = '/custom',
): Map<string, StccCard> {
	for (const raw of packs) {
		const pack = CustomPackSchema.safeParse(raw)
		if (!pack.success) continue
		for (const entry of pack.data.cards) {
			const parsed = StccCardSchema.safeParse(entry)
			if (!parsed.success) continue
			const key = normalizeCardNumber(parsed.data.card_number)
			if (index.has(key)) continue
			const file = images[key]
			index.set(key, {
				...parsed.data,
				box: 'custom',
				image: file !== undefined ? `${base}/${file}` : null,
			})
		}
	}
	return index
}

/** The name of a custom pack (`firefly`), or null when `raw` is not a pack. */
export function customPackName(raw: unknown): string | null {
	const pack = CustomPackSchema.safeParse(raw)
	return pack.success ? pack.data.pack : null
}

/** A pack's face map (`vendor/custom/<pack>.images.json`: card number → file),
 *  or null when `raw` is not one. */
export function parseCustomImageMap(
	raw: unknown,
): Record<string, string> | null {
	const map = z.record(z.string(), z.string()).safeParse(raw)
	return map.success ? map.data : null
}

/** Their card numbers carry print marks we don't: `2PER01/26●` → `2PER01/26`. */
export function normalizeCardNumber(n: string): string {
	return n.replace(/[^0-9A-Z/?]/gi, '').toUpperCase()
}

/** Build the cardId → record index. Reprints and variants share a number; the
 *  first box that prints it wins, and within a box an "updated" variant beats
 *  the "original". */
export function buildStccIndex(
	boxes: Partial<Record<StccBox, unknown>>,
	base = '/stcc',
): Map<string, StccCard> {
	const index = new Map<string, StccCard>()
	for (const box of STCC_BOXES) {
		const raw = boxes[box]
		if (!Array.isArray(raw)) continue
		for (const entry of raw) {
			const parsed = StccCardSchema.safeParse(entry)
			if (!parsed.success) continue
			const card: StccCard = {
				...parsed.data,
				box,
				image: parsed.data.filename
					? `${base}/img/${box}/${parsed.data.filename}`
					: null,
			}
			const key = normalizeCardNumber(card.card_number)
			const prev = index.get(key)
			if (
				prev === undefined ||
				(prev.box === box && card.variant === 'updated')
			)
				index.set(key, card)
		}
	}
	applyCrossSetUpdates(index)
	return index
}

// ---------------------------------------------------------------------------
// Automated Command cards: the solo Bot's lookup tables (`data/bots.json`,
// rules/13 §13.6). Text only — our mechanics for every row live in
// src/data/cards/solo/bots.json, keyed by our deck id. The two meet through
// `captain`, which is the STCC `source` of that crew deck's cards.
// ---------------------------------------------------------------------------

const StccBotRewardSchema = z.object({
	/** the traits/suits of Market cards that may join your Reinforcement deck */
	cards: z.string(),
	/** the alternative bonuses (rules/14 §14.3), "BOOST: …" and the like */
	bonus: z.array(z.string()).default([]),
})

export const StccBotSchema = z.object({
	/** STCC's own id for the Bot (a variant has a suffixed id) */
	id: z.string(),
	/** equals the STCC `source` of the crew deck's cards */
	captain: z.string(),
	variant: z.string().nullable().optional(),
	/** TRAITS card rows, top to bottom; `key` is "[[klingon]]" or "[[synthetic]] / [[android]]" */
	traits: z.array(z.object({ key: z.string(), text: z.string() })),
	/** SUITS card rows; `text` is the "no Duty Officer" side, `do_text` the other */
	suits: z.array(
		z.object({ suit: z.string(), text: z.string(), do_text: z.string() }),
	),
	special: z.string().nullable().optional(),
	campaign: z
		.object({ win: StccBotRewardSchema, loss: StccBotRewardSchema })
		.nullable()
		.optional(),
})
export type StccBot = z.infer<typeof StccBotSchema>

/** Parse a fetched `bots.json` into an id → Bot map; malformed entries are
 *  skipped (and a missing file is simply an empty map). */
export function parseStccBots(raw: unknown): Map<string, StccBot> {
	const out = new Map<string, StccBot>()
	if (!Array.isArray(raw)) return out
	for (const entry of raw) {
		const parsed = StccBotSchema.safeParse(entry)
		if (parsed.success) out.set(parsed.data.id, parsed.data)
	}
	return out
}

/** The standard (non-variant) Bot of the crew whose cards carry STCC
 *  `source`, or null. */
export function stccBotForSource(
	bots: ReadonlyMap<string, StccBot>,
	source: string,
): StccBot | null {
	for (const bot of bots.values())
		if (bot.captain === source && (bot.variant ?? null) === null) return bot
	return null
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A later box reprints some earlier cards as "updated" variants marked `†`
 *  (`2PER14/26†` 1PER18) carrying the errata's cross-set updates (NX-01 trait,
 *  1CAR08's "max 5", …). The reprint supersedes the earlier record's traits,
 *  text and scan; the earlier card keeps its number and name. */
function applyCrossSetUpdates(index: Map<string, StccCard>): void {
	const byName = new Map<string, StccCard>()
	for (const card of index.values())
		if (card.box === 'box1') byName.set(nameKey(card.name) + card.suit, card)
	for (const reprint of index.values()) {
		if (reprint.variant !== 'updated' || !reprint.card_number.includes('†'))
			continue
		const orig = byName.get(nameKey(reprint.name) + reprint.suit)
		if (orig === undefined) continue
		index.set(normalizeCardNumber(orig.card_number), {
			...reprint,
			name: orig.name,
			card_number: orig.card_number,
		})
	}
}

// ---------------------------------------------------------------------------
// Rules-text tokens: their `[[token]]` names → our icon ids / trait ids.
// ---------------------------------------------------------------------------

/** `[[name]]` segments of a rules string, split into text and token parts. */
export type TextPart =
	{ k: 'text'; text: string } | { k: 'token'; name: string }

export function splitTokens(text: string): TextPart[] {
	const parts: TextPart[] = []
	const re = /\[\[([^\]]+)\]\]/g
	let last = 0
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		if (m.index > last)
			parts.push({ k: 'text', text: text.slice(last, m.index) })
		parts.push({ k: 'token', name: (m[1] ?? '').trim().toLowerCase() })
		last = m.index + m[0].length
	}
	if (last < text.length) parts.push({ k: 'text', text: text.slice(last) })
	return parts
}

// ---------------------------------------------------------------------------
// Printed operations: their text is grouped per card area (hand/table/goal),
// each operation prefixed with its type ("[[action]] Attack Play: …"), and a
// specialty requirement sits before the colon ("Play [[inf3]]: …"); the
// operation's `requires` chip shows it, so it is not part of the text.
// ---------------------------------------------------------------------------

export interface PrintedOp {
	/** Our OperationType spelling, or null for untyped text ("This card cannot be played."). */
	type: string | null
	costsAction: boolean
	isAttack: boolean
	text: string
}

const OP_HEAD =
	/(\[\[action\]\]\s*)?(Attack\s+)?\b(Play|Activation|Passive|Reaction|Resupply|Cleanup|Control|Endgame|Special)(?:\s*\[\[[a-z]+\d+\]\])?\s*:\s*/gi

/** Split one card's printed text into operations, in printed order. The
 *  development cost and mission reward sections are not operations. */
export function printedOps(text: StccText): PrintedOp[] {
	const out: PrintedOp[] = []
	for (const section of [text.hand, text.table, text.goal]) {
		// A header inside a quotation is part of the enclosing operation's text,
		// not a new operation (1PIC08: 'treat any INCIDENT's play operation as
		// "Play: …"').
		const heads = [...section.matchAll(OP_HEAD)].filter(
			(m) =>
				(section.slice(0, m.index ?? 0).match(/"/g) ?? []).length % 2 === 0,
		)
		const lead = section.slice(0, heads[0]?.index ?? section.length).trim()
		if (lead !== '')
			out.push({ type: null, costsAction: false, isAttack: false, text: lead })
		heads.forEach((m, i) => {
			const start = (m.index ?? 0) + m[0].length
			const end = heads[i + 1]?.index ?? section.length
			out.push({
				type: (m[3] ?? '').toUpperCase(),
				costsAction: m[1] !== undefined,
				isAttack: m[2] !== undefined,
				text: section.slice(start, end).trim(),
			})
		})
	}
	return out
}

/** The printed operation matching our operation `index` of `ops`: the n-th
 *  printed op of the same type, where n is its rank among our ops of that type. */
export function printedOpFor(
	printed: PrintedOp[],
	ops: readonly { type: string }[],
	index: number,
): PrintedOp | null {
	const type = ops[index]?.type
	if (type === undefined) return null
	const rank = ops.slice(0, index).filter((o) => o.type === type).length
	return printed.filter((p) => p.type === type)[rank] ?? null
}

/** Their trait spelling (`Lower Decker`, `Mind-Control`, `Vau N'Akat`) → our
 *  TraitId form. */
export function toTraitId(name: string): string {
	return name
		.trim()
		.toUpperCase()
		.replace(/'/g, '')
		.replace(/[\s-]+/g, '_')
}
