// describe() round-trip tests (todo/11 §2 + DoD). The seven worked examples
// in docs/effect-dsl.md §7 are the ground truth: describe(effect) — plus the
// operation-level prefixes — must re-render the *significant* tokens of each
// example's printed text. Plus a compile-time totality guard: a Record keyed
// on every Effect['k'] forces a missing node kind to fail compilation, and the
// runtime asserts every one of the 63 renders to non-empty English.

import { beforeAll, describe as vitestDescribe, expect, it } from 'vitest'

import type { Effect, Operation } from './resolver/nodes'
import type { Amount, Query } from './resolver/queries'
import type { MarketSuit, ResourceId } from '../data/ids'
import { SUITS, TRAITS, SPECIALTIES } from '../data/ids'
import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from './setup'
import { describe, describeOperation } from './describe'
import { PRIMITIVES } from './resolver/primitives'

// ---------------------------------------------------------------------------
// Significant-token vocab (mirrors tools/check_fidelity.ts — keep in sync)
// ---------------------------------------------------------------------------

const SUIT_SET = new Set<string>(SUITS)
const TRAIT_SET = new Set<string>(TRAITS)
const SPEC_SET = new Set<string>(SPECIALTIES)

const VERBS = [
	'beam',
	'deploy',
	'destroy',
	'discard',
	'dismiss',
	'draw',
	'recall',
	'log',
	'promote',
	'junk',
	'put',
	'gain',
	'scan',
	'take',
	'find',
	'return',
	'enlist',
	'send',
	'warp',
	'remove',
	'refresh',
	'exhaust',
	'duplicate',
	'recrystallize',
	'steal',
	'free',
	'play',
	'spend',
	'attack',
	'control',
	'place',
	'wipe',
	'advance',
	'force',
	'may',
	'have',
	'gain',
]
const VERB_SET = new Set(VERBS)

/** Significant tokens of a card text: {ICON} tokens, numbers, suit/trait/
 *  specialty names, resource words, keyword verbs. "1 card" ≡ "a card". */
function sigTokens(text: string): Set<string> {
	let t = text.toLowerCase()
	// prose resource names in the docs examples → icon tokens
	t = t
		.replace(/dilithium/g, '{dil}')
		.replace(/latinum/g, '{lat}')
		.replace(/glory/g, '{glo}')
	// "1 card" is an article, not a number, in both record and description style
	t = t.replace(/\b(\d+) card\b/g, 'a card')
	const out = new Set<string>()
	for (const m of t.match(/\{[^}]+\}/g) ?? []) out.add(m.toUpperCase())
	const words = t
		.replace(/[^a-z0-9 ]/g, ' ')
		.split(/\s+/)
		.filter((w) => w !== '')
	for (const w of words) {
		const up = w.toUpperCase()
		if (/^\d+$/.test(w)) out.add(w)
		else if (w === 'action') out.add('{ACTION}')
		else if (w === 'vp') out.add('VP')
		else if (SUIT_SET.has(up) || TRAIT_SET.has(up) || SPEC_SET.has(up))
			out.add(up)
		else if (VERB_SET.has(w)) out.add(w)
	}
	return out
}

/** Assert the description recalls every significant token of the example. */
function expectRoundTrip(operation: Operation, exampleText: string): void {
	const rendered = describeOperation(operation)
	const want = sigTokens(exampleText)
	const got = sigTokens(rendered)
	const missing = [...want].filter((tok) => !got.has(tok))
	expect(
		{ missing, exampleText, rendered },
		`missing ${missing.length > 0 ? missing.join(', ') : '(none)'} in:\n  ${rendered}`,
	).toMatchObject({ missing: [] })
}

// ---------------------------------------------------------------------------
// §7 helper builders
// ---------------------------------------------------------------------------

const gain = (res: ResourceId, amount: number): Effect => ({
	k: 'GAIN_RESOURCE',
	res,
	amount,
})
const gainCard = (suit: MarketSuit): Effect => ({
	k: 'GAIN_CARD',
	suits: [suit],
})
const draw = (count: number): Effect => ({ k: 'DRAW', count })

function op(
	o: Partial<Operation> & { type: Operation['type']; effect: Effect },
): Operation {
	return { costsAction: false, isAttack: false, text: '', ...o }
}

// ---------------------------------------------------------------------------
// DoD: round-trip all seven worked examples from docs/effect-dsl.md §7
// ---------------------------------------------------------------------------

