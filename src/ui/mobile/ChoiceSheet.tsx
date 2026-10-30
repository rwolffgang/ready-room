// Choice sheets (docs/ui-mobile.md §4, ui-spec §4): one renderer per
// PendingChoice kind — all 14. Contract:
//   · always the prompt, the source card, min/max with a live count, Decline
//     when the choice is optional, and a confirm;
//   · a choice switches to the station holding its candidates and rings them
//     in place (tiles on the board toggle the store selection, cardClicked);
//     the sheet repeats candidates as tiles only when they cannot be ringed
//     on screen — cards in hand or a discard pile, blind deck tops, revealed
//     cards, the opponent's table;
//   · the sheet never dims or blocks the board, and folds down to its header;
//   · answers go through confirmChoice → RESOLVE_CHOICE, and Confirm is only
//     enabled when the engine's own checkSelection accepts the selection —
//     the phone guesses no rule the engine does not already state.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PendingChoice } from '../../engine/resolver/choices'
import { checkSelection } from '../../engine/resolver/choices'
import type { CardInstanceId } from '../../engine/ids'
import type { OperationRef } from '../../engine/state'
import type { MarketSuit, SpecialtyId } from '../../data/ids'
import { SKIP_CONTROL } from '../../engine/phases'
import { zoneKey } from '../../engine/state'
import type { ZoneRef } from '../../engine/resolver/queries'
import {
	confirmChoice,
	useGameStore,
	usePendingChoice,
	useProjected,
	useSelected,
	useViewerSeat,
} from '../store'
import { useDefById, useDefForIid, useDefIndex } from '../defs'
import { OpText } from '../cards'
import { OperationOptions, operationOptions } from '../opOptions'
import { ShorthandOp } from '../shorthand'
import { useOrderState } from '../choice'
import { CardTile } from '../tile/CardTile'
import { Gl, SuitGl } from '../tile/glyph'
import { ringPlan, type Station } from './facts'
import { useBridgeUi } from './bridgeUi'
import { zoneWords } from './sheets'
import { asState } from './stations'
import { cardName, deckLabel, withCardNames } from '../../data/cardNames'

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------

function SourceChip({ choice }: { choice: PendingChoice }) {
	const live = useDefForIid(choice.sourceCard)
	const stamped = useDefById(choice.sourceDef ?? '')
	const def = live ?? stamped
	if (def === null) return null
	return (
		<span className="pb-src">
			<SuitGl suit={def.suit} />
			{cardName(def)}
		</span>
	)
}

function ChoiceFrame({
	choice,
	sub,
	footer,
	children,
}: {
	choice: PendingChoice
	sub?: ReactNode
	footer?: ReactNode
	children?: ReactNode
}) {
	const folded = useBridgeUi((s) => s.choiceFolded)
	const setFolded = useBridgeUi((s) => s.setChoiceFolded)
	return (
		<section
			className={`pb-sheet pb-choice${folded ? ' pb-folded' : ''}`}
			aria-label={`Choice: ${withCardNames(choice.prompt)}`}
			data-kind={choice.k}
		>
			<div className="pb-sheet-h">
				<div className="pb-row">
					<SourceChip choice={choice} />
					<span className="pb-src pb-src-kind">Your choice</span>
					<button
						type="button"
						className="pb-x"
						onClick={() => setFolded(!folded)}
						aria-expanded={!folded}
						aria-label={
							folded ? 'Show the choice' : 'Fold the choice to see the board'
						}
					>
						{folded ? '▴' : '▾'}
					</button>
				</div>
				<h3 className="pb-prompt">
					<OpText text={choice.prompt} plain />
				</h3>
				{sub !== undefined && <div className="pb-sub">{sub}</div>}
			</div>
			{!folded && children !== undefined && (
				<div className="pb-scroll pb-sheet-body">{children}</div>
			)}
			{footer !== undefined && <div className="pb-confirm">{footer}</div>}
		</section>
	)
}

function Pill({
	children,
	primary,
	disabled,
	onClick,
	label,
}: {
	children: ReactNode
	primary?: boolean
	disabled?: boolean
	onClick: () => void
	label?: string
}) {
	return (
		<button
			type="button"
			className={`pb-pill${primary === true ? ' pb-primary' : ''}`}
			disabled={disabled}
			onClick={onClick}
			aria-label={label}
		>
			{children}
		</button>
	)
}

