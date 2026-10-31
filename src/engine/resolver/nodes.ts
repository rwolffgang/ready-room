// Effect DSL node types — data-only discriminated union keyed on `k`,
// matching docs/effect-dsl.md §§2–4 + §5 (todo/03). This is a pure types
// file for the resolver (todo/04+ implements it); no behaviour here.
//
// Optional fields are written `x?: T | undefined` — same reason as in
// queries.ts: it lets src/data/schema.ts annotate `z.ZodType<T>` under
// `exactOptionalPropertyTypes` and have tsc verify the lock-step.

import type {
	Amount,
	CardFilter,
	CardQuery,
	LocationQuery,
	MarketQuery,
	Predicate,
	Query,
	ZoneSpec,
} from './queries'
import type {
	MarketSuit,
	OperationType,
	ResourceId,
	SpecialtyId,
	Suit,
	TraitId,
} from '../../data/ids'

/** An option in a CHOOSE_ONE node ("either A or B"). */
export interface ChooseOption {
	label: string
	body: Effect
}

export type EffectNode =
	// --- Control nodes (docs/effect-dsl.md §2) ---------------------------------
	| { k: 'SEQ'; steps: Effect[] }
	| { k: 'MAY'; body: Effect }
	// count = "choose N of the following": N DIFFERENT options, one after the
	// other (1SIS08, 1SIS09, 1SHI11); default 1 ("either A or B")
	| { k: 'CHOOSE_ONE'; options: ChooseOption[]; count?: number | undefined }
	| { k: 'PAY_THEN'; cost: Effect; body: Effect } // "do A to do B": A is a cost
	| { k: 'IF'; cond: Predicate; then: Effect; else?: Effect | undefined }
	| { k: 'REPEAT'; times: Amount; body: Effect }
	| { k: 'FOR_EACH'; over: Query; body: Effect; bind: string }
	| { k: 'LET'; bind: string; value: Amount | Query; body: Effect }
	| { k: 'OPPONENT'; body: Effect } // switch the acting seat (FORCE sugar)
	| { k: 'REVEAL'; whose: 'SELF' | 'OPPONENT' } // show a hand (informational)
	| { k: 'PUT_ON_DECK_TOP'; target: CardQuery | 'THIS' } // an in-play card → the top of its owner's deck (1PER17)
	| { k: 'NOOP' }
	// --- Cost nodes (docs/effect-dsl.md §3) — pre-validated before any mutation --
	| { k: 'COST_RESOURCE'; res: ResourceId; amount: Amount } // Glory substitution applies
	| { k: 'COST_ACTION' } // the [action] prefix (usually Operation.costsAction)
	| {
			k: 'COST_DISCARD'
			filter?: CardFilter | undefined
			count: number
			whose?: 'SELF' | 'OPPONENT' | undefined
			bind?: string | undefined
			exceptBound?: string | undefined
			onlyBound?: string[] | undefined
			/** 'THIS' = only the resolving card itself ("… this card to …") */
			target?: 'THIS' | undefined
	  } // from hand; exceptBound = "a different card" than that bound card; onlyBound = only the cards bound under these names ("discard IT" — 1PIC08)
	| {
			k: 'COST_PUT'
			filter?: CardFilter | undefined
			count: number
			to: ZoneSpec
			/** where the put card comes from (default HAND); a list = "from your
			 *  hand or Discard pile" (1CAR02) */
			from?: ZoneSpec | ZoneSpec[] | undefined
			/** 'THIS' = only the resolving card itself ("… this card to …") */
			target?: 'THIS' | undefined
	  }
	// must be an in-play card; bind = the exhausted card ("exhaust a SHIP to
	// refresh ITS LOCATION" — 1BUR21)
	| {
			k: 'COST_EXHAUST'
			filter?: CardFilter | undefined
			bind?: string | undefined
			target?: 'THIS' | undefined // only the resolving card ("exhaust this card to …")
	  }
	// "refresh a BAJORAN to draw a card" (1SIS04): refresh one of your exhausted
	// in-play cards as a cost; bind = the refreshed card
	| {
			k: 'COST_REFRESH'
			filter?: CardFilter | undefined
			bind?: string | undefined
			target?: 'THIS' | undefined // only the resolving card
	  }
	// distinct: remove ONE Away Team from each of `count` different Locations
	// ("remove an AWAY TEAM from 3 different controlled LOCATIONs" — 1SHR16)
	| {
			k: 'COST_REMOVE_AWAY_TEAM'
			count: number
			from?: LocationQuery | undefined
			distinct?: boolean | undefined
	  }
	| { k: 'COST_TAKE_INCIDENT'; count: number } // used by Development costs
	// from = where the dismissed card must be (default: in play) — "dismiss a
	// PERSON that is beamed here" = from {k:'BEAMED_TO', host:'THIS'} (1SHI12)
	| {
			k: 'COST_DISMISS'
			filter?: CardFilter | undefined
			count: number
			from?: ZoneSpec | undefined
			/** 'THIS' = only the resolving card itself ("… this card to …") */
			target?: 'THIS' | undefined
	  }
	| { k: 'COST_LOG_THIS' }
	| { k: 'COST_REQUIRE'; cond: Predicate } // a condition gate, nothing is paid: dev cost "… and have 10+ {GLO}" (1KOL05/07/08)
	| {
			k: 'COST_RETURN_INCIDENT'
			filter?: CardFilter | undefined
			count: number
	  } // incidents from hand → deck bottom (cost; the Burn recedes)
	| {
			k: 'COST_RECALL'
			filter?: CardFilter | undefined
			from?: ZoneSpec | undefined
			/** 'THIS' = only the resolving card itself ("… this card to …") */
			target?: 'THIS' | undefined
	  } // an in-play card → hand as a cost
	| {
			k: 'COST_LOG'
			filter?: CardFilter | undefined
			from?: ZoneSpec | ZoneSpec[] | undefined
			bind?: string | undefined
			/** 'THIS' = only the resolving card itself ("… this card to …") */
			target?: 'THIS' | undefined
	  } // bind = the logged card (1SHR16 "if the logged card shares…"); an in-play card → Log as a cost (array = hand OR those zones)
	| {
			k: 'COST_BEAM'
			from?: ZoneSpec | ZoneSpec[] | undefined // default HAND; array = hand OR those zones
			filter?: CardFilter | undefined
			to: CardQuery
			count: number // (a card) beamed as payment for the benefit
			/** 'THIS' = only the resolving card itself ("… this card to …") */
			target?: 'THIS' | undefined
	  }
	// --- Card movement (docs/effect-dsl.md §4) ----------------------------------
	| {
			k: 'BEAM'
			from?: ZoneSpec | ZoneSpec[] | undefined // default HAND; an array means "hand OR those zones"
			filter?: CardFilter | undefined
			to: CardQuery
			count: number // Location can never be beamed
			bound?: string | undefined // only the card bound under this name ("beam THE gained card" — 1PIC01)
			bind?: string | undefined // the (first) beamed card, set only once a beam happened ("if you do" — 1BUR21, 1SEL07)
			target?: 'THIS' | undefined // only the resolving card itself (1PER18 beams itself onto a deployed SHIP when it can)
	  }
	| { k: 'DEPLOY'; target: CardQuery } // SHIP or ONGOING only; else no-op
	| { k: 'DESTROY'; target: CardQuery | 'THIS' } // to the box; ownership lost; cascades
	| {
			k: 'DISCARD'
			filter?: CardFilter | undefined
			count: number
			from: 'HAND' | 'DECK_TOP'
			whose?: 'SELF' | 'OPPONENT' | undefined
			bind?: string | undefined
			onlyBound?: string[] | undefined
	  } // onlyBound = "discard one of THEM" (1PIC16)
	| {
			k: 'DISMISS'
			/** 'THIS' = the resolving card itself — the only way a LOCATION is
			 *  dismissed ("unless the Location itself explicitly instructs it",
			 *  rules/08 → dismiss; 1SHR12 Clean-up) */
			target: CardQuery | 'THIS'
			bind?: string | undefined // the dismissed card ("if they do" — 1CAR08)
	  } // not from Staging; not a Location (unless self)
	| {
			k: 'DRAW'
			count: Amount
			bind?: string | string[] | undefined
			fromBottom?: boolean | undefined
	  } // triggers deck cycling; bind = the (last) drawn card (1PIC08 "discard it"); a list binds the i-th drawn card to the i-th name (1PIC16 "draw 2 cards and discard one of them")
	// bind = the (last) drawn card (1SIS13 free plays the SHIP it drew back
	// from the Discard pile), set only when a card was drawn
	| {
			k: 'DRAW_FROM_DISCARD'
			filter?: CardFilter | undefined
			count: number
			bind?: string | undefined
	  }
	| { k: 'RECALL'; target: CardQuery } // in play → hand; cascades
	| { k: 'LOG'; target: CardQuery | 'THIS'; bind?: string | undefined } // cascades; Location clears tokens; bind = the logged card (todo/13)
	| {
			k: 'PROMOTE'
			from: 'HAND' | 'STAGING' | 'DISCARD'
			filter?: CardFilter | undefined
			/** 'THIS' = "promote this card" — only the resolving card itself,
			 *  when it sits in `from` (1SEL05, 1SIS23). */
			target?: 'THIS' | undefined
	  } // PERSON only; at the limit the player dismisses a Duty Officer to make room (rules/08)
	| { k: 'JUNK'; target: MarketQuery } // never a card bearing resource tokens
	| { k: 'PUT_INTO_STAGING'; target: CardQuery } // counts as *put into play*
	// --- Acquisition (docs/effect-dsl.md §4) -----------------------------------
	| {
			k: 'GAIN_CARD'
			suits: MarketSuit[]
			includeJunk?: boolean | undefined
			/** "gain a X from the Junk" (rules/08 → gain): only matching Junk
			 *  cards, never the Market offer or deck (1PER05, 1SHI07, 1BUR17) */
			onlyJunk?: boolean | undefined
			bind?: string | undefined
			/** legal placements, as SCAN_FOR_TRAIT.to: one entry = no
			 *  CHOOSE_DESTINATION ("gain … to your Discard pile" — 1BUR07) */
			to?: ('DECK_TOP' | 'DISCARD')[] | undefined
	  } // faceup or deck top
	| {
			k: 'SCAN_N'
			n: Amount
			suits: MarketSuit[]
			includeJunk?: boolean | undefined
			bind?: string | undefined
	  } // one suit only
	| {
			k: 'SCAN_FOR_TRAIT'
			traits: TraitId[]
			includeJunk?: boolean | undefined
			bind?: string | undefined
			/** Legal placements for the gained card (rules/05 §5.4.3): omitted =
			 *  both (a CHOOSE_DESTINATION, as for GAIN_CARD); a single entry places
			 *  the gain there automatically. */
			to?: ('DECK_TOP' | 'DISCARD')[] | undefined
	  } // 2 Glory consolation if exhausted
	| {
			k: 'TAKE'
			deck: 'INCIDENT' | 'ENCOUNTER'
			count: number
			look?: number | undefined // look at the top N; the taker chooses `count` of them
			returnUnpicked?: boolean | undefined // the unchosen looked-at cards go to the bottom of the deck (SPACEFOLD, 1PIC18)
			/** where the taken card goes (default HAND): "take an INCIDENT to your
			 *  Discard pile" (1PIC23), under your Draw deck (1LOC17), onto your
			 *  deck top (1BUR/M1) */
			to?: 'HAND' | 'DISCARD' | 'DECK_TOP' | 'DECK_BOTTOM' | undefined
			bind?: string | undefined // the (last) taken card
	  } // → hand
	| { k: 'SELECT'; target: CardQuery; bind: string } // "select a controlled LOCATION": choose one card and bind it (1PIC18); nothing moves
	| {
			k: 'FIND'
			filter: CardFilter
			zones: ZoneSpec[]
			bind?: string | undefined
	  } // → hand; shuffle searched facedown decks; bind = the found card
	| { k: 'RETURN_INCIDENT'; target: CardQuery | 'THIS' } // → bottom of the Incident deck
	| { k: 'ENLIST_RESERVE' } // no-op if Reserve empty
	| {
			k: 'ENLIST_DEVELOPMENT'
			free?: boolean | undefined
			/** "reducing the cost by 1 {DIL} and 1 {LAT}" (1SIS04): each entry
			 *  lowers the Development's COST_RESOURCE of `res` by `amount`
			 *  (never below 0; alternative-cost branches each get the full
			 *  discount). A list `res` is an "or" pool: each of the `amount`
			 *  points lowers ONE of those resources, the player picks the split
			 *  ("by 1 {DIL} or 1 {LAT} for each STARBASE" — 1SIS/M1). */
			discount?:
				{ res: ResourceId | ResourceId[]; amount: Amount }[] | undefined
			/** only Developments matching this ("enlist *1KOL03* for
			 *  free" — 1KOL/M2) */
			filter?: CardFilter | undefined
	  } // pays the (discounted) development cost unless `free`
	// --- Resources & actions (docs/effect-dsl.md §4) ----------------------------
	// fromSupply: Glory "from the supply (not the Stardate card)" (1SEL/M3) —
	// never taken from, nor hands over, the Stardate card
	| {
			k: 'GAIN_RESOURCE'
			res: ResourceId
			amount: Amount
			fromSupply?: boolean | undefined
	  }
	| { k: 'SPEND_RESOURCE'; res: ResourceId; amount: Amount } // prefer COST_RESOURCE
	| { k: 'STEAL'; res: ResourceId; amount: Amount }
	| { k: 'GAIN_ACTION'; amount: Amount }
	| {
			k: 'ADVANCE_SPECIALTY'
			// 'LOWEST' = the lowest specialty, player breaks ties (1SIS22)
			specialty: SpecialtyId | 'CHOICE' | 'LOWEST'
			amount: Amount
	  }
	| { k: 'RECRYSTALLIZE'; amount: Amount | 'ALL' } // BUR only; 'ALL' = every parked {DIL} (1BUR10)
	// --- Board (docs/effect-dsl.md §4) ------------------------------------------
	| {
			k: 'SEND_AWAY_TEAM'
			count: Amount
			target: LocationQuery
			ignoreBlocking?: boolean | undefined
			bind?: string | undefined
	  } // bind = the targeted Location (1PIC24)
	| {
			k: 'REMOVE_AWAY_TEAM'
			count: number
			target: LocationQuery
			whose: 'SELF' | 'OPPONENT'
			bind?: string | undefined
	  } // bind = the Location it was removed from (1SHR24 checks whether that LOCATION was an opponent-controlled one)
	| {
			k: 'WARP'
			ship: CardQuery
			to: LocationQuery
			bind?: string | undefined
			/** "warp up to 2 of your SHIPs": choose up to this many DIFFERENT
			 *  ships first (UP_TO = 0..max), then warp each (1PIC22, 1SEL21,
			 *  1PER02). Omitted = exactly one ship. */
			count?: Amount | undefined
	  } // staying put is not warping; bind = the destination ("the LOCATION you warped to" — 1BUR20)
	| {
			k: 'TAKE_CONTROL'
			target: LocationQuery | 'FROM_LOCATION_DECK' | 'THIS' // THIS = the Location being played
			requireSecured?: boolean | undefined
	  }
	| { k: 'TRIGGER_CONTROL'; target: LocationQuery } // not a "take control" event
	| { k: 'EXHAUST'; target: CardQuery }
	| { k: 'REFRESH'; target: CardQuery; count?: Amount | undefined }
	| {
			k: 'PLACE_RESOURCE_ON_MARKET'
			res: ResourceId
			amount: Amount
			target?: MarketQuery | undefined
	  }
	| { k: 'WIPE_MARKET' }
	| { k: 'WIPE_NEUTRAL_ZONE' } // spares Locations bearing tokens
	// Borg drone tokens (1CAR02): reserved, no meaning in this box (rules/08 →
	// drone, rules/12 §12.30) — recognised-but-inert, logs a warning.
	| {
			k: 'DRONE'
			verb: 'REGENERATE' | 'SEND'
			count: number
			to?: LocationQuery | undefined // SEND: the Location a drone goes to
	  }
	// "assimilate it" (1SHI02): the Borg assimilate keyword is
	// reserved, no meaning in this box (rules/08 → assimilate, rules/12
	// §12.30) — recognised-but-inert: logs a warning, the card does not move.
	| { k: 'ASSIMILATE'; target: CardQuery | 'THIS' }
	// "remove N {GLO} from the Stardate card" (1BUR12): the tokens go
	// back to the supply; emptying the card hands it over like a gain does
	| { k: 'REMOVE_STARDATE_GLORY'; amount: number }
	// peek at the top N LOCATION (or ENCOUNTER) cards and re-stack them on
	// top and/or bottom in any order (1SIS21, 1CAR16); with two decks the
	// player first picks which one
	| {
			k: 'ARRANGE_DECK'
			decks: ('LOCATION' | 'ENCOUNTER')[]
			n: number
	  }
	// --- Replacement effects (docs/effect-dsl.md §6 "would" windows) ----------
	// "… to ignore the negative effect" of the pending ATTACK (a WOULD_BE_ATTACKED
	// trigger): scope ATTACK = every remaining negative effect of that attack
	// (1SIS06, 1SIS10, 1PER19); EFFECT = only the effect that opened the window
	// ("when an attack would dismiss your Duty Officer … ignore the effect" —
	// 1BUR15, 1CAR11)
	| { k: 'IGNORE_ATTACK'; scope?: 'ATTACK' | 'EFFECT' | undefined }
	// "When you would gain a card, scan N of the same suit instead" (1SIS22,
	// 1BUR06): replaces the pending gain (a WOULD_GAIN_CARD trigger)
	| { k: 'REPLACE_GAIN'; scan: number }
	// --- Meta (docs/effect-dsl.md §4) --------------------------------------------
	| {
			k: 'FREE_PLAY'
			filter: CardFilter
			from?: ZoneSpec | ZoneSpec[] | undefined // default HAND; a list = "from your hand or Discard pile" (1SIS08)
			bound?: string | undefined
			bind?: string | undefined // the free-played card, set only once it was played ("if you do" — 1SHR13, 1BUR13)
	  } // action cost waived; other costs stand; bound = only that bound card ("the found card"); the player picks which PLAY operation
	| {
			k: 'DUPLICATE'
			suits: Suit[]
			// DEPLOYED = a card in either player's Fleet ("deployed by any player" —
			// 1SHI04); BOUND = exactly the card bound under `bound` (1LOC20
			// "duplicate Utilize's other play operation")
			from: (
				| 'MARKET'
				| 'DISCARD'
				| 'LOG'
				| 'RESOLVED_THIS_TURN'
				| 'DEPLOYED'
				| 'BOUND'
			)[]
			opType: OperationType // the operation type to resolve (usually PLAY)
			filter?: CardFilter | undefined // "a non-TIME TRAVEL SHIP" (1SHI04)
			bound?: string | undefined // the card for from BOUND
			/** "the OTHER play operation": skip the operations of that card the
			 *  actor already resolved this turn (1LOC20) */
			other?: boolean | undefined
			// RESOLVED_THIS_TURN = only operations of `opType` the actor already
			// resolved this turn (1PER11 repeats a Resupply
			// operation used earlier this turn)
			// `duplicate` cannot itself be duplicated — no chains (rules/08 → duplicate).
	  }
	| { k: 'FORCE'; body: Effect } // sugar for { k: 'OPPONENT' } with choice ownership flipped
	| { k: 'COMPLETE_MISSION'; index?: number | undefined } // normally a player Intent, not an effect
	| {
			k: 'MODIFIER_ATTACH'
			id: string
			stack?: boolean | undefined
			/** attach the layer to each matched CARD instead of the resolving card
			 *  (the layer's `source` becomes that card, so it also drops when the
			 *  card leaves play): the deployed SHIP counting as CLOAK until the
			 *  turn ends (1KOL03, 1CAR03) = TEMP_CLOAK on `$event.card`. */
			target?: CardQuery | undefined
	  } // rule-modifier layers; stack = attach another copy even if one is active (1KOL22 "+1 per unspent action")
	| { k: 'MODIFIER_DETACH'; id: string }
	| {
			k: 'ALT_PLAY'
			suits: Suit[]
			operation: Operation
	  } // static PASSIVE declaration (1PIC08): "you may treat any <suit>'s play operation as <operation>" — the owner's hand cards of `suits` gain `operation` as an extra PLAY option while this card is in play; resolving the node itself does nothing
	// --- Scoring (docs/effect-dsl.md §7) ----------------------------------------
	// Used in the §7 ENDGAME example; absent from the §4 tables. Scoring-only:
	// illegal outside an ENDGAME or SPECIAL operation.
	| { k: 'SCORE_VP'; amount: Amount }
	// --- Escape hatch (docs/effect-dsl.md §8) ------------------------------------
	| { k: 'SCRIPT'; fn: string } // named handler in a small registry; budget ≤ 5

