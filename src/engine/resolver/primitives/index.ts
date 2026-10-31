// The primitive registry (todo/04 §2). One `Primitive` per Effect node kind.
// The mapped type below is exhaustive *by construction*: adding a node kind to
// the `Effect` union without a matching entry here fails `tsc` — the build
// refuses to silently forget a primitive (the DoD's core claim).
//
// Cross-cutting mechanics (suspension, picking, resources, fail-upward) live in
// ../runtime.ts; this file only dispatches. The `canResolveEffect` /
// `canPayAll` entry points are the cost pre-validation (§4) and CHOOSE_ONE
// option filtering (§6) API used by control nodes. Circular imports between
// this file and the per-node files are fine: the per-node files only reference
// `canResolveEffect`/`canPayAll` at call time, never at module-evaluation time.

import type { Effect } from '../nodes'
import type { ChoicePreview } from '../choices'
import type { GameState, EffectCtx, Frame } from '../../state'
import { otherSeat } from '../../state'
import {
	evalAmount,
	evalPredicate,
	resolveQuery,
} from '../../queries/resolveQuery'

import { seq } from './seq'
import { may } from './may'
import { beam } from './beam'
import { chooseOne } from './chooseOne'
import { payThen } from './payThen'
import { ifNode } from './ifNode'
import { repeat } from './repeat'
import { forEach } from './forEach'
import { letNode } from './letNode'
import { opponent } from './opponent'
import { reveal } from './reveal'
import { putOnDeckTop } from './putOnDeckTop'
import { noop } from './noop'
import { costResource } from './costResource'
import { costAction } from './costAction'
import { costDiscard } from './costDiscard'
import { costPut } from './costPut'
import { costExhaust } from './costExhaust'
import { costRefresh } from './costRefresh'
import { costRemoveAwayTeam } from './costRemoveAwayTeam'
import { costTakeIncident } from './costTakeIncident'
import { costDismiss } from './costDismiss'
import { costLogThis } from './costLogThis'
import { costRequire } from './costRequire'
import { costReturnIncident } from './costReturnIncident'
import { costRecall } from './costRecall'
import { costLog } from './costLog'
import { costBeam } from './costBeam'
import { deploy } from './deploy'
import { destroy } from './destroy'
import { discard } from './discard'
import { dismiss } from './dismiss'
import { draw } from './draw'
import { drawFromDiscard } from './drawFromDiscard'
import { recall } from './recall'
import { log } from './log'
import { promote } from './promote'
import { junk } from './junk'
import { putIntoStaging } from './putIntoStaging'
import { gainCard } from './gainCard'
import { scanN } from './scanN'
import { scanForTrait } from './scanForTrait'
import { take } from './take'
import { find } from './find'
import { select } from './select'
import { returnIncident } from './returnIncident'
import { enlistReserve } from './enlistReserve'
import { enlistDevelopment } from './enlistDevelopment'
import { gainResource } from './gainResource'
import { spendResource } from './spendResource'
import { steal } from './steal'
import { gainAction } from './gainAction'
import { advanceSpecialty } from './advanceSpecialty'
import { recrystallize } from './recrystallize'
import { sendAwayTeam } from './sendAwayTeam'
import { removeAwayTeam } from './removeAwayTeam'
import { warp } from './warp'
import { takeControl } from './takeControl'
import { triggerControl } from './triggerControl'
import { exhaust } from './exhaust'
import { refresh } from './refresh'
import { placeResourceOnMarket } from './placeResourceOnMarket'
import { wipeMarket } from './wipeMarket'
import { wipeNeutralZone } from './wipeNeutralZone'
import { drone } from './drone'
import { assimilate } from './assimilate'
import { removeStardateGlory } from './removeStardateGlory'
import { arrangeDeck } from './arrangeDeck'
import { ignoreAttack } from './ignoreAttack'
import { replaceGain } from './replaceGain'
import { freePlay } from './freePlay'
import { duplicate } from './duplicate'
import { force } from './force'
import { completeMission } from './completeMission'
import { modifierAttach } from './modifierAttach'
import { modifierDetach } from './modifierDetach'
import { altPlay } from './altPlay'
import { scoreVp } from './scoreVp'
import { script } from './script'
import { tryNode, able } from './tryNode'
import { attack } from './attack'
import { botDeck } from './botDeck'
import { botAcquire } from './botAcquire'
import { botJunk } from './botJunk'
import { botSendAwayTeam } from './botSendAwayTeam'
import { botDeploy } from './botDeploy'
import { botPromote } from './botPromote'
import { botResolve } from './botResolve'
import { botTakeControl } from './botTakeControl'
import { botRemoveAwayTeam } from './botRemoveAwayTeam'

