// Rule-modifier registry (docs/data-model.md §7, todo/05 §7). The GameState
// stores only `{ id, source }` per player — plain JSON — and the actual hooks
// live here, keyed by modifier id. 1BUR02 (rules/11 §11.6.1) is
// implemented as the proof that the hook set is adequate: when its source
// card is in play, hand size is 6, operation-gained Dilithium parks on the
// Status card, Glory cannot substitute for Dilithium, and stolen Dilithium is
// taken from the parked pile first.
//
// todo/13-followup (common-fidelity-pass gap #1): a card can now declare
// always-on passive rule modifiers via its CardDef `passives: string[]` field.
// While any such card is owned and in play, its declared modifiers join the
// player's attached layers (Status cards / MODIFIER_ATTACH) — see
// `activeModifiers`. The `describe` field on an entry is the card-language
// phrase describe() renders for a MODIFIER_ATTACH { id } node, so the PASSIVE
// operation's effect tree round-trips against the OCR record.
//
// The hook signatures below extend the §7 doodle with the arguments the caller
// already holds (the modifier's `source` and the live state) so the registry
// stays a pure lookup and each hook stays data-driven.

import type { GameState } from './state'
import { player, inPlayCards, zoneProps } from './state'
import { cardDef } from './cards'
import type { CardInstanceId } from './ids'
import type { Effect, Operation } from './resolver/nodes'
import type { ResourceId, TraitId } from '../data/ids'
import type { Seat } from './resolver/queries'
import { isSoloBot } from './solo/seat'

/** How a resource entered the pool (todo/05). 1BUR02 redirects only
 *  operation gains; Market token gains and steals are exempt (rules/11 §11.6.1). */
export interface GainCtx {
	via: 'OPERATION' | 'MARKET' | 'STEAL' | 'OTHER'
}

/** Where a redirected gain is parked. `amount` is normally the full gain. */
export interface Redirect {
	to: CardInstanceId
	amount: number
}

/** A steal should take `amount` from the parked tokens on card `iid` first. */
export interface StealSource {
	iid: CardInstanceId
	amount: number
}

export interface RuleModifierHooks {
	/** Layer on top of the base hand size (docs/data-model.md §4: 5, or 6 with
	 *  1BUR02). Sees the live state so variable adders can count
	 *  the player's tracks (1BUR08: +1 per specialty at 5+). */
	handSize?: (base: number, state: GameState, seat: Seat) => number
	/** Decide whether the gain is redirected onto the modifier's source card.
	 *  Returns null to let the gain flow to the pool. Called with the source
	 *  the modifier is attached to (todo/05 extension over the §7 doodle). */
	onGainResource?: (
		res: ResourceId,
		amount: number,
		ctx: GainCtx,
		source: CardInstanceId,
	) => Redirect | null
	/** May Glory substitute for `target`? (rules/04 §4.3.2; 1BUR02
	 *  disables the DIL rate, LAT substitution still works — rules/11 §11.6.1 #4). */
	canSubstituteGlory?: (target: ResourceId) => boolean
	/** Which parked sources a steal of `res` must tap first, in order. */
	onStolenFrom?: (
		res: ResourceId,
		amount: number,
		source: CardInstanceId,
		state: GameState,
		seat: Seat,
	) => StealSource[]
	/** The Clean-up replacement when this modifier changes Glory placement
	 *  (1BUR02: place 2 DIL from the supply on a Market card instead). */
	cleanupGloryPlacement?: (state: GameState, seat: Seat) => Effect
	/** While active on `seat`, opponent SHIP tokens never block that player's
	 *  Away-Team sends (1PIC05). */
	ignoreOpponentShips?: boolean
	/** While the SOURCE card (this Location) is in play, no Away Team may be
	 *  sent to it (1BUR10 "you cannot send here"). */
	blockSendsHere?: boolean
	/** While active on `seat`, scans and Market gains may also take cards from
	 *  the Junk (1ENC03). */
	scanIncludesJunk?: boolean
	/** The card-language phrase describe() renders for a MODIFIER_ATTACH { id }
	 *  node (fidelity round-trip for PASSIVE operations). */
	describe?: string
	/** "temporarily" / "for the remainder of your turn": the Clean-up REFRESH
	 *  substep detaches every such layer at the end of the CURRENT turn — from
	 *  both seats, so a layer attached on the opponent's turn (a REACTION)
	 *  ends with that turn too (1KOL22, TEMP_CLOAK). */
	untilEndOfTurn?: boolean
	/** The layer's SOURCE card additionally counts as these traits for every
	 *  trait check (matchTrait / CardFilter / scoring / goals) — the deployed
	 *  SHIP counting as CLOAK (1KOL03, 1CAR03). Attached to the card
	 *  via MODIFIER_ATTACH { target }; see `grantedTraits`. */
	grantsTraits?: TraitId[]
	/** One extra Duty Officer slot, optionally trait-restricted (rules/08
	 *  `promote`). `traits` restricts the slot to
	 *  a PERSON with any of them (1BUR06: SCIENTIST/ENGINEER,
	 *  1PER01: STARFLEET); omitted = any PERSON (1PIC07,
	 *  1CAR05). See src/engine/dutyOfficers.ts. */
	dutyOfficerSlot?: { traits?: TraitId[] | undefined }
	/** ATTACK cards are barred for this seat (1PER01):
	 *  no card that prints an ATTACK operation may be played (incl. free play)
	 *  or promoted by this seat. */
	forbidsAttackCards?: boolean
	/** "Your {DIL} cannot be stolen" (1BUR03): a STEAL of
	 *  these resources from this seat takes nothing. */
	protectsFromSteal?: ResourceId[]
	/** "This ship cannot be warped" (1SIS03): the SOURCE card is
	 *  never offered to a WARP. */
	cannotBeWarped?: boolean
}

