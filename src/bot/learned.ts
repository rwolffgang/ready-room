// Learned value function for the house AI (todo/15 §4, docs/bot.md "Learned
// value"): a tiny MLP over the two seats' feature vectors (src/bot/evaluate.ts),
// trained by tools/train-value.ts on self-play records and plugged into the
// ISMCTS leaf through `IsmctsOptions.value`.
//
//   input   one column per INPUT_LAYOUTS entry (see `inputColumns`), each
//           standardised by the trained mean / std and clipped to ±INPUT_CLIP
//   hidden  tanh layers (e.g. 64, 32)
//   output  one tanh unit: the value in [−1, 1] from `seat`'s side,
//           optionally mixed with the hand-tuned tanh(evaluate / EVAL_SCALE)
//           (`evalMix`)
//
// Weights are plain JSON (`ValueWeights`). They carry two hashes, and a
// mismatch on either means "stale, do not use":
//   - featureHash: FEATURE_NAMES + the input layout (+ LAYOUT_VERSION)
//   - cardDataHash: the card data they were trained on (src/data/cardDataHash)
// `compatibleValue` returns null on any mismatch, so callers fall back to the
// hand-tuned `evaluate` leaf silently.
//
// Pure and deterministic: the forward pass is a fixed function of the state.
// It reads the state as given; the search passes determinized states.

import type { GameState } from '../engine/state'
import { otherSeat } from '../engine/state'
import type { Seat } from '../engine/resolver/queries'
import type { CardCatalog } from '../engine/setup'
import { cardDataHashCached, hashString } from '../data/cardDataHash'
import {
	EVAL_SCALE,
	evaluateFeatures,
	evaluateNormalized,
	features,
	FEATURE_NAMES,
	type FeatureName,
} from './evaluate'

/** A value function as the ISMCTS hook takes it: [−1, 1] from `seat`'s side. */
export type ValueFn = (state: GameState, seat: Seat) => number

/** Bump when the meaning of an input layout changes (it is in featureHash). */
export const LAYOUT_VERSION = 1

/** Features that are the same for both seats: one column, not two. */
export const GLOBAL_FEATURES: readonly FeatureName[] = [
	'turn.number',
	'turn.phase',
	'game.resolution',
	'game.stardatesLeft',
	'game.incidentDeck',
]

/** Opponent features that depend on its hidden cards (hand composition and
 *  what the hand could complete). The training records hold their TRUE
 *  values, while a search leaf only sees a determinized sample, so the
 *  `-masked` layouts leave them out. The opponent's other features are
 *  public (zone sizes, board, tracks) or invariant under determinization
 *  (owned-card composition: the opponent's hand, Draw deck and Captain's Log
 *  are resampled within one pool). */
export const HIDDEN_OPP_FEATURES: readonly FeatureName[] = [
	'hand.value',
	'missions.completable',
]

/**
 * Input layouts.
 *   pair         me.<f> for every feature, opp.<f> for every per-seat feature
 *   diff         d.<f> = me − opp per per-seat feature, the globals, and the
 *                two raw score totals
 *   *-masked     the same without the opponent's HIDDEN_OPP_FEATURES (in
 *                `diff-masked` the own value stays as a raw me.<f> column)
 */
export const INPUT_LAYOUTS = [
	'pair',
	'pair-masked',
	'diff',
	'diff-masked',
] as const
export type InputLayout = (typeof INPUT_LAYOUTS)[number]

/** Where an input column comes from. */
export interface InputColumn {
	name: string
	src: 'me' | 'opp' | 'diff'
	index: number
}

const IDX = (n: FeatureName): number =>
	(FEATURE_NAMES as readonly string[]).indexOf(n)

/** The input columns of a layout, in order. */
export function inputColumns(layout: InputLayout): InputColumn[] {
	const masked = layout.endsWith('-masked')
	const isGlobal = (n: FeatureName) => GLOBAL_FEATURES.includes(n)
	const isHidden = (n: FeatureName) => masked && HIDDEN_OPP_FEATURES.includes(n)
	const cols: InputColumn[] = []
	if (layout.startsWith('pair')) {
		FEATURE_NAMES.forEach((n, i) =>
			cols.push({ name: `me.${n}`, src: 'me', index: i }),
		)
		FEATURE_NAMES.forEach((n, i) => {
			if (!isGlobal(n) && !isHidden(n))
				cols.push({ name: `opp.${n}`, src: 'opp', index: i })
		})
		return cols
	}
	FEATURE_NAMES.forEach((n, i) => {
		if (isGlobal(n)) cols.push({ name: n, src: 'me', index: i })
		else if (isHidden(n)) cols.push({ name: `me.${n}`, src: 'me', index: i })
		else cols.push({ name: `d.${n}`, src: 'diff', index: i })
	})
	cols.push({ name: 'me.score.total', src: 'me', index: IDX('score.total') })
	cols.push({ name: 'opp.score.total', src: 'opp', index: IDX('score.total') })
	return cols
}