vitestDescribe('describe() round-trips every §7 worked example', () => {
	it('#1 Simple: Recruit — "Gain an ALLY."', () => {
		const o = op({
			type: 'PLAY',
			costsAction: true,
			effect: gainCard('ALLY'),
			text: 'Gain an ALLY.',
		})
		expectRoundTrip(o, 'Gain an ALLY.')
	})

	it('#2 Sequence: 1PIC24 RESUPPLY — discard off the deck top, then gain Latinum', () => {
		const o = op({
			type: 'RESUPPLY',
			effect: {
				k: 'SEQ',
				steps: [{ k: 'DISCARD', from: 'DECK_TOP', count: 1 }, gain('LAT', 1)],
			},
			text: 'Discard 1 card off your deck top; gain 1 Latinum.',
		})
		expectRoundTrip(o, o.text ?? '')
		// the cost/benefit seam: a plain sequence, NOT " to "
		expect(describe(o.effect)).toBe(
			'Discard the top card of your deck. Gain 1 {LAT}.',
		)
	})

	it('#3 PAY_THEN: 1SHR17 — "Spend 2 Dilithium to gain a CARGO."', () => {
		const o = op({
			type: 'PLAY',
			costsAction: true,
			effect: {
				k: 'PAY_THEN',
				cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
				body: gainCard('CARGO'),
			},
			text: 'Spend 2 Dilithium to gain a CARGO.',
		})
		expectRoundTrip(o, 'Spend 2 Dilithium to gain a CARGO.')
		expect(describe(o.effect)).toBe('Spend 2 {DIL} to gain a CARGO.')
	})

	it('#4 Variable amount: 1SHI13 — IF over HAS_TRAIT_IN_PLAY', () => {
		const o = op({
			type: 'RESUPPLY',
			effect: {
				k: 'IF',
				cond: { k: 'HAS_TRAIT_IN_PLAY', trait: 'ANOMALY', count: 2 },
				then: draw(1),
			},
			text: 'Draw 1 card if you have 2+ ANOMALY in play.',
		})
		expectRoundTrip(o, 'Draw 1 card if you have 2+ ANOMALY in play.')
		expect(describe(o.effect)).toBe(
			'If you have 2 or more ANOMALY in play, draw a card.',
		)
	})

	it('#5 Choice+restriction: 1ALL08 — requires + PAY_THEN resource → GAIN_ACTION', () => {
		const o = op({
			type: 'PLAY',
			requires: { specialty: 'MILITARY', min: 3 },
			effect: {
				k: 'PAY_THEN',
				cost: { k: 'COST_RESOURCE', res: 'LAT', amount: 1 },
				body: { k: 'GAIN_ACTION', amount: 1 },
			},
			text: 'MILITARY 3+ — Spend 1 Latinum: gain an [action].',
		})
		expectRoundTrip(o, 'MILITARY 3+ — Spend 1 Latinum: gain an [action].')
		expect(describeOperation(o)).toBe(
			'Requires MILITARY 3 Spend 1 {LAT} to gain 1 {ACTION}.',
		)
	})

	it('#6 REACTION: 1LOC01 — trigger + MAY log from Discard', () => {
		const logQuery: Query = { zones: [{ k: 'DISCARD', seat: 0 }] }
		const o = op({
			type: 'REACTION',
			trigger: {
				on: 'CARD_PLAYED',
				filter: { suits: ['ENCOUNTER'] },
				seat: 'SELF',
			},
			effect: {
				k: 'SEQ',
				steps: [
					gain('GLO', 1),
					{ k: 'MAY', body: { k: 'LOG', target: logQuery } },
				],
			},
			text: 'REACTION: After you play a DISCOVERY, gain 1 Glory; you may then log a Discard-pile card.',
		})
		expectRoundTrip(o, o.text ?? '')
		expect(describe(o.effect)).toBe(
			'Gain 1 {GLO}. You may log a card from your Discard pile.',
		)
		expect(describeOperation(o)).toBe(
			'After you play an ENCOUNTER: Gain 1 {GLO}. You may log a card from your Discard pile.',
		)
	})

	it('#7 Self-logging: 1ALL03 — costsAction + LOG THIS as last step', () => {
		const o = op({
			type: 'PLAY',
			costsAction: true,
			effect: {
				k: 'SEQ',
				steps: [gainCard('CARGO'), { k: 'LOG', target: 'THIS' }],
			},
			text: '[action] Gain a CARGO. Log this card.',
		})
		expectRoundTrip(o, '[action] Gain a CARGO. Log this card.')
		expect(describe(o.effect)).toBe('Gain a CARGO. Log this card.')
		expect(describeOperation(o)).toBe('{ACTION} Gain a CARGO. Log this card.')
	})
})

// ---------------------------------------------------------------------------
// Totality: every one of the 63 node kinds renders something sensible
// ---------------------------------------------------------------------------

const query0: Query = {
	zones: ['IN_PLAY'],
	seat: 'SELF',
	filter: { suits: ['SHIP'] },
}

/** One minimal-but-valid sample node per kind. The Record type forces the
 *  compiler to name all 63 kinds — adding a node kind without a sample here is
 *  a compile error, so coverage can never silently rot. */