/** Registry: id -> hooks. State only ever stores `{ id, source }`. */
export const MODIFIERS: Record<string, RuleModifierHooks> = {
	'1BUR02': bur02Hooks(),
	// --- common-pass passive modifiers (todo/13 follow-up, docs-notes gap #1) ---
	// Every entry carries the OCR round-trip phrase; the ones with mechanical
	// hooks actually change hand size / send legality / scan-Junk. Per-card ids
	// so each describes against its own record text.
	'1ENC03': {
		describe:
			'Increase your hand size by 1. Whenever you scan, include cards in the Junk too.',
		handSize: (base) => base + 1,
		scanIncludesJunk: true,
	},
	'1PER09_HAND': {
		describe: 'Increase your hand size by 1.',
		handSize: (base) => base + 1,
	},
	'1KOL21_HAND': {
		describe: 'Increase your hand size by 1.',
		handSize: (base) => base + 1,
	},
	// 1KOL22 CLEAN-UP: one stacked copy per unspent action, gone once the
	// Clean-up draw is done (MODIFIER_ATTACH { stack: true }).
	TEMP_HAND_PLUS_1: {
		describe: 'temporarily increase your hand size by 1',
		handSize: (base) => base + 1,
		untilEndOfTurn: true,
	},
	// 1KOL03 / 1CAR03: MODIFIER_ATTACH
	// { id, target: $event.card } — the deployed SHIP counts as CLOAK until the
	// Clean-up REFRESH substep (or until it leaves play: source = the SHIP).
	TEMP_CLOAK: {
		describe: 'That SHIP also counts as CLOAK until your turn ends.',
		grantsTraits: ['CLOAK'],
		untilEndOfTurn: true,
	},
	'1PER23_HAND': {
		describe: 'Increase your hand size by 1.',
		handSize: (base) => base + 1,
	},
	// One more PERSON allowed on duty — an extra Duty
	// Officer slot (rules/08 `promote`), not a hand-size bonus.
	'1CAR05_DUTY': {
		describe: 'You may have an additional PERSON on duty.',
		dutyOfficerSlot: {},
	},
	'1PIC07_DUTY': {
		describe: 'You may have an additional PERSON on duty.',
		dutyOfficerSlot: {},
	},
	'1BUR06_DUTY': {
		describe:
			'You may have an additional PERSON with SCIENTIST or ENGINEER on duty.',
		dutyOfficerSlot: { traits: ['SCIENTIST', 'ENGINEER'] },
	},
	'1PER01_DUTY': {
		describe:
			'You cannot play or promote ATTACK cards. You may have one extra STARFLEET PERSON on duty.',
		dutyOfficerSlot: { traits: ['STARFLEET'] },
		forbidsAttackCards: true,
	},
	'1SIS09_HAND': {
		describe: 'Increase your hand size by 2.',
		handSize: (base) => base + 2,
	},
	'1BUR08_HAND': {
		describe:
			'Increase your hand size by 1 per RESEARCH, INFLUENCE or MILITARY at 5+.',
		handSize: (base, state, seat) =>
			base +
			(['RESEARCH', 'INFLUENCE', 'MILITARY'] as const).filter(
				(sp) => player(state, seat).specialties[sp] >= 5,
			).length,
	},
	'1BUR10_BLOCK': {
		describe: 'You cannot send an AWAY TEAM here.',
		blockSendsHere: true,
	},
	'1PIC05_BLOCK': {
		describe:
			'You ignore all opponent SHIPs when sending an AWAY TEAM to a neutral LOCATION.',
		ignoreOpponentShips: true,
	},
	// 1BUR12: describe-only — the counting lives on the card's
	// SKILL_VARIABLE `variableSkill.counts` (src/engine/queries/counting.ts).
	'1BUR12_ICONS': {
		describe:
			'Per VULCAN you have in play, this card gets 1 RESEARCH Skill; per AMBASSADOR, 1 INFLUENCE Skill; per ROMULAN, 1 MILITARY Skill (traits on this card count too).',
	},
	// describe-only halves of rules that live elsewhere: 1BUR02 INERT
	// DILITHIUM's hand-size and Glory-substitution passives are hooks of the
	// 1BUR02 layer; 1BUR20 wild skills are her two
	// SKILL_ANY icons.
	'1BUR02_HAND': { describe: 'Increase your hand size by 1.' },
	'1BUR02_NO_GLORY_AS_DIL': {
		describe: 'You cannot spend {GLO} as {DIL}.',
	},
	'1BUR20_WILD_SKILLS': { describe: 'This card has 2 wild Skills.' },
	// 1ENC07: describe-only — the rule is the CardDef flag
	// `treatedAsLocation` (src/engine/cards.ts isLocationDef, DEPLOY).
	'1ENC07_LOCATION': {
		describe:
			'Counts as a LOCATION in every respect; deploying it takes control of a LOCATION.',
	},
	'1BUR03_NO_STEAL': {
		describe: 'Your {DIL} cannot be stolen.',
		protectsFromSteal: ['DIL'],
	},
	'1SIS03_NO_WARP': {
		describe: 'This ship cannot be warped.',
		cannotBeWarped: true,
	},
	'1BUR01_CLEANUP': {
		describe:
			'During your Clean-up step, remove 1 {GLO} from the Stardate card and place 2 {DIL} on a Market card instead.',
		cleanupGloryPlacement: (state) => ({
			k: 'SEQ',
			steps: [
				// mirrors 1BUR02's placement (rules/11 §11.6.1 #2) — Cadet
				// Training places just 1 DIL instead of 2 (rules/10 §10.3).
				{
					k: 'PLACE_RESOURCE_ON_MARKET',
					res: 'DIL',
					amount: state.mode === 'CADET' ? 1 : 2,
				},
			],
		}),
	},
}

