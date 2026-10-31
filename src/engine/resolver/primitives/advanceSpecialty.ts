import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount } from '../../queries/resolveQuery'
import { advanceSpecialty as advance, advancedSpecialty } from '../runtime'
import { suspend, answered, answer } from '../runtime'
import type { SpecialtyId } from '../../../data/ids'
import { player, type EffectCtx, type GameState } from '../../state'
import type { Seat } from '../queries'

const ALL: SpecialtyId[] = ['RESEARCH', 'INFLUENCE', 'MILITARY']

type AdvanceNode = Extract<Effect, { k: 'ADVANCE_SPECIALTY' }>

/** The track(s) at the seat's lowest value (several on a tie). */
export function lowestTracks(state: GameState, seat: Seat): SpecialtyId[] {
	const sp = player(state, seat).specialties
	const min = Math.min(...ALL.map((t) => sp[t]))
	return ALL.filter((t) => sp[t] === min)
}

/** The node's amount for one track: the chosen track is visible to it as
 *  `$specialty` (SKILL_ICONS 'CHOSEN'). */
function amountFor(
	state: GameState,
	node: AdvanceNode,
	ctx: EffectCtx,
	specialty: SpecialtyId,
): number {
	return evalAmount(state, node.amount, {
		...ctx,
		bindings: { ...ctx.bindings, $specialty: specialty },
	})
}

/** ADVANCE_SPECIALTY: raise a track, clamped at 15 (rules/07 §7.1). The
 *  'CHOICE' variant surfaces a CHOOSE_SPECIALTY pick first; 'LOWEST' advances
 *  whichever track is the lowest, asking only in a tie ("you choose in a
 *  tie" — 1SIS22); `{pick, of}` is the solo Bot's lower/higher of the listed
 *  tracks, never asking. */
export const advanceSpecialty: Primitive<AdvanceNode> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const key = 'advance.specialty'
		let specialty: SpecialtyId
		if (node.specialty === 'CHOICE' || node.specialty === 'LOWEST') {
			const offered =
				node.specialty === 'CHOICE' ? ALL : lowestTracks(state, ctx.actor)
			if (offered.length === 1) specialty = offered[0]!
			else if (!answered(ctx, key)) {
				// what each pick would add, after the clamp at 15
				const sp = player(state, ctx.actor).specialties
				const gains: Partial<Record<SpecialtyId, number>> = {}
				for (const t of offered)
					gains[t] =
						advancedSpecialty(sp[t], amountFor(state, node, ctx, t)) - sp[t]
				return suspend(state, node, ctx, key, {
					k: 'CHOOSE_SPECIALTY',
					prompt:
						node.specialty === 'LOWEST'
							? 'Advance which of your lowest specialties?'
							: 'Advance which specialty?',
					specialties: [...offered],
					gains,
				})
			} else specialty = answer<SpecialtyId>(ctx, key)
		} else if (typeof node.specialty === 'object') {
			// the solo Bot's "whichever is lower / higher" over the listed tracks;
			// ties go to the first listed (R > I > M — rules/13 §13.6.2)
			const sp = player(state, ctx.actor).specialties
			const sign = node.specialty.pick === 'LOWER' ? 1 : -1
			specialty = node.specialty.of.reduce((best, t) =>
				sign * sp[t] < sign * sp[best] ? t : best,
			)
		} else {
			specialty = node.specialty
		}
		return advance(
			state,
			ctx.actor,
			specialty,
			amountFor(state, node, ctx, specialty),
		)
	},
}