const samples: { [K in Effect['k']]: Effect & { k: K } } = {
	// control
	SEQ: { k: 'SEQ', steps: [gain('DIL', 1), draw(1)] },
	MAY: { k: 'MAY', body: draw(1) },
	CHOOSE_ONE: {
		k: 'CHOOSE_ONE',
		options: [
			{ label: 'a', body: draw(1) },
			{ label: 'b', body: gain('LAT', 1) },
		],
	},
	PAY_THEN: {
		k: 'PAY_THEN',
		cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
		body: gainCard('CARGO'),
	},
	IF: {
		k: 'IF',
		cond: { k: 'HAS_TRAIT_IN_PLAY', trait: 'ANOMALY' },
		then: draw(1),
	},
	REPEAT: { k: 'REPEAT', times: 2, body: gainCard('CARGO') },
	FOR_EACH: { k: 'FOR_EACH', over: query0, bind: 'x', body: gain('DIL', 1) },
	LET: { k: 'LET', bind: 'x', value: 3, body: gain('DIL', 1) },
	OPPONENT: { k: 'OPPONENT', body: { k: 'DISCARD', from: 'HAND', count: 1 } },
	NOOP: { k: 'NOOP' },
	REVEAL: { k: 'REVEAL', whose: 'OPPONENT' },
	PUT_ON_DECK_TOP: { k: 'PUT_ON_DECK_TOP', target: 'THIS' },
	// costs
	COST_RESOURCE: { k: 'COST_RESOURCE', res: 'DIL', amount: 1 },
	COST_ACTION: { k: 'COST_ACTION' },
	COST_DISCARD: { k: 'COST_DISCARD', filter: { suits: ['CARGO'] }, count: 1 },
	COST_PUT: { k: 'COST_PUT', count: 1, to: { k: 'DRAW', seat: 0 } },
	COST_EXHAUST: { k: 'COST_EXHAUST', filter: { suits: ['SHIP'] } },
	COST_REFRESH: { k: 'COST_REFRESH', filter: { traits: ['BAJORAN'] } },
	COST_REMOVE_AWAY_TEAM: { k: 'COST_REMOVE_AWAY_TEAM', count: 1 },
	COST_TAKE_INCIDENT: { k: 'COST_TAKE_INCIDENT', count: 1 },
	COST_DISMISS: { k: 'COST_DISMISS', filter: { suits: ['PERSON'] }, count: 1 },
	COST_LOG_THIS: { k: 'COST_LOG_THIS' },
	COST_RETURN_INCIDENT: {
		k: 'COST_RETURN_INCIDENT',
		count: 1,
		filter: { suits: ['INCIDENT'] },
	},
	COST_RECALL: {
		k: 'COST_RECALL',
		filter: { suits: ['CARGO'] },
		from: { k: 'STAGING', seat: 0 },
	},
	COST_LOG: { k: 'COST_LOG', filter: { suits: ['PERSON'] } },
	COST_BEAM: {
		k: 'COST_BEAM',
		filter: { suits: ['PERSON'] },
		from: { k: 'DUTY_OFFICER', seat: 0 },
		to: query0,
		count: 1,
	},
	// movement
	BEAM: { k: 'BEAM', to: query0, count: 1 },
	DEPLOY: { k: 'DEPLOY', target: query0 },
	DESTROY: { k: 'DESTROY', target: query0 },
	DISCARD: { k: 'DISCARD', from: 'HAND', count: 1 },
	DISMISS: { k: 'DISMISS', target: query0 },
	DRAW: { k: 'DRAW', count: 1 },
	DRAW_FROM_DISCARD: { k: 'DRAW_FROM_DISCARD', count: 1 },
	RECALL: { k: 'RECALL', target: query0 },
	LOG: { k: 'LOG', target: 'THIS' },
	PROMOTE: { k: 'PROMOTE', from: 'HAND' },
	JUNK: { k: 'JUNK', target: { zones: ['IN_PLAY'] } },
	PUT_INTO_STAGING: { k: 'PUT_INTO_STAGING', target: query0 },
	// acquisition
	GAIN_CARD: { k: 'GAIN_CARD', suits: ['CARGO'] },
	SCAN_N: { k: 'SCAN_N', n: 3, suits: ['CARGO'] },
	SCAN_FOR_TRAIT: { k: 'SCAN_FOR_TRAIT', traits: ['SHADY'] },
	TAKE: { k: 'TAKE', deck: 'INCIDENT', count: 1 },
	SELECT: {
		k: 'SELECT',
		target: {
			zones: [{ k: 'LOCATION_AREA', seat: 0 }],
			filter: { suits: ['LOCATION'] },
		},
		bind: 'sel',
	},
	FIND: {
		k: 'FIND',
		filter: { suits: ['SHIP'] },
		zones: [{ k: 'DISCARD', seat: 0 }],
	},
	RETURN_INCIDENT: { k: 'RETURN_INCIDENT', target: { zones: ['IN_PLAY'] } },
	ENLIST_RESERVE: { k: 'ENLIST_RESERVE' },
	ENLIST_DEVELOPMENT: { k: 'ENLIST_DEVELOPMENT' },
	// resources & actions
	GAIN_RESOURCE: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
	SPEND_RESOURCE: { k: 'SPEND_RESOURCE', res: 'LAT', amount: 1 },
	STEAL: { k: 'STEAL', res: 'GLO', amount: 1 },
	GAIN_ACTION: { k: 'GAIN_ACTION', amount: 1 },
	ADVANCE_SPECIALTY: {
		k: 'ADVANCE_SPECIALTY',
		specialty: 'RESEARCH',
		amount: 1,
	},
	RECRYSTALLIZE: { k: 'RECRYSTALLIZE', amount: 1 },
	// board
	SEND_AWAY_TEAM: {
		k: 'SEND_AWAY_TEAM',
		count: 1,
		target: { zones: ['IN_PLAY'] },
	},
	REMOVE_AWAY_TEAM: {
		k: 'REMOVE_AWAY_TEAM',
		count: 1,
		target: { zones: ['IN_PLAY'] },
		whose: 'SELF',
	},
	WARP: { k: 'WARP', ship: query0, to: { zones: ['IN_PLAY'] } },
	TAKE_CONTROL: { k: 'TAKE_CONTROL', target: { zones: ['IN_PLAY'] } },
	TRIGGER_CONTROL: { k: 'TRIGGER_CONTROL', target: { zones: ['IN_PLAY'] } },
	EXHAUST: { k: 'EXHAUST', target: query0 },
	REFRESH: { k: 'REFRESH', target: query0, count: 2 },
	PLACE_RESOURCE_ON_MARKET: {
		k: 'PLACE_RESOURCE_ON_MARKET',
		res: 'DIL',
		amount: 1,
	},
	WIPE_MARKET: { k: 'WIPE_MARKET' },
	WIPE_NEUTRAL_ZONE: { k: 'WIPE_NEUTRAL_ZONE' },
	REMOVE_STARDATE_GLORY: { k: 'REMOVE_STARDATE_GLORY', amount: 1 },
	ARRANGE_DECK: { k: 'ARRANGE_DECK', decks: ['LOCATION'], n: 3 },
	IGNORE_ATTACK: { k: 'IGNORE_ATTACK' },
	REPLACE_GAIN: { k: 'REPLACE_GAIN', scan: 2 },
	// meta
	FREE_PLAY: { k: 'FREE_PLAY', filter: { suits: ['SHIP'] } },
	DUPLICATE: {
		k: 'DUPLICATE',
		suits: ['SHIP'],
		from: ['MARKET'],
		opType: 'PLAY',
	},
	FORCE: { k: 'FORCE', body: { k: 'DISCARD', from: 'HAND', count: 1 } },
	COMPLETE_MISSION: { k: 'COMPLETE_MISSION' },
	MODIFIER_ATTACH: { k: 'MODIFIER_ATTACH', id: 'x' },
	MODIFIER_DETACH: { k: 'MODIFIER_DETACH', id: 'x' },
	ALT_PLAY: {
		k: 'ALT_PLAY',
		suits: ['INCIDENT'],
		operation: {
			type: 'PLAY',
			costsAction: false,
			isAttack: false,
			effect: { k: 'DRAW', count: 2 },
		},
	},
	// scoring + escape
	SCORE_VP: {
		k: 'SCORE_VP',
		amount: {
			k: 'COUNT',
			query: {
				zones: ['ALL_OWNED'],
				seat: 'SELF',
				filter: { traits: ['SHADY'] },
			},
		},
	},
	SCRIPT: { k: 'SCRIPT', fn: 'demo.handler' },
	// (missing until the count became the registry's own key list)
	ASSIMILATE: { k: 'ASSIMILATE', target: 'THIS' },
	COST_REQUIRE: {
		k: 'COST_REQUIRE',
		cond: { k: 'SPECIALTY_AT_LEAST', specialty: 'MILITARY', value: 3 },
	},
	DRONE: { k: 'DRONE', verb: 'REGENERATE', count: 1 },
	// solo Bot (rules/13)
	TRY: { k: 'TRY', body: draw(1), otherwise: gain('GLO', 2) },
	ATTACK: {
		k: 'ATTACK',
		body: { k: 'FORCE', body: { k: 'TAKE', deck: 'INCIDENT', count: 1 } },
	},
	BOT_DECK: { k: 'BOT_DECK', from: 'DECK', op: 'DISCARD', count: 2 },
	BOT_ACQUIRE: {
		k: 'BOT_ACQUIRE',
		mode: 'GAIN',
		pref: [
			[{ traits: ['KLINGON'] }],
			[{ suits: ['PERSON'] }, { suits: ['SHIP'] }],
		],
	},
	BOT_JUNK: { k: 'BOT_JUNK' },
	BOT_SEND_AWAY_TEAM: {
		k: 'BOT_SEND_AWAY_TEAM',
		count: 1,
		prefer: ['STARBASE', 'STARFLEET'],
	},
	BOT_DEPLOY: { k: 'BOT_DEPLOY', target: 'THIS', then: 'EXPLORE' },
	BOT_PROMOTE: { k: 'BOT_PROMOTE', target: 'THIS' },
	BOT_RESOLVE: { k: 'BOT_RESOLVE', from: 'DECK_TOP' },
	BOT_TAKE_CONTROL: { k: 'BOT_TAKE_CONTROL' },
	BOT_REMOVE_AWAY_TEAM: { k: 'BOT_REMOVE_AWAY_TEAM', count: 2 },
	TRANSFER: { k: 'TRANSFER', target: 'THIS', to: 'DECK_BOTTOM' },
} as { [K in Effect['k']]: Effect & { k: K } }

