// Query / predicate / amount evaluation (todo/04 provisional; todo/05 §5
// hardens the counting and SKILL_ANY/SKILL_VARIABLE cases). This is the layer
// the resolver's primitives dispatch against.
//
// AMBIGUITY CALL (todo/04): the per-player `ZoneSpec.seat` field is typed
// `Seat = 0 | 1` (locked by todo/03), but card data is seat-neutral — a card
// must work identically for both players. This module therefore interprets the
// numeric seat as SELF-relative: 0 -> the acting seat (`ctx.actor`), 1 -> the
// other. Query.seat ('SELF'/'OPPONENT'/'ANY') drives ALL_OWNED / IN_PLAY only.

import { cardDef } from '../cards'
import { player, otherSeat, owned, inPlayCards, zonesOf } from '../state'
import {
	matchTrait,
	differentSpeciesCount,
	kindLabels,
	effectiveTraits,
	cardTraits,
	type MatchOpts,
} from './traits'
import { exhibitsSpecialty, countSkillIcons } from './counting'
import { isSecured } from './board'
import {
	isCadetOpponent,
	opponentCardsInPlay,
	opponentResource,
} from '../../bot/cadet'
import type { GameState, CardInstance } from '../state'
import type { CardInstanceId } from '../ids'
import type {
	Amount,
	CardFilter,
	Predicate,
	Query,
	SameShipRequirement,
	Seat,
	ZoneSpec,
} from '../resolver/queries'
import type { EffectCtx } from '../state'
import { isSoloBot } from '../solo/seat'

export type QueryOpts = MatchOpts

const PER_PLAYER_ZONES = [
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
	'REINFORCEMENT',
] as const

function isPerPlayerZoneSpec(
	spec: ZoneSpec,
): spec is { k: (typeof PER_PLAYER_ZONES)[number]; seat: Seat } {
	return (
		typeof spec === 'object' &&
		(PER_PLAYER_ZONES as readonly string[]).includes(spec.k)
	)
}

/** seats a Query resolves against, given the acting seat. */
function querySeats(query: Query, ctx: EffectCtx): Seat[] {
	switch (query.seat ?? 'SELF') {
		case 'SELF':
			return [ctx.actor]
		case 'OPPONENT':
			return [otherSeat(ctx.actor)]
		case 'ANY':
			return [0, 1]
	}
}

function expandZoneSpec(
	state: GameState,
	spec: ZoneSpec,
	ctx: EffectCtx,
	seats: Seat[],
): CardInstanceId[] {
	if (spec === 'ALL_OWNED') {
		const out: CardInstanceId[] = []
		for (const seat of seats) out.push(...owned(state, seat))
		return out
	}
	if (spec === 'IN_PLAY') {
		const out: CardInstanceId[] = []
		for (const seat of seats) out.push(...inPlayCards(state, seat))
		return out
	}
	if (spec === 'BEAMED_ANY') {
		const out: CardInstanceId[] = []
		for (const seat of seats)
			out.push(
				...inPlayCards(state, seat).filter(
					(iid) => state.cards[iid]?.zone.k === 'BEAMED',
				),
			)
		return out
	}
	if (spec === 'BEAMED_TO_SHIP') {
		const out: CardInstanceId[] = []
		for (const seat of seats) {
			out.push(
				...inPlayCards(state, seat).filter((iid) => {
					const z = state.cards[iid]?.zone
					if (z?.k !== 'BEAMED') return false
					const host = state.cards[z.host as CardInstanceId]
					return host !== undefined && cardDef(host.def).suit === 'SHIP'
				}),
			)
		}
		return out
	}
	if (spec === 'LOCATIONS' || spec === 'NEUTRAL_LOCATIONS') {
		const out: CardInstanceId[] = []
		if (spec === 'LOCATIONS')
			for (const seat of seats)
				out.push(...(state.zones[`LOCATION_AREA:${seat}`] ?? []))
		for (const slot of [0, 1, 2])
			out.push(...(state.zones[`NEUTRAL_ZONE:${slot}`] ?? []))
		return out
	}
	if (typeof spec === 'object' && spec.k === 'BEAMED_TO') {
		const host = beamHost(spec, ctx)
		return host === undefined ? [] : (state.zones[`BEAMED:${host}`] ?? [])
	}
	if (isPerPlayerZoneSpec(spec)) {
		// SELF-relative seat (see header note)
		const seat = spec.seat === 0 ? ctx.actor : otherSeat(ctx.actor)
		return state.zones[`${spec.k}:${seat}`] ?? []
	}
	return state.zones[zoneKeySpec(spec)] ?? []
}

