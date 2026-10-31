// <CardTile> — one card, four densities (docs/ui-mobile.md §3).
//
// The tile reads the width of its SLOT through a CSS container query, never
// the viewport: the same component is a pip in a stack, a chip in the hand
// dock, a tile in the Market grid and a wide row in the Fleet. The markup
// always carries every part (suit, name, VP, tokens, traits, state chips,
// every line); tile.css hides what a density does not show. That keeps the
// density a pure layout concern and the logic testable without layout.
//
// State is drawn over the card, never baked into it: Glory/resource tokens,
// action tokens, exhausted (only ACTIVATION lines dim — that is all it
// disables), beamed cards, the ship token, the Captain's Away Team pool, the
// Away Teams and ships at a Location, the candidate ring of a pending choice,
// the selection.
//
// The line is the button: a lit line (legal right now for the viewer — see
// lines.ts) dispatches its PLAY_CARD / ACTIVATE on tap or Enter/Space. The
// header opens the card detail. While the card is a candidate of the pending
// choice, the whole tile is the button and toggles the selection.

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { CardDef } from '../../data/schema'
import type { SkillIcon } from '../../data/ids'
import { isGameplayTrait, isSpecies } from '../../data/ids'
import type { CardInstanceId } from '../../engine/ids'
import type { PendingChoice } from '../../engine/resolver/choices'
import type { Seat } from '../../engine/resolver/queries'
import type { GlyphId } from '../../engine/shorthand'
import type { Intent } from '../../engine/intents'
import { zoneKey, type GameState } from '../../engine/state'
import {
	useGameStore,
	useProjected,
	useRealState,
	useViewerSeat,
	usePendingChoice,
	useSelected,
	setDetail,
} from '../store'
import { useDefForIid, useDefIndex } from '../defs'
import { HIDDEN_DEF, type ProjectedState } from '../projection'
import { ShorthandLineView } from '../shorthand'
import { ShipStandees } from '../standees'
import { Gl, SuitGl } from './glyph'
import { intentOffered, speakable, tileLines, type TileLine } from './lines'
import { useViewerLegal } from './legal'
import './tile.css'
import { cardName, deckLabel } from '../../data/cardNames'

// ---------------------------------------------------------------------------
// Candidate state of the pending choice (pure)
// ---------------------------------------------------------------------------

export interface CandidateState {
	/** selectable: ring it and let a tap toggle it */
	candidate: boolean
	/** shown greyed with a reason (CHOOSE_CARDS `disabled`) */
	disabledReason?: string | undefined
}

/** Is `iid` a candidate of the viewer's pending choice? Only the two kinds
 *  that choose cards on the table ring in place (ui-spec §4). */
export function candidateState(
	choice: PendingChoice | null,
	viewer: Seat,
	iid: CardInstanceId,
): CandidateState {
	if (choice === null || choice.seat !== viewer) return { candidate: false }
	if (choice.k === 'CHOOSE_CARDS') {
		const off = (choice.disabled ?? []).find((d) => d.iid === iid)
		if (off !== undefined)
			return { candidate: false, disabledReason: off.reason }
		return { candidate: choice.candidates.includes(iid) }
	}
	if (choice.k === 'CHOOSE_LOCATION')
		return { candidate: choice.candidates.includes(iid) }
	return { candidate: false }
}

/** Tap a lit line: dispatch only what the store still offers. */
export function runIntent(intent: Intent): void {
	const s = useGameStore.getState()
	if (!intentOffered(s.legal, intent)) return
	s.dispatch(intent)
}

function onKeys(fn: () => void) {
	return (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			e.stopPropagation()
			fn()
		}
	}
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const SKILL_GLYPH: Record<SkillIcon, GlyphId> = {
	SKILL_RESEARCH: 'RESEARCH',
	SKILL_INFLUENCE: 'INFLUENCE',
	SKILL_MILITARY: 'MILITARY',
	SKILL_ANY: 'ANY_SPECIALTY',
	SKILL_VARIABLE: 'ANY_SPECIALTY',
}

