// Zod schemas for card data (todo/03 §2). Every object schema is `.strict()`
// so a typo'd key is a hard error, never a silently ignored field.
// The Effect schema is recursive via z.lazy and mirrors the hand-written
// types in src/engine/resolver/{nodes,queries}.ts — annotating each schema
// as `z.ZodType<T>` makes the compiler verify the two stay in lock-step.

import { z } from 'zod'

import type {
	BotPref,
	BotPrefTerm,
	Effect,
	Operation,
	TriggerSpec,
} from '../engine/resolver/nodes'
import type {
	Amount,
	CardFilter,
	Predicate,
	Query,
	VariableSkillSpec,
	ZoneSpec,
} from '../engine/resolver/queries'
import {
	DECKS,
	FOCUS_ICONS,
	MARKET_SUITS,
	OPERATION_TYPES,
	RESOURCES,
	SKILL_ICONS,
	SPECIALTIES,
	START_POSITIONS,
	SUITS,
	TRAITS,
	type DeckId,
	type FocusIcon,
	type SkillIcon,
	type StartPosition,
	type Suit,
	type TraitId,
} from './ids'

// ---------------------------------------------------------------------------
// Leaf enums
// ---------------------------------------------------------------------------

const SuitSchema = z.enum(SUITS)
const MarketSuitSchema = z.enum(MARKET_SUITS)
const TraitSchema = z.enum(TRAITS)
const SpecialtySchema = z.enum(SPECIALTIES)
const ResourceSchema = z.enum(RESOURCES)
const DeckSchema = z.enum(DECKS)
const StartPositionSchema = z.enum(START_POSITIONS)
const OperationTypeSchema = z.enum(OPERATION_TYPES)
const SkillIconSchema = z.enum(SKILL_ICONS)
const FocusIconSchema = z.enum(FOCUS_ICONS)

const SeatSchema = z.union([z.literal(0), z.literal(1)])

// ---------------------------------------------------------------------------
// Query layer (docs/effect-dsl.md §5) — declared first; Effect references them
// ---------------------------------------------------------------------------

const CardFilterSchema: z.ZodType<CardFilter> = z.lazy(() =>
	z
		.object({
			suits: z.array(SuitSchema).optional(),
			traits: z.array(TraitSchema).optional(), // OR within the list
			allTraits: z.array(TraitSchema).optional(), // AND
			ids: z.array(z.string()).optional(), // def ids; [] matches nothing
			exhibits: z.array(SpecialtySchema).optional(), // Skill or Focus icon, NOT restriction
			focus: z.array(SpecialtySchema).optional(), // Focus icon only (1BUR04)
			minVp: z.number().int().min(0).optional(),
			not: CardFilterSchema.optional(),
		})
		.strict(),
)

const ZoneSpecSchema: z.ZodType<ZoneSpec> = z.lazy(() =>
	z.union([
		z.literal('ALL_OWNED'),
		z.literal('IN_PLAY'),
		z.literal('BEAMED_ANY'),
		z.literal('BEAMED_TO_SHIP'),
		z.literal('LOCATIONS'),
		z.literal('NEUTRAL_LOCATIONS'),
		z.object({ k: z.literal('BEAMED_TO'), host: z.literal('THIS') }).strict(),
		z.object({ k: z.literal('BEAMED_TO'), bound: z.string().min(1) }).strict(),
		z.object({ k: z.literal('MARKET_DECK'), suit: MarketSuitSchema }).strict(),
		z.object({ k: z.literal('MARKET_OFFER'), suit: MarketSuitSchema }).strict(),
		z.object({ k: z.literal('ENCOUNTER_DECK') }).strict(),
		z.object({ k: z.literal('INCIDENT_DECK') }).strict(),
		z.object({ k: z.literal('LOCATION_DECK') }).strict(),
		z
			.object({
				k: z.literal('NEUTRAL_ZONE'),
				slot: z.union([z.literal(0), z.literal(1), z.literal(2)]),
			})
			.strict(),
		z.object({ k: z.literal('JUNK') }).strict(),
		z.object({ k: z.literal('STARDATE_PILE') }).strict(),
		z.object({ k: z.literal('BOX') }).strict(),
		z
			.object({
				k: z.enum([
					'HAND',
					'DRAW',
					'DISCARD',
					'RESERVE',
					'DEVELOPMENT',
					'LOG',
					'STAGING',
					'FLEET',
					'LOCATION_AREA',
					'DUTY_OFFICER',
					'CAPTAIN',
					'STATUS',
				]),
				seat: SeatSchema,
			})
			.strict(),
		// No `{k:'BEAMED', host}`: its host is a runtime instance id, so card data
		// uses `{k:'BEAMED_TO', host:'THIS'}` / `{k:'BEAMED_TO', bound}` instead.
	]),
)

const QuerySchema: z.ZodType<Query> = z.lazy(() =>
	z
		.object({
			zones: z.array(ZoneSpecSchema),
			seat: z.enum(['SELF', 'OPPONENT', 'ANY']).optional(),
			filter: CardFilterSchema.optional(),
			countIcons: z.enum(['SKILL', 'FOCUS']).optional(),
			bound: z
				.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
				.optional(),
			withShip: z.union([z.boolean(), CardFilterSchema]).optional(),
			shipSeat: z.enum(['SELF', 'OPPONENT', 'ANY']).optional(),
			withAwayTeam: z.boolean().optional(),
			atThisShip: z.boolean().optional(),
			atBound: z.string().min(1).optional(),
			secured: z.boolean().optional(),
			thisCard: z.boolean().optional(),
			exceptThis: z.boolean().optional(),
		})
		.strict(),
)

