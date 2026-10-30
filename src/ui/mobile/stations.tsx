// The three stations (docs/ui-mobile.md §4): Sector (what you share with the
// opponent), Ship (your tableau as wide tiles), Crew (the crew board as
// forecasts). Everything renders the projected state and takes legality from
// the viewer's legal-intents list; the real state is read only for extras
// (the "if the game ended now" score) when the client has one.

import { useMemo, type ReactNode } from 'react'
import type { GameState } from '../../engine/state'
import { otherSeat, zoneKey } from '../../engine/state'
import type { CardInstanceId } from '../../engine/ids'
import type { Seat, ZoneRef } from '../../engine/resolver/queries'
import type { SpecialtyId } from '../../data/ids'
import type { GlyphId } from '../../engine/shorthand'
import { MARKET_SUITS_FOUR } from '../../engine/market'
import { shipTokensAt } from '../../engine/queries/board'
import { dutyOfficerSlots } from '../../engine/dutyOfficers'
import {
	useGameStore,
	useProjected,
	useRealState,
	useViewerSeat,
} from '../store'
import type { ProjectedState } from '../projection'
import { CardTile, runIntent } from '../tile/CardTile'
import { Gl, SuitGl } from '../tile/glyph'
import { ShorthandTokens } from '../shorthand'
import {
	missionView,
	scoreNow,
	secureCopy,
	secureStatus,
	trackForecast,
} from './facts'
import { useBridgeUi } from './bridgeUi'
import { useViewerLegal } from '../tile/legal'
import { useDefIndex } from '../defs'
import { cardName, deckLabel } from '../../data/cardNames'

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

export function SecH({
	icon,
	children,
	aside,
}: {
	icon?: ReactNode
	children: ReactNode
	aside?: ReactNode
}) {
	return (
		<h3 className="pb-sec-h">
			{icon}
			<span>{children}</span>
			{aside !== undefined && <span className="pb-aside">{aside}</span>}
		</h3>
	)
}

function useZone(ref: ZoneRef): readonly CardInstanceId[] {
	const projected = useProjected()
	return projected?.zones[zoneKey(ref)] ?? []
}

export function asState(p: ProjectedState): GameState {
	return p as unknown as GameState
}

// ---------------------------------------------------------------------------
// Sector
// ---------------------------------------------------------------------------

export function Sector() {
	const projected = useProjected()
	const openSheet = useBridgeUi((s) => s.openSheet)
	if (projected === null) return null
	const z = (k: string) => projected.zones[k] ?? []
	const junk = z('JUNK')
	return (
		<section className="pb-station" aria-label="Sector">
			<SecH
				icon={<Gl g="MARKET" />}
				aside={
					<>
						<button
							type="button"
							className="pb-link"
							disabled={junk.length === 0}
							onClick={() =>
								openSheet({ k: 'pile', label: 'Junk', iids: [...junk] })
							}
						>
							Junk {junk.length}
						</button>
						{' · '}Encounter {z('ENCOUNTER_DECK').length}
					</>
				}
			>
				Market
			</SecH>
			<div className="pb-market">
				{MARKET_SUITS_FOUR.map((suit) => {
					const offers = z(zoneKey({ k: 'MARKET_OFFER', suit }))
					const deck = z(zoneKey({ k: 'MARKET_DECK', suit })).length
					return (
						<div key={suit} className="pb-mslot">
							{offers.length === 0 ? (
								<div className="pb-empty">No {suit} on offer</div>
							) : (
								offers.map((iid) => <CardTile key={iid} iid={iid} />)
							)}
							<div className="pb-foot">
								<span>
									{suit} deck {deck}
								</span>
							</div>
						</div>
					)
				})}
			</div>
			<SecH
				icon={<SuitGl suit="LOCATION" />}
				aside={<>Location deck {z('LOCATION_DECK').length}</>}
			>
				Neutral Zone
			</SecH>
			<div className="pb-stack">
				{([0, 1, 2] as const).map((slot) => {
					const loc = z(zoneKey({ k: 'NEUTRAL_ZONE', slot }))[0]
					return loc === undefined ? (
						<div key={slot} className="pb-empty">
							No Location in slot {slot + 1}
						</div>
					) : (
						<NeutralLocation key={loc} iid={loc} />
					)
				})}
			</div>
		</section>
	)
}

function Tokens({
	ships,
	teams,
	who,
}: {
	ships: number
	teams: number
	who: 'me' | 'them'
}) {
	return (
		<span className={`pb-side pb-side-${who}`}>
			{Array.from({ length: ships }, (_, i) => (
				<SuitGl key={`s${i}`} suit="SHIP" />
			))}
			{Array.from({ length: teams }, (_, i) => (
				<Gl key={`a${i}`} g="AWAY" />
			))}
		</span>
	)
}

