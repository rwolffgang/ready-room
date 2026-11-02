// Resolver-side pending-choice surface (todo/04, formalised by todo/07):
//   1. `PendingChoice` — the JSON union the effect stack halts on
//      (docs/state-machine.md §4); every variant carries `id`, `seat`,
//      `prompt` and `sourceCard` (todo/07 §1), and is plain serialisable data
//      — no functions, no closures. The UI renders this union directly
//      (`src/engine/choiceUi.ts` keeps the type-level contract exported from
//      `src/engine/index.ts`).
//   2. `validateChoice(state, choiceId, selection)` — a PURE validator
//      ("never trust the client"): deterministically accepts or rejects a raw
//      selection with a human reason, without mutating state.
//   3. `applyChoice(state, intent)` — the RESOLVE_CHOICE resume flow: runs
//      `validateChoice`, then writes the selection into the suspended frame's
//      `ctx.bindings[choiceId]` so the primitive resumes, clearing
//      `pendingChoice`.
//   4. `probeFirstChoice(state)` — probe mode ("does at least one legal
//      selection exist?"): pick the FIRST legal selection without halting,
//      hard-filtering disabled options/candidates.
//
// Selections are stored in bindings (JSON), so a mid-effect
// serialise/deserialise round-trip preserves them — see stack.test.ts.

import type { GameState, JsonValue, EffectCtx } from '../state'
import type { CardInstanceId } from '../ids'
import type { AcRowRef, OperationRef } from '../state'
import type { MarketSuit, SpecialtyId, TraitId } from '../../data/ids'
import type { Seat } from './queries'

/** One row of a CHOOSE_OPTION / CHOOSE_DESTINATION panel: label, whether the
 *  option is selectable right now, and (when disabled) why — so the UI greys
 *  it with a tooltip instead of hiding it (todo/07 §5, rules/12 §12.12). */
export interface ChoiceOption {
	key: string
	label: string
	enabled: boolean
	reason?: string | undefined
	/** The option is this card's operation (pick which PLAY to free play, which
	 *  operation to duplicate): the UI shows the card and the printed text. */
	op?: { card: CardInstanceId; opIndex: number } | undefined
}

/** A candidate that *looks* eligible but is not a legal target (shown greyed
 *  with `reason` as its tooltip — todo/07 §5). */
export interface ChoiceDisabledCard {
	iid: CardInstanceId
	reason: string
}

/** CHOOSE_CARDS payload. Anything in `disabled` is deliberately NOT selectable
 *  but is surfaced so the player sees why (todo/07 §5). A disabled card may
 *  also be listed in `candidates` (JUNK lists every Market offer), so readers
 *  filter `candidates` by `disabled` and show the union once. */
export interface ChoiceCardsContext {
	candidates: CardInstanceId[]
	disabled?: ChoiceDisabledCard[] | undefined
	/** Face-down candidates — present only to be picked (e.g. "top of the PERSON
	 *  deck (unknown)"); selectable but the UI must not reveal their faces.
	 *  Purely a presentation hint — validation/probe treat them as legal. */
	hidden?: CardInstanceId[] | undefined
	min: number
	max: number
	/** Zone serialisation shown in the choice (validation bookkeeping). */
	from: string
	/** True when an empty selection is meaningful ("may discard any", or the
	 *  decline of a "you may" asked without a CONFIRM): it is accepted even
	 *  below `min`. */
	optional?: boolean | undefined
}