vitestDescribe('describe() is total over every node kind', () => {
	it('renders every kind to non-empty English without placeholders/leaks', () => {
		const kinds = Object.keys(samples)
		expect(kinds.sort()).toEqual(Object.keys(PRIMITIVES).sort())
		const rendered = Object.entries(samples).map(([k, node]) => ({
			k,
			out: describe(node as Effect),
		}))
		for (const { k, out } of rendered) {
			expect(out.length, `${k} rendered empty`).toBeGreaterThan(0)
			expect(out, `${k} leaked undefined`).not.toContain('undefined')
			expect(out, `${k} leaked NaN`).not.toContain('NaN')
			expect(out, `${k} leaked null`).not.toContain('null')
		}
		// exact-phrasing spot checks for the shared tooltip surface
		expect(describe(samples.SEQ)).toBe('Gain 1 {DIL}. Draw a card.')
		expect(describe(samples.MAY)).toBe('You may draw a card.')
		// the solo Bot's rows read like its Automated Command cards
		expect(describe(samples.TRY)).toBe(
			'If able, draw a card. Otherwise, gain 2 {GLO}.',
		)
		expect(describe(samples.BOT_DECK)).toBe(
			'Discard the top 2 cards of the Bot deck.',
		)
		expect(describe(samples.BOT_ACQUIRE)).toBe(
			'Gain a KLINGON > PERSON / SHIP.',
		)
		expect(describe(samples.BOT_SEND_AWAY_TEAM)).toBe(
			'Send an Away Team to a neutral STARBASE > STARFLEET > LOCATION.',
		)
		expect(describe(samples.BOT_DEPLOY)).toBe('Deploy this SHIP; it explores.')
		expect(describe(samples.BOT_RESOLVE)).toBe(
			'Resolve the top card of the Bot deck.',
		)
		expect(
			describe({
				k: 'ADVANCE_SPECIALTY',
				specialty: { pick: 'LOWER', of: ['RESEARCH', 'INFLUENCE'] },
				amount: 1,
			}),
		).toBe('Gain 1 RESEARCH / INFLUENCE (whichever is lower).')
		expect(describe(samples.COST_ACTION)).toBe('Spend an {ACTION}.')
		expect(describe(samples.CHOOSE_ONE)).toContain('Either ')
	})
})