// ---------------------------------------------------------------------------
// the host
// ---------------------------------------------------------------------------

export function ChoiceSheet({ splitView }: { splitView: boolean }) {
	const choice = usePendingChoice()
	const viewer = useViewerSeat()
	const botToMove = useGameStore((s) => s.botToMove)
	if (choice === null || choice.seat !== viewer || botToMove !== null)
		return null
	return <ChoiceBody key={choice.id} choice={choice} splitView={splitView} />
}

function ChoiceBody({
	choice,
	splitView,
}: {
	choice: PendingChoice
	splitView: boolean
}) {
	const setFolded = useBridgeUi((s) => s.setChoiceFolded)
	useEffect(() => setFolded(false), [setFolded])
	switch (choice.k) {
		case 'CONFIRM':
			return <ConfirmSheet choice={choice} />
		case 'CHOOSE_OPTION':
			return <OptionSheet choice={choice} />
		case 'CHOOSE_CARDS':
		case 'CHOOSE_LOCATION':
			return <PickSheet choice={choice} splitView={splitView} />
		case 'CHOOSE_SUIT':
			return <SuitSheet choice={choice} />
		case 'CHOOSE_TRAIT':
			return <TraitSheet choice={choice} />
		case 'CHOOSE_SPECIALTY':
			return <SpecialtySheet choice={choice} />
		case 'CHOOSE_DESTINATION':
			return <DestinationSheet choice={choice} />
		case 'CHOOSE_AMOUNT':
			return <AmountSheet choice={choice} />
		case 'ORDER_OPERATIONS':
			return <OrderOpsSheet choice={choice} />
		case 'OPTIONAL_TRIGGERS':
			return <TriggersSheet choice={choice} />
		case 'CHOOSE_WITNESS':
			return <WitnessSheet choice={choice} />
		case 'CHOOSE_WILDCARD_AS':
			return <WildcardSheet choice={choice} />
		case 'ORDER_CARDS':
			return <OrderCardsSheet choice={choice} />
	}
}

type Of<K extends PendingChoice['k']> = Extract<PendingChoice, { k: K }>

// ---------------------------------------------------------------------------
// CONFIRM, CHOOSE_OPTION
// ---------------------------------------------------------------------------

function ConfirmSheet({ choice }: { choice: Of<'CONFIRM'> }) {
	// what the "you may …" would act on; a group of one is taken without
	// another prompt (choice.tsx ConfirmPreview)
	const preview = choice.preview
	const group = (what: string, iids: readonly CardInstanceId[]) => (
		<TileGroup
			label={`${what} · ${iids.length === 1 ? 'the only option' : `${iids.length} options`}`}
			iids={iids}
		/>
	)
	return (
		<ChoiceFrame
			choice={choice}
			footer={
				<>
					<Pill onClick={() => confirmChoice(false)}>Decline</Pill>
					<Pill primary onClick={() => confirmChoice(true)}>
						Confirm
					</Pill>
				</>
			}
		>
			{preview === undefined ? undefined : (
				<>
					{group(preview.cards.length === 1 ? 'Card' : 'Cards', preview.cards)}
					{preview.onto !== undefined && group('Onto', preview.onto)}
				</>
			)}
		</ChoiceFrame>
	)
}

function OptionSheet({ choice }: { choice: Of<'CHOOSE_OPTION'> }) {
	const byCard = operationOptions(choice.options)
	if (byCard !== null)
		return (
			<ChoiceFrame choice={choice} sub="Pick one.">
				<OperationOptions byCard={byCard} seat={choice.seat} size="board" />
			</ChoiceFrame>
		)
	return (
		<ChoiceFrame choice={choice} sub="Pick one.">
			<div className="pb-options">
				{choice.options.map((o) => (
					<button
						key={o.key}
						type="button"
						className="pb-option"
						disabled={!o.enabled}
						onClick={() => confirmChoice({ key: o.key })}
					>
						<span>
							<OpText text={o.label} plain />
						</span>
						{!o.enabled && o.reason !== undefined && (
							<small className="pb-why">{o.reason}</small>
						)}
					</button>
				))}
			</div>
		</ChoiceFrame>
	)
}