export type Effect = EffectNode

/** Specialty threshold gate on an operation, e.g. `requires: { specialty: 'MILITARY', min: 3 }`. */
export interface SpecialtyReq {
	specialty: SpecialtyId
	min: number
}

/**
 * REACTION operation trigger (docs/effect-dsl.md §6). Rulings baked in:
 * CARD_GAINED fires for gain AND scan, never take; RESOURCE_GAINED never fires
 * for steal; PUT_INTO_PLAY timing differs per route.
 */
/** Whose events a trigger listens to. Every event trigger defaults to the
 *  card owner's OWN events ("after gaining", "after putting … into play",
 *  "after logging"); `OPPONENT` = "after your opponent …", `ANY` = "after you
 *  or your opponent …" (docs/effect-dsl.md §6). */
export type TriggerSeat = 'SELF' | 'OPPONENT' | 'ANY'

export type TriggerSpec =
	| {
			on: 'CARD_PLAYED'
			filter?: CardFilter | undefined
			seat?: TriggerSeat | undefined
	  }
	| {
			on: 'CARD_GAINED'
			filter?: CardFilter | undefined
			seat?: TriggerSeat | undefined
			/** only gains placed there — e.g. deck-top gains only (1SHI06) */
			dest?: 'DECK_TOP' | 'DISCARD' | undefined
	  }
	| { on: 'RESOURCE_GAINED'; res?: ResourceId | undefined }
	| {
			on: 'SPECIALTY_ADVANCED'
			specialty?: SpecialtyId | undefined
			/** any of these ("after your opponent gains INFLUENCE/MILITARY" —
			 *  1SIS06); combined with `specialty` when both are given */
			specialties?: SpecialtyId[] | undefined
			seat?: TriggerSeat | undefined
	  } // "after gaining at least 1 {INFLUENCE}" (1KOL07/08); a gain of ≥1
	| {
			on: 'PUT_INTO_PLAY'
			filter?: CardFilter | undefined
			seat?: TriggerSeat | undefined
	  }
	| {
			on: 'CARD_DEPLOYED'
			filter?: CardFilter | undefined
			seat?: TriggerSeat | undefined
	  } // "after deploying a SHIP" (1KOL03, 1CAR03): a DEPLOY moved it Staging → Fleet
	| { on: 'LOCATION_CONTROLLED'; seat?: 'SELF' | 'OPPONENT' | undefined }
	| {
			on: 'CARD_LOGGED'
			filter?: CardFilter | undefined
			seat?: TriggerSeat | undefined
			/** SPECIAL self-log only: resolve while the card is still in play,
			 *  before logging it cascades (a LOCATION's Ships are dismissed) —
			 *  1LOC01 (STCC FAQ "1LOC01-warp") */
			beforeLeaving?: boolean | undefined
	  }
	| { on: 'AWAY_TEAM_SENT'; neutral?: boolean | undefined } // neutral = "to a neutral LOCATION" (1PER18)
	| { on: 'SHIP_WARPED' }
	| { on: 'INCIDENT_TAKEN'; orReturned?: boolean | undefined } // orReturned = "whenever you take or return an INCIDENT" (1PER22)
	| { on: 'INCIDENT_RETURNED' } // "after returning an INCIDENT"
	| { on: 'ATTACKED' } // opponent resolved an ATTACK on you
	// "When you would be attacked" (1SIS06, 1SIS10, 1PER19): before the first
	// negative effect of an opponent's ATTACK operation applies to you. `effect`
	// narrows it to "when an attack would dismiss your Duty Officer" (1BUR15) /
	// "… would force you to remove AWAY TEAMs" (1CAR11), asked per such effect.
	| {
			on: 'WOULD_BE_ATTACKED'
			effect?: 'DISMISS_DUTY_OFFICER' | 'REMOVE_AWAY_TEAM' | undefined
	  }
	// "When you would gain a card" (1SIS22, 1BUR06): your GAIN_CARD picked a
	// card and is about to take it
	| { on: 'WOULD_GAIN_CARD' }
	// SPECIAL only: "Before scoring, …" (1PER22) — runs for the owner
	// once the game ends, before final scoring
	| { on: 'BEFORE_SCORING' }
	| { on: 'ATTACK_MADE' } // you resolved an ATTACK against the opponent
	| { on: 'MISSION_COMPLETED' }
	| { on: 'ENCOUNTER_TAKEN' }
	| { on: 'OPERATION_RESOLVED'; paid?: ResourceId | undefined } // "after resolving an operation with a {LAT} cost" (1SIS24): the owner's own operation that paid `paid` as a cost

/** One printed operation strip on a card (docs/data-model.md §1). */
export interface Operation {
	type: OperationType
	costsAction: boolean // the [action] prefix
	isAttack: boolean // the ATTACK prefix
	requires?: SpecialtyReq | undefined
	trigger?: TriggerSpec | undefined // REACTION; a triggered PASSIVE ("PASSIVE: After …", 1SHR10); SPECIAL CARD_LOGGED
	effect: Effect
	/** Optional label for fixtures/tools. Card data carries no printed text — the
	 *  printed rules come from the fetched STCC data (src/data/stcc.ts). */
	text?: string | undefined
}
