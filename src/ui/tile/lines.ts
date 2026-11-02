// Which operation lines a <CardTile> shows and what state each one is in
// (docs/ui-mobile.md §3). Pure: the component draws what this returns, and
// the tests pin it without a DOM.
//
// Two questions, kept apart:
//   1. Which lines are SHOWN depends on where the card is (`show: 'zone'`):
//      in play, PLAY / CONTROL / Development lines cannot fire again and are
//      hidden; in hand, table lines fade ("works once in play"); in the Market
//      and anywhere else, everything shows. The Rosetta detail asks for
//      `show: 'all'` and gets every line with the state it has from here.
//   2. The STATE of a line is legality for the viewer right now. A line is
//      lit iff the viewer's legal-intents list holds its intent —
//      {PLAY_CARD | ACTIVATE, iid, operationIndex} (ALT_PLAY grants carry
//      `via`). Locally that list is legalIntents on the real state; online it
//      comes with the server's seat view. Nothing here re-derives legality.
//
// Everything else reads the VIEW the viewer is shown (the projected state:
// zones, phase, active seat, the pending choice, exhausted flags). "Why not"
// reasons are an optional extra: when the client holds the real engine state
// (local play) they come from canPlay / canActivate on it; without one, a
// line that is not lit simply dims — or carries the turn's reason, which the
// view alone can tell (not your Action step, a choice is open).

import type { CardDef } from '../../data/schema'
import type { Operation } from '../../engine/resolver/nodes'
import type { GameState } from '../../engine/state'
import type { Intent } from '../../engine/intents'
import type { Seat, ZoneRef } from '../../engine/resolver/queries'
import type { CardInstanceId } from '../../engine/ids'
import {
	canActivate,
	canPlay,
	idleOperationReason,
	type CanPlayResult,
} from '../../engine/queries/legality'
import { altPlayOperation } from '../../engine/altPlay'
import { cardDef } from '../../engine/cards'
import {
	shorthandDevelopmentCost,
	shorthandOperation,
	type ShorthandLine,
} from '../../engine/shorthand'
import { describe, describeOperation } from '../../engine/describe'
import { withLiveValues } from '../../engine/shorthandLive'
import { cardName, withCardNames } from '../../data/cardNames'

/** Where a card sits, as far as its lines are concerned. */
export type TileContext =
	'hand' | 'play' | 'staging' | 'development' | 'market' | 'other'

/** lit: legal now (the line is the button) · dim: cannot run now, with a
 *  reason · later: a table line on a card in hand · done: resolved this turn
 *  (Staging) · na: not usable from here (detail view only) · plain: reads,
 *  does nothing to press. */
export type LineState = 'lit' | 'dim' | 'later' | 'done' | 'na' | 'plain'

export interface TileLine {
	key: string
	/** index into the def's operations; null for the Development cost */
	opIndex: number | null
	op: Operation | null
	line: ShorthandLine
	english: string | undefined
	state: LineState
	reason?: string | undefined
	/** the reason is the turn's, not the card's (not your Action step, a
	 *  choice is open): the tile only dims; the detail still says why */
	turnGated?: boolean | undefined
	/** the intent a lit line dispatches */
	intent?: Intent | undefined
	/** an ALT_PLAY grant: the name of the card that grants it */
	via?: string | undefined
	/** a lit line that would do nothing right now (idleOperationReason): the
	 *  part it would skip. The tile asks for a second tap before running it. */
	idle?: string | undefined
}

export interface TileLineInput {
	def: CardDef
	/** the live instance, or null for a bare def (catalog, Market preview) */
	iid: CardInstanceId | null
	/** what the viewer is shown (the projected state), or null with no game */
	view: GameState | null
	/** the viewer's legal intents right now: a line is lit iff its intent is
	 *  in this list */
	legal: readonly Intent[]
	viewer: Seat
	/** the real engine state when the client has one (local play) — only for
	 *  "why not" reasons; omit it and unlit lines dim without one */
	real?: GameState | null | undefined
	/** 'zone' filters by where the card is; 'all' is the detail view */
	show?: 'zone' | 'all' | undefined
}

export function contextOf(zone: ZoneRef | undefined): TileContext {
	if (zone === undefined) return 'market'
	switch (zone.k) {
		case 'HAND':
			return 'hand'
		case 'STAGING':
			return 'staging'
		case 'DEVELOPMENT':
			return 'development'
		case 'LOCATION_AREA':
		case 'FLEET':
		case 'DUTY_OFFICER':
		case 'CAPTAIN':
		case 'STATUS':
		case 'BEAMED':
			return 'play'
		case 'MARKET_OFFER':
		case 'NEUTRAL_ZONE':
			return 'market'
		default:
			return 'other'
	}
}

