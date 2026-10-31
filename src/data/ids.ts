// Machine ID enums — transcribed from rules/09-icon-reference.md (todo/03 §1).
// `as const` tuples give both the union literal type AND the runtime list the
// authoring tool renders dropdowns from. Never hand-maintain a second list in
// the UI — import these.

export const SUITS = [
	'PERSON',
	'CARGO',
	'SHIP',
	'ALLY',
	'ENCOUNTER',
	'INCIDENT',
	'LOCATION',
	'DIRECTIVE',
	'CAPTAIN',
	'STATUS',
	'MISSION',
] as const
export type Suit = (typeof SUITS)[number]

export const MARKET_SUITS = ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const
export type MarketSuit = (typeof MARKET_SUITS)[number]

export const SPECIES_TRAITS = [
	'ALIEN',
	'AENAR',
	'ANDORIAN',
	'ANDROID',
	'BAJORAN',
	'BETAZOID',
	'BORG',
	'BREEN',
	'CARDASSIAN',
	'CHANGELING',
	'FERENGI',
	'HUMAN',
	'JEM_HADAR',
	'KAZON',
	'KELPIEN',
	'KLINGON',
	'ORION',
	'PAKLED',
	'REMAN',
	'ROMULAN',
	'SYNTHETIC',
	'TELLARITE',
	'TRANSCENDENT',
	'TRILL',
	'VAU_NAKAT',
	'VORTA',
	'VULCAN',
	'XB',
	'XINDI',
] as const
export type SpeciesTrait = (typeof SPECIES_TRAITS)[number]

export const REGULAR_TRAITS = [
	'AMBASSADOR',
	'ANOMALY',
	'AUGMENT',
	'BEVERAGE',
	'BUSINESS',
	'CLOAK',
	'COMMUNICATION',
	'CREATURE',
	'DOCTOR',
	'DOMINION',
	'ENGINEER',
	'HELMET',
	'HOLOGRAM',
	'IMPERIAL',
	'MIND_CONTROL',
	'NX_01',
	'OPS',
	'PILOT',
	'MAQUIS',
	'SCIENTIST',
	'SECURITY',
	'SHADY',
	'SPY',
	'STARBASE',
	'STARFLEET',
	'TELEPATH',
	'TIME_TRAVEL',
	'WEAPON',
] as const
export type RegularTrait = (typeof REGULAR_TRAITS)[number]

export const GAMEPLAY_TRAITS = [
	'ATTACK',
	'ONGOING',
	'SURPRISE',
	'WILDCARD',
] as const
export type GameplayTrait = (typeof GAMEPLAY_TRAITS)[number]

export const TRAITS = [
	...SPECIES_TRAITS,
	...REGULAR_TRAITS,
	...GAMEPLAY_TRAITS,
] as const
export type TraitId = (typeof TRAITS)[number]

export const SPECIALTIES = ['RESEARCH', 'INFLUENCE', 'MILITARY'] as const
export type SpecialtyId = (typeof SPECIALTIES)[number]

export const RESOURCES = ['DIL', 'LAT', 'GLO'] as const
export type ResourceId = (typeof RESOURCES)[number]

export const DECKS = [
	'COMMON',
	// crew decks, by their card-number code (1PIC01/24 …)
	'PIC',
	'SIS',
	'SEL',
	'SHR',
	'BUR',
	'KOL',
	// fan-made custom crew decks (not part of the published game; names, text
	// and art come from a custom pack, src/data/custom/)
	'MAL',
	// the solo Directives (rules/13 §13.14, rules/14 §14.4): no crew of their
	// own, set up only in a solo game
	'SOLO',
] as const
export type DeckId = (typeof DECKS)[number]

export const START_POSITIONS = [
	'AVAILABLE',
	'RESERVE',
	'DEVELOPMENT',
	'DISCARD',
	'DEPLOYED',
	'CONTROLLED_LOCATION',
	'INCIDENT_DECK',
] as const
export type StartPosition = (typeof START_POSITIONS)[number]

export const OPERATION_TYPES = [
	'PLAY',
	'ACTIVATION',
	'PASSIVE',
	'REACTION',
	'RESUPPLY',
	'CLEANUP',
	'CONTROL',
	'ENDGAME',
	'SPECIAL',
	// "SURPRISE (Bot only)": resolved instead of an Automated Command row when
	// the solo Bot resolves the card (rules/13 §13.6.3)
	'SURPRISE',
] as const
export type OperationType = (typeof OPERATION_TYPES)[number]

// Skill / focus icons (rules/09 §9.1). Listed in the same order the game prints them.
export const SKILL_ICONS = [
	'SKILL_RESEARCH',
	'SKILL_INFLUENCE',
	'SKILL_MILITARY',
	'SKILL_ANY',
	'SKILL_VARIABLE',
] as const
export type SkillIcon = (typeof SKILL_ICONS)[number]

export const FOCUS_ICONS = [
	'FOCUS_RESEARCH',
	'FOCUS_INFLUENCE',
	'FOCUS_MILITARY',
] as const
export type FocusIcon = (typeof FOCUS_ICONS)[number]

// Box-unused IDs (rules/12 §12.30): recognised-but-inert so expansion data
// doesn't crash the engine. The validator warns (never errors) when a card uses one.
export const NOT_IN_THIS_BOX = new Set([
	'JEM_HADAR',
	'VORTA',
	'XB',
	'HELMET',
	'MIND_CONTROL',
])

// Suit MISSION is also box-unused (rules/12 §12.30) but lives outside
// NOT_IN_THIS_BOX because it is a valid suit enum value — the validator checks
// it explicitly. (The SURPRISE trait was the other one, until the official solo
// Bot made it live — rules/13 §13.6.3.)
export const NOT_IN_THIS_BOX_SUITS = new Set(['MISSION'])
export const NOT_IN_THIS_BOX_TRAITS = new Set<string>()

// Helpers — DIFFERENT_SPECIES (docs/effect-dsl.md §5) needs these to decide which
// traits are species-bearing before performing the bipartite matching.
export function isSpecies(t: TraitId): boolean {
	return (SPECIES_TRAITS as readonly string[]).includes(t)
}

export function isGameplayTrait(t: TraitId): boolean {
	return (GAMEPLAY_TRAITS as readonly string[]).includes(t)
}