// ---------------------------------------------------------------------------
// CHOOSE_CARDS / CHOOSE_LOCATION — ringed in place
// ---------------------------------------------------------------------------

const STATION_WORD: Record<Station, string> = {
	sector: 'Sector',
	ship: 'Ship',
	crew: 'Crew',
}

/** A labelled row of card tiles in a choice sheet — a card choice's
 *  candidates by zone, a "you may …" preview. A candidate taken sight unseen
 *  is a deck, not a tile. */
function TileGroup({
	label,
	iids,
	hidden,
}: {
	label: string
	iids: readonly CardInstanceId[]
	hidden?: ReadonlySet<string> | undefined
}) {
	return (
		<div>
			<div className="pb-lbl">{label}</div>
			<div className="pb-cands">
				{iids.map((iid) =>
					hidden?.has(iid) === true ? (
						<BlindCard key={iid} iid={iid} />
					) : (
						<CardTile key={iid} iid={iid} />
					),
				)}
			</div>
		</div>
	)
}

function BlindCard({ iid }: { iid: CardInstanceId }) {
	const projected = useProjected()
	const selected = useSelected()
	const z = projected?.cards[iid]?.zone
	const picked = selected.includes(iid)
	const deck =
		z?.k === 'MARKET_DECK'
			? `${z.suit} deck`
			: z?.k === 'ENCOUNTER_DECK'
				? 'Encounter deck'
				: z?.k === 'LOCATION_DECK'
					? 'Location deck'
					: 'Deck'
	const n =
		z !== undefined ? (projected?.zones[zoneKey(z as ZoneRef)]?.length ?? 0) : 0
	return (
		<button
			type="button"
			className={`pb-blind${picked ? ' pb-picked' : ''}`}
			aria-pressed={picked}
			onClick={() => useGameStore.getState().cardClicked(iid)}
		>
			<b>Top of the {deck}</b>
			{n} card{n === 1 ? '' : 's'} · sight unseen
		</button>
	)
}

function PickSheet({
	choice,
	splitView,
}: {
	choice: Of<'CHOOSE_CARDS'> | Of<'CHOOSE_LOCATION'>
	splitView: boolean
}) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	const selected = useSelected()
	const tab = useBridgeUi((s) => s.tab)
	const setTab = useBridgeUi((s) => s.setTab)
	const openSheet = useBridgeUi((s) => s.openSheet)
	const hidden = useMemo(
		() =>
			new Set<string>(choice.k === 'CHOOSE_CARDS' ? (choice.hidden ?? []) : []),
		[choice],
	)
	const plan = useMemo(
		() =>
			projected === null
				? null
				: ringPlan(choice, asState(projected), viewer, hidden),
		[choice, projected, viewer, hidden],
	)
	// switch to the station holding the candidates, once per choice
	useEffect(() => {
		if (plan?.focus != null) {
			openSheet(null)
			setTab(plan.focus)
		}
	}, [choice.id])

	if (projected === null || plan === null) return null
	const oppDeck = projected.players[viewer === 0 ? 1 : 0]?.deckId
	const oppName = oppDeck !== undefined ? deckLabel(oppDeck) : 'Opponent'
	const skip =
		choice.k === 'CHOOSE_LOCATION' && choice.candidates.includes(SKIP_CONTROL)
	const selection =
		choice.k === 'CHOOSE_LOCATION' ? (selected[0] ?? null) : selected
	const ok = checkSelection(choice, selection).ok
	const min = choice.k === 'CHOOSE_CARDS' ? choice.min : 1
	const max = choice.k === 'CHOOSE_CARDS' ? choice.max : 1
	const optional = choice.k === 'CHOOSE_CARDS' && choice.optional === true

	// candidates the sheet repeats, grouped by where they are
	const groups = new Map<string, CardInstanceId[]>()
	for (const iid of plan.sheet) {
		const z = projected.cards[iid]?.zone
		const label = hidden.has(iid)
			? 'Sight unseen'
			: z === undefined
				? 'Elsewhere'
				: zoneWords(z, viewer, oppName)
		const arr = groups.get(label) ?? []
		arr.push(iid)
		groups.set(label, arr)
	}
	const elsewhere = (['sector', 'ship'] as const).filter(
		(st) => plan[st].length > 0 && (splitView ? false : st !== tab),
	)
	const ringedHere = (['sector', 'ship'] as const).filter(
		(st) => plan[st].length > 0 && (splitView || st === tab),
	)

	return (
		<ChoiceFrame
			choice={choice}
			sub={
				<>
					<b className="pb-count">{selected.length} selected</b> ·{' '}
					{min === max ? `pick ${min}` : `pick ${min}–${max}`}
					{optional ? ' · optional' : ''}
					{ringedHere.length > 0 && (
						<>
							{' '}
							· ringed on {ringedHere.map((s) => STATION_WORD[s]).join(' and ')}
						</>
					)}
				</>
			}
			footer={
				<>
					{selected.length > 0 && (
						<Pill onClick={() => useGameStore.getState().setSelected([])}>
							Clear
						</Pill>
					)}
					{optional && <Pill onClick={() => confirmChoice([])}>Decline</Pill>}
					{skip && (
						<Pill onClick={() => confirmChoice(SKIP_CONTROL)}>Skip</Pill>
					)}
					<Pill primary disabled={!ok} onClick={() => confirmChoice(selection)}>
						Confirm{selected.length > 0 ? ` (${selected.length})` : ''}
					</Pill>
				</>
			}
		>
			{elsewhere.map((st) => (
				<button
					key={st}
					type="button"
					className="pb-link pb-elsewhere"
					onClick={() => setTab(st)}
				>
					{plan[st].length} ringed on {STATION_WORD[st]} ›
				</button>
			))}
			{[...groups.entries()].map(([label, iids]) => (
				<TileGroup key={label} label={label} iids={iids} hidden={hidden} />
			))}
			{plan.sheet.length === 0 && ringedHere.length > 0 && (
				<p className="pb-note">
					Tap a ringed card to pick it. Fold this sheet to see more of the
					board.
				</p>
			)}
		</ChoiceFrame>
	)
}