/** Behaviour contract for one node kind (todo/04 §2). */
export interface Primitive<N extends Effect> {
	/** Can this node be fully resolved right now? Used by cost pre-validation
	 *  (§4), CHOOSE_ONE option filtering (§6, rules/03 §3.5.3) and probe. */
	canResolve(state: GameState, node: N, ctx: EffectCtx): boolean
	/** Advance one step. May push frames, may set pendingChoice, may emit events.
	 *  MUST NOT internally resolve whole subtrees — one primitive per
	 *  `executeOne` (rules/12 §12.24 needs reaction windows between steps). */
	execute(
		state: GameState,
		node: N,
		ctx: EffectCtx,
		frame: Extract<Frame, { k: 'EFFECT' }>,
	): GameState
	/** true if this node is a cost — pre-validated by canPayAll before any
	 *  mutation (todo/04 §4). */
	isCost: boolean
	/** The cards this node would pick from (and move onto), for the CONFIRM of
	 *  a MAY around it (may.ts); null when it has nothing to show. */
	preview?(state: GameState, node: N, ctx: EffectCtx): ChoicePreview | null
	/** true when this node, as the whole body of a MAY, asks before it changes
	 *  anything and can carry the decline in that prompt — the MAY then asks no
	 *  CONFIRM and runs it with `ctx.declinable` (may.ts). */
	offersDecline?(state: GameState, node: N, ctx: EffectCtx): boolean
}

/**
 * Exhaustive dispatch table. The mapped type keys the table to the Effect
 * union itself, so tsc fails (not a runtime check) the moment a node kind has
 * no primitive — the DoD §2 guarantee.
 */