const AmountSchema: z.ZodType<Amount> = z.lazy(() =>
	z.union([
		z.number().int().min(0),
		z.object({ k: z.literal('COUNT'), query: QuerySchema }).strict(),
		z
			.object({
				k: z.literal('ICON_COUNT'),
				bind: z.string().min(1),
				kind: z.enum(['SKILL', 'FOCUS']),
			})
			.strict(),
		z
			.object({
				k: z.literal('SKILL_ICONS'),
				specialty: z.union([SpecialtySchema, z.literal('CHOSEN')]),
			})
			.strict(),
		z
			.object({ k: z.literal('SPECIALTY'), specialty: SpecialtySchema })
			.strict(),
		z
			.object({
				k: z.literal('RESOURCE'),
				res: ResourceSchema,
				seat: z.enum(['SELF', 'OPPONENT']).optional(),
			})
			.strict(),
		z.object({ k: z.literal('UNUSED_ACTIONS') }).strict(),
		z
			.object({
				k: z.enum(['MIN', 'MAX', 'SUM']),
				terms: z.array(AmountSchema),
			})
			.strict(),
		z.object({ k: z.literal('UP_TO'), max: AmountSchema }).strict(),
		z
			.object({
				k: z.literal('PER'),
				every: z.number().int().min(1),
				of: AmountSchema,
			})
			.strict(),
		z.object({ k: z.literal('TRAIT_COUNT'), bind: z.string().min(1) }).strict(),
		z
			.object({
				k: z.literal('SHARED_TRAITS'),
				bind: z.string().min(1),
				with: QuerySchema,
			})
			.strict(),
	]),
)

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
	z.discriminatedUnion('k', [
		z
			.object({
				k: z.literal('SPECIALTY_AT_LEAST'),
				specialty: SpecialtySchema,
				value: z.number().int().min(0),
			})
			.strict(),
		z
			.object({
				k: z.literal('COUNT_AT_LEAST'),
				query: QuerySchema,
				value: z.number().int().min(0),
			})
			.strict(),
		z
			.object({
				k: z.literal('HAS_TRAIT_IN_PLAY'),
				trait: TraitSchema,
				count: z.number().int().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('DIFFERENT_SPECIES_IN_PLAY'),
				count: z.number().int().min(1),
				filter: CardFilterSchema.optional(),
				eachDistinct: z.array(TraitSchema).min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('SAME_SHIP'),
				requirements: z
					.array(
						z
							.object({
								count: z.number().int().min(1).optional(),
								filter: CardFilterSchema.optional(),
								different: z
									.union([z.literal('SPECIES'), z.array(TraitSchema).min(1)])
									.optional(),
								eachDistinct: z.array(TraitSchema).min(1).optional(),
							})
							.strict(),
					)
					.min(1),
			})
			.strict(), // mission goals only
		z
			.object({
				k: z.literal('CONTROLS_LOCATION'),
				count: z.number().int().min(0),
			})
			.strict(),
		z.object({ k: z.literal('AND'), terms: z.array(PredicateSchema) }).strict(),
		z.object({ k: z.literal('OR'), terms: z.array(PredicateSchema) }).strict(),
		z.object({ k: z.literal('NOT'), term: PredicateSchema }).strict(),
		z
			.object({
				k: z.literal('BOUND_IS'),
				bind: z.string().min(1),
				filter: CardFilterSchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('DID'),
				bind: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
			})
			.strict(),
		z
			.object({
				k: z.literal('BOUND_SHARES_TRAIT'),
				bind: z.string().min(1),
				with: QuerySchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('LOG_LEGAL'),
				filter: CardFilterSchema.optional(),
				from: ZoneSpecSchema.optional(),
			})
			.strict(),
		z
			.object({ k: z.literal('CAPTAIN_HAS_TRAIT'), trait: TraitSchema })
			.strict(),
		z
			.object({
				k: z.literal('COMPARE'),
				a: AmountSchema,
				op: z.enum(['LT', 'GE']),
				b: AmountSchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('COLLECTIVE_AT_LEAST'),
				value: z.number().int().min(0),
			})
			.strict(),
		z.object({ k: z.literal('IS_SOLO_BOT') }).strict(),
		z
			.object({
				k: z.literal('TOTAL_VP_AT_LEAST'),
				value: z.number().int().min(0),
			})
			.strict(),
		z
			.object({
				k: z.literal('AWAY_TEAMS_AT'),
				at: QuerySchema,
				seat: z.enum(['SELF', 'OPPONENT', 'ANY']).optional(),
				value: z.number().int().min(0),
			})
			.strict(),
	]),
)

const VariableSkillSpecSchema: z.ZodType<VariableSkillSpec> = z.lazy(() =>
	z.union([
		z
			.object({
				condition: PredicateSchema,
				skills: z.array(SpecialtySchema).min(1),
			})
			.strict(),
		z
			.object({
				counts: z
					.array(
						z
							.object({ specialty: SpecialtySchema, amount: AmountSchema })
							.strict(),
					)
					.min(1),
			})
			.strict(),
	]),
)

// ---------------------------------------------------------------------------
// Solo Bot leaves (rules/13 §13.10.1): preference expressions and targets
// ---------------------------------------------------------------------------

const BotPrefTermSchema: z.ZodType<BotPrefTerm> = z.union([
	z.object({ most: ResourceSchema }).strict(),
	CardFilterSchema,
])
const BotPrefSchema: z.ZodType<BotPref> = z
	.array(z.array(BotPrefTermSchema).min(1))
	.min(1)
const BotTargetSchema = z.union([
	z.literal('THIS'),
	z.literal('DISCARD'),
	z.object({ bound: z.string().min(1) }).strict(),
])

// ---------------------------------------------------------------------------
// Effects (docs/effect-dsl.md §§2–4) — the recursive union keyed on `k`
// ---------------------------------------------------------------------------

