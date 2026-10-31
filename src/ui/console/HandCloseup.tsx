// The hand close up (H, Closeup.tsx): every card in your hand at once, as
// large as the board leaves room for. The cards fall into as many rows as
// draw them largest — a short hand in one row, a long one in two or three —
// and the rows come out even (seven cards are four and three, not six and
// one). A click on a card does what it does in the dock.

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { zoneKey } from '../../engine/state'
import { Hand } from '../board'
import { useProjected, useViewerSeat } from '../store'

/** Between the cards, across and down (console.css: .closeup-hand-fan). */
const GAP = 16
/** What the frame takes from the backdrop around the cards: the backdrop's
 *  and the frame's padding and border, the frame's head, the row's padding. */
const FRAME_W = 80
const FRAME_H = 84
const MIN_W = 96
const MAX_W = 360

export interface HandLayout {
	cardW: number
	cols: number
}

/** The card width and column count that draw `n` cards largest in a
 *  `w`×`h` box, in as many rows as that takes. A card is its face at the
 *  printed 1:1.397 plus 5px of frame high. */
export function handLayout(n: number, w: number, h: number): HandLayout {
	const cards = Math.max(1, n)
	let best: HandLayout = { cardW: 0, cols: cards }
	for (let rows = 1; rows <= cards; rows++) {
		const cols = Math.ceil(cards / rows)
		const byW = (w - (cols - 1) * GAP) / cols
		const byH = ((h - (rows - 1) * GAP) / rows - 5) / 1.397
		const cardW = Math.floor(Math.min(byW, byH, MAX_W))
		if (cardW > best.cardW) best = { cardW, cols }
	}
	return { ...best, cardW: Math.max(MIN_W, best.cardW) }
}

export function HandCloseup() {
	const viewer = useViewerSeat()
	const projected = useProjected()
	const n = projected?.zones[zoneKey({ k: 'HAND', seat: viewer })]?.length ?? 0
	const fan = useRef<HTMLDivElement>(null)
	const [box, setBox] = useState<{ w: number; h: number } | null>(null)
	useLayoutEffect(() => {
		const backdrop = fan.current?.closest('.closeup-backdrop')
		if (!backdrop || typeof ResizeObserver === 'undefined') return
		const measure = () =>
			setBox({ w: backdrop.clientWidth, h: backdrop.clientHeight })
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(backdrop)
		return () => ro.disconnect()
	}, [])
	const layout =
		box === null ? null : handLayout(n, box.w - FRAME_W, box.h - FRAME_H)
	const style =
		layout === null
			? undefined
			: ({
					'--card-w': `${layout.cardW}px`,
					'--cols': layout.cols,
				} as CSSProperties)
	return (
		<div ref={fan} className="closeup-hand-fan" style={style}>
			<Hand seat={viewer} size="board" />
		</div>
	)
}