export const PRIMITIVES: {
	[K in Effect['k']]: Primitive<Extract<Effect, { k: K }>>
} = {
	SEQ: seq,
	MAY: may,
	CHOOSE_ONE: chooseOne,
	PAY_THEN: payThen,
	IF: ifNode,
	REPEAT: repeat,
	FOR_EACH: forEach,
	LET: letNode,
	OPPONENT: opponent,
	REVEAL: reveal,
	PUT_ON_DECK_TOP: putOnDeckTop,
	NOOP: noop,
	COST_RESOURCE: costResource,
	COST_ACTION: costAction,
	COST_DISCARD: costDiscard,
	COST_PUT: costPut,
	COST_EXHAUST: costExhaust,
	COST_REFRESH: costRefresh,
	COST_REMOVE_AWAY_TEAM: costRemoveAwayTeam,
	COST_TAKE_INCIDENT: costTakeIncident,
	COST_DISMISS: costDismiss,
	COST_LOG_THIS: costLogThis,
	COST_REQUIRE: costRequire,
	COST_RETURN_INCIDENT: costReturnIncident,
	COST_RECALL: costRecall,
	COST_LOG: costLog,
	COST_BEAM: costBeam,
	BEAM: beam,
	DEPLOY: deploy,
	DESTROY: destroy,
	DISCARD: discard,
	DISMISS: dismiss,
	DRAW: draw,
	DRAW_FROM_DISCARD: drawFromDiscard,
	RECALL: recall,
	LOG: log,
	PROMOTE: promote,
	JUNK: junk,
	PUT_INTO_STAGING: putIntoStaging,
	GAIN_CARD: gainCard,
	SCAN_N: scanN,
	SCAN_FOR_TRAIT: scanForTrait,
	TAKE: take,
	FIND: find,
	SELECT: select,
	RETURN_INCIDENT: returnIncident,
	ENLIST_RESERVE: enlistReserve,
	ENLIST_DEVELOPMENT: enlistDevelopment,
	GAIN_RESOURCE: gainResource,
	SPEND_RESOURCE: spendResource,
	STEAL: steal,
	GAIN_ACTION: gainAction,
	ADVANCE_SPECIALTY: advanceSpecialty,
	RECRYSTALLIZE: recrystallize,
	SEND_AWAY_TEAM: sendAwayTeam,
	REMOVE_AWAY_TEAM: removeAwayTeam,
	WARP: warp,
	TAKE_CONTROL: takeControl,
	TRIGGER_CONTROL: triggerControl,
	EXHAUST: exhaust,
	REFRESH: refresh,
	PLACE_RESOURCE_ON_MARKET: placeResourceOnMarket,
	WIPE_MARKET: wipeMarket,
	WIPE_NEUTRAL_ZONE: wipeNeutralZone,
	DRONE: drone,
	ASSIMILATE: assimilate,
	REMOVE_STARDATE_GLORY: removeStardateGlory,
	ARRANGE_DECK: arrangeDeck,
	IGNORE_ATTACK: ignoreAttack,
	REPLACE_GAIN: replaceGain,
	FREE_PLAY: freePlay,
	DUPLICATE: duplicate,
	FORCE: force,
	COMPLETE_MISSION: completeMission,
	MODIFIER_ATTACH: modifierAttach,
	MODIFIER_DETACH: modifierDetach,
	ALT_PLAY: altPlay,
	SCORE_VP: scoreVp,
	SCRIPT: script,
	TRY: tryNode,
	ATTACK: attack,
	BOT_DECK: botDeck,
	BOT_ACQUIRE: botAcquire,
	BOT_JUNK: botJunk,
	BOT_SEND_AWAY_TEAM: botSendAwayTeam,
	BOT_DEPLOY: botDeploy,
	BOT_PROMOTE: botPromote,
	BOT_RESOLVE: botResolve,
	BOT_TAKE_CONTROL: botTakeControl,
	BOT_REMOVE_AWAY_TEAM: botRemoveAwayTeam,
}

/** The primitive for a node, widened to the full Effect union. The mapped
 *  table is closed per-kind, so this cast is safe — it exists only because TS
 *  cannot call a union of contravariant `canResolve`/`execute` directly. */
export function primitiveOf(node: Effect): Primitive<Effect> {
	return PRIMITIVES[node.k] as Primitive<Effect>
}

/**
 * Can the whole `node` tree fully resolve right now (no skipped requirement,
 * no unpayable void)? Control nodes recurse; cost/pay leaves delegate to the
 * registry. Benefit nodes that would be silently skipped still "resolve" only
 * if they have actual work — this is what §6's option filtering reads.
 */
/** Control nodes dispatch their own child-resolution and skip semantics; the
 *  leaf-guard below (§5 benefit skipping) therefore must NOT fire on them —
 *  a SEQ half of whose steps are unresolvable must still run the resolvable
 *  ones (each leaf is guarded individually as it executes). */
const CONTROL_KINDS = new Set<Effect['k']>([
	'SEQ',
	'MAY',
	'CHOOSE_ONE',
	'PAY_THEN',
	'IF',
	'REPEAT',
	'FOR_EACH',
	'LET',
	'OPPONENT',
	'NOOP',
	'TRY',
	'ATTACK',
])

export function isControl(node: Effect): boolean {
	return CONTROL_KINDS.has(node.k)
}