function Traits({ def }: { def: CardDef }) {
	const focus =
		def.focus !== null
			? (def.focus.replace('FOCUS_', '') as
					'RESEARCH' | 'INFLUENCE' | 'MILITARY')
			: null
	if (def.traits.length === 0 && def.skills.length === 0 && focus === null)
		return null
	return (
		<div className="pb-traits">
			{def.skills.map((s, i) => (
				<Gl
					key={`${s}${i}`}
					g={SKILL_GLYPH[s]}
					as={s === 'SKILL_VARIABLE' ? 'variable' : 'skill'}
					className={`pb-skill${s === 'SKILL_VARIABLE' ? ' pb-variable' : ''}`}
					title={`${s.replace('SKILL_', '').toLowerCase()} skill icon`}
				/>
			))}
			{focus !== null && (
				<Gl
					g={focus}
					as="focus"
					className="pb-focus"
					title={`${focus.toLowerCase()} focus icon`}
				/>
			)}
			{def.traits.map((t) => (
				<span
					key={t}
					className={`sh-trait${isSpecies(t) ? ' sh-species' : isGameplayTrait(t) ? ' sh-gameplay' : ''}`}
				>
					{t.replace(/_/g, ' ')}
				</span>
			))}
		</div>
	)
}

function nameOf(
	projected: ProjectedState | null,
	index: Map<string, CardDef>,
	iid: string,
): string {
	const d = projected?.cards[iid]?.def
	if (d === undefined || d === HIDDEN_DEF) return 'face-down card'
	return cardName(index.get(d)) ?? iid
}

/** State chips drawn from the live instance (wide density). */
function StateChips({
	iid,
	projected,
	index,
	interactive,
}: {
	iid: CardInstanceId
	projected: ProjectedState
	index: Map<string, CardDef>
	interactive: boolean
}) {
	const card = projected.cards[iid]
	if (card === undefined) return null
	const chips: ReactNode[] = []
	const z = card.zone
	if (card.exhausted)
		chips.push(
			<span key="exh" className="pb-chip pb-chip-warn">
				<Gl g="EXHAUST" />
				exhausted
			</span>,
		)
	if (card.actionTokens > 0)
		chips.push(
			<span key="act" className="pb-chip">
				<Gl g="ACT" />
				{card.actionTokens} action token{card.actionTokens === 1 ? '' : 's'}
			</span>,
		)
	if (z.k === 'CAPTAIN') {
		const p = projected.players[z.seat]
		if (p !== undefined) {
			const out = Math.max(0, p.awayTeamsTotal - p.awayTeamsInPool)
			chips.push(
				<span key="pool" className="pb-chip pb-chip-seat">
					<span className="pb-pool">
						{Array.from({ length: p.awayTeamsTotal }, (_, i) => (
							<Gl
								key={i}
								g="AWAY"
								className={i < p.awayTeamsInPool ? '' : 'pb-out'}
							/>
						))}
					</span>
					{p.awayTeamsInPool} in pool · {out} out
				</span>,
			)
		}
	}
	if (z.k === 'DUTY_OFFICER')
		chips.push(
			<span key="duty" className="pb-chip">
				<Gl g="DUTY" />
				Duty Officer
			</span>,
		)
	if (z.k === 'FLEET') {
		// only a ship standing on a Location says so (a deployed Cargo never)
		const at = card.shipTokenAt
		if (at !== null && at !== 'SUPPLY')
			chips.push(
				<span key="ship" className="pb-chip pb-chip-seat">
					<SuitGl suit="LOCATION" />
					at {nameOf(projected, index, at)}
				</span>,
			)
	}
	if (z.k === 'LOCATION_AREA') {
		const teams = projected.awayTeamsAt[iid]
		if (teams !== undefined && teams[0] + teams[1] > 0)
			chips.push(
				<span key="teams" className="pb-chip">
					<Gl g="AWAY" />
					Away Teams {teams[0]}
					{' · '}
					{teams[1]}
				</span>,
			)
	}
	if (card.wildcardAs !== null)
		chips.push(
			<span key="wild" className="pb-chip">
				as {card.wildcardAs.replace(/_/g, ' ')}
			</span>,
		)
	const beamed = projected.zones[zoneKey({ k: 'BEAMED', host: iid })] ?? []
	for (const b of beamed) {
		const label = nameOf(projected, index, b)
		chips.push(
			interactive ? (
				<button
					key={`beam${b}`}
					type="button"
					className="pb-chip pb-chip-btn"
					onClick={(e) => {
						e.stopPropagation()
						setDetail(b)
					}}
					aria-label={`Beamed: ${label}`}
				>
					<Gl g="BEAM" />
					{label}
				</button>
			) : (
				<span key={`beam${b}`} className="pb-chip">
					<Gl g="BEAM" />
					{label}
				</span>
			),
		)
	}
	if (chips.length === 0) return null
	return <>{chips}</>
}

const VERB: Partial<Record<TileLine['line']['timing'], string>> = {
	PLAY: 'Play',
	ACTIVATION: 'Activate',
}