vitestDescribe('describe() record-vocabulary helpers', () => {
	it('renders resources and suits with record icon tokens', () => {
		expect(describe(gainCard('ALLY'))).toBe('Gain an ALLY.')
		expect(describe(gainCard('CARGO'))).toBe('Gain a CARGO.')
		expect(describe(gain('GLO', 1))).toBe('Gain 1 {GLO}.')
		expect(describe({ k: 'STEAL', res: 'GLO', amount: 1 })).toBe(
			'Steal 1 {GLO} from your opponent.',
		)
	})

	it('renders SCORE_VP COUNT like the ENDGAME records', () => {
		const amount: Amount = {
			k: 'COUNT',
			query: {
				zones: ['ALL_OWNED'],
				seat: 'SELF',
				filter: { traits: ['SHADY'] },
			},
		}
		expect(describe({ k: 'SCORE_VP', amount })).toBe(
			'Score 1 VP for each SHADY you own.',
		)
	})
})

vitestDescribe("describe() on the opponent's side (FORCE / OPPONENT)", () => {
	const persons = (seat: 0 | 1): Query => ({
		zones: [
			{ k: 'HAND', seat },
			{ k: 'DISCARD', seat },
		],
		filter: { suits: ['PERSON'] },
	})
	const incident: Effect = { k: 'TAKE', deck: 'INCIDENT', count: 1 }

	it('words a forced body from the reader: their hand, they do', () => {
		expect(
			describe({ k: 'FORCE', body: { k: 'DISCARD', from: 'HAND', count: 2 } }),
		).toBe('Force your opponent to discard 2 cards from their hand.')
		expect(
			describe({
				k: 'FORCE',
				body: {
					k: 'SEQ',
					steps: [
						{ k: 'LOG', target: persons(0), bind: '$t.logged' },
						{
							k: 'IF',
							cond: { k: 'DID', bind: '$t.logged' },
							then: { k: 'MAY', body: draw(1) },
						},
					],
				},
			}),
		).toBe(
			'Force your opponent to log a PERSON from their hand or from their Discard pile. If they do, they may draw a card.',
		)
	})

	// whose Away Teams, never "your opponent's a LOCATION" / "their a LOCATION"
	it('words removing Away Teams by their owner, from a LOCATION', () => {
		const loc: Query = { zones: ['LOCATIONS'], filter: { suits: ['LOCATION'] } }
		expect(
			describe({
				k: 'REMOVE_AWAY_TEAM',
				count: 1,
				target: { ...loc, withAwayTeam: true },
				whose: 'OPPONENT',
			}),
		).toBe(
			"Remove 1 of your opponent's Away Teams from a LOCATION where you have an Away Team.",
		)
		expect(
			describe({
				k: 'FORCE',
				body: {
					k: 'REMOVE_AWAY_TEAM',
					count: 1,
					target: loc,
					whose: 'SELF',
				},
			}),
		).toBe(
			'Force your opponent to remove 1 of their Away Teams from a LOCATION.',
		)
		expect(
			describe({
				k: 'REMOVE_AWAY_TEAM',
				count: 1,
				target: { zones: ['LOCATIONS'], bound: '$t.loc' },
				whose: 'OPPONENT',
			}),
		).toBe("Remove 1 of your opponent's Away Teams from that LOCATION.")
	})

	it('names the opponent first when a forced body opens with IF', () => {
		expect(
			describe({
				k: 'FORCE',
				body: {
					k: 'IF',
					cond: { k: 'COUNT_AT_LEAST', query: persons(0), value: 1 },
					then: {
						k: 'SEQ',
						steps: [
							{ k: 'LOG', target: persons(0) },
							{ k: 'MAY', body: draw(1) },
						],
					},
					else: incident,
				},
			}),
		).toBe(
			'If your opponent has at least 1 PERSON in their hand or in their Discard pile, force them to log a PERSON from their hand or from their Discard pile. They may draw a card. Otherwise, force them to take 1 Incident card.',
		)
	})

	it('words OPPONENT as "your opponent …", handing a nested one back to you', () => {
		expect(describe({ k: 'OPPONENT', body: incident })).toBe(
			'Your opponent takes 1 Incident card.',
		)
		expect(describe({ k: 'OPPONENT', body: { k: 'MAY', body: draw(1) } })).toBe(
			'Your opponent may draw a card.',
		)
		expect(
			describe({
				k: 'OPPONENT',
				body: {
					k: 'SEQ',
					steps: [draw(1), { k: 'OPPONENT', body: gain('GLO', 1) }],
				},
			}),
		).toBe('Your opponent draws a card. You gain 1 {GLO}.')
	})

	it('reads "if they do" after the step the opponent was forced to take', () => {
		expect(
			describe({
				k: 'SEQ',
				steps: [
					{
						k: 'FORCE',
						body: { k: 'LOG', target: persons(0), bind: '$t.logged' },
					},
					{
						k: 'IF',
						cond: { k: 'DID', bind: '$t.logged' },
						then: gain('GLO', 1),
					},
				],
			}),
		).toBe(
			'Force your opponent to log a PERSON from their hand or from their Discard pile. If they do, gain 1 {GLO}.',
		)
	})

	it("reads a seat-1 zone as the opponent's", () => {
		expect(
			describe({
				k: 'IF',
				cond: { k: 'COUNT_AT_LEAST', query: persons(1), value: 1 },
				then: draw(1),
			}),
		).toBe(
			'If your opponent has at least 1 PERSON in their hand or in their Discard pile, draw a card.',
		)
	})
})