export interface ChoiceBase {
	id: string
	seat: Seat
	prompt: string
	/** The card whose effect caused the choice, or null for phase-level prompts
	 *  (todo/07 §1). Stamped by suspend()/phaseSuspend() from ctx.source. */
	sourceCard: CardInstanceId | null
	/** Def id of sourceCard at the moment of the choice, so the UI can still name
	 *  it after the card has left play face-down (e.g. an Incident returned to
	 *  its deck mid-effect). A played card is public, so this leaks nothing. */
	sourceDef?: string | undefined
	/** Index of the sourceCard's printed operation that is resolving, so the UI
	 *  can say why the choice is asked and what it pays for. Absent for
	 *  phase-level prompts and granted (ALT_PLAY) operations. */
	sourceOp?: number | undefined
	/** The solo Bot's Automated Command row resolving sourceCard instead of
	 *  its printed text (rules/13 §13.6) — then there is no sourceOp. */
	sourceRow?: AcRowRef | undefined
	/** This prompt is the whole "you may …" (may.ts asked no CONFIRM): its
	 *  `declineSelection` — the empty pick, Skip or Decline — declines the
	 *  optional effect, and a "decline everything optional" policy answers it. */
	mayDecline?: true | undefined
}

/** What accepting a "you may …" (a CONFIRM) would act on: the cards it picks
 *  from and, for a move onto a card (a beam), the cards it may go onto. A
 *  list of one is taken without asking, so the CONFIRM is the only place the
 *  player sees it. Shown like CHOOSE_CARDS candidates (projection.ts). */
export interface ChoicePreview {
	cards: CardInstanceId[]
	onto?: CardInstanceId[] | undefined
}

/** Sentinel candidate of a CHOOSE_LOCATION that may be declined — the
 *  Control Step's take-control (rules/03 §3.4) and a "you may" warp, send or
 *  remove an Away Team asked without a CONFIRM. The UI shows it as a Skip
 *  button. */
export const SKIP_LOCATION = '__SKIP__' as CardInstanceId

/** Option key of the Decline row a "you may choose one" adds to its
 *  CHOOSE_OPTION when it asks no CONFIRM (chooseOne.ts). */
export const DECLINE_OPTION = '__DECLINE__'

/** The selection that declines a `mayDecline` prompt, or undefined for a
 *  choice that is not one. */
export function declineSelection(choice: PendingChoice): JsonValue | undefined {
	if (choice.mayDecline !== true) return undefined
	switch (choice.k) {
		case 'CHOOSE_CARDS':
			return []
		case 'CHOOSE_OPTION':
			return { key: DECLINE_OPTION }
		case 'CHOOSE_LOCATION':
			return SKIP_LOCATION
		default:
			return undefined
	}
}

export type PendingChoice =
	| (ChoiceBase & { k: 'CONFIRM'; preview?: ChoicePreview | undefined })
	| (ChoiceBase & { k: 'CHOOSE_OPTION'; options: ChoiceOption[] })
	| (ChoiceBase & { k: 'CHOOSE_CARDS' } & ChoiceCardsContext)
	| (ChoiceBase & { k: 'CHOOSE_LOCATION'; candidates: CardInstanceId[] })
	| (ChoiceBase & { k: 'CHOOSE_SUIT'; suits: MarketSuit[] })
	| (ChoiceBase & { k: 'CHOOSE_TRAIT'; traits: TraitId[] })
	| (ChoiceBase & {
			k: 'CHOOSE_SPECIALTY'
			specialties: SpecialtyId[]
			/** how far each offered track would advance (after the clamp at 15) */
			gains?: Partial<Record<SpecialtyId, number>> | undefined
	  })
	| (ChoiceBase & {
			k: 'CHOOSE_DESTINATION'
			card: CardInstanceId
			options: ('DECK_TOP' | 'DISCARD')[]
	  })
	| (ChoiceBase & { k: 'CHOOSE_AMOUNT'; min: number; max: number })
	| (ChoiceBase & { k: 'ORDER_OPERATIONS'; pending: OperationRef[] })
	| (ChoiceBase & { k: 'OPTIONAL_TRIGGERS'; offered: OperationRef[] })
	| (ChoiceBase & { k: 'CHOOSE_WITNESS'; sets: CardInstanceId[][] })
	| (ChoiceBase & {
			k: 'CHOOSE_WILDCARD_AS'
			card: CardInstanceId
			traits: TraitId[]
	  })
	| (ChoiceBase & { k: 'ORDER_CARDS'; cards: CardInstanceId[] })