/** The host a `BEAMED_TO` spec names: 'THIS' = the resolving card (redirected
 *  to the duplicating card inside DUPLICATE, like every other self-reference),
 *  `bound` = the card bound under that name (unset → no host). */
function beamHost(
	spec: Extract<ZoneSpec, { k: 'BEAMED_TO' }>,
	ctx: EffectCtx,
): string | undefined {
	if ('host' in spec) return ctx.duplicating ?? ctx.source
	const v = ctx.bindings[spec.bound]
	return typeof v === 'string' ? v : undefined
}

/** zoneKey-equivalent serialisation for the shared (non-per-player) zones. */
function zoneKeySpec(spec: ZoneSpec): string {
	if (typeof spec === 'string') return spec // shorthands (handled above; defensive)
	switch (spec.k) {
		case 'BEAMED':
			return `BEAMED:${spec.host}` // runtime ref: host is an instance id
		case 'MARKET_DECK':
			return `MARKET_DECK:${spec.suit}`
		case 'MARKET_OFFER':
			return `MARKET_OFFER:${spec.suit}`
		case 'NEUTRAL_ZONE':
			return `NEUTRAL_ZONE:${spec.slot}`
		default:
			return spec.k
	}
}

/** Match a single filter tree against a card. Wildcards honour `opts`. */
export function matchFilter(
	state: GameState,
	card: CardInstance,
	filter: CardFilter,
	opts: QueryOpts,
): boolean {
	const def = cardDef(card.def)
	if (
		filter.suits !== undefined &&
		!filter.suits.includes(def.suit) &&
		// counts as a LOCATION (1ENC07)
		!(def.treatedAsLocation === true && filter.suits.includes('LOCATION'))
	)
		return false

	if (filter.traits !== undefined && filter.traits.length > 0) {
		const anyTrait = filter.traits.some((t) =>
			matchTrait(state, card.iid, t, opts),
		)
		if (!anyTrait) return false
	}

	if (filter.allTraits !== undefined && filter.allTraits.length > 0) {
		const traits = effectiveTraits(state, card.iid)
		const own = new Set(traits.filter((t) => filter.allTraits!.includes(t)))
		if (card.wildcardAs !== null) own.add(card.wildcardAs)
		const missing = filter.allTraits.filter((t) => !own.has(t))
		if (missing.length > 0) {
			// a WILDCARD card can substitute for (at most) the single missing trait
			const isWild = traits.includes('WILDCARD')
			if (!isWild || !opts.allowWildcard || missing.length > 1) return false
			if (card.wildcardAs !== null && card.wildcardAs !== missing[0])
				return false
		}
	}

	if (filter.ids !== undefined && !filter.ids.includes(def.id)) return false

	if (filter.exhibits !== undefined && filter.exhibits.length > 0) {
		const any = filter.exhibits.some((sp) =>
			exhibitsSpecialty(cardDef(card.def), sp),
		)
		if (!any) return false
	}

	// Focus icon only ("your cards with {INF-focus}/{MIL-focus}" — 1BUR04)
	if (
		filter.focus !== undefined &&
		filter.focus.length > 0 &&
		!filter.focus.some((sp) => def.focus === `FOCUS_${sp}`)
	)
		return false

	if (filter.minVp !== undefined && def.vp < filter.minVp) return false

	// "excluding X": a WILDCARD is never compelled to be X (rules/12 §12.12 —
	// opt-in only), so the exclusion reads its genuine/declared traits only.
	if (
		filter.not !== undefined &&
		matchFilter(state, card, filter.not, { ...opts, allowWildcard: false })
	)
		return false

	return true
}