// ---------------------------------------------------------------------------
// suit / trait / specialty / wildcard
// ---------------------------------------------------------------------------

function SuitSheet({ choice }: { choice: Of<'CHOOSE_SUIT'> }) {
	return (
		<ChoiceFrame choice={choice} sub="Pick a suit.">
			<div className="pb-grid2">
				{choice.suits.map((s: MarketSuit) => (
					<button
						key={s}
						type="button"
						className="pb-option pb-big"
						onClick={() => confirmChoice(s)}
					>
						<SuitGl suit={s} />
						{s}
					</button>
				))}
			</div>
		</ChoiceFrame>
	)
}

function TraitSheet({ choice }: { choice: Of<'CHOOSE_TRAIT'> }) {
	return (
		<ChoiceFrame choice={choice} sub="Pick a trait.">
			<div className="pb-traitpick">
				{choice.traits.map((t) => (
					<button
						key={t}
						type="button"
						className="pb-option"
						onClick={() => confirmChoice(t)}
					>
						<span className="sh-trait">{t.replace(/_/g, ' ')}</span>
					</button>
				))}
			</div>
		</ChoiceFrame>
	)
}

function SpecialtySheet({ choice }: { choice: Of<'CHOOSE_SPECIALTY'> }) {
	const projected = useProjected()
	return (
		<ChoiceFrame choice={choice} sub="Pick a specialty.">
			<div className="pb-grid3">
				{choice.specialties.map((s: SpecialtyId) => (
					<button
						key={s}
						type="button"
						className={`pb-option pb-big pb-spec-${s}`}
						onClick={() => confirmChoice(s)}
					>
						<Gl g={s} />
						{s}
						{projected !== null && (
							<small>
								now {projected.players[choice.seat]?.specialties[s] ?? 0}
							</small>
						)}
					</button>
				))}
			</div>
		</ChoiceFrame>
	)
}

function WildcardSheet({ choice }: { choice: Of<'CHOOSE_WILDCARD_AS'> }) {
	return (
		<ChoiceFrame
			choice={choice}
			sub="The WILDCARD counts as one trait for this."
		>
			<CardTile iid={choice.card} interactive={false} />
			<div className="pb-traitpick">
				{choice.traits.map((t) => (
					<button
						key={t}
						type="button"
						className="pb-option"
						onClick={() => confirmChoice(t)}
					>
						Treat as <span className="sh-trait">{t.replace(/_/g, ' ')}</span>
					</button>
				))}
			</div>
		</ChoiceFrame>
	)
}