/** The choiceId the UI reports back inside a RESOLVE_CHOICE intent. */
export interface ResolveChoiceIntent {
	t: 'RESOLVE_CHOICE'
	choiceId: string
	selection: unknown
}

/**
 * Distributive omit: keeps the per-variant keys of a union. A plain
 * `Omit<PendingChoice, 'id' | 'seat'>` collapses to the keys common to every
 * variant (k/id/seat/prompt), which is why `ChoiceSeed` cannot be spelled that
 * way. This is the seam todo/07 formalises.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never

/** A PendingChoice without the auto-filled `id`/`seat`/`sourceCard` — what
 *  primitives hand to `suspend()`, which stamps `id` (deterministic,
 *  RNG-derived), `seat = ctx.actor` (rules/12 §12.14 choice ownership) and
 *  `sourceCard = ctx.source`. */
export type ChoiceSeed = DistributiveOmit<
	PendingChoice,
	'id' | 'seat' | 'sourceCard' | 'sourceDef' | 'sourceOp' | 'sourceRow'
>

/** Result of the pure selection validator (todo/07 DoD). */
export type ValidateResult =
	{ ok: true; value: JsonValue } | { ok: false; reason: string }

/**
 * A typed, assertable error for an illegal RESOLVE_CHOICE selection — so
 * todo/16 can catch it and surface `reason` to the player. Never thrown
 * mid-effect on a legal selection; validateChoice is the pure gate.
 */
export class IllegalSelectionError extends Error {
	readonly reason: string
	constructor(reason: string) {
		super(`IllegalSelectionError: ${reason}`)
		this.name = 'IllegalSelectionError'
		this.reason = reason
	}
}

// ---------------------------------------------------------------------------
// Selection validation (never trust the client)
// ---------------------------------------------------------------------------

/**
 * Pure, per-choice validation (todo/07 DoD; docs/state-machine.md §4 "Never
 * trust the client"). Accepts a legal raw selection — `{ ok: true; value }`
 * — or rejects it with a human-readable `reason`. Deterministic and side-effect
 * free: it reads only `choice`/`selection` and never mutates state.
 */