function NeutralLocation({ iid }: { iid: CardInstanceId }) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	if (projected === null) return null
	const state = asState(projected)
	const opp = otherSeat(viewer)
	const s = secureStatus(state, iid, viewer)
	const teams = state.awayTeamsAt[iid] ?? [0, 0]
	const tot = Math.max(s.mine + s.theirs, 6)
	const copy = secureCopy(s, deckLabel(state.players[opp].deckId))
	return (
		<CardTile
			iid={iid}
			className="pb-loc"
			extra={
				<>
					<div
						className="pb-tug"
						role="img"
						aria-label={`Tokens here: you ${s.mine}, ${deckLabel(state.players[opp].deckId)} ${s.theirs}`}
					>
						<Tokens
							who="me"
							ships={shipTokensAt(state, iid, viewer)}
							teams={teams[viewer] ?? 0}
						/>
						<span className="pb-bar">
							<i
								className="pb-b-me"
								style={{ width: `${(s.mine / tot) * 100}%` }}
							/>
							<i
								className="pb-b-them"
								style={{ width: `${(s.theirs / tot) * 100}%` }}
							/>
						</span>
						<Tokens
							who="them"
							ships={shipTokensAt(state, iid, opp)}
							teams={teams[opp] ?? 0}
						/>
					</div>
					<div className={`pb-status pb-status-${copy.cls}`}>
						{copy.head}
						<small>{copy.note}</small>
					</div>
				</>
			}
		/>
	)
}

// ---------------------------------------------------------------------------
// Ship (and the opponent's tableau, read-only)
// ---------------------------------------------------------------------------

function ZoneTiles({
	seat,
	k,
	empty,
}: {
	seat: Seat
	k: 'CAPTAIN' | 'DUTY_OFFICER' | 'FLEET' | 'LOCATION_AREA' | 'STAGING'
	empty?: string
}) {
	const iids = useZone({ k, seat })
	if (iids.length === 0)
		return empty !== undefined ? <div className="pb-empty">{empty}</div> : null
	return (
		<div className="pb-stack">
			{iids.map((iid) => (
				<CardTile key={iid} iid={iid} />
			))}
		</div>
	)
}

export function Tableau({ seat }: { seat: Seat }) {
	const projected = useProjected()
	if (projected === null) return null
	const slots = dutyOfficerSlots(asState(projected), seat).length
	return (
		<>
			<SecH icon={<SuitGl suit="CAPTAIN" />}>
				Captain &amp; duty{slots > 1 ? ` · ${slots} Duty slots` : ''}
			</SecH>
			<div className="pb-stack">
				<ZoneTiles seat={seat} k="CAPTAIN" />
				<ZoneTiles seat={seat} k="DUTY_OFFICER" empty="No Duty Officer" />
			</div>
			<SecH icon={<Gl g="FLEET" />}>Fleet</SecH>
			<ZoneTiles seat={seat} k="FLEET" empty="No ships deployed" />
			<SecH icon={<SuitGl suit="LOCATION" />}>Locations</SecH>
			<ZoneTiles
				seat={seat}
				k="LOCATION_AREA"
				empty="No Locations controlled"
			/>
			<SecH icon={<Gl g="STAGING" />}>Staging · this turn</SecH>
			<ZoneTiles seat={seat} k="STAGING" empty="Nothing played this turn" />
		</>
	)
}

