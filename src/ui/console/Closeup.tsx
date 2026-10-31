// The close-ups: one part of the table at a size you can read — the Neutral
// Zone (N), the Market (M) or your own area (B). Framed like the viewscreen
// (V) and sharing its place: one at a time, and opening one puts the other
// away. Its key again, Esc or a click outside the frame closes it; a click on
// a card inside does what it does on the table.

import { useCallback, type ReactNode } from 'react'
import { PlayerArea } from '../board'
import { useViewerSeat } from '../store'
import { type Closeup, useConsoleUi } from './consoleUi'
import { MarketCloseup } from './MarketCloseup'
import { NeutralCloseup } from './NeutralCloseup'
import { useEscape, useShortcut } from './useShortcut'

const KEY: Record<Closeup, string> = {
	'neutral-zone': 'N',
	market: 'M',
	area: 'B',
}

const NAME: Record<Closeup, string> = {
	'neutral-zone': 'Neutral Zone',
	market: 'Market',
	area: 'Your area',
}

function toggle(kind: Closeup) {
	const ui = useConsoleUi.getState()
	ui.setCloseup(ui.closeup === kind ? null : kind)
}

/** A panel's door to its close-up. */
export function CloseupButton({ kind }: { kind: Closeup }) {
	const open = useConsoleUi((s) => s.closeup === kind)
	return (
		<button
			type="button"
			className={`btn micro closeup-btn${open ? ' btn-active' : ''}`}
			onClick={() => toggle(kind)}
			aria-expanded={open}
			title={`${NAME[kind]} close up (${KEY[kind]})`}
		>
			Close up <kbd>{KEY[kind]}</kbd>
		</button>
	)
}

/** The panel's own label as the door, where its top row has no room for a
 *  button (the Market's suits fill it). */
export function CloseupLabel({
	kind,
	children,
}: {
	kind: Closeup
	children: ReactNode
}) {
	const open = useConsoleUi((s) => s.closeup === kind)
	return (
		<button
			type="button"
			className="panel-door"
			onClick={() => toggle(kind)}
			aria-expanded={open}
			title={`${NAME[kind]} close up (${KEY[kind]})`}
		>
			{children} <kbd>{KEY[kind]}</kbd>
		</button>
	)
}

/** The layer; its keys work wherever the console is. */
export function Closeups() {
	const kind = useConsoleUi((s) => s.closeup)
	const setCloseup = useConsoleUi((s) => s.setCloseup)
	const close = useCallback(() => setCloseup(null), [setCloseup])
	useShortcut('n', () => toggle('neutral-zone'))
	useShortcut('m', () => toggle('market'))
	useShortcut('b', () => toggle('area'))
	useEscape(kind !== null, close)
	if (kind === null) return null
	return (
		<div className="closeup-backdrop" onClick={close}>
			<section
				className={`closeup closeup-${kind}`}
				role="dialog"
				aria-label={`${NAME[kind]} close up`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="viewscreen-head">
					<span className="viewscreen-cap" aria-hidden="true" />
					<strong>{NAME[kind]} · close up</strong>
					<button type="button" className="btn micro" onClick={close}>
						Close <kbd>{KEY[kind]}</kbd>
					</button>
				</div>
				{kind === 'neutral-zone' ? (
					<NeutralCloseup />
				) : kind === 'market' ? (
					<MarketCloseup />
				) : (
					<OwnArea />
				)}
			</section>
		</div>
	)
}

function OwnArea() {
	const viewer = useViewerSeat()
	return <PlayerArea seat={viewer} head={false} />
}