export function TileLineRow({
	l,
	cardName,
	interactive,
	onRun,
}: {
	l: TileLine
	cardName: string
	interactive: boolean
	/** after the intent is dispatched (e.g. close the sheet it sits in) */
	onRun?: (() => void) | undefined
}) {
	const lit = l.state === 'lit' && l.intent !== undefined
	const press = lit && interactive
	// a line that would do nothing right now: the first tap only warns
	const [armed, setArmed] = useState(false)
	const run = () => {
		if (l.intent === undefined) return
		if (l.idle !== undefined && !armed) {
			setArmed(true)
			return
		}
		setArmed(false)
		onRun?.()
		runIntent(l.intent)
	}
	const verb = VERB[l.line.timing] ?? 'Use'
	const spoken = l.english !== undefined ? speakable(l.english) : undefined
	return (
		<div
			className={`pb-ln pb-${l.state}`}
			data-line={l.key}
			role={press ? 'button' : undefined}
			tabIndex={press ? 0 : undefined}
			aria-label={
				press
					? `${verb} ${cardName}${l.via !== undefined ? ` via ${l.via}` : ''}: ${spoken ?? ''}`
					: undefined
			}
			onClick={
				press
					? (e) => {
							e.stopPropagation()
							run()
						}
					: undefined
			}
			onKeyDown={press ? onKeys(run) : undefined}
		>
			<ShorthandLineView line={l.line} label={spoken} size="md" />
			{l.via !== undefined && <span className="pb-via">via {l.via}</span>}
			{press && l.idle !== undefined && (
				<div className="pb-why pb-idle">
					{armed
						? `Are you sure? “${l.idle}” can’t happen. Tap again to ${verb.toLowerCase()}.`
						: 'Does nothing right now'}
				</div>
			)}
			{l.state === 'dim' && l.reason !== undefined && l.turnGated !== true && (
				<div className="pb-why">{l.reason}</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// CardTile
// ---------------------------------------------------------------------------

export interface CardTileProps {
	/** a live card instance (projected state) … */
	iid?: CardInstanceId | undefined
	/** … or a bare def (catalog, previews) */
	def?: CardDef | undefined
	/** 'zone' shows the lines that matter where the card is; 'all' every line */
	show?: 'zone' | 'all' | undefined
	/** false: render no buttons inside (the tile sits in a button, e.g. the
	 *  hand dock or a picker) */
	interactive?: boolean | undefined
	/** the seat colour to draw state chips in */
	tone?: 'you' | 'opp' | undefined
	/** extra state chips from the station */
	meta?: ReactNode | undefined
	/** extra body between the chips and the lines (a Location's tug-of-war) */
	extra?: ReactNode | undefined
	/** header tap; default opens the card detail */
	onOpen?: (() => void) | undefined
	/** candidate tap; default toggles the store selection (cardClicked) */
	onPick?: (() => void) | undefined
	/** force the ring (candidate trays) */
	candidate?: boolean | undefined
	picked?: boolean | undefined
	className?: string | undefined
	emptyText?: string | undefined
}

export function CardTile(props: CardTileProps) {
	const {
		iid,
		show = 'zone',
		interactive = true,
		tone,
		meta,
		extra,
		onOpen,
		onPick,
		className = '',
		emptyText,
	} = props
	const projected = useProjected()
	const real = useRealState()
	const viewer = useViewerSeat()
	const pending = usePendingChoice()
	const selected = useSelected()
	const index = useDefIndex()
	const liveDef = useDefForIid(iid ?? null)
	const card = iid !== undefined ? projected?.cards[iid] : undefined
	const hidden = card?.def === HIDDEN_DEF
	const def = iid !== undefined ? liveDef : (props.def ?? null)

	const legal = useViewerLegal()
	const lines = useMemo(
		() =>
			def === null
				? []
				: tileLines({
						def,
						iid: iid ?? null,
						view: projected as unknown as GameState | null,
						legal,
						viewer,
						// reasons only — legality is the legal list above
						real,
						show,
					}),
		[def, iid, projected, legal, real, viewer, show],
	)

	const cand =
		iid !== undefined
			? candidateState(pending, viewer, iid)
			: { candidate: false }
	const isCand = props.candidate ?? cand.candidate
	const isPicked = props.picked ?? (iid !== undefined && selected.includes(iid))
	const pickable = interactive && isCand
	const pick = () => {
		if (onPick !== undefined) onPick()
		else if (iid !== undefined) useGameStore.getState().cardClicked(iid)
	}
	const open = () => {
		if (onOpen !== undefined) onOpen()
		else if (iid !== undefined) setDetail(iid)
	}

	const oppTone =
		tone === 'opp' ||
		(tone === undefined &&
			card !== undefined &&
			card.owner !== null &&
			card.owner !== viewer)

	const classes = [
		'pb-tile',
		hidden || def === null ? 'pb-back' : `s-${def.suit}`,
		isCand ? 'pb-cand' : '',
		isPicked ? 'pb-picked' : '',
		cand.disabledReason !== undefined ? 'pb-blocked' : '',
		card?.exhausted === true ? 'pb-exh' : '',
		oppTone ? 'pb-opp' : '',
		className,
	]
		.filter(Boolean)
		.join(' ')

	const tileProps = pickable
		? {
				role: 'button' as const,
				tabIndex: 0,
				'aria-pressed': isPicked,
				onClick: pick,
				onKeyDown: onKeys(pick),
			}
		: {}

	if (hidden || def === null) {
		if (iid === undefined && def === null) return null
		return (
			<div className="pb-slot">
				<article
					className={classes}
					data-iid={iid}
					aria-label={isCand ? 'Face-down card (candidate)' : 'Face-down card'}
					{...tileProps}
				>
					<div className="pb-backface">
						<SuitGl suit="ANY" className="pb-sg" />
						<span>face down</span>
					</div>
				</article>
			</div>
		)
	}

	const vp =
		def.vp !== 0 || def.vpAsterisk
			? `${def.vpAsterisk ? '*' : ''}${def.vp}`
			: null
	const tokens = Object.entries(card?.resourceTokens ?? {}).filter(
		([, n]) => (n ?? 0) > 0,
	) as ['DIL' | 'LAT' | 'GLO', number][]
	const headerButton = interactive && !pickable

	return (
		<div className="pb-slot">
			<article
				className={classes}
				data-iid={iid}
				title={cand.disabledReason}
				{...(pickable ? { 'aria-label': `${cardName(def)}, candidate` } : {})}
				{...tileProps}
			>
				<header
					className="pb-th"
					role={headerButton ? 'button' : undefined}
					tabIndex={headerButton ? 0 : undefined}
					aria-label={headerButton ? `Open ${cardName(def)}` : undefined}
					onClick={
						headerButton
							? (e) => {
									e.stopPropagation()
									open()
								}
							: undefined
					}
					onKeyDown={headerButton ? onKeys(open) : undefined}
				>
					<SuitGl suit={def.suit} className="pb-sg" />
					<h4>{cardName(def)}</h4>
					{tokens.map(([r, n]) => (
						<span key={r} className={`pb-tok pb-tok-${r}`} title={`${n} ${r}`}>
							<Gl g={r} />
							{n}
						</span>
					))}
					{vp !== null && (
						<span className={`pb-vp${def.vp < 0 ? ' pb-neg' : ''}`}>{vp}</span>
					)}
				</header>
				<Traits def={def} />
				<div className="pb-meta">
					{iid !== undefined && projected !== null && (
						<StateChips
							iid={iid}
							projected={projected}
							index={index}
							interactive={interactive && !pickable}
						/>
					)}
					{iid !== undefined &&
						(card?.zone.k === 'LOCATION_AREA' ||
							card?.zone.k === 'NEUTRAL_ZONE') && (
							<ShipStandees
								loc={iid}
								placement="inline"
								interactive={interactive}
							/>
						)}
					{meta}
				</div>
				{extra}
				{cand.disabledReason !== undefined && (
					<div className="pb-why pb-why-cand">{cand.disabledReason}</div>
				)}
				<div className="pb-lines">
					{lines.length === 0 ? (
						<div className="pb-nolines">
							{emptyText ?? 'No operations here'}
						</div>
					) : (
						lines.map((l) => (
							<TileLineRow
								key={l.key}
								l={l}
								cardName={cardName(def)}
								interactive={interactive && !pickable}
							/>
						))
					)}
				</div>
			</article>
		</div>
	)
}

/** The seat's captain name (falls back to the deck id), for headers. */
export function captainName(
	projected: ProjectedState,
	seat: Seat,
	index: Map<string, CardDef>,
): string {
	const cap = projected.zones[zoneKey({ k: 'CAPTAIN', seat })]?.[0]
	if (cap !== undefined) {
		const d = projected.cards[cap]?.def
		if (d !== undefined && d !== HIDDEN_DEF) {
			const def = index.get(d)
			if (def !== undefined) return cardName(def)
		}
	}
	const p = projected.players[seat]
	return p !== undefined ? deckLabel(p.deckId) : `Player ${seat + 1}`
}
