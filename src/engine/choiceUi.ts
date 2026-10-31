// Type-level UI contract for the choice panel (todo/07 §5, docs/ui-spec.md §4).
//
// `PendingChoice` (resolver/choices.ts) is the single source of truth for what
// a choice carries; this module names each kind's RENDERABLE payload so the
// React renderers (todo/14) can key on it without re-deriving rules. Content
// comes from data: the resolver derives labels/candidates/enabled flags +
// reasons from the card def's text where sensible. A pending choice is already
// this shape and is plain JSON — no re-derivation needed to render it.

import type {
	PendingChoice,
	ChoiceOption,
	ChoiceDisabledCard,
} from './resolver/choices'
import type { CardInstanceId } from './ids'
import type { MarketSuit, TraitId, SpecialtyId } from '../data/ids'
import type { OperationRef } from './state'
import type { Seat } from './resolver/queries'

/** The frame every choice panel renders: prompt, deciding seat (rules/12
 *  §12.14 — the deciding player is often NOT the active player), and the card
 *  whose effect caused the choice (null for phase-level prompts). */
export interface ChoiceUiBase<T extends PendingChoice['k']> {
	kind: T
	id: string
	seat: Seat
	prompt: string
	sourceCard: CardInstanceId | null
}

export type ChoiceConfirmUi = ChoiceUiBase<'CONFIRM'>
export interface ChoiceOptionUi extends ChoiceUiBase<'CHOOSE_OPTION'> {
	options: ChoiceOption[] // enabled=false rows are greyed with `reason`
}
export interface ChoiceCardsUi extends ChoiceUiBase<'CHOOSE_CARDS'> {
	candidates: CardInstanceId[] // may also list `disabled` cards
	disabled?: ChoiceDisabledCard[] // greyed with a tooltip (todo/07 §5)
	hidden?: CardInstanceId[] // face-down candidates ("top of the X deck (unknown)")
	min: number
	max: number
	from: string
	optional?: boolean
}
export interface ChoiceLocationUi extends ChoiceUiBase<'CHOOSE_LOCATION'> {
	candidates: CardInstanceId[]
}
export interface ChoiceSuitUi extends ChoiceUiBase<'CHOOSE_SUIT'> {
	suits: MarketSuit[]
}
export interface ChoiceTraitUi extends ChoiceUiBase<'CHOOSE_TRAIT'> {
	traits: TraitId[]
}
export interface ChoiceSpecialtyUi extends ChoiceUiBase<'CHOOSE_SPECIALTY'> {
	specialties: SpecialtyId[]
	gains?: Partial<Record<SpecialtyId, number>> // per track, after the clamp at 15
}
export interface ChoiceDestinationUi extends ChoiceUiBase<'CHOOSE_DESTINATION'> {
	card: CardInstanceId
	options: ('DECK_TOP' | 'DISCARD')[] // gain/scan placement — two-button prompt
}
export interface ChoiceAmountUi extends ChoiceUiBase<'CHOOSE_AMOUNT'> {
	min: number
	max: number
}
export interface ChoiceOrderOperationsUi extends ChoiceUiBase<'ORDER_OPERATIONS'> {
	pending: OperationRef[]
}
export interface ChoiceOptionalTriggersUi extends ChoiceUiBase<'OPTIONAL_TRIGGERS'> {
	offered: OperationRef[]
}
export interface ChoiceWitnessUi extends ChoiceUiBase<'CHOOSE_WITNESS'> {
	sets: CardInstanceId[][]
}
export interface ChoiceWildcardUi extends ChoiceUiBase<'CHOOSE_WILDCARD_AS'> {
	card: CardInstanceId
	traits: TraitId[]
}
export interface ChoiceOrderCardsUi extends ChoiceUiBase<'ORDER_CARDS'> {
	cards: CardInstanceId[]
}

/** The full renderable choice union (one React component per kind — todo/14). */
export type ChoiceUi =
	| ChoiceConfirmUi
	| ChoiceOptionUi
	| ChoiceCardsUi
	| ChoiceLocationUi
	| ChoiceSuitUi
	| ChoiceTraitUi
	| ChoiceSpecialtyUi
	| ChoiceDestinationUi
	| ChoiceAmountUi
	| ChoiceOrderOperationsUi
	| ChoiceOptionalTriggersUi
	| ChoiceWitnessUi
	| ChoiceWildcardUi
	| ChoiceOrderCardsUi
