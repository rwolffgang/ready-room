// Query-layer types — data-only, matching docs/effect-dsl.md §5 (todo/03).
// Every node here is plain JSON so GameState/card data round-trips through
// JSON.stringify. The resolver (todo/04+) implements semantics against these shapes.
//
// Optional fields are written `x?: T | undefined` so the schemas in
// src/data/schema.ts can be annotated `z.ZodType<T>` under the project's
// `exactOptionalPropertyTypes` flag — a zod `.optional()` output is exactly
// `T | undefined`, so the two stay in lock-step and tsc proves it.

import type {
	MarketSuit,
	ResourceId,
	SpecialtyId,
	Suit,
	TraitId,
} from '../../data/ids'

export type Seat = 0 | 1

/**
 * A concrete zone reference (the runtime shape: a card's `zone`, moveCard
 * destinations, zone keys). Unlike `ZoneSpec` there are no bare-string
 * shorthands here — every zone is fully specified, and per-player zones carry
 * the concrete seat. Structurally identical to the object members of
 * `ZoneSpec`; the distinction is semantic (spec = query shorthand with
 * SELF-relative seats; ref = resolved concrete zone).
 */
export type ZoneRef =
	| { k: 'MARKET_DECK'; suit: MarketSuit }
	| { k: 'MARKET_OFFER'; suit: MarketSuit }
	| { k: 'ENCOUNTER_DECK' }
	| { k: 'INCIDENT_DECK' }
	| { k: 'LOCATION_DECK' }
	| { k: 'NEUTRAL_ZONE'; slot: 0 | 1 | 2 }
	| { k: 'JUNK' }
	| { k: 'STARDATE_PILE' }
	| { k: 'BOX' }
	| {
			k:
				| 'HAND'
				| 'DRAW'
				| 'DISCARD'
				| 'RESERVE'
				| 'DEVELOPMENT'
				| 'LOG'
				| 'STAGING'
				| 'FLEET'
				| 'LOCATION_AREA'
				| 'DUTY_OFFICER'
				| 'CAPTAIN'
				| 'STATUS'
				| 'BOT_ROW'
				| 'SUPPLEMENT'
				| 'REINFORCEMENT'
			seat: Seat
	  }
	| { k: 'BEAMED'; host: string }

/**
 * A zone reference used by queries and by movement primitives. Structured refs
 * carry their parameters; bare string shorthands cover the most common
 * whole-owner queries ("ALL_OWNED", "IN_PLAY") so card JSON stays terse.
 */
export type ZoneSpec =
	| 'ALL_OWNED'
	| 'IN_PLAY'
	| 'BEAMED_ANY' // every card beamed to any of the seat's cards (SHIP or LOCATION hosts)
	| 'BEAMED_TO_SHIP' // only cards beamed to one of the seat's SHIPs ("a card beamed to a SHIP" — 1KOL17, 1PIC14)
	// Every LOCATION a player can reach (rules/06 §6.2.2 / §6.3.1): the Location
	// Areas of the query's seats (SELF → your controlled Locations; ANY → both
	// players') plus all three Neutral Zone slots. The default target for
	// "warp … / send an AWAY TEAM to a LOCATION".
	| 'LOCATIONS'
	| 'NEUTRAL_LOCATIONS' // all three Neutral Zone slots ("a neutral LOCATION")
	// Cards beamed to one specific card. `host: 'THIS'` = the resolving card
	// ("a card beamed here" — 1SIS03, 1LOC04); `bound` = the
	// card bound under that name. Card names can't be hosts: the runtime
	// `{k:'BEAMED', host}` ref takes an instance id, never usable in card data.
	| { k: 'BEAMED_TO'; host: 'THIS' }
	| { k: 'BEAMED_TO'; bound: string }
	| ZoneRef

/**
 * A filter over cards in a zone query. `traits` is OR-within-the-list;
 * `allTraits` is AND. `exhibits` matches Skill OR Focus icons — never the
 * restriction icons (rules/07 §7.1.3).
 */
export interface CardFilter {
	suits?: Suit[] | undefined
	traits?: TraitId[] | undefined
	allTraits?: TraitId[] | undefined
	/** one of these card defs (by def id). Unlike the other lists, an empty
	 *  `ids` matches nothing — a card the data references but no box prints. */
	ids?: string[] | undefined
	exhibits?: SpecialtyId[] | undefined
	/** a FOCUS icon of one of these specialties — Focus only, never a Skill
	 *  icon ("your cards with {INF-focus}/{MIL-focus}" — 1BUR04) */
	focus?: SpecialtyId[] | undefined
	minVp?: number | undefined
	not?: CardFilter | undefined
}