export function checkSelection(
	choice: PendingChoice,
	selection: unknown,
): ValidateResult {
	switch (choice.k) {
		case 'CONFIRM':
			if (selection !== true && selection !== false) {
				return {
					ok: false,
					reason: `CONFIRM: selection must be a boolean, got ${JSON.stringify(selection)}`,
				}
			}
			return { ok: true, value: selection }
		case 'CHOOSE_OPTION': {
			const s = selection as { key?: unknown } | null
			const key = s?.key
			if (typeof key !== 'string')
				return { ok: false, reason: `CHOOSE_OPTION: selection must be { key }` }
			const opt = choice.options.find((o) => o.key === key)
			if (!opt)
				return { ok: false, reason: `CHOOSE_OPTION: unknown option ${key}` }
			if (!opt.enabled)
				return {
					ok: false,
					reason: `CHOOSE_OPTION: option ${key} is not enabled`,
				}
			return { ok: true, value: { key } }
		}
		case 'CHOOSE_CARDS': {
			if (!Array.isArray(selection))
				return { ok: false, reason: 'CHOOSE_CARDS: selection must be an array' }
			const iids = selection as CardInstanceId[]
			const declined = iids.length === 0 && choice.optional === true
			if (!declined && (iids.length < choice.min || iids.length > choice.max)) {
				return {
					ok: false,
					reason: `CHOOSE_CARDS: need ${choice.min}..${choice.max} cards, got ${iids.length}`,
				}
			}
			const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
			for (const iid of iids) {
				if (!choice.candidates.includes(iid)) {
					return {
						ok: false,
						reason: `CHOOSE_CARDS: ${iid} is not a candidate`,
					}
				}
				// "card not where its enabled flag claims": a candidate the resolver
				// deliberately marked disabled (greyed with a reason) is never a legal
				// target — rules/12 §12.12 (WILDCARD opt-in) and todo/07 §5.
				if (disabled.has(iid)) {
					return {
						ok: false,
						reason: `CHOOSE_CARDS: ${iid} is not a legal target`,
					}
				}
			}
			if (new Set(iids).size !== iids.length) {
				return { ok: false, reason: 'CHOOSE_CARDS: duplicate selections' }
			}
			return { ok: true, value: iids as JsonValue }
		}
		case 'CHOOSE_LOCATION': {
			if (
				typeof selection !== 'string' ||
				!choice.candidates.includes(selection as CardInstanceId)
			) {
				return { ok: false, reason: 'CHOOSE_LOCATION: must pick a candidate' }
			}
			return { ok: true, value: selection }
		}
		case 'CHOOSE_SUIT':
			if (
				typeof selection !== 'string' ||
				!choice.suits.includes(selection as MarketSuit)
			) {
				return {
					ok: false,
					reason: 'CHOOSE_SUIT: must pick one of the offered suits',
				}
			}
			return { ok: true, value: selection }
		case 'CHOOSE_TRAIT':
			if (
				typeof selection !== 'string' ||
				!choice.traits.includes(selection as TraitId)
			) {
				return {
					ok: false,
					reason: 'CHOOSE_TRAIT: must pick one of the offered traits',
				}
			}
			return { ok: true, value: selection }
		case 'CHOOSE_SPECIALTY':
			if (
				typeof selection !== 'string' ||
				!choice.specialties.includes(selection as SpecialtyId)
			) {
				return {
					ok: false,
					reason: 'CHOOSE_SPECIALTY: must pick one of the offered specialties',
				}
			}
			return { ok: true, value: selection }
		case 'CHOOSE_DESTINATION':
			if (
				typeof selection !== 'string' ||
				!choice.options.includes(selection as 'DECK_TOP' | 'DISCARD')
			) {
				return {
					ok: false,
					reason: `CHOOSE_DESTINATION: must pick one of ${choice.options.join('/')}`,
				}
			}
			return { ok: true, value: selection }
		case 'CHOOSE_AMOUNT':
			if (typeof selection !== 'number' || !Number.isInteger(selection)) {
				return { ok: false, reason: 'CHOOSE_AMOUNT: must be an integer' }
			}
			if (selection < choice.min || selection > choice.max) {
				return {
					ok: false,
					reason: `CHOOSE_AMOUNT: ${selection} outside ${choice.min}..${choice.max}`,
				}
			}
			return { ok: true, value: selection }
		case 'ORDER_OPERATIONS':
		case 'OPTIONAL_TRIGGERS': {
			const offered =
				choice.k === 'ORDER_OPERATIONS' ? choice.pending : choice.offered
			if (!Array.isArray(selection))
				return { ok: false, reason: `${choice.k}: selection must be an array` }
			const refs = selection as OperationRef[]
			const check = (ref: OperationRef) =>
				typeof ref?.card === 'string' && typeof ref.opIndex === 'number'
			if (refs.some((r) => !check(r)))
				return { ok: false, reason: `${choice.k}: malformed operation refs` }
			for (const ref of refs) {
				if (
					!offered.some((p) => p.card === ref.card && p.opIndex === ref.opIndex)
				) {
					return {
						ok: false,
						reason: `${choice.k}: ${ref.card}#${ref.opIndex} not in pending list`,
					}
				}
			}
			if (
				new Set(refs.map((r) => `${r.card}#${r.opIndex}`)).size !== refs.length
			) {
				return { ok: false, reason: `${choice.k}: duplicates in ordering` }
			}
			return { ok: true, value: refs as unknown as JsonValue }
		}
		case 'CHOOSE_WITNESS': {
			if (!Array.isArray(selection))
				return {
					ok: false,
					reason: 'CHOOSE_WITNESS: selection must be an array',
				}
			const set = choice.sets.find(
				(s) =>
					(selection as unknown[]).length === s.length &&
					(selection as unknown[]).every((x) =>
						s.includes(x as CardInstanceId),
					),
			)
			if (!set)
				return {
					ok: false,
					reason:
						'CHOOSE_WITNESS: selection is not one of the offered witness sets',
				}
			return { ok: true, value: selection as JsonValue }
		}
		case 'CHOOSE_WILDCARD_AS': {
			if (
				typeof selection !== 'string' ||
				!choice.traits.includes(selection as TraitId)
			) {
				return {
					ok: false,
					reason: `CHOOSE_WILDCARD_AS: must pick one of ${choice.traits.join('/')}`,
				}
			}
			return { ok: true, value: selection }
		}
		case 'ORDER_CARDS': {
			if (!Array.isArray(selection))
				return { ok: false, reason: 'ORDER_CARDS: selection must be an array' }
			const iids = selection as CardInstanceId[]
			if (iids.length !== choice.cards.length)
				return { ok: false, reason: 'ORDER_CARDS: wrong length' }
			for (const iid of iids) {
				if (!choice.cards.includes(iid))
					return { ok: false, reason: `ORDER_CARDS: ${iid} not in the list` }
			}
			if (new Set(iids).size !== iids.length)
				return { ok: false, reason: 'ORDER_CARDS: duplicates' }
			return { ok: true, value: iids as JsonValue }
		}
	}
}