export function canResolveEffect(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): boolean {
	switch (node.k) {
		case 'SEQ':
			return (
				node.steps.length > 0 &&
				node.steps.every((s) => canResolveEffect(state, s, ctx))
			)
		case 'MAY':
			// declining is always legal, so a MAY is always resolvable
			return true
		case 'CHOOSE_ONE':
			return node.options.some((o) => canResolveEffect(state, o.body, ctx))
		case 'PAY_THEN':
			return (
				canPayAll(state, node.cost, ctx) &&
				canResolveEffect(state, node.body, ctx)
			)
		case 'IF':
			return evalPredicate(state, node.cond, ctx)
				? canResolveEffect(state, node.then, ctx)
				: node.else !== undefined
					? canResolveEffect(state, node.else, ctx)
					: true
		case 'REPEAT': {
			const t = evalAmount(state, node.times, ctx)
			if (!Number.isInteger(t) || t < 0) return false
			// "up to N times": zero rounds is a legal resolution
			if (typeof node.times === 'object' && node.times.k === 'UP_TO')
				return true
			return t === 0 || canResolveEffect(state, node.body, ctx)
		}
		case 'FOR_EACH':
			return (
				resolveQuery(state, node.over, ctx).length === 0 ||
				canResolveEffect(state, node.body, ctx)
			)
		case 'LET':
			return canResolveEffect(state, node.body, ctx)
		case 'OPPONENT':
			return canResolveEffect(state, node.body, {
				...ctx,
				actor: otherSeat(ctx.actor),
			})
		case 'NOOP':
			return true
		case 'TRY':
			return able(state, node.test ?? node.body, ctx)
				? canResolveEffect(state, node.body, ctx)
				: node.otherwise !== undefined
					? canResolveEffect(state, node.otherwise, ctx)
					: true
		case 'ATTACK':
			return canResolveEffect(state, node.body, ctx)
		default:
			return primitiveOf(node).canResolve(state, node, ctx)
	}
}

/**
 * Cost pre-validation (todo/04 §4, rules/12 §12.1): walk the cost subtree and
 * AND every cost leaf's canResolve. Choice-bearing costs thereby verify at
 * least one legal selection exists. Non-cost leaves inside a cost tree make
 * the whole thing unpayable (a benefit cannot be a "cost") — fail upward.
 */
export function canPayAll(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): boolean {
	switch (node.k) {
		case 'SEQ':
			return node.steps.every((s) => canPayAll(state, s, ctx))
		case 'MAY':
			return true // "may pay X" → declining keeps it payable
		case 'CHOOSE_ONE':
			return node.options.some((o) => canPayAll(state, o.body, ctx))
		case 'PAY_THEN':
			return (
				canPayAll(state, node.cost, ctx) && canPayAll(state, node.body, ctx)
			)
		case 'IF':
			return evalPredicate(state, node.cond, ctx)
				? canPayAll(state, node.then, ctx)
				: node.else !== undefined
					? canPayAll(state, node.else, ctx)
					: true
		case 'REPEAT': {
			const t = evalAmount(state, node.times, ctx)
			if (!Number.isInteger(t) || t < 0) return false
			if (typeof node.times === 'object' && node.times.k === 'UP_TO')
				return true
			return t === 0 || canPayAll(state, node.body, ctx)
		}
		case 'FOR_EACH':
			return (
				resolveQuery(state, node.over, ctx).length === 0 ||
				canPayAll(state, node.body, ctx)
			)
		case 'LET':
			return canPayAll(state, node.body, ctx)
		case 'OPPONENT':
			return canPayAll(state, node.body, {
				...ctx,
				actor: otherSeat(ctx.actor),
			})
		case 'NOOP':
			return true
		case 'TRY':
			return able(state, node.test ?? node.body, ctx)
				? canPayAll(state, node.body, ctx)
				: node.otherwise !== undefined
					? canPayAll(state, node.otherwise, ctx)
					: true
		case 'ATTACK':
			return canPayAll(state, node.body, ctx)
		default:
			return primitiveOf(node).isCost
				? primitiveOf(node).canResolve(state, node, ctx)
				: false
	}
}