/** The input vector of one position (unnormalised). */
export function inputVector(
	cols: readonly InputColumn[],
	mine: ArrayLike<number>,
	theirs: ArrayLike<number>,
	out: Float64Array = new Float64Array(cols.length),
): Float64Array {
	for (let j = 0; j < cols.length; j++) {
		const c = cols[j]!
		out[j] =
			c.src === 'me'
				? mine[c.index]!
				: c.src === 'opp'
					? theirs[c.index]!
					: mine[c.index]! - theirs[c.index]!
	}
	return out
}

/** The feature hash of a layout: FEATURE_NAMES in order, the layout and its
 *  version. Any feature added, removed or reordered changes it. */
export function featureHash(layout: InputLayout): string {
	return hashString(
		`value-input|v${LAYOUT_VERSION}|${layout}|${FEATURE_NAMES.join(',')}`,
	)
}

/** Standardised inputs are clipped to ±INPUT_CLIP (robust to outliers). */
export const INPUT_CLIP = 6

export interface ValueLayer {
	/** w[out][in] */
	w: number[][]
	b: number[]
}

export interface GateResult {
	/** the opponent spec of the gate */
	vs: string
	/** the gated spec */
	spec?: string | undefined
	games: number
	seed?: number | undefined
	/** A's win rate (draws count half) */
	winRate: number
	/** 95 % Wilson interval */
	ci: [number, number]
	passed: boolean
}

export interface ValueWeights {
	format: 1
	layout: InputLayout
	featureHash: string
	cardDataHash: string
	/** the input column names (inputColumns(layout).map(c => c.name)) */
	featureNames: string[]
	norm: { mean: number[]; std: number[] }
	/** tanh hidden layers, then one tanh output unit */
	layers: ValueLayer[]
	/** Optional share of the hand-tuned evaluation in the value:
	 *  v = (1 − evalMix) · network + evalMix · tanh(evaluate / EVAL_SCALE).
	 *  Absent or 0: the network alone. */
	evalMix?: number | undefined
	meta: {
		trainedOn: string
		games: number
		positions?: number | undefined
		valLoss: number
		signAccuracy: number
		baselineSignAccuracy: number
		baselineValLoss?: number | undefined
		target?: string | undefined
		hidden?: number[] | undefined
		gate?: GateResult | undefined
		[key: string]: unknown
	}
}

/** Why a weights object cannot be loaded, or null when its shape is valid. */
export function weightsProblem(w: unknown): string | null {
	if (typeof w !== 'object' || w === null) return 'not an object'
	const v = w as Partial<ValueWeights>
	if (v.format !== 1) return `unknown format ${String(v.format)}`
	if (!(INPUT_LAYOUTS as readonly string[]).includes(v.layout as string))
		return `unknown layout '${String(v.layout)}'`
	const cols = inputColumns(v.layout!)
	const names = v.featureNames
	if (
		!Array.isArray(names) ||
		names.length !== cols.length ||
		names.some((n, i) => n !== cols[i]!.name)
	)
		return 'featureNames do not match the layout'
	const n = cols.length
	if (
		v.norm === undefined ||
		!Array.isArray(v.norm.mean) ||
		!Array.isArray(v.norm.std) ||
		v.norm.mean.length !== n ||
		v.norm.std.length !== n
	)
		return 'norm does not match the inputs'
	if (!Array.isArray(v.layers) || v.layers.length === 0) return 'no layers'
	let fanIn = n
	for (const [k, layer] of v.layers.entries()) {
		if (!Array.isArray(layer.w) || !Array.isArray(layer.b))
			return `layer ${k}: missing w or b`
		if (layer.w.length !== layer.b.length || layer.w.length === 0)
			return `layer ${k}: w and b disagree`
		for (const row of layer.w)
			if (!Array.isArray(row) || row.length !== fanIn)
				return `layer ${k}: a row has ${Array.isArray(row) ? row.length : '?'} inputs, expected ${fanIn}`
		fanIn = layer.w.length
	}
	if (fanIn !== 1) return 'the last layer must have one output'
	if (
		v.evalMix !== undefined &&
		!(Number.isFinite(v.evalMix) && v.evalMix >= 0 && v.evalMix <= 1)
	)
		return 'evalMix must be in [0, 1]'
	const finite = (xs: readonly number[]) => xs.every((x) => Number.isFinite(x))
	if (!finite(v.norm.mean) || !finite(v.norm.std))
		return 'norm has a non-finite number'
	for (const layer of v.layers)
		if (!finite(layer.b) || !layer.w.every(finite))
			return 'a weight is not finite'
	return null
}