export function Ship() {
	const viewer = useViewerSeat()
	return (
		<section className="pb-station" aria-label="Ship">
			<Tableau seat={viewer} />
		</section>
	)
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

const SPEC: SpecialtyId[] = ['RESEARCH', 'INFLUENCE', 'MILITARY']

function Track({
	state,
	seat,
	specialty,
}: {
	state: GameState
	seat: Seat
	specialty: SpecialtyId
}) {
	const t = trackForecast(state, seat, specialty)
	const at = new Map(t.notches.map((n) => [n.step, n.value]))
	return (
		<div className={`pb-track pb-track-${specialty}`}>
			<div className="pb-track-h">
				<Gl g={specialty as GlyphId} />
				{specialty}
				<b>{t.level}</b>
				<span className="pb-mult">×{t.current}</span>
			</div>
			<div className="pb-steps" aria-hidden="true">
				{Array.from({ length: 16 }, (_, i) => (
					<i
						key={i}
						className={`${i <= t.level && i > 0 ? 'on' : ''} ${at.has(i) ? 'm' : ''}`}
					/>
				))}
			</div>
			<div className="pb-ticks" aria-hidden="true">
				{Array.from({ length: 16 }, (_, i) => (
					<span key={i} className={at.has(i) && i <= t.level ? 'hit' : ''}>
						{at.has(i) ? `×${at.get(i)}` : ''}
					</span>
				))}
			</div>
			<div className="pb-fore">
				{t.next === null ? (
					<>Top multiplier reached.</>
				) : (
					<>
						<b>
							{t.stepsToNext} step{t.stepsToNext === 1 ? '' : 's'}
						</b>{' '}
						to ×{t.next.value}.
					</>
				)}
			</div>
		</div>
	)
}

function Missions({ state, seat }: { state: GameState; seat: Seat }) {
	const legal = useViewerLegal()
	const viewer = useViewerSeat()
	return (
		<div className="pb-stack">
			{state.players[seat].missions.map((_, i) => {
				const m = missionView(state, seat, i, seat === viewer ? legal : [])
				if (m === null) return null
				const intent = legal.find(
					(it) => it.t === 'COMPLETE_MISSION' && it.index === i,
				)
				return (
					<div
						key={i}
						className={`pb-mission${m.completed ? ' pb-done' : ''}${m.ready ? ' pb-ready' : ''}`}
					>
						<h4>
							<SuitGl suit="MISSION" />
							{m.title}
							{m.completed && <span className="pb-chip">completed</span>}
						</h4>
						<ul className="pb-goals" aria-label="Goals">
							{m.goals.map((g, gi) => (
								<li key={gi} className={g.met ? 'ok' : 'no'}>
									<span className="pb-mark" aria-hidden="true">
										{g.met ? '✓' : '○'}
									</span>
									<ShorthandTokens
										toks={g.toks}
										label={`${g.met ? 'Met' : 'Not yet'}: ${g.english}`}
										className="pb-goal-line"
									/>
									<span className="pb-goal-en">{g.english}</span>
								</li>
							))}
						</ul>
						<div className="pb-reward">
							<span className="pb-lbl">Reward</span>
							<ShorthandTokens
								toks={m.reward}
								label={m.rewardEnglish}
								className="pb-goal-line"
							/>
						</div>
						{intent !== undefined && seat === viewer && (
							<button
								type="button"
								className="pb-pill pb-primary"
								onClick={() => runIntent(intent)}
							>
								Complete mission ›
							</button>
						)}
					</div>
				)
			})}
		</div>
	)
}

function Piles({ seat }: { seat: Seat }) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const openSheet = useBridgeUi((s) => s.openSheet)
	if (projected === null) return null
	const z = (k: ZoneRef) => projected.zones[zoneKey(k)] ?? []
	const mine = seat === viewer
	const piles: {
		label: string
		g: GlyphId
		iids: readonly CardInstanceId[]
		open: boolean
	}[] = [
		{ label: 'Draw', g: 'DECK', iids: z({ k: 'DRAW', seat }), open: false },
		{
			label: 'Discard',
			g: 'DISCARD_PILE',
			iids: z({ k: 'DISCARD', seat }),
			open: true,
		},
		{
			label: 'Reserve',
			g: 'RESERVE',
			iids: z({ k: 'RESERVE', seat }),
			open: false,
		},
		{
			label: 'Develop',
			g: 'DEVELOP',
			iids: z({ k: 'DEVELOPMENT', seat }),
			open: true,
		},
		{ label: 'Log', g: 'LOG', iids: z({ k: 'LOG', seat }), open: mine },
	]
	return (
		<div className="pb-piles">
			{piles.map((p) => {
				const can = p.open && p.iids.length > 0
				return (
					<button
						key={p.label}
						type="button"
						className="pb-pile"
						disabled={!can}
						aria-label={`${p.label}: ${p.iids.length}${p.open ? '' : ' (hidden)'}`}
						onClick={() =>
							openSheet({ k: 'pile', label: p.label, iids: [...p.iids] })
						}
					>
						<Gl g={p.g} />
						<b>{p.iids.length}</b>
						{p.label}
						{!p.open && <Gl g="LOCK" className="pb-lock" />}
					</button>
				)
			})}
		</div>
	)
}