// The card trees themselves, as tooltips and the guide show them (and the
// solo Bot's rows without a fetched bots.json). Card ids, never names: a
// named card is a `[[card:<def id>]]` token the UI expands.
vitestDescribe('describe() on real card operations', () => {
	let catalog: CardCatalog
	beforeAll(async () => {
		catalog = await loadCatalog()
	})
	const opText = (id: string, index: number): string => {
		const def = catalog.defs.find((d) => d.id === id)
		if (def === undefined) throw new Error(`no card ${id}`)
		return describeOperation(def.operations[index]!)
	}
	const botRow = (deck: string) => {
		const bot = catalog.bots?.find((b) => b.deck === deck)
		if (bot === undefined) throw new Error(`no Bot ${deck}`)
		return bot
	}

	it('names the Market once, whatever its suit zones', () => {
		for (const id of ['1CAR15-16', '1SEL15-24'])
			expect(opText(id, 0)).not.toMatch(/Market or from the Market/)
		expect(opText('1CAR15-16', 0)).toContain('Junk a card from the Market.')
	})

	it('counts cards without a second article, and names a bound one', () => {
		expect(opText('1SHR24-24', 1)).toBe(
			"[ATTACK] Discard an ANDORIAN from your hand to remove 1 of your opponent's Away Teams from a LOCATION. If that LOCATION is in your opponent's Location area, your opponent takes 1 Incident card. Dismiss this card.",
		)
		expect(opText('1PER03-25', 0)).toBe(
			'Free play an ATTACK. If you have no card in your Duty Officer, you may either promote a PERSON from your hand to Duty Officer or promote a PERSON from your Discard pile to Duty Officer.',
		)
		expect(opText('1PER05-25', 2)).toContain(
			'gain 1 {DIL} for every 2 cards in your Log, rounded down.',
		)
		expect(opText('1KOL08-24', 0)).toBe(
			'Send 1 Away Team to a LOCATION in the Neutral Zone. If you have secured that LOCATION, you may spend an {ACTION} to take control of that LOCATION and log this card.',
		)
		expect(opText('1BUR21-26', 2)).toBe(
			"Exhaust a SHIP you have in play to refresh that card's LOCATION.",
		)
		expect(opText('1PER16-25', 1)).toBe(
			'After putting a SYNTHETIC or HOLOGRAM into play: If that card is SYNTHETIC, gain 1 {GLO}. If that card is HOLOGRAM, draw a card.',
		)
		expect(opText('1INC02-6', 0)).toContain(
			'If the discarded card is a MILITARY icon card, gain 2 {DIL}.',
		)
	})

	it('names a card by its token, in play once', () => {
		expect(opText('1SHP08-25', 1)).toBe(
			"[ATTACK] Discard a card from your hand to remove 1 of your opponent's Away Teams from a LOCATION where you have an Away Team. If you do, gain 1 {GLO}. If you have at least 1 [[card:1SHP14-25]] in play, advance MILITARY by 1.",
		)
		expect(opText('1SHP22-25', 1)).toBe(
			'Spend 2 {DIL} to advance RESEARCH by 1. If you have at least 1 [[card:1SHP14-25]] in play, advance RESEARCH by 1.',
		)
	})

	it('writes Away Teams as the cards do, here or across Locations', () => {
		expect(opText('1CAR11-16', 2)).toBe(
			'When an attack would make you remove 1 or more Away Teams: Dismiss this card to ignore the effect.',
		)
		expect(opText('1KOL20-24', 2)).toBe(
			'If you have an Away Team here, draw a card. If you have 3 or more Away Teams in total at LOCATIONs in your Location area, draw a card. You may spend 2 {DIL} and discard a card from your hand to draw a card.',
		)
		expect(opText('1SHR12-24', 2)).toBe(
			'If you have no Away Team here, dismiss this card.',
		)
		expect(opText('1BUR10-26', 2)).toBe('You cannot send an Away Team here.')
	})

	it('joins the fields of a filter with AND, not "or"', () => {
		expect(opText('1BUR22-26', 0)).toContain(
			'For each non-CAPTAIN SCIENTIST you have in play, draw a card.',
		)
		expect(opText('1KOL04-24', 0)).toContain(
			'Dismiss a KLINGON PERSON from your Duty Officer to gain 4 {GLO}.',
		)
		expect(opText('1SEL01-24', 2)).toBe(
			'Score 1 VP for each non-ROMULAN/REMAN ATTACK you own.',
		)
	})

	it('counts once, with an article where a card is named', () => {
		expect(opText('1PIC15-24', 1)).toBe(
			'{ACTION} Discard 2 cards from your hand to gain a CARGO.',
		)
		expect(opText('1ALL10-13', 0)).toContain(
			'You may draw a CARGO from your Discard pile.',
		)
		expect(opText('1ALL07-13', 1)).toBe(
			'If you have an ATTACK in play, log this card.',
		)
		expect(opText('1KOL17-24', 0)).toContain(
			'You may log a PERSON beamed to a SHIP to advance MILITARY by 1.',
		)
		expect(opText('1SEL21-24', 0)).toBe(
			'Warp up to 3 CLOAK SHIP from your Fleet to a LOCATION.',
		)
	})

	it('scores what you own, and icons in play', () => {
		expect(opText('1BUR04-26', 2)).toBe(
			'Score 1 VP for each INFLUENCE/MILITARY Focus card you own.',
		)
		expect(opText('1KOL05-24', 4)).toBe(
			'Score 1 VP for each Skill icon you have in play (excluding beamed cards).',
		)
	})

	it('reads conditions, negations and repeats as sentences', () => {
		// a LET's cards are named by the query that collected them
		expect(opText('1CAR14-16', 0)).toContain(
			"For each KLINGON in your opponent's Duty Officer, dismiss that card. If any of those cards is in your opponent's Discard pile, force your opponent to discard a card from their hand.",
		)
		// "You may if …" puts the condition first
		expect(opText('1PER24-25', 0)).toContain(
			'If the gained card is in your deck or in your Discard pile and you have at least 1 SHIP in your Fleet, you may beam the gained card to a SHIP from your Fleet.',
		)
		expect(opText('1SHI11-13', 1)).toContain(
			'If your opponent has fewer than 2 SHIP in their Fleet, deploy this ship.',
		)
		expect(opText('1KOL22-24', 1)).toBe(
			'For each of your unused actions, temporarily increase your hand size by 1. You may gain 1 {GLO}.',
		)
		// a REINFORCEMENT zone used to recurse without end
		expect(opText('1DIR02-2', 1)).toBe(
			'If you have no card in your Reinforcement deck, draw a card. Log this card.',
		)
	})

	it('keeps a multi-step option or paid-for body in one clause', () => {
		expect(opText('1MAL25-25', 1)).toBe(
			'Either discard a WEAPON from your hand to gain 1 {GLO} and advance MILITARY by 1 or discard a MILITARY icon card from your hand to gain 1 {GLO} and advance MILITARY by 1.',
		)
		expect(opText('1SHR12-24', 3)).toBe(
			'Either discard a WEAPON from your hand to send 1 Away Team to this card and advance INFLUENCE by 1 or discard a MILITARY icon card from your hand to send 1 Away Team to this card and advance INFLUENCE by 1.',
		)
		expect(opText('1SHR11-24', 1)).toMatch(
			/: Either draw a card and your opponent gains 2 \{DIL\} or gain 2 \{DIL\} and your opponent may draw a card\.$/,
		)
		expect(opText('1PER21-25', 0)).toContain(
			'You may spend 1 {LAT} to advance INFLUENCE by 1 and advance MILITARY by 1.',
		)
		expect(opText('1BUR24-26', 1)).toBe(
			'{ACTION} Dismiss a [[card:1BUR03-26]] you have in play, dismiss this card and spend 3 {DIL} to take 1 Encounter card.',
		)
	})

	it('warps "this ship" only when it is this card', () => {
		expect(opText('1PER02-25', 0)).toContain(
			'You may warp a SHIP from your Fleet to a LOCATION.',
		)
		expect(opText('1LOC01-20', 2)).toContain(
			'Warp a SHIP from your Fleet to a LOCATION (excluding this card).',
		)
		expect(opText('1SHI13-13', 2)).toBe(
			'Spend 1 {DIL} to warp this ship to a LOCATION.',
		)
	})

	it('words a counted amount "for each …", with its cap', () => {
		expect(opText('1CAR04-16', 0)).toBe(
			'Requires INFLUENCE 5 Gain 1 {LAT} for each FERENGI you have in play and each BUSINESS you have in play (max 5). If the number of FERENGI you have in play plus the number of BUSINESS you have in play (max 5) is at least 3, gain 1 {GLO}.',
		)
		expect(opText('1ALL01-13', 0)).toBe(
			'Requires MILITARY 3 For each KLINGON you have in play (max 5 times), either gain 2 {DIL} or gain 1 {LAT} or discard a card from your hand to gain 1 {GLO}. Log this card.',
		)
		expect(opText('1LOC04-20', 0)).toBe(
			'Up to once for each PERSON in your hand or in your Discard pile or beamed here, beam a PERSON from your hand or from your Discard pile to this card.',
		)
		expect(opText('1PER12-25', 1)).toBe(
			'Spend 1 {LAT} to gain 1 {GLO} for each ANOMALY you have in play (max 3) and dismiss this card.',
		)
		expect(opText('1CAR08-16', 0)).toContain(
			'Draw a card for each VULCAN you have in play (excluding this card, max 5).',
		)
		expect(opText('1PER19-25', 1)).toContain(
			'gain 1 {GLO} for each trait that card shares with this card.',
		)
	})

	it("reads the solo Bot's rows like its Automated Command cards", () => {
		expect(describe(botRow('PIC').suits.ALLY.noDo)).toBe(
			'Discard the top 2 cards of the Bot deck. Advance INFLUENCE by the number of PERSON in your Discard pile. Send an Away Team to a neutral LOCATION for each SHIP in your Discard pile.',
		)
		expect(describe(botRow('BUR').traits[2]!.effect)).toBe(
			'Promote a PERSON from the Bot Discard pile to Duty Officer. If this card is a SHIP, deploy this SHIP; it explores. Otherwise, gain 2 {GLO}.',
		)
		expect(describe(botRow('SIS').suits.INCIDENT.noDo)).toContain(
			'Gain a MILITARY Focus card > INFLUENCE Focus card > PERSON / ALLY.',
		)
		// the row already asked whether this card is a PERSON
		expect(describe(botRow('SHR').traits[3]!.effect)).toContain(
			'If this card is a PERSON, promote it to Duty Officer. Otherwise, log this card.',
		)
	})

	it('leaves no generator seams in any operation or Bot row', () => {
		const SEAMS: [RegExp, string][] = [
			[/\b(an?|the) (an?|the|this|that) /, 'doubled article'],
			[/\b\d+ an? /, 'article after a count'],
			[/\b(\d+) \1 /, 'doubled count'],
			[/\b(your|their)( opponent's)? an? /, 'article after a possessive'],
			[/\bcard cards\b/, 'card cards'],
			[/\$|\b[a-z]+\.[a-z.]+ card\b/, 'bind name'],
			[/AWAY TEAM/, 'keyword noun in caps'],
			[/(from the [\w ]+?) or \1\b/, 'repeated zone'],
			[/\b(\w+) \1\b/, 'doubled word'],
			[/(?<!\[\[card:)\b\d[A-Z]{3}\d\d-\d+/, 'bare card id'],
			[/\bnot you\b|\byou may if\b|\bLet \$|\bfrom beamed\b/i, 'broken clause'],
		]
		const texts: [string, string][] = []
		for (const def of catalog.defs)
			def.operations.forEach((o, i) =>
				texts.push([`${def.id} op ${i}`, describeOperation(o)]),
			)
		for (const bot of catalog.bots ?? []) {
			bot.traits.forEach((row, i) =>
				texts.push([`${bot.deck} trait ${i}`, describe(row.effect)]),
			)
			for (const [suit, row] of Object.entries(bot.suits)) {
				texts.push([`${bot.deck} ${suit}`, describe(row.noDo)])
				texts.push([`${bot.deck} ${suit} DO`, describe(row.do)])
			}
		}
		const hits = texts.flatMap(([where, text]) =>
			SEAMS.filter(([re]) => re.test(text)).map(
				([, what]) => `${where} (${what}): ${text}`,
			),
		)
		expect(hits).toEqual([])
	})
})