// ---------------------------------------------------------------------------
// CHOOSE_DESTINATION — remembers its default for the game
// ---------------------------------------------------------------------------

const DEST_WORD = { DECK_TOP: 'Top of deck', DISCARD: 'Discard pile' } as const

function DestinationSheet({ choice }: { choice: Of<'CHOOSE_DESTINATION'> }) {
	const remembered = useGameStore((s) => s.destinationDefault)
	const known =
		remembered !== null && choice.options.includes(remembered)
			? remembered
			: null
	const [dest, setDest] = useState<'DECK_TOP' | 'DISCARD'>(
		known ?? choice.options[0] ?? 'DISCARD',
	)
	const [remember, setRemember] = useState(remembered !== null)
	const go = () => {
		if (remember) useGameStore.getState().setDestinationDefault(dest)
		else useGameStore.setState({ destinationDefault: null })
		confirmChoice(dest)
	}
	return (
		<ChoiceFrame
			choice={choice}
			sub={
				known !== null
					? `Remembered: ${DEST_WORD[known].toLowerCase()}.`
					: 'Where does it go?'
			}
			footer={
				<Pill primary onClick={go}>
					Put it: {DEST_WORD[dest].toLowerCase()} ›
				</Pill>
			}
		>
			<CardTile iid={choice.card} interactive={false} />
			<div className="pb-dest">
				<div
					className="pb-seg pb-seg-wide"
					role="group"
					aria-label="Destination"
				>
					{choice.options.map((o) => (
						<button
							key={o}
							type="button"
							aria-pressed={dest === o}
							onClick={() => setDest(o)}
						>
							<Gl g={o === 'DECK_TOP' ? 'TOP_DECK' : 'DISCARD_PILE'} />
							{DEST_WORD[o]}
						</button>
					))}
				</div>
				<label className="pb-remember">
					<button
						type="button"
						className="pb-sw"
						role="switch"
						aria-checked={remember}
						aria-label="Remember this for the rest of the game"
						onClick={() => setRemember(!remember)}
					/>
					Remember this for the rest of the game
				</label>
			</div>
		</ChoiceFrame>
	)
}

// ---------------------------------------------------------------------------
// CHOOSE_AMOUNT
// ---------------------------------------------------------------------------

function AmountSheet({ choice }: { choice: Of<'CHOOSE_AMOUNT'> }) {
	const [v, setV] = useState(choice.min)
	return (
		<ChoiceFrame
			choice={choice}
			sub={`Between ${choice.min} and ${choice.max}.`}
			footer={
				<Pill primary onClick={() => confirmChoice(v)}>
					Confirm {v}
				</Pill>
			}
		>
			<div className="pb-stepper">
				<button
					type="button"
					className="pb-pill"
					disabled={v <= choice.min}
					onClick={() => setV(Math.max(choice.min, v - 1))}
					aria-label="decrease"
				>
					−
				</button>
				<output aria-live="polite">{v}</output>
				<button
					type="button"
					className="pb-pill"
					disabled={v >= choice.max}
					onClick={() => setV(Math.min(choice.max, v + 1))}
					aria-label="increase"
				>
					+
				</button>
			</div>
		</ChoiceFrame>
	)
}

// ---------------------------------------------------------------------------
// ORDER_OPERATIONS / OPTIONAL_TRIGGERS / ORDER_CARDS / CHOOSE_WITNESS
// ---------------------------------------------------------------------------

function OpRow({ opRef: ref }: { opRef: OperationRef }) {
	const projected = useProjected()
	const index = useDefIndex()
	const d = projected?.cards[ref.card]?.def
	const def = d !== undefined ? index.get(d) : undefined
	const op = def?.operations[ref.opIndex]
	return (
		<div className="pb-oprow">
			<div className="pb-who">
				{def !== undefined && <SuitGl suit={def.suit} />}
				{cardName(def) ?? 'a card'}
			</div>
			{op !== undefined && <ShorthandOp op={op} size="md" />}
		</div>
	)
}