function ScoreNowPanel({ state, seat }: { state: GameState; seat: Seat }) {
	const index = useDefIndex()
	const now = useMemo(() => {
		try {
			return scoreNow(state, seat)
		} catch {
			return null
		}
	}, [state, seat])
	if (now === null) return null
	const b = now.breakdown
	const printed = b.printedVp.reduce((a, p) => a + p.vp, 0)
	const focus = b.focus.reduce((a, f) => a + f.vp, 0)
	const missions = b.missions.reduce((a, m) => a + m.vp, 0)
	const nameOf = (iid: string) => {
		const d = state.cards[iid]?.def
		return (d !== undefined ? cardName(index.get(d)) : undefined) ?? iid
	}
	return (
		<div className="pb-score">
			<div>
				<span>Glory in your pool</span>
				<b>{b.glory}</b>
			</div>
			<div>
				<span>Tokens on neutral Locations</span>
				<b>{b.neutralTokens.vp}</b>
			</div>
			{b.endgame.map((e, i) => (
				<div key={i}>
					<span>Endgame: {nameOf(e.card)}</span>
					<b>{e.vp}</b>
				</div>
			))}
			<div>
				<span>Printed VP on your cards</span>
				<b>{printed}</b>
			</div>
			{b.focusSuppressed ? (
				<div className="pb-warn">
					<span>
						Focus icons: 0 until you complete a mission
						{now.focusWouldBe > 0 ? ` (would be ${now.focusWouldBe})` : ''}
					</span>
					<b>0</b>
				</div>
			) : (
				<div>
					<span>
						Focus icons ×{' '}
						{b.focus
							.map(
								(f) => `${f.specialty.slice(0, 3)} ${f.cards}×${f.multiplier}`,
							)
							.join(', ') || 'none'}
					</span>
					<b>{focus}</b>
				</div>
			)}
			{b.missions.length > 0 && (
				<div>
					<span>Completed missions</span>
					<b>{missions}</b>
				</div>
			)}
			<div className="pb-tot">
				<span>Total</span>
				<b>{b.total}</b>
			</div>
		</div>
	)
}

export function CrewBoardView({ seat }: { seat: Seat }) {
	const projected = useProjected()
	// "if the game ended now" scores every owned card, hidden ones too: an
	// extra shown when the client holds the real state (local play)
	const real = useRealState()
	if (projected === null) return null
	const view = asState(projected)
	const p = view.players[seat]
	return (
		<>
			<SecH
				icon={<Gl g="ANY_SPECIALTY" />}
				aside={
					<>
						{deckLabel(p.deckId)} ·{' '}
						{p.boardSide === 'BASIC' ? 'Basic' : 'Advanced'} side
					</>
				}
			>
				Specialties
			</SecH>
			<div className="pb-stack">
				{SPEC.map((s) => (
					<Track key={s} state={view} seat={seat} specialty={s} />
				))}
			</div>
			<SecH icon={<SuitGl suit="MISSION" />}>
				Mission{p.missions.length === 1 ? '' : 's'}
			</SecH>
			<Missions state={view} seat={seat} />
			<SecH icon={<Gl g="DECK" />}>Piles</SecH>
			<Piles seat={seat} />
			{real !== null && (
				<>
					<SecH icon={<Gl g="ENDGAME" />}>If the game ended now</SecH>
					<ScoreNowPanel state={real} seat={seat} />
				</>
			)}
		</>
	)
}

export function Crew() {
	const viewer = useViewerSeat()
	return (
		<section className="pb-station" aria-label="Crew">
			<CrewBoardView seat={viewer} />
		</section>
	)
}

/** Stations that hold something to press or pick: a lit line, a ringed
 *  candidate, a completable mission — the tab gets a dot. */
export function useStationDots(): Record<'sector' | 'ship' | 'crew', boolean> {
	const legal = useViewerLegal()
	const projected = useProjected()
	const viewer = useViewerSeat()
	const pending = useGameStore((s) => s.pendingChoice)
	return useMemo(() => {
		const dots = { sector: false, ship: false, crew: false }
		if (projected === null) return dots
		const where = (iid: CardInstanceId) => projected.cards[iid]?.zone
		for (const it of legal) {
			if (it.t === 'ACTIVATE') {
				const z = where(it.iid)
				if (z !== undefined && z.k !== 'HAND') dots.ship = true
			}
			if (it.t === 'COMPLETE_MISSION') dots.crew = true
		}
		if (pending !== null && pending.seat === viewer) {
			const ids =
				pending.k === 'CHOOSE_CARDS' || pending.k === 'CHOOSE_LOCATION'
					? pending.candidates
					: []
			for (const iid of ids) {
				const z = where(iid)
				if (z === undefined) continue
				if (z.k === 'MARKET_OFFER' || z.k === 'NEUTRAL_ZONE') dots.sector = true
				if (
					(z.k === 'FLEET' ||
						z.k === 'CAPTAIN' ||
						z.k === 'DUTY_OFFICER' ||
						z.k === 'LOCATION_AREA' ||
						z.k === 'STAGING') &&
					z.seat === viewer
				)
					dots.ship = true
			}
		}
		return dots
	}, [legal, projected, viewer, pending])
}
