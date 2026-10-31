// shorthand.ts — effect tree → Shorthand glyph tokens (docs/shorthand.md).
//
// describe.ts renders an operation as English; this renders the same tree as a
// line of glyphs a player can read at a glance on a small card:
//
//   {−1 DIL} › warp            "Spend 1 {DIL} to warp this ship to a LOCATION."
//   ACT  {+1 <INCIDENT>} › +ALLY
//
// Nothing is authored per card: every line is compiled from the effect tree,
// so each card (and every future card) gets its Shorthand for free. The
// grammar, in one breath: timing mark first; costs sit in a `cost` group left
// of the `then` chevron; signed amounts are arithmetic on your hand and pool
// (+2 cards, −1 DIL, +1 INCIDENT); `may` is optional, `opp` is the opponent,
// `per` is "for each", `if`/`did` are conditions, `qual` narrows a verb
// ("promote · PERSON").
//
// The compiler is TOTAL: each switch below is exhaustive over its union, so a
// new node, amount, predicate or trigger kind is a compile error here until it
// is given a rendering. Tokens are plain JSON — the UI renders them
// (src/ui/shorthand.tsx) and `formatShorthand` prints them for tests/tools.

import { cardNameById } from '../data/cardNames'
import type { Effect, Operation, TriggerSpec } from './resolver/nodes'
import type { Amount, CardFilter, Predicate, Query } from './resolver/queries'
import type {
	MarketSuit,
	OperationType,
	SpecialtyId,
	Suit,
	TraitId,
} from '../data/ids'
import { describeModifier } from './modifiers'

// ---------------------------------------------------------------------------
// Token model
// ---------------------------------------------------------------------------

/** Every glyph the language uses. Suits, traits, skills and focus icons are
 *  their own token kinds; these are the resources, verbs and places. */
export const GLYPHS = [
	// resources & tokens
	'DIL',
	'LAT',
	'GLO',
	'ACT',
	'VP',
	'AWAY',
	// specialties
	'RESEARCH',
	'INFLUENCE',
	'MILITARY',
	'ANY_SPECIALTY',
	'LOWEST_SPECIALTY',
	// your cards and decks
	'CARD',
	'DECK',
	'TOP_DECK',
	'PUT',
	'FIND',
	'FROM_DISCARD',
	'DISCARD_PILE',
	'LOG',
	'ENLIST',
	'DEVELOP',
	'HAND',
	'RESERVE',
	// in play
	'PLAY',
	'FREE_PLAY',
	'DEPLOY',
	'PROMOTE',
	'RECALL',
	'DISMISS',
	'DESTROY',
	'EXHAUST',
	'REFRESH',
	'DUPLICATE',
	'REVEAL',
	'ENTER',
	'FLEET',
	'DUTY',
	'STAGING',
	// Market
	'MARKET',
	'JUNK',
	'SCAN',
	'WIPE_MARKET',
	'STEAL',
	// space
	'WARP',
	'BEAM',
	'SEND',
	'CONTROL',
	'WIPE_NEUTRAL_ZONE',
	'ARRANGE',
	'STARDATE',
	// checks & rules
	'CHECK',
	'LOCK',
	'SHIELD',
	'ATTACK',
	'MISSION',
	'RECRYSTALLIZE',
	'OPERATION',
	'ENDGAME',
] as const
export type GlyphId = (typeof GLYPHS)[number]

/** A specialty slot on a skill/focus icon; ANY = the wild icon. */
export type SpecialtySlot = SpecialtyId | 'ANY'

export type Tok =
	/** a glyph with an optional label: a signed or bounded amount ("+2",
	 *  "−1", "≥3", "≤2") printed before it, or a short word after it */
	| { k: 'glyph'; g: GlyphId; n?: string | undefined }
	/** a card suit; `n` as on a glyph, `note` a trailing word ("look 3") */
	| {
			k: 'suit'
			suit: Suit | 'ANY'
			n?: string | undefined
			note?: string | undefined
	  }
	| { k: 'skill'; specialty: SpecialtySlot }
	| { k: 'focus'; specialty: SpecialtySlot }
	| { k: 'trait'; trait: TraitId }
	| { k: 'name'; name: string }
	| { k: 'word'; text: string }
	| { k: 'num'; n: string }
	/** the cost/benefit seam of "do A to do B" */
	| { k: 'then' }
	| { k: 'sep'; s: '/' | '+' }
	| { k: 'cost'; body: Tok[] }
	| { k: 'may'; body: Tok[] }
	| { k: 'or'; options: Tok[][]; pick: number }
	/** your opponent does it, or it happens to them */
	| { k: 'opp'; body: Tok[] }
	| {
			k: 'if'
			cond: Tok[]
			then: Tok[]
			else?: Tok[] | undefined
			/** the source condition, for live evaluation (shorthandLive.ts) */
			pred?: Predicate | undefined
			/** set by withLiveValues: does the condition hold right now? */
			holds?: boolean | undefined
	  }
	/** "if you do" — the steps before it happened */
	| { k: 'did'; then: Tok[] }
	/** `times`: "2", "≤3", or "each" (a compressed run of look-alike steps) */
	| { k: 'repeat'; times: string; body: Tok[] }
	| {
			k: 'per'
			body: Tok[]
			per: Tok[]
			max?: number | undefined
			/** how many times `body` applies, as an Amount — for live evaluation
			 *  (shorthandLive.ts) */
			source?: Amount | undefined
			/** set by withLiveValues: that amount on the current board */
			live?: number | undefined
	  }
	/** narrows the verb before it ("promote · PERSON") */
	| { k: 'qual'; body: Tok[] }
	| { k: 'req'; cond: Tok[] }
	| {
			k: 'gain'
			suits: (MarketSuit | 'ANY')[]
			junk?: 'ONLY' | 'ALSO' | undefined
	  }
	| {
			k: 'scan'
			n?: string | undefined
			of: Tok[]
			junk?: boolean | undefined
			instead?: boolean | undefined
	  }
	| { k: 'steal'; body: Tok[] }
	/** a passive rule change: unique rules stay words */
	| { k: 'rule'; text: string }
	| { k: 'atLeast'; n: string; of: Tok[] }
	/** "if it is X" — about a card bound earlier in the operation */
	| { k: 'is'; body: Tok[] }
	| { k: 'not'; body: Tok[] }
	/** alternatives in one slot, from compression ("PERSON/CARGO/SHIP") */
	| { k: 'alt'; options: Tok[] }