/** A zone membership query. `zones` defaults per-node; `seat` defaults to SELF. */
export interface Query {
	zones: ZoneSpec[]
	seat?: 'SELF' | 'OPPONENT' | 'ANY' | undefined
	filter?: CardFilter | undefined
	countIcons?: 'SKILL' | 'FOCUS' | undefined
	/** Only the card bound under this name (e.g. `$event.card` — "return THE
	 *  INCIDENT" just taken, 1PIC13); a list matches any of those bindings
	 *  ("one of THE drawn cards", 1SHR03); a name bound to a list (a LET over
	 *  a Query) matches each card in it ("if any were dismissed" — 1SEL14);
	 *  no binding ⇒ matches nothing. */
	bound?: string | string[] | undefined
	/** LOCATIONs where the acting seat has a SHIP token ("a LOCATION where you
	 *  have a SHIP" — 1PIC14, 1SHR…, 1SIS…). A CardFilter narrows it to a SHIP
	 *  matching that filter ("the *U.S.S. Discovery*'s LOCATION" — 1BUR21). */
	withShip?: boolean | CardFilter | undefined
	/** whose SHIP token `withShip` looks for (default SELF = the acting seat):
	 *  an opponent SHIP present at this card's LOCATION (1SIS15) = `{ atThisShip, withShip: true, shipSeat: 'OPPONENT' }` */
	shipSeat?: 'SELF' | 'OPPONENT' | 'ANY' | undefined
	/** LOCATIONs where the acting seat has an Away Team ("a LOCATION where you
	 *  have an AWAY TEAM" — 1PIC23). */
	withAwayTeam?: boolean | undefined
	/** Only the LOCATION where the resolving card (a SHIP) has its token —
	 *  "send an AWAY TEAM to this ship's LOCATION" (1SHR07). */
	atThisShip?: boolean | undefined
	/** Only the LOCATION where the card bound under this name is — a SHIP's own
	 *  token, or the token of the SHIP it is beamed to ("exhaust a SHIP to
	 *  refresh ITS LOCATION" — 1BUR21). Unbound ⇒ matches nothing. */
	atBound?: string | undefined
	/** Only neutral LOCATIONs the acting seat has secured — "if that LOCATION is
	 *  now secured" (1KOL08). */
	secured?: boolean | undefined
	/** Only the resolving card itself ("this card"; redirected to the
	 *  duplicating card inside DUPLICATE like every self-reference) — "beam a
	 *  PERSON to this ship", "the traits it shares with 1PER19" (1PER19). */
	thisCard?: boolean | undefined
	/** Every match except the resolving card itself (1CAR08 counts VULCANs in
	 *  play but not itself; other copies still count). */
	exceptThis?: boolean | undefined
}

// Semantic aliases over the same query shape. The resolver enforces zone
// semantics per alias (a LocationQuery can only select LOCATION cards, etc.).
export type CardQuery = Query
export type LocationQuery = Query
export type MarketQuery = Query

export type Amount =
	| number
	| { k: 'COUNT'; query: Query }
	| { k: 'ICON_COUNT'; bind: string; kind: 'SKILL' | 'FOCUS' } // Skill/Focus icons of a bound card (todo/13)
	// Skill icons of one specialty in play, beamed cards excluded (rules/12 §12.5);
	// 'CHOSEN' = the specialty picked by the enclosing ADVANCE_SPECIALTY CHOICE (1PIC19)
	| { k: 'SKILL_ICONS'; specialty: SpecialtyId | 'CHOSEN' }
	| { k: 'SPECIALTY'; specialty: SpecialtyId }
	| { k: 'RESOURCE'; res: ResourceId; seat?: 'SELF' | 'OPPONENT' | undefined }
	| { k: 'UNUSED_ACTIONS' }
	| { k: 'MIN' | 'MAX' | 'SUM'; terms: Amount[] } // SUM: "for each X and each Y" counts a card that is both twice (1CAR04)
	| { k: 'UP_TO'; max: Amount } // player chooses 0..max
	| { k: 'PER'; every: number; of: Amount } // "1 for every N", rounded down
	// the number of traits on the card bound under `bind` (1BUR11 compares
	// a gained card's traits to 3, via COMPARE)
	| { k: 'TRAIT_COUNT'; bind: string }
	// the number of the bound card's traits that the (first) card matched by
	// `with` also has ("gain 1 {GLO} for each trait the discarded card shares
	// with 1PER19" — 1PER19)
	| { k: 'SHARED_TRAITS'; bind: string; with: Query }