/** Does one of `seats` have a SHIP token at Location `loc` (optionally: a
 *  SHIP matching `filter`)? */
function hasShipAt(
	state: GameState,
	seats: Seat[],
	loc: CardInstanceId,
	filter: CardFilter | undefined,
	opts: QueryOpts,
): boolean {
	for (const seat of seats)
		for (const iid of state.zones[`FLEET:${seat}`] ?? []) {
			const card = state.cards[iid]
			if (card?.shipTokenAt !== loc) continue
			if (filter === undefined || matchFilter(state, card, filter, opts))
				return true
		}
	return false
}

/** The LOCATION a card is at: a SHIP's own token, or — for a card beamed to
 *  a SHIP — its host's token. */
function locationOfCard(
	state: GameState,
	iid: CardInstanceId,
): CardInstanceId | undefined {
	const self = state.cards[iid]
	if (self === undefined) return undefined
	const host =
		self.zone.k === 'BEAMED'
			? state.cards[self.zone.host as CardInstanceId]
			: self
	const at = host?.shipTokenAt
	return typeof at === 'string' && at !== 'SUPPLY'
		? (at as CardInstanceId)
		: undefined
}

/** The LOCATION the resolving card is at (rules/06 §6.2.2): a SHIP's own
 *  token, or — for a card beamed to a SHIP — its host's token ("send an AWAY
 *  TEAM to its LOCATION" after beaming this card to a SHIP, 1PER13).
 *  Self-references redirect to the duplicating card inside DUPLICATE. */
function thisCardsLocation(
	state: GameState,
	ctx: EffectCtx,
): CardInstanceId | undefined {
	return locationOfCard(state, ctx.duplicating ?? ctx.source)
}

/** Evaluate a CardQuery to the list of matching card instances (in zone order). */
export function resolveQuery(
	state: GameState,
	query: Query,
	ctx: EffectCtx,
	opts?: QueryOpts,
): CardInstanceId[] {
	const matchOpts: QueryOpts = opts ?? {
		allowWildcard: true,
		actorMayOptIn: true,
	}
	const seats = querySeats(query, ctx)
	const seen = new Set<CardInstanceId>()
	const out: CardInstanceId[] = []
	// `bound`: only the card(s) bound under the given name(s) — "log one of THE
	// drawn cards" (1SHR03) lists several; an unset name matches nothing. A
	// name bound to a list (a LET over a Query) matches every card in it
	// ("if any were dismissed" — 1SEL14).
	const boundNames =
		query.bound === undefined
			? undefined
			: Array.isArray(query.bound)
				? query.bound
				: [query.bound]
	const bound = boundNames
		?.flatMap((n) => {
			const v = ctx.bindings[n]
			return Array.isArray(v) ? v : [v]
		})
		.filter((v): v is string => typeof v === 'string')
	if (bound !== undefined && bound.length === 0) return out
	// withShip looks for the acting seat's SHIPs unless `shipSeat` says whose
	const shipSeats: Seat[] =
		query.shipSeat === 'OPPONENT'
			? [otherSeat(ctx.actor)]
			: query.shipSeat === 'ANY'
				? [0, 1]
				: [ctx.actor]
	// atBound: the LOCATION the bound card is at ("refresh ITS LOCATION")
	let boundLoc: CardInstanceId | null | undefined
	if (query.atBound !== undefined) {
		const v = ctx.bindings[query.atBound]
		boundLoc =
			typeof v === 'string'
				? (locationOfCard(state, v as CardInstanceId) ?? null)
				: null
		if (boundLoc === null) return out
	}
	// thisCard: only the resolving card (the duplicating card inside DUPLICATE)
	const self =
		query.thisCard === true ? (ctx.duplicating ?? ctx.source) : undefined
	const except =
		query.exceptThis === true ? (ctx.duplicating ?? ctx.source) : undefined
	for (const spec of query.zones) {
		for (const iid of expandZoneSpec(state, spec, ctx, seats)) {
			if (self !== undefined && iid !== self) continue
			if (except !== undefined && iid === except) continue
			if (seen.has(iid)) continue
			seen.add(iid)
			const card = state.cards[iid]
			if (!card) continue
			if (bound !== undefined && !bound.includes(iid)) continue
			if (
				query.withShip !== undefined &&
				query.withShip !== false &&
				!hasShipAt(
					state,
					shipSeats,
					iid,
					query.withShip === true ? undefined : query.withShip,
					matchOpts,
				)
			)
				continue
			if (
				query.withAwayTeam === true &&
				(state.awayTeamsAt[iid]?.[ctx.actor] ?? 0) <= 0
			)
				continue
			if (query.atThisShip === true && thisCardsLocation(state, ctx) !== iid)
				continue
			if (boundLoc !== undefined && boundLoc !== iid) continue
			if (query.secured === true && !isSecured(state, iid, ctx.actor)) continue
			if (
				query.filter !== undefined &&
				!matchFilter(state, card, query.filter, matchOpts)
			)
				continue
			out.push(iid)
		}
	}
	return out
}