export const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
	z.discriminatedUnion('k', [
		// ---------------- control (docs/effect-dsl.md §2) ------------------------
		z.object({ k: z.literal('SEQ'), steps: z.array(EffectSchema) }).strict(),
		z.object({ k: z.literal('MAY'), body: EffectSchema }).strict(),
		z
			.object({
				k: z.literal('CHOOSE_ONE'),
				options: z.array(
					z.object({ label: z.string(), body: EffectSchema }).strict(),
				),
				count: z.number().int().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('PAY_THEN'),
				cost: EffectSchema,
				body: EffectSchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('IF'),
				cond: PredicateSchema,
				then: EffectSchema,
				else: EffectSchema.optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('REPEAT'),
				times: AmountSchema,
				body: EffectSchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('FOR_EACH'),
				over: QuerySchema,
				body: EffectSchema,
				bind: z.string(),
			})
			.strict(),
		z
			.object({
				k: z.literal('LET'),
				bind: z.string(),
				value: z.union([AmountSchema, QuerySchema]),
				body: EffectSchema,
			})
			.strict(),
		z.object({ k: z.literal('OPPONENT'), body: EffectSchema }).strict(),
		z
			.object({ k: z.literal('REVEAL'), whose: z.enum(['SELF', 'OPPONENT']) })
			.strict(),
		z
			.object({
				k: z.literal('PUT_ON_DECK_TOP'),
				target: z.union([QuerySchema, z.literal('THIS')]),
			})
			.strict(),
		z.object({ k: z.literal('NOOP') }).strict(),
		// ---------------- costs (docs/effect-dsl.md §3) ---------------------------
		z
			.object({
				k: z.literal('COST_RESOURCE'),
				res: ResourceSchema,
				amount: AmountSchema,
			})
			.strict(),
		z.object({ k: z.literal('COST_ACTION') }).strict(),
		z
			.object({
				k: z.literal('COST_DISCARD'),
				filter: CardFilterSchema.optional(),
				count: z.number().int().min(1),
				whose: z.enum(['SELF', 'OPPONENT']).optional(),
				bind: z.string().min(1).optional(),
				exceptBound: z.string().min(1).optional(),
				onlyBound: z.array(z.string().min(1)).min(1).optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_PUT'),
				filter: CardFilterSchema.optional(),
				count: z.number().int().min(1),
				to: ZoneSpecSchema,
				from: z.union([ZoneSpecSchema, z.array(ZoneSpecSchema)]).optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_EXHAUST'),
				filter: CardFilterSchema.optional(),
				bind: z.string().min(1).optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_REFRESH'),
				filter: CardFilterSchema.optional(),
				bind: z.string().min(1).optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_REMOVE_AWAY_TEAM'),
				count: z.number().int().min(1),
				from: QuerySchema.optional(),
				distinct: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_TAKE_INCIDENT'),
				count: z.number().int().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_DISMISS'),
				filter: CardFilterSchema.optional(),
				count: z.number().int().min(1),
				from: ZoneSpecSchema.optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z.object({ k: z.literal('COST_LOG_THIS') }).strict(),
		z.object({ k: z.literal('COST_REQUIRE'), cond: PredicateSchema }).strict(),
		z
			.object({
				k: z.literal('COST_RETURN_INCIDENT'),
				filter: CardFilterSchema.optional(),
				count: z.number().int().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_RECALL'),
				filter: CardFilterSchema.optional(),
				from: ZoneSpecSchema.optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_LOG'),
				filter: CardFilterSchema.optional(),
				from: z.union([ZoneSpecSchema, z.array(ZoneSpecSchema)]).optional(),
				bind: z.string().min(1).optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('COST_BEAM'),
				from: z.union([ZoneSpecSchema, z.array(ZoneSpecSchema)]).optional(),
				filter: CardFilterSchema.optional(),
				to: QuerySchema,
				count: z.number().int().min(1),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		// ---------------- card movement (docs/effect-dsl.md §4) -------------------
		z
			.object({
				k: z.literal('BEAM'),
				from: z.union([ZoneSpecSchema, z.array(ZoneSpecSchema)]).optional(),
				filter: CardFilterSchema.optional(),
				to: QuerySchema,
				count: z.number().int().min(1),
				bound: z.string().min(1).optional(),
				bind: z.string().min(1).optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z.object({ k: z.literal('DEPLOY'), target: QuerySchema }).strict(),
		z
			.object({
				k: z.literal('DESTROY'),
				target: z.union([QuerySchema, z.literal('THIS')]),
			})
			.strict(),
		z
			.object({
				k: z.literal('DISMISS'),
				target: z.union([QuerySchema, z.literal('THIS')]),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('DRAW'),
				count: AmountSchema,
				bind: z
					.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
					.optional(),
				fromBottom: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('DRAW_FROM_DISCARD'),
				filter: CardFilterSchema.optional(),
				count: z.number().int().min(1),
				bind: z.string().optional(),
			})
			.strict(),
		z.object({ k: z.literal('RECALL'), target: QuerySchema }).strict(),
		z
			.object({
				k: z.literal('LOG'),
				target: z.union([QuerySchema, z.literal('THIS')]),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('PROMOTE'),
				from: z.enum(['HAND', 'STAGING', 'DISCARD']),
				filter: CardFilterSchema.optional(),
				target: z.literal('THIS').optional(),
			})
			.strict(),
		z.object({ k: z.literal('JUNK'), target: QuerySchema }).strict(),
		z
			.object({ k: z.literal('PUT_INTO_STAGING'), target: QuerySchema })
			.strict(),
		z
			.object({
				k: z.literal('DISCARD'),
				filter: CardFilterSchema.optional(),
				count: z.number().int().min(1),
				from: z.enum(['HAND', 'DECK_TOP']),
				whose: z.enum(['SELF', 'OPPONENT']).optional(),
				bind: z.string().min(1).optional(),
				onlyBound: z.array(z.string().min(1)).min(1).optional(),
			})
			.strict(),
		// ---------------- acquisition (docs/effect-dsl.md §4) ---------------------
		z
			.object({
				k: z.literal('GAIN_CARD'),
				suits: z.array(MarketSuitSchema),
				includeJunk: z.boolean().optional(),
				onlyJunk: z.boolean().optional(),
				bind: z.string().min(1).optional(),
				to: z
					.array(z.enum(['DECK_TOP', 'DISCARD']))
					.min(1)
					.optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('SCAN_N'),
				n: AmountSchema,
				suits: z.array(MarketSuitSchema),
				includeJunk: z.boolean().optional(),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('SCAN_FOR_TRAIT'),
				traits: z.array(TraitSchema),
				includeJunk: z.boolean().optional(),
				bind: z.string().min(1).optional(),
				to: z.array(z.enum(['DECK_TOP', 'DISCARD'])).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('TAKE'),
				deck: z.enum(['INCIDENT', 'ENCOUNTER']),
				count: z.number().int().min(1),
				look: z.number().int().min(1).optional(),
				returnUnpicked: z.boolean().optional(),
				to: z.enum(['HAND', 'DISCARD', 'DECK_TOP', 'DECK_BOTTOM']).optional(),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('SELECT'),
				target: QuerySchema,
				bind: z.string().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('FIND'),
				filter: CardFilterSchema,
				zones: z.array(ZoneSpecSchema),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('RETURN_INCIDENT'),
				target: z.union([QuerySchema, z.literal('THIS')]),
			})
			.strict(),
		z.object({ k: z.literal('ENLIST_RESERVE') }).strict(),
		z
			.object({
				k: z.literal('ENLIST_DEVELOPMENT'),
				free: z.boolean().optional(),
				discount: z
					.array(
						z
							.object({
								res: z.union([ResourceSchema, z.array(ResourceSchema).min(2)]),
								amount: AmountSchema,
							})
							.strict(),
					)
					.min(1)
					.optional(),
				filter: CardFilterSchema.optional(),
			})
			.strict(),
		// ---------------- resources & actions (docs/effect-dsl.md §4) --------------
		z
			.object({
				k: z.literal('GAIN_RESOURCE'),
				res: ResourceSchema,
				amount: AmountSchema,
				fromSupply: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('SPEND_RESOURCE'),
				res: ResourceSchema,
				amount: AmountSchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('STEAL'),
				res: ResourceSchema,
				amount: AmountSchema,
			})
			.strict(),
		z.object({ k: z.literal('GAIN_ACTION'), amount: AmountSchema }).strict(),
		z
			.object({
				k: z.literal('ADVANCE_SPECIALTY'),
				specialty: z.union([
					SpecialtySchema,
					z.literal('CHOICE'),
					z.literal('LOWEST'),
					z
						.object({
							pick: z.enum(['LOWER', 'HIGHER']),
							of: z.array(SpecialtySchema).min(2),
						})
						.strict(),
				]),
				amount: AmountSchema,
			})
			.strict(),
		z
			.object({
				k: z.literal('RECRYSTALLIZE'),
				amount: z.union([AmountSchema, z.literal('ALL')]),
			})
			.strict(),
		// ---------------- board (docs/effect-dsl.md §4) -----------------------------
		z
			.object({
				k: z.literal('SEND_AWAY_TEAM'),
				count: AmountSchema,
				target: QuerySchema,
				ignoreBlocking: z.boolean().optional(),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('REMOVE_AWAY_TEAM'),
				count: z.number().int().min(1),
				target: QuerySchema,
				whose: z.enum(['SELF', 'OPPONENT']),
				bind: z.string().optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('WARP'),
				ship: QuerySchema,
				to: QuerySchema,
				bind: z.string().min(1).optional(),
				count: AmountSchema.optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('TAKE_CONTROL'),
				target: z.union([
					QuerySchema,
					z.literal('FROM_LOCATION_DECK'),
					z.literal('THIS'),
				]),
				requireSecured: z.boolean().optional(),
			})
			.strict(),
		z.object({ k: z.literal('TRIGGER_CONTROL'), target: QuerySchema }).strict(),
		z.object({ k: z.literal('EXHAUST'), target: QuerySchema }).strict(),
		z
			.object({
				k: z.literal('REFRESH'),
				target: QuerySchema,
				count: AmountSchema.optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('PLACE_RESOURCE_ON_MARKET'),
				res: ResourceSchema,
				amount: AmountSchema,
				target: QuerySchema.optional(),
			})
			.strict(),
		z.object({ k: z.literal('WIPE_MARKET') }).strict(),
		z.object({ k: z.literal('WIPE_NEUTRAL_ZONE') }).strict(),
		z
			.object({
				k: z.literal('DRONE'),
				verb: z.enum(['REGENERATE', 'SEND']),
				count: z.number().int().min(1),
				to: QuerySchema.optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('ASSIMILATE'),
				target: z.union([QuerySchema, z.literal('THIS')]),
			})
			.strict(),
		z
			.object({
				k: z.literal('REMOVE_STARDATE_GLORY'),
				amount: z.number().int().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('ARRANGE_DECK'),
				decks: z.array(z.enum(['LOCATION', 'ENCOUNTER'])).min(1),
				n: z.number().int().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('IGNORE_ATTACK'),
				scope: z.enum(['ATTACK', 'EFFECT']).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('REPLACE_GAIN'),
				scan: z.number().int().min(1),
			})
			.strict(),
		// ---------------- meta (docs/effect-dsl.md §4) ------------------------------
		z
			.object({
				k: z.literal('FREE_PLAY'),
				filter: CardFilterSchema,
				from: z.union([ZoneSpecSchema, z.array(ZoneSpecSchema)]).optional(),
				bound: z.string().min(1).optional(),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('DUPLICATE'),
				suits: z.array(SuitSchema),
				from: z
					.array(
						z.enum([
							'MARKET',
							'DISCARD',
							'LOG',
							'RESOLVED_THIS_TURN',
							'DEPLOYED',
							'BOUND',
						]),
					)
					.min(1),
				opType: OperationTypeSchema,
				filter: CardFilterSchema.optional(),
				bound: z.string().min(1).optional(),
				other: z.boolean().optional(),
			})
			.strict(),
		z.object({ k: z.literal('FORCE'), body: EffectSchema }).strict(),
		z
			.object({
				k: z.literal('COMPLETE_MISSION'),
				index: z.number().int().min(0).max(2).optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('MODIFIER_ATTACH'),
				id: z.string().min(1),
				stack: z.boolean().optional(),
				target: QuerySchema.optional(),
			})
			.strict(),
		z
			.object({ k: z.literal('MODIFIER_DETACH'), id: z.string().min(1) })
			.strict(),
		// Static PASSIVE declaration (1PIC08): the granted operation is always a
		// PLAY — it is offered as an alternative way to play a hand card.
		z
			.object({
				k: z.literal('ALT_PLAY'),
				suits: z.array(SuitSchema).min(1),
				operation: OperationSchema.refine((op) => op.type === 'PLAY', {
					message: 'ALT_PLAY grants a PLAY operation',
				}),
			})
			.strict(),
		// ---------------- scoring (docs/effect-dsl.md §7 example) --------------------
		// Illegal outside ENDGAME / SPECIAL operations — enforced in the superRefine.
		z.object({ k: z.literal('SCORE_VP'), amount: AmountSchema }).strict(),
		// ---------------- escape hatch (docs/effect-dsl.md §8) ------------------------
		z.object({ k: z.literal('SCRIPT'), fn: z.string().min(1) }).strict(),
		// ---------------- solo Bot (rules/13) — AC rows and SURPRISE ops only ---------
		// (the placement rule is enforced in BotCardSchema / the CardDef superRefine)
		z
			.object({
				k: z.literal('TRY'),
				body: EffectSchema,
				otherwise: EffectSchema.optional(),
				test: EffectSchema.optional(),
			})
			.strict(),
		z.object({ k: z.literal('ATTACK'), body: EffectSchema }).strict(),
		z
			.object({
				k: z.literal('BOT_DECK'),
				from: z.enum(['DECK', 'SUPPLEMENT']),
				op: z.enum(['LOG', 'DISCARD', 'TAKE']),
				count: z.number().int().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('BOT_ACQUIRE'),
				mode: z.enum(['GAIN', 'TAKE']),
				from: z.enum(['MARKET', 'ENCOUNTER', 'INCIDENT']).optional(),
				pref: BotPrefSchema.optional(),
				bind: z.string().min(1).optional(),
			})
			.strict(),
		z.object({ k: z.literal('BOT_JUNK') }).strict(),
		z
			.object({
				k: z.literal('BOT_SEND_AWAY_TEAM'),
				count: AmountSchema,
				prefer: z.array(TraitSchema).min(1).optional(),
				ignoreShips: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				k: z.literal('BOT_DEPLOY'),
				target: BotTargetSchema,
				then: z.enum(['EXPLORE', 'ENGAGE']).optional(),
			})
			.strict(),
		z
			.object({ k: z.literal('BOT_PROMOTE'), target: BotTargetSchema })
			.strict(),
		z
			.object({
				k: z.literal('BOT_RESOLVE'),
				from: z.enum(['ROW', 'DECK_TOP', 'SUPPLEMENT_TOP', 'DISCARD', 'BOUND']),
				filter: CardFilterSchema.optional(),
				bound: z.string().min(1).optional(),
			})
			.strict(),
		z.object({ k: z.literal('BOT_TAKE_CONTROL') }).strict(),
		z
			.object({
				k: z.literal('BOT_REMOVE_AWAY_TEAM'),
				count: z.number().int().min(1),
			})
			.strict(),
		z
			.object({
				k: z.literal('TRANSFER'),
				target: z.literal('THIS'),
				to: z.literal('DECK_BOTTOM'),
			})
			.strict(),
	]),
)

const TriggerSeatSchema = z.enum(['SELF', 'OPPONENT', 'ANY'])

const TriggerSchema: z.ZodType<TriggerSpec> = z.discriminatedUnion('on', [
	z
		.object({
			on: z.literal('CARD_PLAYED'),
			filter: CardFilterSchema.optional(),
			seat: TriggerSeatSchema.optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('CARD_GAINED'),
			filter: CardFilterSchema.optional(),
			seat: TriggerSeatSchema.optional(),
			dest: z.enum(['DECK_TOP', 'DISCARD']).optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('RESOURCE_GAINED'),
			res: ResourceSchema.optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('SPECIALTY_ADVANCED'),
			specialty: SpecialtySchema.optional(),
			specialties: z.array(SpecialtySchema).min(1).optional(),
			seat: TriggerSeatSchema.optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('PUT_INTO_PLAY'),
			filter: CardFilterSchema.optional(),
			seat: TriggerSeatSchema.optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('CARD_DEPLOYED'),
			filter: CardFilterSchema.optional(),
			seat: TriggerSeatSchema.optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('LOCATION_CONTROLLED'),
			seat: z.enum(['SELF', 'OPPONENT']).optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('CARD_LOGGED'),
			filter: CardFilterSchema.optional(),
			seat: TriggerSeatSchema.optional(),
			beforeLeaving: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			on: z.literal('AWAY_TEAM_SENT'),
			neutral: z.boolean().optional(),
		})
		.strict(),
	z.object({ on: z.literal('SHIP_WARPED') }).strict(),
	z
		.object({
			on: z.literal('INCIDENT_TAKEN'),
			orReturned: z.boolean().optional(),
		})
		.strict(),
	z.object({ on: z.literal('INCIDENT_RETURNED') }).strict(),
	z.object({ on: z.literal('ATTACKED') }).strict(),
	z
		.object({
			on: z.literal('WOULD_BE_ATTACKED'),
			effect: z.enum(['DISMISS_DUTY_OFFICER', 'REMOVE_AWAY_TEAM']).optional(),
		})
		.strict(),
	z.object({ on: z.literal('WOULD_GAIN_CARD') }).strict(),
	z.object({ on: z.literal('BEFORE_SCORING') }).strict(),
	z.object({ on: z.literal('ATTACK_MADE') }).strict(),
	z.object({ on: z.literal('MISSION_COMPLETED') }).strict(),
	z.object({ on: z.literal('ENCOUNTER_TAKEN') }).strict(),
	z
		.object({
			on: z.literal('OPERATION_RESOLVED'),
			paid: ResourceSchema.optional(),
		})
		.strict(),
])

const OperationSchema = z
	.object({
		type: z.enum(OPERATION_TYPES),
		costsAction: z.boolean().default(false),
		isAttack: z.boolean().default(false),
		requires: z
			.object({
				specialty: z.enum(SPECIALTIES),
				min: z.number().int().min(1).max(15),
			})
			.strict()
			.optional(),
		trigger: TriggerSchema.optional(),
		effect: EffectSchema,
		text: z.string().min(1).optional(),
	})
	.strict()

// ---------------------------------------------------------------------------
// CardDef (docs/data-model.md §1) + cross-field refinements (todo/03 §3)
// ---------------------------------------------------------------------------

export interface CardDef {
	id: string
	cardId: string | null
	/** Only for cards without a card number (Stardates) and test fixtures —
	 *  printed names come from STCC (src/data/cardNames.ts). */
	name?: string | undefined
	suit: Suit
	deck: DeckId
	traits: TraitId[]
	skills: SkillIcon[]
	variableSkill?: VariableSkillSpec | undefined
	focus: FocusIcon | null
	vp: number
	vpAsterisk: boolean
	startPosition: StartPosition | null
	developmentCost: Effect | null
	operations: Operation[]
	awayTeams?: number | undefined
	locationTier?: 'STARTING' | 'ADVANCED' | undefined
	/** Always-on rule-modifier ids active while this card is owned and in play
	 *  (docs/notes common-fidelity-pass gap #1). The hooks live in the
	 *  src/engine/modifiers.ts registry; the PASSIVE operation's effect carries
	 *  a matching MODIFIER_ATTACH node purely so describe() round-trips. */
	passives?: string[] | undefined
	cannotBePlayed?: boolean | undefined
	/** "This card cannot be promoted." (1SIS13) — PROMOTE never
	 *  offers it. */
	cannotBePromoted?: boolean | undefined
	/** "This card cannot be beamed or discarded by any effect except its own
	 *  play operation (not even in the Clean-up Step)" (1DIR01/2): never a
	 *  discard or beam candidate. */
	discardProtected?: boolean | undefined
	/** The card counts as a LOCATION throughout, and deploying it takes
	 *  control of one (1ENC07): it
	 *  also matches the LOCATION suit, DEPLOY puts it into the Location area
	 *  and emits LOCATION_CONTROLLED (src/engine/cards.ts isLocationDef). */
	treatedAsLocation?: boolean | undefined
}

// --- effect-tree walkers (shape-only; shared by the refinements below) --------

function* effectChildren(effect: Effect): Iterable<Effect> {
	switch (effect.k) {
		case 'SEQ':
			for (const step of effect.steps) yield step
			break
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
			yield effect.body
			break
		case 'CHOOSE_ONE':
			for (const option of effect.options) yield option.body
			break
		case 'PAY_THEN':
			yield effect.cost
			yield effect.body
			break
		case 'IF':
			yield effect.then
			if (effect.else !== undefined) yield effect.else
			break
		case 'REPEAT':
		case 'FOR_EACH':
		case 'LET':
			yield effect.body
			break
		case 'ATTACK':
			yield effect.body
			break
		case 'TRY':
			yield effect.body
			if (effect.otherwise !== undefined) yield effect.otherwise
			if (effect.test !== undefined) yield effect.test
			break
		case 'ALT_PLAY':
			yield effect.operation.effect
			break
		default:
			break
	}
}

function walkEffect(effect: Effect, visit: (node: Effect) => void): void {
	visit(effect)
	for (const child of effectChildren(effect)) walkEffect(child, visit)
}

function containsNode(effect: Effect, k: Effect['k']): boolean {
	let found = false
	walkEffect(effect, (node) => {
		if (node.k === k) found = true
	})
	return found
}

// Tracks how many DUPLICATE nodes are ancestors of the current node; invokes
// `nested` once when a DUPLICATE sits below another DUPLICATE's subtree. This
// stays vacuous while DUPLICATE carries no effect subtree, but guards the
// literal form if the grammar ever grows one — see the superRefine below.
function walkEffectNesting(
	effect: Effect,
	nested: (depth: number) => void,
	depth = 0,
): void {
	if (effect.k === 'DUPLICATE') {
		if (depth > 0) nested(depth)
		for (const child of effectChildren(effect))
			walkEffectNesting(child, nested, depth + 1)
		return
	}
	for (const child of effectChildren(effect))
		walkEffectNesting(child, nested, depth)
}

export const CardDefSchema = z
	.object({
		id: z.string().min(1),
		cardId: z.string().nullable(),
		name: z.string().min(1).optional(),
		suit: SuitSchema,
		deck: DeckSchema,
		traits: z.array(TraitSchema),
		skills: z.array(SkillIconSchema).max(3), // rules/09 §9.7
		variableSkill: VariableSkillSpecSchema.optional(),
		focus: FocusIconSchema.nullable(),
		vp: z.number().int(), // printed VP (may be negative: penalty INCIDENTs print -2, rules/01)
		vpAsterisk: z.boolean().default(false),
		startPosition: StartPositionSchema.nullable(),
		developmentCost: EffectSchema.nullable(),
		operations: z.array(OperationSchema),
		awayTeams: z.number().int().min(1).optional(),
		locationTier: z.enum(['STARTING', 'ADVANCED']).optional(),
		passives: z.array(z.string().min(1)).optional(),
		cannotBePlayed: z.boolean().optional(),
		cannotBePromoted: z.boolean().optional(),
		discardProtected: z.boolean().optional(),
		treatedAsLocation: z.boolean().optional(),
	})
	.strict()
	.superRefine((card, ctx) => {
		const addIssue = (
			message: string,
			path: (string | number)[] = [],
		): void => {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
		}

		// trigger is required iff REACTION, forbidden otherwise — except a SPECIAL
		// "when you log this card" (trigger CARD_LOGGED, 1SHR06) and a triggered
		// PASSIVE ("PASSIVE: After taking an INCIDENT, you may …", 1SHR10)
		for (const [index, operation] of card.operations.entries()) {
			if (operation.type === 'REACTION' && operation.trigger === undefined) {
				addIssue('REACTION operation requires a trigger.', [
					'operations',
					index,
					'trigger',
				])
			}
			const selfLogSpecial =
				operation.type === 'SPECIAL' &&
				(operation.trigger?.on === 'CARD_LOGGED' ||
					operation.trigger?.on === 'BEFORE_SCORING')
			const triggeredPassive = operation.type === 'PASSIVE'
			if (
				operation.type !== 'REACTION' &&
				operation.trigger !== undefined &&
				!selfLogSpecial &&
				!triggeredPassive
			) {
				addIssue(
					`trigger is only allowed on REACTION operations (this is a ${operation.type}).`,
					['operations', index, 'trigger'],
				)
			}
		}

		// Replacement nodes need their "would" window: IGNORE_ATTACK only under a
		// WOULD_BE_ATTACKED trigger, REPLACE_GAIN only under WOULD_GAIN_CARD;
		// BEFORE_SCORING only on a SPECIAL (docs/effect-dsl.md §6).
		for (const [index, operation] of card.operations.entries()) {
			const on = operation.trigger?.on
			if (on === 'BEFORE_SCORING' && operation.type !== 'SPECIAL')
				addIssue('A BEFORE_SCORING trigger is only allowed on a SPECIAL.', [
					'operations',
					index,
					'trigger',
				])
			const needs: [Effect['k'], string][] = [
				['IGNORE_ATTACK', 'WOULD_BE_ATTACKED'],
				['REPLACE_GAIN', 'WOULD_GAIN_CARD'],
			]
			for (const [k, trig] of needs) {
				if (containsNode(operation.effect, k) && on !== trig)
					addIssue(`${k} is only legal under a ${trig} trigger.`, [
						'operations',
						index,
						'effect',
					])
			}
		}

		// SCORE_VP only inside ENDGAME / SPECIAL (docs/effect-dsl.md §7)
		for (const [index, operation] of card.operations.entries()) {
			if (
				operation.type !== 'ENDGAME' &&
				operation.type !== 'SPECIAL' &&
				containsNode(operation.effect, 'SCORE_VP')
			) {
				addIssue(
					`SCORE_VP is illegal in a ${operation.type} operation — scoring nodes may only appear in ENDGAME or SPECIAL operations.`,
					['operations', index, 'effect'],
				)
			}
		}

		// ALT_PLAY is a static declaration: only as the whole effect of an
		// untriggered PASSIVE operation (the engine reads it from there, it is
		// never "resolved" — docs/effect-dsl.md §4 Meta).
		for (const [index, operation] of card.operations.entries()) {
			const declared =
				operation.type === 'PASSIVE' &&
				operation.trigger === undefined &&
				operation.effect.k === 'ALT_PLAY'
			let nested = false
			walkEffect(operation.effect, (node) => {
				if (node.k === 'ALT_PLAY' && !(declared && node === operation.effect))
					nested = true
			})
			if (nested) {
				addIssue(
					'ALT_PLAY may only be the whole effect of an untriggered PASSIVE operation.',
					['operations', index, 'effect'],
				)
			}
		}

		// vpAsterisk ⇒ a SPECIAL operation defines scoring (rules/07 §7.4.2)
		if (card.vpAsterisk && !card.operations.some((o) => o.type === 'SPECIAL')) {
			addIssue(
				'vpAsterisk is true but the card has no SPECIAL operation — the SPECIAL operation defines asterisk-VP scoring.',
			)
		}

		// printed cards carry no name — STCC is the only source (cardNames.ts)
		if (card.cardId !== null && card.name !== undefined) {
			addIssue(
				'Cards with a cardId must not carry a name; it comes from STCC.',
				['name'],
			)
		}

		// CAPTAIN ⇒ awayTeams >= 1 and no startPosition
		if (card.suit === 'CAPTAIN') {
			if (typeof card.awayTeams !== 'number' || card.awayTeams < 1) {
				addIssue('CAPTAIN cards must declare awayTeams >= 1.', ['awayTeams'])
			}
			if (card.startPosition !== null) {
				addIssue(
					'CAPTAIN cards have no startPosition (they start in the Captain slot).',
					['startPosition'],
				)
			}
		}

		// common LOCATION ⇒ locationTier
		if (
			card.suit === 'LOCATION' &&
			card.deck === 'COMMON' &&
			card.locationTier === undefined
		) {
			addIssue(
				'Common LOCATION cards must declare a locationTier (STARTING | ADVANCED).',
				['locationTier'],
			)
		}

		// Market cards never start in a player's deck
		if (
			card.deck === 'COMMON' &&
			(MARKET_SUITS as readonly string[]).includes(card.suit) &&
			card.startPosition !== null
		) {
			addIssue(
				'Market cards never start in a player deck — startPosition must be null.',
				['startPosition'],
			)
		}

		// non-common, non-CAPTAIN, non-STATUS ⇒ startPosition present
		if (
			card.deck !== 'COMMON' &&
			card.suit !== 'CAPTAIN' &&
			card.suit !== 'STATUS' &&
			card.startPosition === null
		) {
			addIssue(
				'Crew-deck cards (other than CAPTAIN/STATUS) must declare a startPosition.',
				['startPosition'],
			)
		}

		// cannotBePlayed ⇒ no PLAY operation (rules/03 §3.5.4)
		if (
			card.cannotBePlayed === true &&
			card.operations.some((o) => o.type === 'PLAY')
		) {
			addIssue('cannotBePlayed cards must have no PLAY operation.', [
				'operations',
			])
		}

		// ONGOING ⇒ a PLAY operation containing a DEPLOY node (rules/05 §5.2.2)
		if (card.traits.includes('ONGOING')) {
			const hasPlayWithDeploy = card.operations.some(
				(o) => o.type === 'PLAY' && containsNode(o.effect, 'DEPLOY'),
			)
			if (!hasPlayWithDeploy) {
				addIssue(
					'ONGOING cards must have a PLAY operation containing a DEPLOY node.',
					['operations'],
				)
			}
		}

		// DUPLICATE must not contain another DUPLICATE in its reachable subtree
		// (rules/08 -> duplicate, "cannot itself be duplicated" — no chains). The
		// node carries no inline subtree in the current grammar, so the enforceable
		// static form is: a DUPLICATE must not target (opType) an operation on the
		// same card that itself contains a DUPLICATE. The depth walk below also
		// guards the literal nesting form if the grammar ever grows a DUPLICATE body.
		for (const [index, operation] of card.operations.entries()) {
			let targetsDuplicate = false
			let hasDuplicate = false
			walkEffect(operation.effect, (node) => {
				if (node.k !== 'DUPLICATE') return
				hasDuplicate = true
				const chains = card.operations.some(
					(other, otherIndex) =>
						otherIndex !== index &&
						other.type === node.opType &&
						containsNode(other.effect, 'DUPLICATE'),
				)
				if (chains) targetsDuplicate = true
			})
			if (hasDuplicate && targetsDuplicate) {
				addIssue(
					'DUPLICATE would resolve an operation that itself contains a DUPLICATE — duplicate cannot be duplicated (no chains, rules/08).',
					['operations', index, 'effect'],
				)
			}
			walkEffectNesting(operation.effect, () => {
				addIssue(
					'DUPLICATE is nested inside another DUPLICATE in its reachable subtree (no chains, rules/08).',
					['operations', index, 'effect'],
				)
			})
		}

		// developmentCost ⇔ startPosition DEVELOPMENT
		if (card.developmentCost !== null && card.startPosition !== 'DEVELOPMENT') {
			addIssue(
				'Cards with a developmentCost must have startPosition DEVELOPMENT.',
				['startPosition'],
			)
		}
		if (card.developmentCost === null && card.startPosition === 'DEVELOPMENT') {
			addIssue(
				'Cards with startPosition DEVELOPMENT must declare a developmentCost.',
				['developmentCost'],
			)
		}
	})

export const CardArraySchema = z.array(CardDefSchema)

// ---------------------------------------------------------------------------
// Automated Command cards (rules/13 §13.6) — the solo Bot's lookup tables, one
// entry per crew in src/data/cards/solo/bots.json. Mechanics only: the printed
// rows are joined in at runtime from the fetched STCC data/bots.json.
// ---------------------------------------------------------------------------

/** The SUITS card's rows, in their printed order. */
export const BOT_SUITS = [
	'INCIDENT',
	'SHIP',
	'ALLY',
	'CARGO',
	'PERSON',
	'DIRECTIVE',
	'ENCOUNTER',
	'LOCATION',
] as const
export type BotSuit = (typeof BOT_SUITS)[number]

const BotSuitRowSchema = z
	.object({
		/** the "no Duty Officer" side */
		noDo: EffectSchema,
		/** the "with Duty Officer" side */
		do: EffectSchema,
	})
	.strict()

/** A campaign upgrade bonus (rules/14 §14.3 Option B). */
const BotBonusSchema = z.discriminatedUnion('k', [
	// an effect resolved at the start of every later campaign game: before
	// your starting hand is drawn, after it, or at the start of play
	z
		.object({
			k: z.literal('BOOST'),
			when: z.enum(['BEFORE_HAND', 'AFTER_HAND']),
			effect: EffectSchema,
		})
		.strict(),
	// move one of your own crew cards into your Reinforcement deck for good
	z
		.object({
			k: z.literal('TO_REINFORCEMENT'),
			from: z.enum(['RESERVE', 'AVAILABLE']),
			filter: CardFilterSchema.optional(),
		})
		.strict(),
])
export type BotBonus = z.infer<typeof BotBonusSchema>

const BotRewardSchema = z
	.object({
		/** the Market cards Option A may add to the Reinforcement deck */
		cards: CardFilterSchema,
		/** Option B, in the printed order */
		bonus: z.array(BotBonusSchema),
	})
	.strict()
export type BotReward = z.infer<typeof BotRewardSchema>

export const BotCardSchema = z
	.object({
		/** the crew whose Bot this is */
		deck: DeckSchema,
		/** TRAITS card rows, top to bottom: the first row naming a trait of the
		 *  card being resolved wins; a WILDCARD card takes row 0 */
		traits: z
			.array(
				z
					.object({
						match: z.array(TraitSchema).min(1),
						effect: EffectSchema,
					})
					.strict(),
			)
			.min(1),
		suits: z
			.object({
				INCIDENT: BotSuitRowSchema,
				SHIP: BotSuitRowSchema,
				ALLY: BotSuitRowSchema,
				CARGO: BotSuitRowSchema,
				PERSON: BotSuitRowSchema,
				DIRECTIVE: BotSuitRowSchema,
				ENCOUNTER: BotSuitRowSchema,
				LOCATION: BotSuitRowSchema,
			})
			.strict(),
		/** the BUR Bot's Dilithium Clean-up and scoring (rules/13 §13.4,
		 *  §13.13.3) */
		special: z.enum(['DILITHIUM']).optional(),
		/** the Five-Year Mission upgrades for beating / losing to this Bot */
		campaign: z
			.object({ win: BotRewardSchema, loss: BotRewardSchema })
			.strict()
			.optional(),
	})
	.strict()
export type BotCard = z.infer<typeof BotCardSchema>
export const BotArraySchema = z.array(BotCardSchema)