/** describe() English with its icon tokens spelled out, for screen readers
 *  (the detail view renders the tokens as icons instead). */
export function speakable(english: string): string {
	return english
		.replace(/\{ACTION\}\s*/g, 'Costs an action: ')
		.replace(/\{DIL\}/g, 'Dilithium')
		.replace(/\{LAT\}/g, 'Latinum')
		.replace(/\{GLO\}/g, 'Glory')
		.replace(/\[ATTACK\]\s*/g, 'Attack: ')
		.replace(/\[\[\s*([^\]]+?)\s*\]\]/g, '$1')
}

/** The desktop detail's turn gate (cards.tsx CardDetailHost): ACTION phase,
 *  the viewer is the active seat, no pending choice. Null when open. */
export function turnBlock(
	state: GameState,
	viewer: Seat,
	kind: 'PLAY' | 'ACTIVATION',
): string | null {
	if (state.result !== null) return 'The game is over'
	if (state.pendingChoice !== null) return 'Resolve the open choice first'
	if (state.phase.k !== 'ACTION')
		return kind === 'PLAY'
			? 'Cards are played in the Action step'
			: 'Activations only run in the Action step'
	if (state.activeSeat !== viewer) return 'Not your turn'
	return null
}

// ---------------------------------------------------------------------------
// Caches: compiled lines per def, canPlay per state
// ---------------------------------------------------------------------------

interface Compiled {
	opIndex: number | null
	op: Operation | null
	line: ShorthandLine
	english: string | undefined
}

const compiledCache = new WeakMap<CardDef, Compiled[]>()

function safeEnglish(op: Operation): string | undefined {
	try {
		return withCardNames(describeOperation(op))
	} catch {
		return undefined
	}
}

/** Every printed operation, then the Development cost, compiled once per
 *  def. A malformed tree drops its line rather than the tile. */
export function compiledLines(def: CardDef): Compiled[] {
	const hit = compiledCache.get(def)
	if (hit !== undefined) return hit
	const out: Compiled[] = []
	def.operations.forEach((op, i) => {
		try {
			out.push({
				opIndex: i,
				op,
				line: shorthandOperation(op),
				english: safeEnglish(op),
			})
		} catch {
			// unreadable operation: no line
		}
	})
	if (def.developmentCost !== null) {
		try {
			let english: string | undefined
			try {
				english = `Development cost: ${withCardNames(describe(def.developmentCost))}`
			} catch {
				english = undefined
			}
			out.push({
				opIndex: null,
				op: null,
				line: shorthandDevelopmentCost(def.developmentCost),
				english,
			})
		} catch {
			// unreadable cost: no line
		}
	}
	compiledCache.set(def, out)
	return out
}

const playCache = new WeakMap<GameState, Map<string, CanPlayResult>>()

/** canPlay for its reasons, memoised per (state object, seat, card): a tile,
 *  the dock chip and the detail ask the same question of the same state. */
export function canPlayCached(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): CanPlayResult {
	let m = playCache.get(state)
	if (m === undefined) {
		m = new Map()
		playCache.set(state, m)
	}
	const key = `${seat}:${iid}`
	const hit = m.get(key)
	if (hit !== undefined) return hit
	let r: CanPlayResult
	try {
		r = canPlay(state, seat, iid)
	} catch {
		r = {
			ok: false,
			operations: [],
			altPlays: [],
			reasons: ['this card def is unreadable'],
		}
	}
	m.set(key, r)
	return r
}

/** One reason per PLAY operation: canPlay lists a reason for each failing
 *  PLAY op in printed order, or a single card-level reason (not in hand,
 *  1PER01) that applies to all of them. */
function playReasons(def: CardDef, check: CanPlayResult): Map<number, string> {
	const failing = def.operations
		.map((op, i) => (op.type === 'PLAY' ? i : -1))
		.filter((i) => i >= 0 && !check.operations.includes(i))
	const out = new Map<number, string>()
	if (check.reasons.length === failing.length) {
		failing.forEach((i, k) => out.set(i, check.reasons[k]!))
	} else {
		const all = check.reasons.join('; ') || 'Not playable right now'
		for (const i of failing) out.set(i, all)
	}
	return out
}

/** idleOperationReason on the real state (local play only; online there is
 *  no engine state to probe, so no warning). */
function idleOf(
	real: GameState | null,
	seat: Seat,
	iid: CardInstanceId,
	opIndex: number,
): string | undefined {
	if (real === null) return undefined
	try {
		const reason = idleOperationReason(real, seat, iid, opIndex)
		return reason === null ? undefined : withCardNames(reason)
	} catch {
		return undefined
	}
}