function bur02Hooks(): RuleModifierHooks {
	return {
		describe:
			'Increase your hand size by 1. Place on this card any {DIL} you gain other than from the Market. You cannot spend that {DIL}. Glory cannot substitute for {DIL}. Stolen {DIL} is taken from this card first.',
		handSize: (base) => base + 1,
		onGainResource: (res, amount, ctx, source) => {
			if (res !== 'DIL') return null
			// Rule 3: DIL gained via an operation goes onto the Status card; the
			// Market exception (rule 9 / §11.6.1 #3) and steals (rule 8) flow normally.
			if (ctx.via !== 'OPERATION') return null
			return { to: source, amount }
		},
		canSubstituteGlory: (target) => target !== 'DIL',
		onStolenFrom: (res, amount, source, state, seat) => {
			if (res !== 'DIL') return []
			const s = state.cards[source]
			const parked = s?.resourceTokens?.DIL ?? 0
			if (parked <= 0) return []
			void seat
			return [{ iid: source, amount: Math.min(amount, parked) }]
		},
		cleanupGloryPlacement: (state) => ({
			k: 'SEQ',
			steps: [
				// "remove 1 Glory from the current Stardate card" is handled by the
				// Clean-up step itself; this hook only replaces the Glory-on-Market
				// placement with the DIL-from-supply placement (rules/11 §11.6.1 #2).
				// Cadet Training places just 1 DIL instead of 2 (rules/10 §10.3).
				{
					k: 'PLACE_RESOURCE_ON_MARKET',
					res: 'DIL',
					amount: state.mode === 'CADET' ? 1 : 2,
				},
			],
		}),
	}
}