/**
 * Pure entry point for RESOLVE_CHOICE (todo/07 DoD): validates a raw selection
 * against the CURRENT published choice, keyed by choiceId. Rejects a missing/
 * stale choiceId, an out-of-set candidate, a cardinality violation, a
 * disabled target, or a malformed selection — each with a distinct reason.
 * Never mutates state.
 */
export function validateChoice(
	state: GameState,
	choiceId: string,
	selection: unknown,
): ValidateResult {
	const pending = state.pendingChoice
	if (pending === null)
		return { ok: false, reason: 'RESOLVE_CHOICE: no pending choice' }
	if (pending.id !== choiceId) {
		return {
			ok: false,
			reason: `RESOLVE_CHOICE: choice id mismatch (${pending.id} vs ${choiceId})`,
		}
	}
	return checkSelection(pending, selection)
}

/**
 * Throwing sibling of checkSelection for probe/internal callers that need the
 * validated value back. Illegal selections throw the typed IllegalSelectionError
 * so todo/16 can assert on it; the pure gate remains checkSelection.
 */
export function validateSelection(
	choice: PendingChoice,
	selection: unknown,
): JsonValue {
	const v = checkSelection(choice, selection)
	if (!v.ok) throw new IllegalSelectionError(v.reason)
	return v.value
}

// ---------------------------------------------------------------------------
// Storing a selection back into the suspended frame
// ---------------------------------------------------------------------------

/** The bindings map a frame publishes choice answers in (suspend() writes the
 *  `key → choiceId` link into it; answered selections land at `[choiceId]`). */
function frameBindings(
	f: GameState['stack'][number],
): Record<string, JsonValue> | undefined {
	if (f.k === 'REACTION_WINDOW') return f.bindings
	if (f.k === 'PHASE_STEP') return f.ctx?.bindings
	if (f.k === 'EFFECT' || f.k === 'OPERATION') return f.ctx.bindings
	return undefined
}