function resolvedThisTurn(
	state: GameState,
	iid: CardInstanceId,
	opIndex: number,
): boolean {
	const r = state.resolvedOps
	if (r === undefined || r.turn !== state.turnNumber) return false
	return r.refs.some((ref) => ref.card === iid && ref.opIndex === opIndex)
}

// ---------------------------------------------------------------------------
// The lines
// ---------------------------------------------------------------------------

/** Why a line can never run from where the card is (state 'na'): in play,
 *  PLAY / CONTROL / Development lines are spent; a Development cost is paid
 *  only on enlisting. undefined: the line can matter here. */
export function notHereReason(
	ctx: TileContext,
	timing: ShorthandLine['timing'],
): string | undefined {
	switch (ctx) {
		case 'hand':
			return timing === 'DEVELOPMENT'
				? 'Paid only when enlisted from Development'
				: undefined
		case 'play':
			return timing === 'PLAY'
				? 'Already in play'
				: timing === 'CONTROL'
					? 'Resolved when control was taken'
					: timing === 'DEVELOPMENT'
						? 'Paid when it was enlisted'
						: undefined
		case 'staging':
			return timing === 'DEVELOPMENT' ? 'Paid when it was enlisted' : undefined
		default:
			return undefined
	}
}

/** Why a line has to wait for the card to move on (state 'later'): table
 *  lines on a card in hand or in Development, activations in the Staging
 *  Area. undefined: the line is not waiting on where the card is. */
export function laterReason(
	ctx: TileContext,
	timing: ShorthandLine['timing'],
): string | undefined {
	switch (ctx) {
		case 'hand':
			return timing === 'PLAY' || timing === 'DEVELOPMENT'
				? undefined
				: 'Works once this card is in play'
		case 'staging':
			return timing === 'ACTIVATION'
				? 'No table operations in the Staging Area'
				: undefined
		case 'development':
			return timing === 'DEVELOPMENT'
				? undefined
				: 'Works once enlisted and in play'
		default:
			return undefined
	}
}

/** Why the detail views fold a line away below the ones usable here: it
 *  never runs from this zone, or (in hand and the Staging Area) not before
 *  the card moves on. A card in Development keeps its lines open, since they
 *  are what you read before enlisting it. */
export function foldReason(
	ctx: TileContext,
	timing: ShorthandLine['timing'],
): string | undefined {
	return (
		notHereReason(ctx, timing) ??
		(ctx === 'development' ? undefined : laterReason(ctx, timing))
	)
}

function sameVia(
	a: { source: string; opIndex: number } | undefined,
	b: { source: string; opIndex: number } | undefined,
): boolean {
	return (
		(a?.source ?? null) === (b?.source ?? null) &&
		(a?.opIndex ?? null) === (b?.opIndex ?? null)
	)
}

/** The PLAY_CARD / ACTIVATE intent for one printed line, if it is legal. */
function litIntent(
	legal: readonly Intent[],
	t: 'PLAY_CARD' | 'ACTIVATE',
	iid: CardInstanceId,
	opIndex: number,
): Intent | undefined {
	return legal.find(
		(it) =>
			(it.t === 'PLAY_CARD' || it.t === 'ACTIVATE') &&
			it.t === t &&
			it.iid === iid &&
			it.operationIndex === opIndex &&
			(it.t !== 'PLAY_CARD' || it.via === undefined),
	)
}