function MoveButtons({
	i,
	n,
	move,
}: {
	i: number
	n: number
	move: (up: boolean, index: number) => void
}) {
	return (
		<span className="pb-move">
			<button
				type="button"
				className="pb-pill"
				disabled={i === 0}
				onClick={() => move(true, i)}
				aria-label="move up"
			>
				↑
			</button>
			<button
				type="button"
				className="pb-pill"
				disabled={i === n - 1}
				onClick={() => move(false, i)}
				aria-label="move down"
			>
				↓
			</button>
		</span>
	)
}

function OrderOpsSheet({ choice }: { choice: Of<'ORDER_OPERATIONS'> }) {
	const [order, move] = useOrderState<OperationRef>(choice.pending)
	return (
		<ChoiceFrame
			choice={choice}
			sub="Top resolves first."
			footer={
				<>
					<Pill onClick={() => confirmChoice(choice.pending)}>
						Auto (as listed)
					</Pill>
					<Pill primary onClick={() => confirmChoice(order)}>
						Resolve in this order
					</Pill>
				</>
			}
		>
			<ol className="pb-order">
				{order.map((ref, i) => (
					<li key={`${ref.card}#${ref.opIndex}`}>
						<span className="pb-idx">{i + 1}</span>
						<OpRow opRef={ref} />
						<MoveButtons i={i} n={order.length} move={move} />
					</li>
				))}
			</ol>
		</ChoiceFrame>
	)
}

function TriggersSheet({ choice }: { choice: Of<'OPTIONAL_TRIGGERS'> }) {
	const [picked, setPicked] = useState<OperationRef[]>([])
	const has = (r: OperationRef) =>
		picked.some((p) => p.card === r.card && p.opIndex === r.opIndex)
	const toggle = (r: OperationRef) =>
		setPicked((prev) =>
			has(r)
				? prev.filter((p) => !(p.card === r.card && p.opIndex === r.opIndex))
				: [...prev, r],
		)
	return (
		<ChoiceFrame
			choice={choice}
			sub="Use any number, including none; they resolve in the order you pick them."
			footer={
				<>
					<Pill onClick={() => confirmChoice([])}>Skip all</Pill>
					<Pill primary onClick={() => confirmChoice(picked)}>
						Use selected ({picked.length})
					</Pill>
				</>
			}
		>
			<ul className="pb-order">
				{choice.offered.map((ref) => (
					<li
						key={`${ref.card}#${ref.opIndex}`}
						className={has(ref) ? 'pb-on' : ''}
					>
						<OpRow opRef={ref} />
						<button
							type="button"
							className={`pb-pill${has(ref) ? ' pb-primary' : ''}`}
							aria-pressed={has(ref)}
							onClick={() => toggle(ref)}
						>
							{has(ref)
								? `✓ ${picked.findIndex((p) => p.card === ref.card && p.opIndex === ref.opIndex) + 1}`
								: 'Use'}
						</button>
					</li>
				))}
			</ul>
		</ChoiceFrame>
	)
}

function OrderCardsSheet({ choice }: { choice: Of<'ORDER_CARDS'> }) {
	const [order, move] = useOrderState<CardInstanceId>(choice.cards)
	return (
		<ChoiceFrame
			choice={choice}
			sub="Top of the list goes on top."
			footer={
				<Pill primary onClick={() => confirmChoice(order)}>
					Confirm order
				</Pill>
			}
		>
			<ol className="pb-order">
				{order.map((iid, i) => (
					<li key={iid}>
						<span className="pb-idx">{i + 1}</span>
						<div className="pb-order-tile">
							<CardTile iid={iid} interactive={false} />
						</div>
						<MoveButtons i={i} n={order.length} move={move} />
					</li>
				))}
			</ol>
		</ChoiceFrame>
	)
}

function WitnessSheet({ choice }: { choice: Of<'CHOOSE_WITNESS'> }) {
	return (
		<ChoiceFrame choice={choice} sub="Pick the set of cards that meets it.">
			{choice.sets.map((set, si) => (
				<div key={si} className="pb-witness">
					<div className="pb-lbl">Set {si + 1}</div>
					<div className="pb-cands">
						{set.map((iid) => (
							<CardTile key={iid} iid={iid} interactive={false} />
						))}
					</div>
					<Pill primary onClick={() => confirmChoice(set)}>
						Choose set {si + 1}
					</Pill>
				</div>
			))}
		</ChoiceFrame>
	)
}