/** Count Skill/Focus icons over a set of matched cards instead of cards. */
export function countIcons(
	state: GameState,
	iids: CardInstanceId[],
	kind: 'SKILL' | 'FOCUS',
): number {
	let total = 0
	for (const iid of iids) {
		const card = state.cards[iid]
		if (!card) continue
		if (kind === 'FOCUS') {
			if (cardDef(card.def).focus !== null) total++
		} else {
			total += cardDef(card.def).skills.length
		}
	}
	return total
}

// ---------------------------------------------------------------------------
// Predicates (docs/effect-dsl.md §5)
// ---------------------------------------------------------------------------

export function evalPredicate(
	state: GameState,
	pred: Predicate,
	ctx: EffectCtx,
): boolean {
	switch (pred.k) {
		case 'SPECIALTY_AT_LEAST':
			return player(state, ctx.actor).specialties[pred.specialty] >= pred.value
		case 'COUNT_AT_LEAST': {
			// rules/10 §10.2 #3: opponent-owned quantities answer "one of every-
			// thing" in Cadet mode (resolved here so opponent predicates never read
			// the virtual seat's empty real state).
			if (
				pred.query.seat === 'OPPONENT' &&
				isCadetOpponent(state.mode, otherSeat(ctx.actor))
			) {
				void state
				return opponentCardsInPlay(pred.query.filter) >= pred.value
			}
			const iids = resolveQuery(state, pred.query, ctx)
			const n =
				pred.query.countIcons !== undefined
					? countIcons(state, iids, pred.query.countIcons)
					: iids.length
			return n >= pred.value
		}
		case 'HAS_TRAIT_IN_PLAY': {
			const req = pred.count ?? 1
			let found = 0
			for (const iid of inPlayCards(state, ctx.actor)) {
				if (
					matchTrait(state, iid, pred.trait, {
						allowWildcard: true,
						actorMayOptIn: true,
					})
				) {
					found++
					if (found >= req) return true
				}
			}
			return false
		}
		case 'DIFFERENT_SPECIES_IN_PLAY': {
			const opts = { allowWildcard: true, actorMayOptIn: true }
			const filter = pred.filter
			const cards =
				filter === undefined
					? inPlayCards(state, ctx.actor)
					: inPlayCards(state, ctx.actor).filter((iid) =>
							matchFilter(state, state.cards[iid]!, filter, opts),
						)
			return (
				differentSpeciesCount(state, cards, {
					allowWildcard: true,
					eachDistinct: pred.eachDistinct,
				}) >= pred.count
			)
		}
		case 'SAME_SHIP': {
			// Mission-only. Rules/07 §7.2: a goal "on the same SHIP" counts icons on
			// that one SHIP plus every card beamed to that particular SHIP. Every
			// requirement must be met by the ship itself OR a card beamed onto it,
			// each requirement by its own distinct cards.
			const ships = resolveQuery(
				state,
				{ zones: ['IN_PLAY'], seat: 'SELF', filter: { suits: ['SHIP'] } },
				ctx,
			)
			return ships.some((iid) =>
				sameShipSatisfied(state, iid, pred.requirements),
			)
		}
		case 'CONTROLS_LOCATION':
			// `seat: 0` is SELF-relative (header note): the acting seat's Location
			// Area, whichever seat that is.
			return (
				resolveQuery(
					state,
					{ zones: [{ k: 'LOCATION_AREA', seat: 0 }], seat: 'SELF' },
					ctx,
				).length >= pred.count
			)
		case 'AND':
			return pred.terms.every((t) => evalPredicate(state, t, ctx))
		case 'OR':
			return pred.terms.some((t) => evalPredicate(state, t, ctx))
		case 'NOT':
			return !evalPredicate(state, pred.term, ctx)
		case 'BOUND_IS': {
			const iid = ctx.bindings[pred.bind]
			if (typeof iid !== 'string') return false // no card bound yet
			const card = state.cards[iid]
			if (card === undefined) return false
			return matchFilter(state, card, pred.filter, {
				allowWildcard: true,
				actorMayOptIn: true,
			})
		}
		case 'DID': {
			// "if you do (both)": every named step recorded its result
			const names = Array.isArray(pred.bind) ? pred.bind : [pred.bind]
			return names.every((n) => {
				const v = ctx.bindings[n]
				if (v === undefined || v === null) return false
				return !Array.isArray(v) || v.length > 0
			})
		}
		case 'BOUND_SHARES_TRAIT': {
			const iid = ctx.bindings[pred.bind]
			if (typeof iid !== 'string') return false
			const card = state.cards[iid]
			if (card === undefined) return false
			const own = new Set<string>(cardTraits(state, card.iid))
			for (const other of resolveQuery(state, pred.with, ctx)) {
				const oc = state.cards[other]
				if (oc === undefined) continue
				const theirs = new Set<string>(cardTraits(state, other))
				for (const t of own) if (theirs.has(t)) return true
			}
			return false
		}
		case 'LOG_LEGAL': {
			// "there is a card you could Log" — the COST_LOG-style candidate check
			// (todo/12 gap: mandatory-log payoffs gate on a legal target existing).
			const zone = pred.from ?? 'IN_PLAY'
			return (
				resolveQuery(
					state,
					{ zones: [zone], seat: 'SELF', filter: pred.filter },
					ctx,
				).length >= 1
			)
		}
		case 'CAPTAIN_HAS_TRAIT':
			// "your captain has BORG" (1CAR02) — the CAPTAIN zone of the actor.
			return (
				resolveQuery(
					state,
					{
						zones: [{ k: 'CAPTAIN', seat: 0 }],
						seat: 'SELF',
						filter: { traits: [pred.trait] },
					},
					ctx,
				).length >= 1
			)
		case 'IS_SOLO_BOT':
			return isSoloBot(state, ctx.actor)
		case 'COLLECTIVE_AT_LEAST':
			// "you have N+ {COLLECTIVE} value" (1CAR02): the Borg Collective icon is
			// not used in this box (rules/12 §12.30), so every player's collective
			// value is 0 — recognised-but-inert.
			return 0 >= pred.value
		case 'TOTAL_VP_AT_LEAST': {
			// "you have N+ value" — total printed VP of the actor's in-play cards.
			let total = 0
			for (const iid of resolveQuery(
				state,
				{ zones: ['IN_PLAY'], seat: 'SELF' },
				ctx,
			)) {
				total += cardDef(state.cards[iid]!.def).vp
			}
			return total >= pred.value
		}
		case 'AWAY_TEAMS_AT': {
			// "2+ AWAY TEAMs here" — away-team tokens at the matched Locations
			// (1SHR12, ruling 026).
			if (pred.value <= 0) return true
			const seats: Seat[] =
				pred.seat === 'OPPONENT'
					? [otherSeat(ctx.actor)]
					: pred.seat === 'ANY'
						? [0, 1]
						: [ctx.actor]
			let total = 0
			for (const iid of resolveQuery(state, pred.at, ctx)) {
				const at = state.awayTeamsAt[iid]
				for (const s of seats) total += at?.[s] ?? 0
			}
			return total >= pred.value
		}
		case 'COMPARE': {
			const a = evalAmount(state, pred.a, ctx)
			const b = evalAmount(state, pred.b, ctx)
			return pred.op === 'LT' ? a < b : a >= b
		}
	}
}