export function tileLines(input: TileLineInput): TileLine[] {
	const { def, iid, view, legal, viewer } = input
	const real = input.real ?? null
	const show = input.show ?? 'zone'
	const card = iid !== null && view !== null ? view.cards[iid] : undefined
	const ctx: TileContext = card === undefined ? 'market' : contextOf(card.zone)
	const mine = card !== undefined && card.owner === viewer

	// reasons only: the real state's canPlay, when there is one to ask
	let reasons: Map<number, string> | null = null
	const playReason = (opIndex: number): string | undefined => {
		if (real === null || iid === null) return undefined
		if (reasons === null)
			reasons = playReasons(def, canPlayCached(real, viewer, iid))
		return reasons.get(opIndex)
	}

	// live values (docs/shorthand.md §5): counted amounts and conditions read
	// against the board — only with the real state, so an online view with
	// hidden cards never shows a guessed number. A Market card is read for
	// the viewer: what it would do for you.
	const liveSeat: Seat | null =
		real === null || iid === null
			? null
			: ((real.cards[iid]?.owner ?? viewer) as Seat)
	const withLive = (line: ShorthandLine): ShorthandLine => {
		if (liveSeat === null || iid === null || real === null) return line
		try {
			return withLiveValues(line, real, liveSeat, iid)
		} catch {
			return line
		}
	}

	const out: TileLine[] = []
	for (const c of compiledLines(def)) {
		const timing = c.line.timing
		const base = {
			key: c.opIndex === null ? 'dev' : `op${c.opIndex}`,
			opIndex: c.opIndex,
			op: c.op,
			line: withLive(c.line),
			english: c.english,
		}
		let st: LineState = 'plain'
		let reason: string | undefined
		let turnGated = false
		let intent: Intent | undefined
		let idle: string | undefined

		const na = notHereReason(ctx, timing)
		const later = na === undefined ? laterReason(ctx, timing) : undefined
		if (na !== undefined) {
			st = 'na'
			reason = na
		} else if (later !== undefined) {
			st = 'later'
			reason = later
		} else
			switch (ctx) {
				case 'hand':
					if (timing === 'PLAY') {
						if (!mine || view === null || iid === null || c.opIndex === null)
							break
						intent = litIntent(legal, 'PLAY_CARD', iid, c.opIndex)
						if (intent !== undefined) {
							st = 'lit'
							idle = idleOf(real, viewer, iid, c.opIndex)
							break
						}
						st = 'dim'
						const block = turnBlock(view, viewer, 'PLAY')
						if (block !== null) {
							reason = block
							turnGated = true
						} else reason = playReason(c.opIndex)
					}
					break
				case 'play':
					if (timing === 'ACTIVATION' && card !== undefined) {
						if (card.exhausted) {
							st = 'dim'
							reason = 'Exhausted until Clean-up'
							break
						}
						if (!mine || view === null || iid === null || c.opIndex === null)
							break
						intent = litIntent(legal, 'ACTIVATE', iid, c.opIndex)
						if (intent !== undefined) {
							st = 'lit'
							idle = idleOf(real, viewer, iid, c.opIndex)
							break
						}
						st = 'dim'
						const block = turnBlock(view, viewer, 'ACTIVATION')
						if (block !== null) {
							reason = block
							turnGated = true
						} else if (real !== null) {
							try {
								reason = canActivate(real, viewer, iid, c.opIndex).reason
							} catch {
								reason = undefined
							}
						}
					}
					break
				case 'staging':
					if (
						timing === 'PLAY' &&
						view !== null &&
						iid !== null &&
						c.opIndex !== null &&
						resolvedThisTurn(view, iid, c.opIndex)
					)
						st = 'done'
					break
				case 'development':
				case 'market':
				case 'other':
					break
			}

		if (show === 'zone' && st === 'na') continue
		out.push({
			...base,
			state: st,
			reason,
			intent,
			...(turnGated ? { turnGated } : {}),
			...(idle !== undefined ? { idle } : {}),
		})
	}

	// ALT_PLAY grants (1PIC08): extra ways to play a hand card,
	// each a PLAY_CARD intent carrying `via` in the legal list.
	if (ctx === 'hand' && mine && view !== null && iid !== null) {
		const seen: { source: string; opIndex: number }[] = []
		for (const it of legal) {
			if (it.t !== 'PLAY_CARD' || it.iid !== iid || it.via === undefined)
				continue
			const via = it.via
			if (seen.some((v) => sameVia(v, via))) continue
			seen.push(via)
			let op: Operation | null
			let line: ShorthandLine
			try {
				op = altPlayOperation(view, via)
				if (op === null) continue
				line = shorthandOperation(op)
			} catch {
				continue
			}
			const source = view.cards[via.source]
			let name: string | undefined
			try {
				name = source !== undefined ? cardName(cardDef(source.def)) : undefined
			} catch {
				name = undefined
			}
			out.push({
				key: `via:${via.source}#${via.opIndex}`,
				opIndex: it.operationIndex,
				op,
				line,
				english: safeEnglish(op),
				state: 'lit',
				intent: it,
				via: name,
			})
		}
	}

	// In hand the playable lines lead: the chip density shows only the first.
	if (ctx === 'hand' && show === 'zone') {
		const rank = (l: TileLine) => (l.state === 'later' ? 1 : 0)
		out.sort((a, b) => rank(a) - rank(b))
	}
	return out
}

/** True when an intent is currently offered by the store's legality list —
 *  the last gate before a tap dispatches (a stale tile must never throw). */
export function intentOffered(
	legal: readonly Intent[],
	intent: Intent,
): boolean {
	return legal.some((it) => {
		if (it.t !== intent.t) return false
		if (it.t === 'PLAY_CARD' && intent.t === 'PLAY_CARD')
			return (
				it.iid === intent.iid &&
				it.operationIndex === intent.operationIndex &&
				(it.via?.source ?? null) === (intent.via?.source ?? null) &&
				(it.via?.opIndex ?? null) === (intent.via?.opIndex ?? null)
			)
		if (it.t === 'ACTIVATE' && intent.t === 'ACTIVATE')
			return (
				it.iid === intent.iid && it.operationIndex === intent.operationIndex
			)
		return JSON.stringify(it) === JSON.stringify(intent)
	})
}