// ---------------------------------------------------------------------------
// The active set: attached layers ∪ in-play passive declarations
// ---------------------------------------------------------------------------

/** Every rule-modifier entry active for `seat`: the player's attached layers
 *  (Status cards / MODIFIER_ATTACH) plus the always-on `passives` declared by
 *  their in-play cards. Stateless — computed on demand, so a card leaving
 *  play just stops contributing, no detach bookkeeping needed.
 *
 *  A declared passive is a table operation (rules/03 §3.5.5): it counts only
 *  while its card's table operations are available (not in Staging, not
 *  beamed — a PERSON only as Duty Officer), and only while the declaring
 *  PASSIVE operation's `requires` threshold is met ("Passive [mil3]", FORCED
 *  SINGULARITY) — re-evaluated on every read. */
export function activeModifiers(
	state: GameState,
	seat: Seat,
): { id: string; source: CardInstanceId }[] {
	const p = player(state, seat)
	const out: { id: string; source: CardInstanceId }[] = [...p.modifiers]
	// the official solo Bot ignores its cards' text: only attached layers count
	if (isSoloBot(state, seat)) return out
	for (const iid of inPlayCards(state, seat)) {
		const card = state.cards[iid]!
		const def = cardDef(card.def)
		if (def.passives === undefined) continue
		if (!zoneProps(card.zone).tableOps) continue
		for (const id of def.passives) {
			if (!passiveRequirementMet(p, def.operations, id)) continue
			if (!out.some((m) => m.id === id && m.source === iid))
				out.push({ id, source: iid })
		}
	}
	return out
}

/** The specialty gate of the PASSIVE operation that declares modifier `id`
 *  (its MODIFIER_ATTACH { id } effect). No such operation, or no `requires`,
 *  means always on. */
function passiveRequirementMet(
	p: ReturnType<typeof player>,
	operations: Operation[],
	id: string,
): boolean {
	const op = operations.find(
		(o) =>
			o.type === 'PASSIVE' &&
			o.effect.k === 'MODIFIER_ATTACH' &&
			o.effect.id === id,
	)
	if (op?.requires === undefined) return true
	return p.specialties[op.requires.specialty] >= op.requires.min
}

/** The hooks for one active entry (missing ids are inert by design). */
function hooksOf(entry: {
	id: string
	source: CardInstanceId
}): RuleModifierHooks {
	return MODIFIERS[entry.id] ?? {}
}

/** Traits granted to card `iid` by attached layers of EITHER player whose
 *  source is that card (MODIFIER_ATTACH { target } — the temporary CLOAK grant).
 *  Only attached layers count: a card's own declared `passives` never grant
 *  traits. Cheap (two short arrays) — it sits under every trait check. */
export function grantedTraits(
	state: GameState,
	iid: CardInstanceId,
): TraitId[] {
	let out: TraitId[] | undefined
	for (const p of state.players) {
		for (const m of p.modifiers) {
			if (m.source !== iid) continue
			const g = MODIFIERS[m.id]?.grantsTraits
			if (g === undefined) continue
			out = [...(out ?? []), ...g]
		}
	}
	return out ?? []
}

/** Drop every `untilEndOfTurn` layer from `seat` (Clean-up REFRESH calls it
 *  for both seats). */
export function dropTurnModifiers(state: GameState, seat: Seat): GameState {
	const p = player(state, seat)
	const kept = p.modifiers.filter(
		(m) => MODIFIERS[m.id]?.untilEndOfTurn !== true,
	)
	if (kept.length === p.modifiers.length) return state
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, modifiers: kept } : pl,
	) as GameState['players']
	return { ...state, players }
}

/** Resolve the effective hand size for a player (rules/11 §11.6.1 #1). */
export function effectiveHandSize(state: GameState, seat: Seat): number {
	let size = player(state, seat).handSize
	for (const m of activeModifiers(state, seat)) {
		const hook = hooksOf(m).handSize
		if (hook) size = hook(size, state, seat)
	}
	return size
}

/** First redirect decision among the player's active modifiers, or null. */
export function gainRedirect(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
	ctx: GainCtx,
): Redirect | null {
	for (const m of activeModifiers(state, seat)) {
		const hook = hooksOf(m).onGainResource
		if (!hook) continue
		const r = hook(res, amount, ctx, m.source)
		if (r !== null) return r
	}
	return null
}