/**
 * SAME_SHIP goal (rules/07 §7.2): does `ship` plus the cards beamed to it
 * meet every requirement, each with its OWN distinct cards? A requirement
 * asks for `count` cards matching its filter; with `different`, those cards
 * must also stand for pairwise different traits/species (a WILDCARD may be
 * any one of them). Solved by a small backtracking search over (card, kind)
 * assignments — a ship carries a handful of cards.
 */
export function sameShipSatisfied(
	state: GameState,
	shipIid: CardInstanceId,
	requirements: readonly SameShipRequirement[],
): boolean {
	const opts = { allowWildcard: true, actorMayOptIn: true }
	if (state.cards[shipIid] === undefined) return false
	const pool = [shipIid, ...zonesOf(state, { k: 'BEAMED', host: shipIid })]

	interface Slot {
		group: number
		cands: { iid: CardInstanceId; labels: string[] | null }[]
	}
	const slots: Slot[] = []
	requirements.forEach((req, group) => {
		const cands: Slot['cands'] = []
		for (const iid of pool) {
			const card = state.cards[iid]!
			if (
				req.filter !== undefined &&
				!matchFilter(state, card, req.filter, opts)
			)
				continue
			if (req.different === undefined) {
				cands.push({ iid, labels: null })
				continue
			}
			const labels = kindLabels(
				state,
				iid,
				{ allowWildcard: true, eachDistinct: req.eachDistinct },
				req.different === 'SPECIES' ? undefined : req.different,
			)
			if (labels.length > 0) cands.push({ iid, labels })
		}
		for (let i = 0; i < (req.count ?? 1); i++) slots.push({ group, cands })
	})
	// most constrained requirement first
	slots.sort((a, b) => a.cands.length - b.cands.length || a.group - b.group)

	const used = new Set<CardInstanceId>()
	const labelsUsed = new Map<number, Set<string>>()
	// within a group the slots are interchangeable: take cards in pool order
	const lastIdx = new Map<number, number>()
	const solve = (i: number): boolean => {
		if (i === slots.length) return true
		const slot = slots[i]!
		const from = lastIdx.get(slot.group) ?? -1
		for (let c = from + 1; c < slot.cands.length; c++) {
			const cand = slot.cands[c]!
			if (used.has(cand.iid)) continue
			const kinds = cand.labels ?? [null]
			for (const label of kinds) {
				const taken = labelsUsed.get(slot.group) ?? new Set<string>()
				if (label !== null && taken.has(label)) continue
				used.add(cand.iid)
				if (label !== null)
					labelsUsed.set(slot.group, new Set([...taken, label]))
				const prev = lastIdx.get(slot.group)
				lastIdx.set(slot.group, c)
				const ok = solve(i + 1)
				if (prev === undefined) lastIdx.delete(slot.group)
				else lastIdx.set(slot.group, prev)
				used.delete(cand.iid)
				labelsUsed.set(slot.group, taken)
				if (ok) return true
			}
		}
		return false
	}
	return solve(0)
}