/**
 * One requirement of a SAME_SHIP mission goal (rules/07 §7.2): `count`
 * distinct cards (default 1) among the SHIP and the cards beamed to it that
 * match `filter` — no card fills two requirements ("3 ALLY on the same SHIP",
 * "a ROMULAN on a SHIP that has KLINGON"). `different` additionally makes the
 * matched cards bear pairwise different traits from the list ("3 different of
 * VULCAN / TELLARITE / …", 1SHR/M2), or different species with 'SPECIES'
 * ("3 different species … on the same SHIP", 1BUR/M2); a card bearing one of
 * `eachDistinct` counts as its own kind.
 */
export interface SameShipRequirement {
	count?: number | undefined
	filter?: CardFilter | undefined
	different?: TraitId[] | 'SPECIES' | undefined
	eachDistinct?: TraitId[] | undefined
}

export type Predicate =
	| { k: 'SPECIALTY_AT_LEAST'; specialty: SpecialtyId; value: number }
	| { k: 'COUNT_AT_LEAST'; query: Query; value: number }
	| { k: 'HAS_TRAIT_IN_PLAY'; trait: TraitId; count?: number | undefined }
	// "N DIFFERENT SPECIES in play": bipartite matching of in-play cards ↔
	// species. `filter` narrows the counted cards ("excluding cards with
	// HUMAN / STARFLEET" = `not`, 1PIC/M3); every card bearing one of
	// `eachDistinct` counts as its own species (every ALIEN and every
	// TRANSCENDENT is distinct, 1PIC/M3)
	| {
			k: 'DIFFERENT_SPECIES_IN_PLAY'
			count: number
			filter?: CardFilter | undefined
			eachDistinct?: TraitId[] | undefined
	  }
	// mission goals: one SHIP plus the cards beamed to it meets every
	// requirement, each requirement with its own DISTINCT cards (rules/07 §7.2)
	| { k: 'SAME_SHIP'; requirements: SameShipRequirement[] }
	| { k: 'CONTROLS_LOCATION'; count: number }
	| { k: 'AND' | 'OR'; terms: Predicate[] }
	| { k: 'NOT'; term: Predicate }
	| { k: 'BOUND_IS'; bind: string; filter: CardFilter } // the just-discarded/gained card matches
	// "if you do" / "if you do both": every named binding was set by an earlier
	// step of this operation (a primitive `bind` is written only when it
	// actually happened — 1SIS08, 1BUR21, 1SEL07, 1PER09, 1SHR13)
	| { k: 'DID'; bind: string | string[] }
	| { k: 'BOUND_SHARES_TRAIT'; bind: string; with: Query } // shares a trait with a queried card
	| {
			k: 'LOG_LEGAL'
			filter?: CardFilter | undefined
			from?: ZoneSpec | undefined
	  } // a COST_LOG-style target exists
	| { k: 'CAPTAIN_HAS_TRAIT'; trait: TraitId } // "your captain has X" (1CAR02)
	// "you have N+ {COLLECTIVE} value" (1CAR02): Borg Collective icons are not
	// used in this box (rules/12 §12.30) — reserved, the value is always 0.
	| { k: 'COLLECTIVE_AT_LEAST'; value: number }
	// the acting seat is the official solo Bot ("if this card is owned by the
	// bot" — 1DIR01/2)
	| { k: 'IS_SOLO_BOT' }
	| { k: 'TOTAL_VP_AT_LEAST'; value: number } // "you have N+ value" = total printed VP in play (1CAR02)
	| {
			k: 'AWAY_TEAMS_AT' // away-team tokens at matched Locations: "2+ AWAY TEAMS here" (1SHR12, ruling 026)
			at: LocationQuery
			seat?: 'SELF' | 'OPPONENT' | 'ANY' | undefined
			value: number
	  }
	// numeric comparison of two Amounts: "whichever is the lower" (1KOL06),
	// "and have 10+ {GLO}" (1KOL05/07/08 development costs via COST_REQUIRE)
	| { k: 'COMPARE'; a: Amount; op: 'LT' | 'GE'; b: Amount }

/**
 * A SKILL_VARIABLE spec (docs/data-model.md §1, rules/09 §9.1): the card's
 * VARIABLE skill icon counts only while `condition` holds, then as `skills`.
 * Shape is deliberately minimal — the authoring tool pins it down once the
 * actual conditional-skill cards are transcribed (todo/12, todo/13).
 */
export type VariableSkillSpec =
	| {
			condition: Predicate
			skills: SpecialtyId[]
	  }
	/** A variable Skill icon that counts matching cards in play (1BUR12):
	 *  the VARIABLE icon counts `amount` times as `specialty`, evaluated
	 *  for the card's owner with the card as `source`. */
	| { counts: { specialty: SpecialtyId; amount: Amount }[] }
