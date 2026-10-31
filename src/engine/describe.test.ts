// describe() round-trip tests (todo/11 §2 + DoD). The seven worked examples
// in docs/effect-dsl.md §7 are the ground truth: describe(effect) — plus the
// operation-level prefixes — must re-render the *significant* tokens of each
// example's printed text. Plus a compile-time totality guard: a Record keyed
// on every Effect['k'] forces a missing node kind to fail compilation, and the
// runtime asserts every one of the 63 renders to non-empty English.

import { describe as vitestDescribe, expect, it } from 'vitest'

import type { Effect, Operation } from './resolver/nodes'
import type { Amount, Query } from './resolver/queries'
import type { MarketSuit, ResourceId } from '../data/ids'
import { SUITS, TRAITS, SPECIALTIES } from '../data/ids'
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
		pref: [[{ traits: ['KLINGON'] }], [{ suits: ['PERSON'] }, { suits: ['SHIP'] }]],
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
			'Score 1 VP for each of your SHADY cards.',
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
			'If your opponent has at least 1 PERSON from their hand or from their Discard pile, force them to log a PERSON from their hand or from their Discard pile. They may draw a card. Otherwise, force them to take 1 Incident card.',
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
			'If your opponent has at least 1 PERSON from their hand or from their Discard pile, draw a card.',
		)
	})
})