/** May Glory be spent as `target`? Default 1 GLO = 1 LAT / 2 DIL; modifiers
 *  can only narrow it (1BUR02 disables the DIL rate). */
export function canSubstituteGlory(
	state: GameState,
	seat: Seat,
	target: ResourceId,
): boolean {
	let allowed = target === 'DIL' || target === 'LAT'
	for (const m of activeModifiers(state, seat)) {
		const hook = hooksOf(m).canSubstituteGlory
		if (!hook) continue
		allowed = allowed && hook(target)
	}
	return allowed
}

/** Parked sources a steal of `res` must tap first (in modifier order). */
export function stolenSources(
	state: GameState,
	seat: Seat,
	res: ResourceId,
	amount: number,
): StealSource[] {
	const out: StealSource[] = []
	for (const m of activeModifiers(state, seat)) {
		const hook = hooksOf(m).onStolenFrom
		if (!hook) continue
		out.push(...hook(res, amount, m.source, state, seat))
	}
	return out
}

/** The Clean-up Glory replacement effect for `seat`, if a modifier overrides it. */
export function cleanupGloryEffect(
	state: GameState,
	seat: Seat,
): Effect | null {
	for (const m of activeModifiers(state, seat)) {
		const hook = hooksOf(m).cleanupGloryPlacement
		if (hook) return hook(state, seat)
	}
	return null
}

/** Does any active modifier of `seat` ignore opponent SHIP tokens when
 *  blocking Away-Team sends (1PIC05)? */
export function ignoresOpponentShips(state: GameState, seat: Seat): boolean {
	return activeModifiers(state, seat).some(
		(m) => hooksOf(m).ignoreOpponentShips === true,
	)
}

/** Does scanning/Market-gaining include the Junk for `seat` (1ENC03)? */
export function scanIncludesJunk(state: GameState, seat: Seat): boolean {
	return activeModifiers(state, seat).some(
		(m) => hooksOf(m).scanIncludesJunk === true,
	)
}

/** May an Away Team be sent to `locIid` at all? The Location's own passive
 *  modifiers can forbid it outright (1BUR10 "you cannot send
 *  here"). Returned false is a hard block, true/null means "no opinion". */
export function blocksSendsTo(
	state: GameState,
	locIid: CardInstanceId,
): boolean {
	const loc = state.cards[locIid]
	if (loc === undefined) return false
	const def = cardDef(loc.def)
	if (def.passives === undefined) return false
	return def.passives.some((id) => MODIFIERS[id]?.blockSendsHere === true)
}

/** The describe() phrase for a modifier id (fidelity round-trip). Unknown ids
 *  fall back to a parenthetical so describe stays total. */
export function describeModifier(id: string): string | undefined {
	return MODIFIERS[id]?.describe
}

/** Extra Duty Officer slots granted by `seat`'s active modifiers (one per
 *  entry; `traits` restricts that slot — rules/08 `promote`). */
export function extraDutyOfficerSlots(
	state: GameState,
	seat: Seat,
): { traits?: TraitId[] | undefined }[] {
	const out: { traits?: TraitId[] | undefined }[] = []
	for (const m of activeModifiers(state, seat)) {
		const slot = hooksOf(m).dutyOfficerSlot
		if (slot !== undefined) out.push(slot)
	}
	return out
}

/** Is `seat` barred from playing/promoting cards with ATTACK (1PER01)? */
export function forbidsAttackCards(state: GameState, seat: Seat): boolean {
	return activeModifiers(state, seat).some(
		(m) => hooksOf(m).forbidsAttackCards === true,
	)
}

/** Is `seat`'s `res` protected from STEAL (1BUR03)? */
export function stealProtected(
	state: GameState,
	seat: Seat,
	res: ResourceId,
): boolean {
	return activeModifiers(state, seat).some(
		(m) => hooksOf(m).protectsFromSteal?.includes(res) === true,
	)
}

/** May card `iid` not be warped (1SIS03 — its own passive)? */
export function cannotBeWarped(state: GameState, iid: CardInstanceId): boolean {
	const owner = state.cards[iid]?.owner
	if (owner === undefined || owner === null) return false
	return activeModifiers(state, owner).some(
		(m) => m.source === iid && hooksOf(m).cannotBeWarped === true,
	)
}