/** One compiled operation strip. */
export interface ShorthandLine {
	timing: OperationType | 'DEVELOPMENT'
	action: boolean
	attack: boolean
	requires?: { specialty: SpecialtyId; min: number } | undefined
	trigger: Tok[]
	body: Tok[]
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

const glyph = (g: GlyphId, n?: string): Tok =>
	n === undefined ? { k: 'glyph', g } : { k: 'glyph', g, n }
const suit = (s: Suit | 'ANY', n?: string): Tok =>
	n === undefined ? { k: 'suit', suit: s } : { k: 'suit', suit: s, n }
const word = (text: string): Tok => ({ k: 'word', text })
const qual = (body: Tok[]): Tok[] =>
	body.length > 0 ? [{ k: 'qual', body }] : []
const opp = (body: Tok[]): Tok[] =>
	body.length > 0 ? [{ k: 'opp', body }] : []

function join(toks: Tok[], s: '/' | '+'): Tok[] {
	return toks.flatMap((t, i): Tok[] => (i > 0 ? [{ k: 'sep', s }, t] : [t]))
}
function joinGroups(groups: Tok[][], s: '/' | '+'): Tok[] {
	return groups.flatMap((g, i): Tok[] => (i > 0 ? [{ k: 'sep', s }, ...g] : g))
}

/** Drop a ship's registry prefix ("U.S.S. X" → "X"): it eats a tile. */
function shortName(name: string): string {
	return name.replace(/^(U\.S\.S\.|I\.K\.S\.|I\.R\.W\.)\s+/, '')
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

interface Amt {
	/** the number shown on the glyph ("2", "≤3", "X") */
	n: string
	/** set when the amount counts something: render as "… / per" */
	per?: Tok[] | undefined
	max?: number | undefined
}

function amt(a: Amount): Amt {
	if (typeof a === 'number') return { n: String(a) }
	switch (a.k) {
		case 'COUNT':
			return { n: '1', per: query(a.query) }
		case 'ICON_COUNT':
			return {
				n: '1',
				per: [
					a.kind === 'SKILL'
						? { k: 'skill', specialty: 'ANY' }
						: { k: 'focus', specialty: 'ANY' },
				],
			}
		case 'SKILL_ICONS':
			return {
				n: '1',
				per: [
					{
						k: 'skill',
						specialty: a.specialty === 'CHOSEN' ? 'ANY' : a.specialty,
					},
				],
			}
		case 'SPECIALTY':
			return { n: '1', per: [glyph(a.specialty, 'level')] }
		case 'RESOURCE':
			return {
				n: '1',
				per: a.seat === 'OPPONENT' ? opp([glyph(a.res)]) : [glyph(a.res)],
			}
		case 'UNUSED_ACTIONS':
			return { n: '1', per: [glyph('ACT', 'unused')] }
		case 'UP_TO': {
			const m = amt(a.max)
			return { ...m, n: `≤${m.n}` }
		}
		case 'PER': {
			const of = amt(a.of)
			return {
				n: '1',
				per: [
					{ k: 'num', n: String(a.every) },
					...(of.per ?? [{ k: 'num', n: of.n }]),
				],
			}
		}
		case 'MIN': {
			// "…, max N": one variable term capped by one number
			const caps = a.terms.filter((t): t is number => typeof t === 'number')
			const rest = a.terms.filter((t) => typeof t !== 'number')
			const only = rest[0]
			if (caps.length === 1 && rest.length === 1 && only !== undefined)
				return { ...amt(only), max: caps[0] }
			return { n: 'X', per: [word('the lower')] }
		}
		case 'MAX':
			return { n: 'X', per: [word('the higher')] }
		case 'SUM':
			return {
				n: '1',
				per: joinGroups(
					a.terms.map((t) => amt(t).per ?? [{ k: 'num', n: amt(t).n }]),
					'+',
				),
			}
		case 'TRAIT_COUNT':
			return { n: '1', per: [word('its traits')] }
		case 'SHARED_TRAITS':
			return { n: '1', per: [word('shared traits')] }
	}
}

/** A glyph with a signed amount; a counted amount becomes "glyph / per". */
function counted(
	tok: (n: string) => Tok,
	a: Amount,
	sign: '+' | '−' | '',
): Tok[] {
	const m = amt(a)
	const body = [tok(`${sign}${m.n}`)]
	if (m.per === undefined) return body
	return [
		{
			k: 'per',
			body,
			per: m.per,
			...(m.max !== undefined ? { max: m.max } : {}),
			source: a,
		},
	]
}

// ---------------------------------------------------------------------------
// Filters and queries
// ---------------------------------------------------------------------------

/** The noun a filter names. `anyCard`: an empty filter reads as "a card". */
function filt(f: CardFilter | undefined, anyCard = true): Tok[] {
	if (f === undefined) return anyCard ? [glyph('CARD')] : []
	const out: Tok[] = []
	if (f.not !== undefined) out.push({ k: 'not', body: filt(f.not, false) })
	// "a PERSON, CARGO, SHIP, ALLY, …" listing (nearly) every suit is any card
	if (f.suits !== undefined && f.suits.length >= 6) out.push(glyph('CARD'))
	else if (f.suits !== undefined && f.suits.length > 0)
		out.push(
			...join(
				f.suits.map((s) => suit(s)),
				'/',
			),
		)
	if (f.traits !== undefined && f.traits.length > 0)
		out.push(
			...join(
				f.traits.map((t): Tok => ({ k: 'trait', trait: t })),
				'/',
			),
		)
	if (f.allTraits !== undefined && f.allTraits.length > 0)
		out.push(
			...join(
				f.allTraits.map((t): Tok => ({ k: 'trait', trait: t })),
				'+',
			),
		)
	if (f.ids !== undefined && f.ids.length > 0)
		out.push(
			...join(
				[...new Set(f.ids.map(cardNameById))].map((n): Tok => ({
					k: 'name',
					name: shortName(n),
				})),
				'/',
			),
		)
	if (f.exhibits !== undefined && f.exhibits.length > 0)
		out.push(
			...join(
				f.exhibits.map((s): Tok => ({ k: 'skill', specialty: s })),
				'/',
			),
		)
	if (f.focus !== undefined && f.focus.length > 0)
		out.push(
			...join(
				f.focus.map((s): Tok => ({ k: 'focus', specialty: s })),
				'/',
			),
		)
	if (f.minVp !== undefined) out.push(glyph('VP', `≥${f.minVp}`))
	if (out.length === 0 && anyCard) out.push(glyph('CARD'))
	return out
}

/** A zone standing in for its cards when a query has no filter. */
function zoneNoun(z: Query['zones'][number]): Tok | undefined {
	if (typeof z === 'string') {
		if (z === 'LOCATIONS' || z === 'NEUTRAL_LOCATIONS') return suit('LOCATION')
		return undefined
	}
	switch (z.k) {
		case 'LOCATION_AREA':
			return suit('LOCATION')
		case 'FLEET':
			return glyph('FLEET')
		case 'DUTY_OFFICER':
			return glyph('DUTY')
		case 'STAGING':
			return glyph('STAGING')
		case 'DISCARD':
			return glyph('DISCARD_PILE')
		case 'HAND':
			return glyph('HAND')
		case 'LOG':
			return glyph('LOG')
		case 'RESERVE':
			return glyph('RESERVE')
		case 'CAPTAIN':
			return suit('CAPTAIN')
		default:
			return undefined
	}
}

/** The things a query counts or targets. */
function query(q: Query): Tok[] {
	let base: Tok[]
	if (q.countIcons !== undefined)
		base = [
			q.countIcons === 'SKILL'
				? { k: 'skill', specialty: 'ANY' }
				: { k: 'focus', specialty: 'ANY' },
		]
	else {
		base = filt(q.filter, false)
		if (base.length === 0) {
			const noun = q.zones.map(zoneNoun).find((t) => t !== undefined)
			base = [noun ?? glyph('CARD')]
		}
	}
	return q.seat === 'OPPONENT' ? opp(base) : base
}

/** The qualifier after a card verb: nothing for "this card", the filter else. */
function target(t: Query | 'THIS' | undefined): Tok[] {
	if (t === undefined || t === 'THIS' || t.thisCard === true) return []
	const noun = filt(t.filter, false)
	if (t.seat === 'OPPONENT')
		return qual(opp(noun.length > 0 ? noun : [glyph('CARD')]))
	return qual(noun)
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function cond(p: Predicate): Tok[] {
	switch (p.k) {
		case 'SPECIALTY_AT_LEAST':
			return [glyph(p.specialty, `≥${p.value}`)]
		case 'COUNT_AT_LEAST':
			return [{ k: 'atLeast', n: `≥${p.value}`, of: query(p.query) }]
		case 'HAS_TRAIT_IN_PLAY':
			return [
				{
					k: 'atLeast',
					n: `≥${p.count ?? 1}`,
					of: [{ k: 'trait', trait: p.trait }],
				},
			]
		case 'DIFFERENT_SPECIES_IN_PLAY':
			return [
				{ k: 'atLeast', n: `≥${p.count}`, of: [word('different species')] },
			]
		case 'SAME_SHIP':
			return [word('all on one SHIP')]
		case 'CONTROLS_LOCATION':
			return [{ k: 'atLeast', n: `≥${p.count}`, of: [suit('LOCATION')] }]
		case 'AND':
			return joinGroups(p.terms.map(cond), '+')
		case 'OR':
			return joinGroups(p.terms.map(cond), '/')
		case 'NOT':
			return [{ k: 'not', body: cond(p.term) }]
		case 'BOUND_IS':
			return [{ k: 'is', body: filt(p.filter) }]
		case 'DID':
			return [glyph('CHECK')]
		case 'BOUND_SHARES_TRAIT':
			return [word('shares a trait')]
		case 'LOG_LEGAL':
			return []
		case 'CAPTAIN_HAS_TRAIT':
			return [suit('CAPTAIN'), { k: 'trait', trait: p.trait }]
		case 'COLLECTIVE_AT_LEAST':
			return [word(`collective ≥${p.value}`)]
		case 'IS_SOLO_BOT':
			return [word('Bot')]
		case 'TOTAL_VP_AT_LEAST':
			return [glyph('VP', `≥${p.value}`)]
		case 'AWAY_TEAMS_AT': {
			const t = glyph('AWAY', `≥${p.value}`)
			return p.seat === 'OPPONENT' ? opp([t]) : [t]
		}
		case 'COMPARE': {
			if (
				typeof p.b === 'number' &&
				typeof p.a === 'object' &&
				p.a.k === 'RESOURCE'
			)
				return [glyph(p.a.res, `${p.op === 'GE' ? '≥' : '<'}${p.b}`)]
			return [word(p.op === 'GE' ? 'at least' : 'lower')]
		}
	}
}

/** Compile a condition on its own — a mission goal, a requirement. */
export function shorthandCondition(p: Predicate): Tok[] {
	return cond(p)
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Compile an effect tree to glyph tokens. */
export function shorthand(e: Effect): Tok[] {
	switch (e.k) {
		// control
		case 'SEQ':
			return compress(e.steps.flatMap(shorthand))
		case 'MAY': {
			const body = shorthand(e.body)
			return body.length > 0 ? [{ k: 'may', body }] : []
		}
		case 'CHOOSE_ONE': {
			// "from your hand or your Discard pile" twins read the same here
			const seen = new Set<string>()
			const options: Tok[][] = []
			for (const o of e.options) {
				const body = shorthand(o.body)
				const key = JSON.stringify(body)
				if (seen.has(key)) continue
				seen.add(key)
				options.push(body)
			}
			if (options.length === 1) return options[0] ?? []
			return [{ k: 'or', options, pick: e.count ?? 1 }]
		}
		case 'PAY_THEN': {
			const cost = shorthand(e.cost)
			const body = shorthand(e.body)
			return cost.length > 0
				? [{ k: 'cost', body: cost }, { k: 'then' }, ...body]
				: body
		}
		case 'IF': {
			const then = shorthand(e.then)
			const other = e.else !== undefined ? shorthand(e.else) : []
			if (e.cond.k === 'DID') return then.length > 0 ? [{ k: 'did', then }] : []
			if (then.length === 0 && other.length > 0)
				return [
					{
						k: 'if',
						cond: [{ k: 'not', body: cond(e.cond) }],
						then: other,
						pred: { k: 'NOT', term: e.cond },
					},
				]
			return [
				{
					k: 'if',
					cond: cond(e.cond),
					then,
					...(other.length > 0 ? { else: other } : {}),
					pred: e.cond,
				},
			]
		}
		case 'REPEAT': {
			const body = shorthand(e.body)
			if (typeof e.times === 'object' && e.times.k === 'UP_TO')
				return [{ k: 'repeat', times: `≤${amt(e.times.max).n}`, body }]
			const m = amt(e.times)
			if (m.per !== undefined)
				return [
					{
						k: 'per',
						body,
						per: m.per,
						...(m.max !== undefined ? { max: m.max } : {}),
						source: e.times,
					},
				]
			return [{ k: 'repeat', times: m.n, body }]
		}
		case 'FOR_EACH':
			return [
				{
					k: 'per',
					body: shorthand(e.body),
					per: query(e.over),
					source: { k: 'COUNT', query: e.over },
				},
			]
		case 'LET':
			return shorthand(e.body)
		case 'OPPONENT':
		case 'FORCE':
			return opp(shorthand(e.body))
		case 'REVEAL':
			return e.whose === 'OPPONENT'
				? opp([glyph('REVEAL'), glyph('HAND')])
				: [glyph('REVEAL'), glyph('HAND')]
		case 'PUT_ON_DECK_TOP':
			return [glyph('TOP_DECK'), ...target(e.target)]
		case 'NOOP':
		case 'SELECT':
		case 'DRONE':
		case 'ASSIMILATE':
		case 'MODIFIER_DETACH':
			return []

		// costs
		case 'COST_RESOURCE':
			return counted((n) => glyph(e.res, n), e.amount, '−')
		case 'COST_ACTION':
			return [glyph('ACT', '−1')]
		case 'COST_DISCARD': {
			const t = [
				glyph('CARD', `−${e.count}`),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
			return e.whose === 'OPPONENT' ? opp(t) : t
		}
		case 'COST_PUT': {
			const to = typeof e.to === 'string' ? e.to : e.to.k
			const g: GlyphId =
				to === 'DRAW'
					? 'TOP_DECK'
					: to === 'STAGING'
						? 'PLAY'
						: to === 'LOG'
							? 'LOG'
							: 'PUT'
			return [
				glyph(g),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		}
		case 'COST_EXHAUST':
			return [
				glyph('EXHAUST'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		case 'COST_REFRESH':
			return [
				glyph('REFRESH'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		case 'COST_REMOVE_AWAY_TEAM':
			return [glyph('AWAY', `−${e.count}`)]
		case 'COST_TAKE_INCIDENT':
			return [suit('INCIDENT', `+${e.count}`)]
		case 'COST_DISMISS':
			return [
				glyph('DISMISS'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		case 'COST_LOG_THIS':
			return [glyph('LOG')]
		case 'COST_REQUIRE': {
			const c = cond(e.cond)
			return c.length > 0 ? [{ k: 'req', cond: c }] : []
		}
		case 'COST_RETURN_INCIDENT':
			return [suit('INCIDENT', `−${e.count}`)]
		case 'COST_RECALL':
			return [
				glyph('RECALL'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		case 'COST_LOG':
			return [
				glyph('LOG'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		case 'COST_BEAM':
			return [
				glyph('BEAM'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]

		// card movement
		case 'BEAM':
			return [
				glyph('BEAM', e.count !== 1 ? String(e.count) : undefined),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
			]
		case 'DEPLOY':
			return [glyph('DEPLOY')]
		case 'DESTROY':
			return [glyph('DESTROY'), ...target(e.target)]
		case 'DISCARD': {
			const t =
				e.from === 'DECK_TOP'
					? [glyph('DECK', `−${e.count}`)]
					: [glyph('CARD', `−${e.count}`), ...qual(filt(e.filter, false))]
			return e.whose === 'OPPONENT' ? opp(t) : t
		}
		case 'DISMISS':
			return [glyph('DISMISS'), ...target(e.target)]
		case 'DRAW':
			return counted((n) => glyph('CARD', n), e.count, '+')
		case 'DRAW_FROM_DISCARD':
			return [
				glyph('FROM_DISCARD', `+${e.count}`),
				...qual(filt(e.filter, false)),
			]
		case 'RECALL':
			return [glyph('RECALL'), ...target(e.target)]
		case 'LOG':
			return [glyph('LOG'), ...target(e.target)]
		case 'PROMOTE':
			return [
				glyph('PROMOTE'),
				...(e.target === 'THIS' ? [] : qual(filt(e.filter, false))),
				...(e.from === 'DISCARD' ? qual([glyph('DISCARD_PILE')]) : []),
			]
		case 'JUNK':
			return [glyph('JUNK')]
		case 'PUT_INTO_STAGING':
			return [glyph('PLAY'), ...target(e.target)]

		// acquisition
		case 'GAIN_CARD':
			return [
				{
					k: 'gain',
					suits: e.suits,
					...(e.onlyJunk === true
						? { junk: 'ONLY' }
						: e.includeJunk === true
							? { junk: 'ALSO' }
							: {}),
				},
			]
		case 'SCAN_N':
			return [
				{
					k: 'scan',
					n: amt(e.n).n,
					of: join(
						e.suits.map((s) => suit(s)),
						'/',
					),
					...(e.includeJunk === true ? { junk: true } : {}),
				},
			]
		case 'SCAN_FOR_TRAIT':
			return [
				{
					k: 'scan',
					of: join(
						e.traits.map((t): Tok => ({ k: 'trait', trait: t })),
						'/',
					),
					...(e.includeJunk === true ? { junk: true } : {}),
				},
			]
		case 'TAKE':
			return [
				{
					k: 'suit',
					suit: e.deck,
					n: `+${e.count}`,
					...(e.look !== undefined ? { note: `look ${e.look}` } : {}),
				},
			]
		case 'FIND':
			return [glyph('FIND'), ...qual(filt(e.filter, false))]
		case 'RETURN_INCIDENT':
			return [suit('INCIDENT', '−1')]
		case 'ENLIST_RESERVE':
			return [glyph('ENLIST')]
		case 'ENLIST_DEVELOPMENT':
			return [
				glyph('DEVELOP', e.free === true ? 'free' : undefined),
				...qual(filt(e.filter, false)),
			]

		// resources & actions
		case 'GAIN_RESOURCE':
			return counted((n) => glyph(e.res, n), e.amount, '+')
		case 'SPEND_RESOURCE':
			return counted((n) => glyph(e.res, n), e.amount, '−')
		case 'STEAL':
			return [
				{ k: 'steal', body: counted((n) => glyph(e.res, n), e.amount, '') },
			]
		case 'GAIN_ACTION':
			return counted((n) => glyph('ACT', n), e.amount, '+')
		case 'ADVANCE_SPECIALTY': {
			const g: GlyphId =
				e.specialty === 'CHOICE'
					? 'ANY_SPECIALTY'
					: e.specialty === 'LOWEST' || typeof e.specialty === 'object'
						? 'LOWEST_SPECIALTY'
						: e.specialty
			return counted((n) => glyph(g, n), e.amount, '+')
		}
		case 'RECRYSTALLIZE':
			return [
				glyph('RECRYSTALLIZE', e.amount === 'ALL' ? 'all' : amt(e.amount).n),
			]
		case 'SCORE_VP':
			return counted((n) => glyph('VP', n), e.amount, '')

		// board
		case 'SEND_AWAY_TEAM':
			return counted((n) => glyph('SEND', n), e.count, '')
		case 'REMOVE_AWAY_TEAM': {
			const t = [glyph('AWAY', `−${e.count}`)]
			return e.whose === 'OPPONENT' ? opp(t) : t
		}
		case 'WARP':
			return [glyph('WARP', e.count !== undefined ? amt(e.count).n : undefined)]
		case 'TAKE_CONTROL':
			return [
				glyph('CONTROL'),
				...(e.target === 'FROM_LOCATION_DECK' ? qual([word('deck')]) : []),
			]
		case 'TRIGGER_CONTROL':
			return [glyph('CONTROL', 'again')]
		case 'EXHAUST':
			return [glyph('EXHAUST'), ...target(e.target)]
		case 'REFRESH': {
			const n = e.count !== undefined ? amt(e.count).n : '1'
			return [glyph('REFRESH', n !== '1' ? n : undefined), ...target(e.target)]
		}
		case 'PLACE_RESOURCE_ON_MARKET':
			return [
				glyph('MARKET'),
				...counted((n) => glyph(e.res, n), e.amount, '+'),
			]
		case 'WIPE_MARKET':
			return [glyph('WIPE_MARKET')]
		case 'WIPE_NEUTRAL_ZONE':
			return [glyph('WIPE_NEUTRAL_ZONE')]
		case 'REMOVE_STARDATE_GLORY':
			return [glyph('STARDATE', `−${e.amount}`)]
		case 'ARRANGE_DECK':
			return [glyph('ARRANGE', String(e.n))]
		case 'IGNORE_ATTACK':
			return [glyph('SHIELD')]
		case 'REPLACE_GAIN':
			return [
				{
					k: 'scan',
					n: String(e.scan),
					of: [word('same suit')],
					instead: true,
				},
			]

		// meta
		case 'FREE_PLAY':
			return [
				glyph('FREE_PLAY'),
				...(e.bound !== undefined ? [] : qual(filt(e.filter, false))),
			]
		case 'DUPLICATE':
			return [
				glyph('DUPLICATE'),
				...qual(
					e.suits.length >= 6
						? [glyph('CARD')]
						: join(
								e.suits.map((s) => suit(s)),
								'/',
							),
				),
			]
		case 'COMPLETE_MISSION':
			return [glyph('MISSION')]
		case 'MODIFIER_ATTACH':
			return [{ k: 'rule', text: describeModifier(e.id) ?? e.id }]
		case 'ALT_PLAY':
			return [
				{ k: 'rule', text: `Any ${e.suits.join('/')} may be played as:` },
				...shorthand(e.operation.effect),
			]
		case 'SCRIPT':
			return [word('special rule')]

		// solo Bot (rules/13) — Automated Command rows
		case 'TRY': {
			const then = shorthand(e.body)
			const other = e.otherwise !== undefined ? shorthand(e.otherwise) : []
			return [
				{
					k: 'if',
					cond: [word(e.test !== undefined ? 'able (both)' : 'able')],
					then,
					...(other.length > 0 ? { else: other } : {}),
				},
			]
		}
		case 'ATTACK':
			return [glyph('ATTACK'), ...shorthand(e.body)]
		case 'BOT_DECK': {
			const verb =
				e.op === 'LOG' ? glyph('LOG') : e.op === 'DISCARD' ? glyph('DISCARD_PILE') : glyph('TOP_DECK')
			return [
				verb,
				glyph('DECK', `${e.count}`),
				...(e.from === 'SUPPLEMENT' ? qual([word('supplement')]) : []),
			]
		}
		case 'BOT_ACQUIRE': {
			if (e.from === 'ENCOUNTER' || e.from === 'INCIDENT')
				return [{ k: 'suit', suit: e.from, n: '+1' }]
			const terms: Tok[] = (e.pref ?? [[{}]]).flatMap((step, i) => [
				...(i > 0 ? [word('>')] : []),
				...step.flatMap((term, j) => [
					...(j > 0 ? [{ k: 'sep', s: '/' } as Tok] : []),
					...('most' in term ? [word('most'), glyph(term.most)] : filt(term)),
				]),
			])
			return [
				e.mode === 'GAIN' ? glyph('DISCARD_PILE', '+1') : glyph('TOP_DECK', '+1'),
				...qual(terms),
			]
		}
		case 'BOT_JUNK':
			return [glyph('JUNK'), ...qual([word('most valuable')])]
		case 'BOT_SEND_AWAY_TEAM':
			return [
				...counted((n) => glyph('SEND', n), e.count, ''),
				...(e.prefer !== undefined
					? qual(e.prefer.map((t) => ({ k: 'trait', trait: t }) as Tok))
					: []),
			]
		case 'BOT_DEPLOY':
			return [
				glyph('DEPLOY'),
				...(e.then !== undefined ? [glyph('WARP'), word(e.then.toLowerCase())] : []),
			]
		case 'BOT_PROMOTE':
			return [
				glyph('PROMOTE'),
				...(e.target === 'DISCARD' ? qual([glyph('DISCARD_PILE')]) : []),
			]
		case 'BOT_RESOLVE':
			return [word('resolve'), ...qual([word(e.from.toLowerCase().replace('_', ' '))])]
		case 'BOT_TAKE_CONTROL':
			return [glyph('CONTROL'), ...qual([word('most Bot tokens')])]
		case 'BOT_REMOVE_AWAY_TEAM':
			return [glyph('AWAY', `−${e.count}`)]
		case 'TRANSFER':
			return [glyph('DECK'), word('bottom, yours')]
	}
}

/** Consecutive siblings that differ only in one suit/trait leaf collapse into
 *  one "each:" group with the leaves joined — 1PIC04' six "you may
 *  discard a <suit> to gain 1 GLO" become one line. */
function compress(toks: Tok[]): Tok[] {
	const LEAF = /\{"k":"(?:suit|trait)","(?:suit|trait)":"[A-Z_]+"\}/g
	const key = (t: Tok) => JSON.stringify(t).replace(LEAF, '#')
	const leaf = (t: Tok): string | undefined => {
		const m = JSON.stringify(t).match(LEAF)
		return m !== null && m.length === 1 ? m[0] : undefined
	}
	const out: Tok[] = []
	for (let i = 0; i < toks.length;) {
		const first = toks[i] as Tok
		const firstLeaf = leaf(first)
		let j = i + 1
		while (
			firstLeaf !== undefined &&
			j < toks.length &&
			key(toks[j] as Tok) === key(first) &&
			leaf(toks[j] as Tok) !== undefined
		)
			j++
		if (firstLeaf !== undefined && j - i >= 3) {
			const leaves = toks
				.slice(i, j)
				.map((t) => JSON.parse(leaf(t) as string) as Tok)
			const slot = '"__ALT__"'
			const template = JSON.stringify(first).replace(firstLeaf, slot)
			const merged = JSON.parse(template, (_k, v: unknown) =>
				v === '__ALT__' ? { k: 'alt', options: leaves } : v,
			) as Tok
			out.push({ k: 'repeat', times: 'each', body: [merged] })
			i = j
		} else {
			out.push(first)
			i++
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** What a REACTION (or triggered PASSIVE / SPECIAL) waits for. */
export function shorthandTrigger(t: TriggerSpec): Tok[] {
	const whose = (seat: 'SELF' | 'OPPONENT' | 'ANY' | undefined, body: Tok[]) =>
		seat === 'OPPONENT' ? opp(body) : body
	switch (t.on) {
		case 'CARD_PLAYED':
			return whose(t.seat, [glyph('PLAY'), ...qual(filt(t.filter, false))])
		case 'CARD_GAINED': {
			const suits = (t.filter?.suits ?? []).filter(isMarketSuit)
			return whose(t.seat, [
				{ k: 'gain', suits: suits.length > 0 ? suits : ['ANY'] },
			])
		}
		case 'RESOURCE_GAINED':
			return [glyph(t.res ?? 'DIL', '+')]
		case 'SPECIALTY_ADVANCED': {
			const list = [
				...(t.specialty !== undefined ? [t.specialty] : []),
				...(t.specialties ?? []),
			]
			const toks =
				list.length > 0
					? join(
							list.map((s) => glyph(s, '+')),
							'/',
						)
					: [glyph('ANY_SPECIALTY', '+')]
			return whose(t.seat, toks)
		}
		case 'PUT_INTO_PLAY':
			return whose(t.seat, [glyph('ENTER'), ...qual(filt(t.filter, false))])
		case 'CARD_DEPLOYED':
			return whose(t.seat, [glyph('DEPLOY'), ...qual(filt(t.filter, false))])
		case 'LOCATION_CONTROLLED':
			return whose(t.seat, [glyph('CONTROL')])
		case 'CARD_LOGGED':
			return whose(t.seat, [glyph('LOG'), ...qual(filt(t.filter, false))])
		case 'AWAY_TEAM_SENT':
			return [
				glyph('SEND'),
				...(t.neutral === true ? qual([word('neutral')]) : []),
			]
		case 'SHIP_WARPED':
			return [glyph('WARP')]
		case 'INCIDENT_TAKEN':
			return [suit('INCIDENT', t.orReturned === true ? '±' : '+')]
		case 'INCIDENT_RETURNED':
			return [suit('INCIDENT', '−')]
		case 'ATTACKED':
			return opp([glyph('ATTACK')])
		case 'WOULD_BE_ATTACKED':
			return [
				...opp([glyph('ATTACK')]),
				...(t.effect === 'DISMISS_DUTY_OFFICER'
					? qual([glyph('DUTY')])
					: t.effect === 'REMOVE_AWAY_TEAM'
						? qual([glyph('AWAY')])
						: []),
			]
		case 'WOULD_GAIN_CARD':
			return [{ k: 'gain', suits: ['ANY'] }]
		case 'BEFORE_SCORING':
			return [glyph('ENDGAME')]
		case 'ATTACK_MADE':
			return [glyph('ATTACK')]
		case 'MISSION_COMPLETED':
			return [glyph('MISSION')]
		case 'ENCOUNTER_TAKEN':
			return [suit('ENCOUNTER', '+')]
		case 'OPERATION_RESOLVED':
			return [
				glyph('OPERATION'),
				...(t.paid !== undefined ? qual([glyph(t.paid)]) : []),
			]
	}
}

function isMarketSuit(s: Suit): s is MarketSuit {
	return s === 'PERSON' || s === 'CARGO' || s === 'SHIP' || s === 'ALLY'
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Compile one printed operation strip. */
export function shorthandOperation(op: Operation): ShorthandLine {
	return {
		timing: op.type,
		action: op.costsAction,
		attack: op.isAttack,
		...(op.requires !== undefined
			? { requires: { specialty: op.requires.specialty, min: op.requires.min } }
			: {}),
		trigger: op.trigger !== undefined ? shorthandTrigger(op.trigger) : [],
		body: shorthand(op.effect),
	}
}

/** A Development cost as a line of its own (the black strip). */
export function shorthandDevelopmentCost(cost: Effect): ShorthandLine {
	return {
		timing: 'DEVELOPMENT',
		action: false,
		attack: false,
		trigger: [],
		body: shorthand(cost),
	}
}

// ---------------------------------------------------------------------------
// Plain-text form (tests, tools) and readability weight
// ---------------------------------------------------------------------------

/** Labels printed before the glyph: signed, bounded or bare numbers. */
export function labelLeads(n: string): boolean {
	return /^[+−±≤0-9]/.test(n)
}

function text(toks: Tok[]): string {
	return toks.map(tokText).join(' ')
}

function tokText(t: Tok): string {
	switch (t.k) {
		case 'glyph':
			return t.n === undefined
				? t.g
				: labelLeads(t.n)
					? `${t.n} ${t.g}`
					: `${t.g} ${t.n}`
		case 'suit': {
			const base = `<${t.suit}>`
			const withN =
				t.n === undefined
					? base
					: labelLeads(t.n)
						? `${t.n}${base}`
						: `${base}${t.n}`
			return t.note !== undefined ? `${withN} (${t.note})` : withN
		}
		case 'skill':
			return `skill:${t.specialty}`
		case 'focus':
			return `focus:${t.specialty}`
		case 'trait':
			return `#${t.trait}`
		case 'name':
			return `"${t.name}"`
		case 'word':
			return `'${t.text}'`
		case 'num':
			return t.n
		case 'then':
			return '›'
		case 'sep':
			return t.s
		case 'cost':
			return `{${text(t.body)}}`
		case 'may':
			return `(${text(t.body)})?`
		case 'or':
			return `${t.pick > 1 ? `pick ${t.pick} ` : ''}( ${t.options.map((o) => (o.length > 0 ? text(o) : '∅')).join(' | ')} )`
		case 'opp':
			return `OPP[${text(t.body)}]`
		case 'if':
			return `IF ${text(t.cond)} ⇒ ${text(t.then)}${t.else !== undefined ? ` ELSE ${text(t.else)}` : ''}`
		case 'did':
			return `✓⇒ ${text(t.then)}`
		case 'repeat':
			return `${t.times === 'each' ? 'each' : `${t.times}×`}(${text(t.body)})`
		case 'per':
			return `${text(t.body)} / ${text(t.per)}${t.max !== undefined ? ` max${t.max}` : ''}`
		case 'qual':
			return `·${text(t.body)}`
		case 'req':
			return `REQ[${text(t.cond)}]`
		case 'gain':
			return `+${t.suits.join('/')}${t.junk === 'ONLY' ? '(junk)' : t.junk === 'ALSO' ? '(+junk)' : ''}`
		case 'scan':
			return `SCAN${t.n ?? ''} ${text(t.of)}${t.junk === true ? ' +junk' : ''}${t.instead === true ? ' instead' : ''}`
		case 'steal':
			return `STEAL ${text(t.body)}`
		case 'rule':
			return `§«${t.text}»`
		case 'atLeast':
			return `${t.n} ${text(t.of)}`
		case 'is':
			return `=${text(t.body)}?`
		case 'not':
			return `non-${text(t.body)}`
		case 'alt':
			return t.options.map(tokText).join('/')
	}
}

const TIMING_TEXT: Record<ShorthandLine['timing'], string> = {
	PLAY: 'PLAY',
	ACTIVATION: 'ACTI',
	PASSIVE: 'PASS',
	REACTION: 'REAC',
	RESUPPLY: 'RESU',
	CLEANUP: 'CLEA',
	CONTROL: 'CONT',
	ENDGAME: 'ENDG',
	SPECIAL: 'SPEC',
	SURPRISE: 'SURP',
	DEVELOPMENT: 'DEV',
}

/** One line of plain text: "ACTI {−1 DIL} › WARP". */
export function formatShorthand(line: ShorthandLine): string {
	const head = [
		TIMING_TEXT[line.timing],
		...(line.action ? ['ACT'] : []),
		...(line.attack ? ['ATTACK'] : []),
		...(line.requires !== undefined
			? [`REQ[${line.requires.specialty} ≥${line.requires.min}]`]
			: []),
	].join(' ')
	const trigger = line.trigger.length > 0 ? `${text(line.trigger)} : ` : ''
	return `${head} | ${trigger}${text(line.body)}`
}

/** How much a line asks of the eye: glyphs and chips count 1, a name or word
 *  1.5, a rule sentence 3, a separator 0.3. The action chip counts 1. The
 *  golden test keeps the catalogue glanceable against this measure. */
export function shorthandWeight(line: ShorthandLine): number {
	let w = line.action ? 1 : 0
	const walk = (toks: Tok[]) => {
		for (const t of toks) {
			switch (t.k) {
				case 'glyph':
				case 'suit':
				case 'skill':
				case 'focus':
				case 'trait':
				case 'num':
					w += 1
					break
				case 'name':
				case 'word':
					w += 1.5
					break
				case 'rule':
					w += 3
					break
				case 'then':
				case 'sep':
					w += 0.3
					break
				case 'gain':
					w += 1 + t.suits.length
					break
				case 'scan':
					w += 1
					walk(t.of)
					break
				case 'cost':
				case 'may':
				case 'opp':
				case 'qual':
				case 'steal':
				case 'is':
				case 'not':
					walk(t.body)
					break
				case 'req':
					walk(t.cond)
					break
				case 'or':
					for (const o of t.options) walk(o)
					break
				case 'if':
					walk(t.cond)
					walk(t.then)
					if (t.else !== undefined) walk(t.else)
					break
				case 'did':
					walk(t.then)
					break
				case 'repeat':
					walk(t.body)
					break
				case 'per':
					walk(t.body)
					walk(t.per)
					break
				case 'atLeast':
					walk(t.of)
					break
				case 'alt':
					walk(t.options)
					break
			}
		}
	}
	walk(line.trigger)
	walk(line.body)
	return Math.round(w * 10) / 10
}
