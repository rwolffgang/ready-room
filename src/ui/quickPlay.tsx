// The Play button on a card (hand or table, console and phone alike): a card
// with exactly one legal operation right now carries a button that runs it at
// once — the double-click fast path (store.cardClicked) as a button you can
// see. It is lit by the same gate: singleLegalAction on the real engine state
// (so never for a second way to play, nor for an operation that would do
// nothing), only for the viewer's own card on the viewer's ACTION step with no
// choice pending, and only while the store still lists the intent — an empty
// list while the house AI is to move, or the solo Bot's lone BOT_STEP, hides
// it. Online there is no engine state to probe, so there is no button either.
//
// The button speaks in icons: the operation's timing mark (src/ui/shorthand)
// and, when it costs an action, the game's own action token, the isolinear
// chip (printedIcons.ts).

import type { MouseEvent, PointerEvent } from 'react'
import { useMemo } from 'react'
import { cardDef } from '../engine/cards'
import type { CardInstanceId } from '../engine/ids'
import type { Intent } from '../engine/intents'
import {
	singleLegalAction,
	type SingleLegalAction,
} from '../engine/queries/legality'
import type { Seat } from '../engine/resolver/queries'
import type { GameState } from '../engine/state'
import { GlyphMark } from './shorthand'
import { useGameStore, useRealState, useViewerSeat } from './store'
import { useViewerLegal } from './tile/legal'
import { intentOffered } from './tile/lines'

export interface QuickAction {
	action: SingleLegalAction
	intent: Extract<Intent, { t: 'PLAY_CARD' | 'ACTIVATE' }>
	costsAction: boolean
}

/** The one operation the viewer may run on `iid` from its Play button, or
 *  null. Pure: `state` is the real engine state, `legal` the viewer's legal
 *  intents. */
export function quickAction(
	state: GameState | null,
	legal: readonly Intent[],
	viewer: Seat,
	iid: CardInstanceId,
): QuickAction | null {
	if (state === null || state.pendingChoice !== null) return null
	if (state.phase.k !== 'ACTION' || state.activeSeat !== viewer) return null
	const card = state.cards[iid]
	if (card === undefined || card.owner !== viewer) return null
	// cheap first: most cards on the table have no operation listed at all
	if (
		!legal.some(
			(it) => (it.t === 'PLAY_CARD' || it.t === 'ACTIVATE') && it.iid === iid,
		)
	)
		return null
	const action = singleLegalAction(state, viewer, iid)
	if (action === null) return null
	const intent: QuickAction['intent'] =
		action.kind === 'PLAY'
			? { t: 'PLAY_CARD', iid, operationIndex: action.operationIndex }
			: { t: 'ACTIVATE', iid, operationIndex: action.operationIndex }
	if (!intentOffered(legal, intent)) return null
	const op = cardDef(card.def).operations[action.operationIndex]
	return { action, intent, costsAction: op?.costsAction === true }
}

/** quickAction for `iid` (null: none asked for) in the live store. */
export function useQuickAction(iid: CardInstanceId | null): QuickAction | null {
	const state = useRealState()
	const legal = useViewerLegal()
	const viewer = useViewerSeat()
	return useMemo(
		() => (iid === null ? null : quickAction(state, legal, viewer, iid)),
		[state, legal, viewer, iid],
	)
}

const VERB: Record<SingleLegalAction['kind'], string> = {
	PLAY: 'Play',
	ACTIVATION: 'Activate',
}

/** The button itself. It sits beside the card's own click target, never in
 *  it, and keeps its pointer to itself: a press on it neither opens the card
 *  nor starts the long-press zoom. */
export function QuickPlayButton({
	iid,
	quick,
	cardName,
	className = '',
}: {
	iid: CardInstanceId
	quick: QuickAction
	cardName: string
	className?: string | undefined
}) {
	const verb = VERB[quick.action.kind]
	const cost = quick.costsAction ? 'costs an action' : 'no action'
	const run = (e: MouseEvent) => {
		e.stopPropagation()
		useGameStore.getState().playSingleAction(iid, quick.action)
	}
	return (
		<button
			type="button"
			className={`quick-play${quick.costsAction ? ' qp-costs' : ''} ${className}`}
			data-quick={quick.action.kind}
			aria-label={`${verb} ${cardName} (${cost})`}
			title={`${verb} (${cost})`}
			onClick={run}
			onPointerDown={(e: PointerEvent) => e.stopPropagation()}
			onKeyDown={(e) => {
				// Enter/Space press the button; keep them from the card's own keys
				if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
			}}
		>
			<GlyphMark
				mark={{ k: 'timing', timing: quick.action.kind }}
				className="qp-timing"
			/>
			{quick.costsAction && (
				<GlyphMark mark={{ k: 'glyph', g: 'ACT' }} className="qp-chip" />
			)}
		</button>
	)
}