function storeSelection(
	state: GameState,
	choiceId: string,
	selection: JsonValue,
): GameState {
	const stack = state.stack
	if (stack.length === 0)
		throw new Error(`RESOLVE_CHOICE: no frame to resume (${choiceId})`)
	// A choice's answer must land on the frame that ASKED it, not the top of
	// stack. `run()` drains the event queue even after the primitive that
	// suspended the choice, so a REACTION_WINDOW (or a chained PASSIVE) can sit
	// above the suspended EFFECT frame while its choice is still pending — the
	// window's top frame does not own the answer. Every publisher leaves an
	// ownership trail: suspend()/phaseSuspend() write a `key → choiceId`
	// binding into the publishing ctx, and REACTION_WINDOW carries the
	// OPTIONAL_TRIGGERS id in `frame.choiceId`. Search the stack top-down for
	// it, falling back to the top frame (the pre-window behaviour, e.g. a bare
	// phase step that owns its own choice). REACTION_WINDOW answers keep
	// landing in the window, exactly as before (todo/09).
	let idx = -1
	for (let i = stack.length - 1; i >= 0; i--) {
		const f = stack[i]!
		if (f.k === 'REACTION_WINDOW' && f.choiceId === choiceId) {
			idx = i
			break
		}
		const bindings = frameBindings(f)
		if (bindings === undefined) continue
		if (
			bindings[choiceId] !== undefined ||
			Object.values(bindings).includes(choiceId as JsonValue)
		) {
			idx = i
			break
		}
	}
	if (idx < 0) idx = stack.length - 1
	const target = stack[idx]!
	if (target.k === 'REACTION_WINDOW') {
		// todo/09: an OPTIONAL_TRIGGERS answer (the chosen REACTION refs, in the
		// player's order, or [] to decline) lands in the window frame's bindings.
		const frames = stack.map((f) =>
			f === target
				? { ...f, bindings: { ...(f.bindings ?? {}), [choiceId]: selection } }
				: f,
		)
		return { ...state, stack: frames }
	}
	if (target.k === 'EMIT') {
		throw new Error(
			`RESOLVE_CHOICE: frame #${idx} (${target.k}) is not resumable (${choiceId})`,
		)
	}
	if (target.k === 'PHASE_STEP' && target.ctx === undefined) {
		throw new Error(
			`RESOLVE_CHOICE: frame #${idx} (${target.k}) is not resumable (${choiceId})`,
		)
	}
	// Copy, don't mutate: the shared ctx.bindings must never be written in
	// place (a mid-effect reduce would corrupt the caller's state and break
	// save→load→replay byte-exactness — determinism §5). Build one new ctx and
	// rewrite it on EVERY frame sharing the target's ctx object so sibling steps
	// of the same operation still see the answer (the sibling-visibility the
	// former in-place write bought), leaving the incoming state untouched.
	// Frames are grouped by their BINDINGS object, not their ctx object: a
	// control node that only tweaks the ctx (OPPONENT/FORCE flip the actor, an
	// accepted MAY marks its body optional) still shares the bindings with its
	// parent, and binds written after this answer must stay visible there
	// ("You may send an AWAY TEAM … If you do both" — 1BUR21).
	const targetCtx = target.ctx as EffectCtx
	const oldBindings = targetCtx.bindings
	const newBindings = { ...oldBindings, [choiceId]: selection }
	const ctxMap = new Map<EffectCtx, EffectCtx>()
	const frames = stack.map((f) => {
		if (f.k === 'REACTION_WINDOW' || f.k === 'EMIT') return f
		const ctx = f.ctx
		if (ctx === undefined || ctx.bindings !== oldBindings) return f
		let nc = ctxMap.get(ctx)
		if (nc === undefined) {
			nc = { ...ctx, bindings: newBindings }
			ctxMap.set(ctx, nc)
		}
		return { ...f, ctx: nc }
	})
	return { ...state, stack: frames }
}

/** Resume a pending choice from a RESOLVE_CHOICE intent. Runs the pure
 *  `validateChoice` gate first — an illegal selection throws a typed
 *  IllegalSelectionError with the reason BEFORE any mutation, so the input
 *  state is left byte-identical (todo/07 DoD). */