/** A compiled network: flat Float64Arrays for a fast forward pass. */
interface Net {
	cols: InputColumn[]
	mean: Float64Array
	invStd: Float64Array
	layers: { w: Float64Array; b: Float64Array; nIn: number; nOut: number }[]
	buf: Float64Array[]
}

function compile(w: ValueWeights): Net {
	const cols = inputColumns(w.layout)
	const layers = w.layers.map((l) => ({
		w: Float64Array.from(l.w.flat()),
		b: Float64Array.from(l.b),
		nIn: l.w[0]!.length,
		nOut: l.w.length,
	}))
	return {
		cols,
		mean: Float64Array.from(w.norm.mean),
		invStd: Float64Array.from(w.norm.std, (s) => (s > 1e-9 ? 1 / s : 0)),
		layers,
		buf: [
			new Float64Array(cols.length),
			...layers.map((l) => new Float64Array(l.nOut)),
		],
	}
}

/** The network's output for one raw input vector (already column-ordered). */
function forward(net: Net, raw: Float64Array): number {
	const x = net.buf[0]!
	for (let j = 0; j < raw.length; j++) {
		const z = (raw[j]! - net.mean[j]!) * net.invStd[j]!
		x[j] = z > INPUT_CLIP ? INPUT_CLIP : z < -INPUT_CLIP ? -INPUT_CLIP : z
	}
	let input = x
	for (let k = 0; k < net.layers.length; k++) {
		const l = net.layers[k]!
		const out = net.buf[k + 1]!
		for (let o = 0; o < l.nOut; o++) {
			let s = l.b[o]!
			const row = o * l.nIn
			for (let i = 0; i < l.nIn; i++) s += l.w[row + i]! * input[i]!
			out[o] = Math.tanh(s)
		}
		input = out
	}
	return input[0]!
}

/** The value of one position from its two feature vectors (for tools and
 *  tests; `loadValue` is the state-level entry point). Throws on bad weights. */
export function valueOfFeatures(
	weights: ValueWeights,
): (mine: ArrayLike<number>, theirs: ArrayLike<number>) => number {
	const problem = weightsProblem(weights)
	if (problem !== null) throw new Error(`value weights: ${problem}`)
	const net = compile(weights)
	const raw = new Float64Array(net.cols.length)
	const mix = weights.evalMix ?? 0
	if (mix === 0)
		return (mine, theirs) =>
			forward(net, inputVector(net.cols, mine, theirs, raw))
	return (mine, theirs) =>
		(1 - mix) * forward(net, inputVector(net.cols, mine, theirs, raw)) +
		mix * Math.tanh(evaluateFeatures(mine, theirs) / EVAL_SCALE)
}

/**
 * The value function of `weights`: (state, seat) → [−1, 1] from `seat`'s side.
 * Throws if the weights' shape does not match their layout. It does NOT check
 * the hashes (see `compatibleValue`). A Cadet Training or solo-Bot state (no
 * second player) falls back to the hand-tuned `evaluateNormalized`.
 */
export function loadValue(weights: ValueWeights): ValueFn {
	const fromFeatures = valueOfFeatures(weights)
	return (state, seat) => {
		// trained on two-player games only: Cadet's virtual opponent and the
		// official solo Bot fall back to the hand-tuned evaluation
		if (state.mode !== 'TWO_PLAYER') return evaluateNormalized(state, seat)
		return fromFeatures(features(state, seat), features(state, otherSeat(seat)))
	}
}

/** Why `weights` cannot be used with this build's features and `cardData`
 *  (a catalog or its card-data hash), or null when they can. */
export function incompatibility(
	weights: unknown,
	cardData: CardCatalog | string,
): string | null {
	const problem = weightsProblem(weights)
	if (problem !== null) return problem
	const w = weights as ValueWeights
	if (w.featureHash !== featureHash(w.layout))
		return `featureHash ${w.featureHash} ≠ current ${featureHash(w.layout)} (the features changed)`
	const current =
		typeof cardData === 'string' ? cardData : cardDataHashCached(cardData)
	if (w.cardDataHash !== current)
		return `cardDataHash ${w.cardDataHash} ≠ current ${current} (the card data changed)`
	return null
}

/** `loadValue(weights)` if the weights match this build's features and the
 *  card data; null on any mismatch or malformed weights. */
export function compatibleValue(
	weights: unknown,
	cardData: CardCatalog | string,
): ValueFn | null {
	if (incompatibility(weights, cardData) !== null) return null
	return loadValue(weights as ValueWeights)
}