// ---------------------------------------------------------------------------
// Amounts (docs/effect-dsl.md §5, todo/04 §10)
// ---------------------------------------------------------------------------

export interface AmountOpts {
	/** UP_TO policy. todo/04: auto-resolve to max (pure benefit, no downside);
	 *  a real CHOOSE_AMOUNT choice surfaces in todo/07. */
	upTo?: 'max' | undefined
	/** Final scoring threads `allowWildcard: false` — rules/12 §12.12: a
	 *  WILDCARD counts as nothing at final scoring (todo/10). */
	allowWildcard?: boolean | undefined
}

export function evalAmount(
	state: GameState,
	amount: Amount,
	ctx: EffectCtx,
	opts?: AmountOpts,
): number {
	/** Wildcard policy for the query resolve inside a COUNT amount. Mission
	 *  goals keep the default (wildcards satisfy goals, rules/12 §12.12); final
	 *  scoring passes allowWildcard=false so a WILDCARD never satisfies an
	 *  ENDGAME/SPECIAL scoring predicate (rules/07 §7.4.2). */
	const matchOpts: QueryOpts = {
		allowWildcard: opts?.allowWildcard ?? true,
		actorMayOptIn: true,
	}
	const rec = (a: Amount): number => evalAmount(state, a, ctx, opts)
	switch (typeof amount) {
		case 'number':
			return amount
		case 'object': {
			if (amount === null) return 0
			switch (amount.k) {
				case 'COUNT': {
					// rules/10 §10.2 #3: any opponent-card quantity answers 1 in Cadet
					// mode (clamped whether or not the filter could match — the opponent
					// "has one of everything").
					if (
						amount.query.seat === 'OPPONENT' &&
						isCadetOpponent(state.mode, otherSeat(ctx.actor))
					) {
						return opponentCardsInPlay(amount.query.filter)
					}
					const iids = resolveQuery(state, amount.query, ctx, matchOpts)
					return amount.query.countIcons !== undefined
						? countIcons(state, iids, amount.query.countIcons)
						: iids.length
				}
				case 'ICON_COUNT': {
					// Skill/Focus icons of the card bound at `amount.bind` (1SEL07
					// 1SEL07 "the logged card's Skill icons").
					const iid = ctx.bindings[amount.bind] as CardInstanceId | undefined
					if (iid === undefined) return 0
					const card = state.cards[iid]
					if (card === undefined) return 0
					return countIcons(state, [iid], amount.kind)
				}
				case 'SKILL_ICONS': {
					const specialty =
						amount.specialty === 'CHOSEN'
							? ctx.bindings['$specialty']
							: amount.specialty
					if (
						specialty !== 'RESEARCH' &&
						specialty !== 'INFLUENCE' &&
						specialty !== 'MILITARY'
					)
						return 0
					return countSkillIcons(state, ctx.actor, specialty)
				}
				case 'SPECIALTY':
					return player(state, ctx.actor).specialties[amount.specialty]
				case 'RESOURCE': {
					const seat =
						amount.seat === 'OPPONENT' ? otherSeat(ctx.actor) : ctx.actor
					// rules/10 §10.2 #3: the cadet holds exactly 1 of every resource.
					if (isCadetOpponent(state.mode, seat))
						return opponentResource(amount.res)
					return player(state, seat).resources[amount.res]
				}
				case 'UNUSED_ACTIONS':
					return player(state, ctx.actor).actions.available
				case 'MIN':
					return Math.min(...amount.terms.map((t) => rec(t)))
				case 'MAX':
					return Math.max(...amount.terms.map((t) => rec(t)))
				case 'SUM':
					return amount.terms.reduce<number>((n, t) => n + rec(t), 0)
				case 'UP_TO':
					return rec(amount.max)
				case 'PER':
					return Math.floor(rec(amount.of) / amount.every)
				case 'TRAIT_COUNT': {
					// gained card's trait count (1BUR11 compares it to 3)
					const iid = ctx.bindings[amount.bind]
					if (typeof iid !== 'string' || state.cards[iid] === undefined)
						return 0
					return new Set(cardTraits(state, iid as CardInstanceId)).size
				}
				case 'SHARED_TRAITS': {
					// "for each trait the discarded card shares with 1PER19" (1PER19)
					const iid = ctx.bindings[amount.bind]
					if (typeof iid !== 'string' || state.cards[iid] === undefined)
						return 0
					const partner = resolveQuery(state, amount.with, ctx, matchOpts)[0]
					if (partner === undefined) return 0
					const theirs = new Set<string>(cardTraits(state, partner))
					return new Set(
						cardTraits(state, iid as CardInstanceId).filter((t) =>
							theirs.has(t),
						),
					).size
				}
			}
		}
	}
}