export function applyChoice(
	state: GameState,
	intent: ResolveChoiceIntent,
): GameState {
	const v = validateChoice(state, intent.choiceId, intent.selection)
	if (!v.ok) throw new IllegalSelectionError(v.reason)
	const choice: PendingChoice = state.pendingChoice as PendingChoice
	const selection = v.value
	let next = storeSelection(state, intent.choiceId, selection)
	// CHOOSE_WILDCARD_AS also records the declared substitution (rules/12 §12.12).
	if (choice.k === 'CHOOSE_WILDCARD_AS') {
		next = {
			...next,
			cards: {
				...next.cards,
				[choice.card]: {
					...next.cards[choice.card]!,
					wildcardAs: selection as TraitId,
				},
			},
		}
	}
	return { ...next, pendingChoice: null }
}

// ---------------------------------------------------------------------------
// Probe mode: first legal selection per choice kind (docs/state-machine.md §5)
// ---------------------------------------------------------------------------

/**
 * Probe mode resolves the pending choice as "does at least one valid selection
 * exist?" and picks one deterministically. CONFIRM declines (a "may" is
 * optional and never gates playability), and so does a "you may" asked
 * without one (`mayDecline`); amount choices take max; card choices take the
 * first min candidates.
 */
export function probeFirstChoice(state: GameState): GameState {
	const choice = state.pendingChoice
	if (!choice) return state
	let selection: JsonValue
	const decline = declineSelection(choice)
	if (decline !== undefined) selection = decline
	else
		switch (choice.k) {
			case 'CONFIRM':
				selection = false
				break
			case 'CHOOSE_OPTION': {
				const enabled = choice.options.find((o) => o.enabled)
				if (enabled === undefined) {
					// no enabled option at all → there is no legal choice; the probe
					// caller treats this as "cannot resolve".
					throw new Error(`probe: CHOOSE_OPTION with zero enabled options`)
				}
				selection = { key: enabled.key }
				break
			}
			case 'CHOOSE_CARDS': {
				// Probe hard-filters disabled candidates out of the "first legal"
				// selection — a greyed (disabled) target is deliberately not legal
				// (todo/07 §5, rules/12 §12.12).
				const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
				const legal = choice.candidates.filter((iid) => !disabled.has(iid))
				if (legal.length < choice.min) {
					throw new Error(
						`probe: CHOOSE_CARDS has ${legal.length} legal candidates (< min ${choice.min})`,
					)
				}
				selection = legal.slice(0, choice.min) as JsonValue
				break
			}
			case 'CHOOSE_LOCATION':
				selection = choice.candidates[0] as string
				break
			case 'CHOOSE_SUIT':
				selection = choice.suits[0] as string
				break
			case 'CHOOSE_TRAIT':
				selection = choice.traits[0] as string
				break
			case 'CHOOSE_SPECIALTY':
				// a LOWEST tie (1SIS22) offers only the tied tracks, not all three
				selection = choice.specialties[0] as string
				break
			case 'CHOOSE_DESTINATION':
				selection = choice.options[0] ?? 'DECK_TOP'
				break
			case 'CHOOSE_AMOUNT':
				selection = choice.max
				break
			case 'ORDER_OPERATIONS':
				selection = choice.pending as unknown as JsonValue
				break
			case 'OPTIONAL_TRIGGERS':
				selection = choice.offered as unknown as JsonValue
				break
			case 'CHOOSE_WITNESS':
				selection = choice.sets[0] as unknown as JsonValue
				break
			case 'CHOOSE_WILDCARD_AS':
				selection = choice.traits[0] as string
				break
			case 'ORDER_CARDS':
				selection = choice.cards as JsonValue
				break
		}
	const validated = validateSelection(choice, selection)
	const next = storeSelection(state, choice.id, validated)
	if (choice.k === 'CHOOSE_WILDCARD_AS') {
		return {
			...next,
			cards: {
				...next.cards,
				[choice.card]: {
					...next.cards[choice.card]!,
					wildcardAs: validated as TraitId,
				},
			},
			pendingChoice: null,
		}
	}
	return { ...next, pendingChoice: null }
}
