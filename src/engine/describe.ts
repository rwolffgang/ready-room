// describe.ts — effect-tree → English (todo/11 §2).
//
// Renders an Effect tree back into the SAME vocabulary and icon tokens the
// card records (cards/records/core/*.json) use, so the implementing LLM can
// diff describe(effect) against a record text without the card image. This is
// the round-trip substitute for looking at the card:
//
//   record text  →  effect tree  →  describe()  →  English  →  diff vs. record
//
// Conventions (kept in lock-step with docs/effect-dsl.md §7 + the records):
//   - resources render as {DIL} / {LAT} / {GLO};
//   - suits and traits render in ALL-CAPS (ALLY, CARGO, SHIP, …);
//   - PAY_THEN joins cost and body with " to " (the §12.1 cost/benefit seam);
//   - SEQ separates steps with ". " (plain sequence, nothing conditional);
//   - MAY renders "You may …"; CHOOSE_ONE renders "either … or …";
//   - {ACTION} (from COST_ACTION / operation.costsAction) is the action cost;
//   - [ATTACK] (operation.isAttack) is the ATTACK prefix.
//
// Function is TOTAL: every one of the 63 node kinds renders something sensible
// (real English where the DSL has it; a parenthetical placeholder for the few
// authoring-only nodes like LET / MODIFIER_ATTACH). The game UI reuses this for
// tooltips (docs/ui-spec.md §3).

import { cardNameById } from '../data/cardNames'
import type { Effect, Operation, TriggerSpec } from './resolver/nodes'
import type {
	Amount,
	CardFilter,
	LocationQuery,
	MarketQuery,
	Predicate,
	Query,
	ZoneSpec,
} from './resolver/queries'
import type { ResourceId, SpecialtyId, Suit } from '../data/ids'
import { describeModifier } from './modifiers'

// ---------------------------------------------------------------------------
// Small vocabulary helpers
// ---------------------------------------------------------------------------

const RESOURCE_TOKEN: Record<ResourceId, string> = {
	DIL: '{DIL}',
	LAT: '{LAT}',
	GLO: '{GLO}',
}

function resourceToken(res: ResourceId): string {
	return RESOURCE_TOKEN[res]
}

/** Bare suit name in record caps: "ALLY", "CARGO". */
function suitWord(suit: Suit): string {
	return suit
}

function specialtyWord(s: SpecialtyId): string {
	return s
}

/** Article for a bare noun ("SHIP" → "a", "ALLY" → "an"). */
function articleFor(noun: string): string {
	return 'AEIO'.includes(noun.charAt(0)) ? 'an' : 'a'
}

function withArticle(noun: string): string {
	return noun.startsWith('a ') || noun.startsWith('an ')
		? noun
		: `${articleFor(noun)} ${noun}`
}

/** Strip a trailing period and de-capitalise, so a sentence embeds in " …". */
function phrase(sentence: string): string {
	const stripped = sentence.endsWith('.') ? sentence.slice(0, -1) : sentence
	return stripped.charAt(0).toLowerCase() + stripped.slice(1)
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

// ---------------------------------------------------------------------------
// The opponent's side (FORCE / OPPONENT)
// ---------------------------------------------------------------------------
//
// A FORCE / OPPONENT body is resolved by the opponent, so render() words it as
// they would read it: "discard a card from your hand", "you may draw a card".
// Told to the reader that is "force your opponent to discard a card from their
// hand", "your opponent may draw a card". While such a body renders,
// `opponentActs` is set and SEQ / IF / FOR_EACH start each command the
// opponent carries out with SUBJECT; forOpponent() then swaps the pronouns and
// fills those marks. A FORCE / OPPONENT inside one hands the effect back to the
// reader, so its text is already in the reader's words: it is fenced with
// OWN_START / OWN_END and the swap leaves it alone.

/** True while rendering a body the reader's opponent resolves. */
let opponentActs = false
/** bind name → written while the opponent acts ("If they do"). */
const bindSide = new Map<string, boolean>()

const SUBJECT = '\u0001'
const OWN_START = '\u0002'
const OWN_END = '\u0003'

/** Does this node's English open with a bare command ("Discard …"), which
 *  takes a subject when the opponent carries it out? */
function isCommand(node: Effect): boolean {
	switch (node.k) {
		case 'SEQ':
			return node.steps[0] !== undefined && isCommand(node.steps[0])
		case 'MAY':
		case 'IF':
		case 'FOR_EACH':
		case 'LET':
		case 'FORCE':
		case 'OPPONENT':
			return false
		default:
			return true
	}
}

/** Can this node's English follow "… to"? A command or a FORCE can. */
function followsTo(node: Effect): boolean {
	if (node.k === 'SEQ')
		return node.steps[0] !== undefined && followsTo(node.steps[0])
	return node.k === 'FORCE' || isCommand(node)
}

/** `text` (node's English), marked as a command the opponent carries out. */
function theyDo(node: Effect, text: string): string {
	return opponentActs && isCommand(node)
		? SUBJECT + text.charAt(0).toLowerCase() + text.slice(1)
		: text
}

/** Every name a step of `body` binds (DID only reads them). */
function bindsIn(body: unknown, out: string[] = []): string[] {
	if (Array.isArray(body)) for (const v of body) bindsIn(v, out)
	else if (body !== null && typeof body === 'object') {
		const node = body as Record<string, unknown>
		if (node.k !== 'DID' && typeof node.bind === 'string') out.push(node.bind)
		for (const v of Object.values(node)) bindsIn(v, out)
	}
	return out
}

/** "take" → "takes", for "your opponent takes …". */
function thirdPerson(verb: string): string {
	if (['may', 'must', 'can', 'cannot', 'either'].includes(verb)) return verb
	if (verb === 'have') return 'has'
	if (verb === 'do') return 'does'
	if (/(s|sh|ch|x|z)$/.test(verb)) return `${verb}es`
	if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`
	return `${verb}s`
}

/** The opponent's words → the reader's: "your" → "their", "you" → "they",
 *  and "your opponent" (the reader) → "you". */
const SWAP: Record<string, string> = {
	"your opponent's": 'your',
	'your opponent has': 'you have',
	'your opponent does': 'you do',
	'your opponent owns': 'you own',
	'your opponent': 'you',
	your: 'their',
	you: 'they',
}
const SWAP_RE = new RegExp(
	`${OWN_START}[^${OWN_END}]*${OWN_END}|\\b(${Object.keys(SWAP).join('|')})\\b`,
	'gi',
)
const SUBJECT_RE = new RegExp(
	`${OWN_START}[^${OWN_END}]*${OWN_END}|${SUBJECT}(\\w+)|\\b(they) (\\w+)`,
	'gi',
)

/** A FORCE / OPPONENT body, rendered from the opponent's side, in the
 *  reader's words. The first subject names them ("force your opponent to …",
 *  "your opponent takes …", "if your opponent has …"); later commands read
 *  "force them to …" (FORCE) or "they …" (OPPONENT). */
function forOpponent(text: string, force: boolean): string {
	const swapped = text.replace(SWAP_RE, (m, word: string | undefined) => {
		if (word === undefined) return m
		const to = SWAP[word.toLowerCase()]!
		return word.charAt(0) === 'Y' ? capitalise(to) : to
	})
	let named = false
	const filled = swapped.replace(
		SUBJECT_RE,
		(m, cmd: string | undefined, they: string | undefined, verb: string) => {
			if (cmd === undefined && they === undefined) return m
			if (cmd !== undefined) {
				const lead = !named
				named = true
				if (force)
					return `${lead ? 'force your opponent' : 'force them'} to ${cmd}`
				return lead ? `your opponent ${thirdPerson(cmd)}` : `they ${cmd}`
			}
			if (named) return m
			named = true
			const subject = `your opponent ${thirdPerson(verb)}`
			return they === 'They' ? capitalise(subject) : subject
		},
	)
	// sentence starts (also one opening a fenced reader's sentence), then unfence
	return filled
		.replace(
			new RegExp(`(^|[.!?] )(${OWN_START}?)([a-z])`, 'g'),
			(_m, before: string, fence: string, c: string) =>
				before + fence + c.toUpperCase(),
		)
		.replace(new RegExp(`[${OWN_START}${OWN_END}]`, 'g'), '')
}

/** FORCE / OPPONENT: `body` resolved by the other player. */
function renderOtherSide(body: Effect, force: boolean): string {
	const nested = opponentActs
	for (const name of bindsIn(body)) bindSide.set(name, !nested)
	opponentActs = !nested
	let text: string
	try {
		text = render(body)
	} finally {
		opponentActs = nested
	}
	if (nested) {
		// handed back to the reader inside the opponent's text: "you gain 1 {GLO}"
		const own = isCommand(body) ? `you ${phrase(text)}` : phrase(text)
		return `${OWN_START}${own}${OWN_END}.`
	}
	return forOpponent(
		isCommand(body) ? `${SUBJECT}${phrase(text)}.` : text,
		force,
	)
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** Render an Amount as a plain phrase ("2", "up to 5", "your {DIL}"). */
export function describeAmount(amount: Amount): string {
	if (typeof amount === 'number') return String(amount)
	switch (amount.k) {
		case 'COUNT':
			return `the number of ${describeQuery(amount.query)}`
		case 'SPECIALTY':
			return `your ${specialtyWord(amount.specialty)}`
		case 'RESOURCE':
			return `your ${resourceToken(amount.res)}`
		case 'UNUSED_ACTIONS':
			return 'your unused actions'
		case 'MIN':
			return `the lesser of ${amount.terms.map(describeAmount).join(' and ')}`
		case 'MAX':
			return `the greater of ${amount.terms.map(describeAmount).join(' and ')}`
		case 'SUM':
			return amount.terms.map(describeAmount).join(' plus ')
		case 'UP_TO':
			return `up to ${describeAmount(amount.max)}`
		case 'PER':
			return `1 for every ${amount.every} ${perBasePhrase(amount.of)}`
		case 'ICON_COUNT':
			return `the ${amount.kind === 'SKILL' ? 'Skill' : 'Focus'} icons of the ${amount.bind} card`
		case 'SKILL_ICONS':
			return amount.specialty === 'CHOSEN'
				? 'your matching Skill icons in play (excluding beamed cards)'
				: `your ${specialtyWord(amount.specialty)} Skill icons in play (excluding beamed cards)`
		case 'TRAIT_COUNT':
			return `the number of traits of the ${amount.bind} card`
		case 'SHARED_TRAITS':
			return `the number of traits the ${amount.bind} card shares with ${traitPartnerTarget(amount.with)}`
	}
}

/** A "1 for every N" divisor rolled up out of an Amount. Handles a bare PER
 *  Amount and a MIN[PER, fixed] cap (the "…(max N cards)" cards). Returns the
 *  divisor, the underlying base amount, and an optional `cap` (the fixed MAX
 *  sibling — "…, max N") — or undefined when not a divisor. */
function perOf(
	amount: Amount,
): { every: number; base: Amount; cap?: number } | undefined {
	if (typeof amount !== 'object' || amount === null) return undefined
	if (amount.k === 'PER') return { every: amount.every, base: amount.of }
	if (amount.k === 'MIN') {
		for (const t of amount.terms) {
			const p = perOf(t)
			if (p !== undefined) {
				const capTerm = amount.terms.find((t2) => typeof t2 === 'number')
				return typeof capTerm === 'number' ? { ...p, cap: capTerm } : p
			}
		}
	}
	return undefined
}

/** "…(max N cards)" tail for a capped divisor, or empty when uncapped. */
function perCapTail(per: { cap?: number }): string {
	return per.cap !== undefined
		? ` (max ${per.cap}${per.cap === 1 ? ' card' : ' cards'})`
		: ''
}

/** The noun phrase under a PER divisor: a COUNT base renders its query
 *  directly ("ANOMALY you have in play"), anything else renders as an amount
 *  ("your {DIL}"). */
function perBasePhrase(base: Amount): string {
	return typeof base === 'object' && base !== null && base.k === 'COUNT'
		? describeQuery(base.query)
		: describeAmount(base)
}

// ---------------------------------------------------------------------------
// Filters / zones / queries
// ---------------------------------------------------------------------------

/** Bare noun for a CardFilter: "SHIP", "SHADY", "BORG or STARFLEET", "a card".
 *  No article — callers add one for target phrases ("beam a SHIP"). */
export function describeFilter(filter: CardFilter | undefined): string {
	if (filter === undefined) return 'a card'
	const parts: string[] = []
	if (filter.suits !== undefined && filter.suits.length > 0)
		parts.push(...filter.suits.map(suitWord))
	if (filter.traits !== undefined && filter.traits.length > 0)
		parts.push(...filter.traits)
	if (filter.allTraits !== undefined && filter.allTraits.length > 0)
		parts.push(...filter.allTraits.map((t) => `${t}`))
	if (filter.ids !== undefined)
		parts.push(
			filter.ids.length > 0
				? [...new Set(filter.ids.map(cardNameById))].join(' or ')
				: 'an unprinted card',
		)
	if (filter.exhibits !== undefined && filter.exhibits.length > 0) {
		parts.push(`a ${filter.exhibits.map(specialtyWord).join(' or ')} icon card`)
	}
	if (filter.focus !== undefined && filter.focus.length > 0) {
		parts.push(`a ${filter.focus.map(specialtyWord).join('/')} Focus card`)
	}
	if (filter.minVp !== undefined) parts.push(`with ${filter.minVp}+ VP`)
	if (filter.not !== undefined) parts.push(`non-${describeFilter(filter.not)}`)
	if (parts.length === 0) return 'a card'
	const noun = parts.join(' or ')
	// single suit/trait: bare form ("SHIP", "CARGO") so "for each SHIP you own" reads right
	return noun
}

/** For COST_RECALL / COST_LOG: "from in play" (default) or "from <explicit
 *  zone(s)>". zonePhrase already prefixes its own "from " for concrete zones,
 *  so avoid doubling it. An array means "hand OR those zones" (1BUR22
 *  "from your hand or Discard pile"). */
function inPlayFrom(from: ZoneSpec | ZoneSpec[] | undefined): string {
	if (from === undefined || from === 'IN_PLAY' || from === 'ALL_OWNED')
		return ' from in play'
	const zones = Array.isArray(from) ? from : [from]
	const zp = zones
		.map((z) => (z === 'IN_PLAY' ? 'from play' : zonePhrase([z], 'SELF')))
		.join(' or ')
	return ` ${zp.startsWith('from ') ? zp : `from ${zp}`}`
}

/** Whose a per-player zone (`{ k: 'HAND', seat }`) is, relative to the actor;
 *  undefined for the shared and whole-owner zones. */
function zoneOwner(z: ZoneSpec): 'SELF' | 'OPPONENT' | undefined {
	if (typeof z !== 'object' || !('seat' in z)) return undefined
	return z.seat === 1 ? 'OPPONENT' : 'SELF'
}

/** Zone qualifier for a query: "you own", "you have in play", "in your hand". */
function zonePhrase(
	zones: ZoneSpec[],
	seat: 'SELF' | 'OPPONENT' | 'ANY' | undefined,
): string {
	if (zones.length === 0) return ''

	if (zones.length === 1) {
		const z = zones[0]!
		// a per-player zone is the actor's (seat 0) or their opponent's (seat 1),
		// whatever the query's seat (resolveQuery.ts header)
		const owner = zoneOwner(z) ?? seat
		const fromWord = (s: string): string =>
			owner === 'OPPONENT'
				? `from your opponent's ${s}`
				: owner === 'ANY'
					? `from any player's ${s}`
					: `from your ${s}`
		if (z === 'ALL_OWNED')
			return seat === 'OPPONENT' ? 'your opponent owns' : 'you own'
		if (z === 'IN_PLAY')
			return seat === 'OPPONENT'
				? 'your opponent has in play'
				: 'you have in play'
		if (z === 'BEAMED_ANY') return 'beamed to one of your cards'
		if (z === 'BEAMED_TO_SHIP') return 'beamed to a SHIP'
		// "a LOCATION" = any Location you may reach (controlled or neutral)
		if (z === 'LOCATIONS') return ''
		if (z === 'NEUTRAL_LOCATIONS') return 'in the Neutral Zone'
		switch (z.k) {
			case 'BEAMED_TO':
				return 'host' in z ? 'beamed here' : `beamed to the ${z.bound} card`
			case 'HAND':
				return fromWord('hand')
			case 'DRAW':
				return fromWord('deck')
			case 'DISCARD':
				return fromWord('Discard pile')
			case 'RESERVE':
				return fromWord('Reserve')
			case 'DEVELOPMENT':
				return fromWord('Development pile')
			case 'LOG':
				return fromWord('Log')
			case 'STAGING':
				return fromWord('Staging Area')
			case 'FLEET':
				return fromWord('Fleet')
			case 'LOCATION_AREA':
				return fromWord('Location area')
			case 'DUTY_OFFICER':
				return fromWord('Duty Officer')
			case 'CAPTAIN':
				return fromWord('Captain')
			case 'STATUS':
				return fromWord('Status card')
			case 'JUNK':
				return 'from the Junk'
			case 'INCIDENT_DECK':
				return 'from the Incident deck'
			case 'ENCOUNTER_DECK':
				return 'from the Encounter deck'
			case 'LOCATION_DECK':
				return 'from the Location deck'
			case 'NEUTRAL_ZONE':
				return 'in the Neutral Zone'
			case 'STARDATE_PILE':
				return 'from the Stardate pile'
			case 'BOX':
				return 'from the box'
			case 'MARKET_OFFER':
				return 'from the Market'
			case 'MARKET_DECK':
				return `from the ${suitWord(z.suit)} Market deck`
			case 'BEAMED':
				return `beamed to ${z.host}`
		}
	}
	return zones.map((z) => zonePhrase([z], seat)).join(' or ')
}

/** A Query as a noun phrase: "SHIP you have in play", "card from your Discard
 *  pile", "ALLY you own". Bare form — callers add articles for targets. */
export function describeQuery(query: Query): string {
	if (query.thisCard === true) return 'this card'
	const head = describeFilter(query.filter)
	if (query.atThisShip === true)
		return query.withShip !== undefined &&
			query.withShip !== false &&
			query.shipSeat === 'OPPONENT'
			? `${head} where this ship is, if your opponent has a SHIP there`
			: `${head} where this ship is`
	if (query.atBound !== undefined) return `the ${query.atBound} card's ${head}`
	if (query.secured === true) return `${head} you have secured`
	const zone = zonePhrase(query.zones, query.seat)
	const tail =
		shipPhrase(query) +
		(query.exceptThis === true ? ' (excluding this card)' : '')
	if (zone === '') return `${head}${tail}`
	return `${head} ${zone}${tail}`
}

/** " where you have a SHIP" for a `withShip` query (whose: `shipSeat`). */
function shipPhrase(query: Query): string {
	if (query.withShip === undefined || query.withShip === false) return ''
	const ship = query.withShip === true ? 'SHIP' : describeFilter(query.withShip)
	const a = /^[AEIOU]/i.test(ship) ? 'an' : 'a'
	if (query.shipSeat === 'OPPONENT')
		return ` where your opponent has ${a} ${ship}`
	if (query.shipSeat === 'ANY') return ` where there is ${a} ${ship}`
	return ` where you have ${a} ${ship}`
}

/** A CardQuery as a target noun: "a SHIP you have in play", "a card from your
 *  hand", "an ALLY". */
function describeCardTarget(q: Query): string {
	const noun = describeQuery(q)
	if (noun === 'a card' || q.thisCard === true) return noun
	return withArticle(noun)
}

/** A Location/Market query as a target noun. */
function describeLocation(q: LocationQuery | MarketQuery): string {
	return withArticle(describeQuery(q))
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** Render a Predicate used inside IF ("you have 2 or more ANOMALY in play"). */
export function describePredicate(pred: Predicate): string {
	switch (pred.k) {
		case 'SPECIALTY_AT_LEAST':
			return `your ${specialtyWord(pred.specialty)} is at least ${pred.value}`
		case 'COUNT_AT_LEAST': {
			const zones = pred.query.zones
			if (
				!opponentActs &&
				zones.length > 0 &&
				zones.every((z) => zoneOwner(z) === 'OPPONENT')
			)
				return `your opponent has at least ${pred.value} ${describeQuery(pred.query).replace(/your opponent's /g, 'their ')}`
			return `you have at least ${pred.value} ${describeQuery(pred.query)}`
		}
		case 'HAS_TRAIT_IN_PLAY':
			return pred.count !== undefined && pred.count > 1
				? `you have ${pred.count} or more ${pred.trait} in play`
				: `you have a ${pred.trait} in play`
		case 'DIFFERENT_SPECIES_IN_PLAY':
			return `you have ${pred.count} different species${
				pred.filter?.not !== undefined
					? ` (excluding ${describeFilter(pred.filter.not)})`
					: ''
			} in play${
				pred.eachDistinct !== undefined
					? ` (each ${pred.eachDistinct.join(' and each ')} counts as a different one)`
					: ''
			}`
		case 'SAME_SHIP':
			return `you have ${pred.requirements
				.map((r) => {
					const n = r.count ?? 1
					const what =
						r.filter !== undefined ? describeFilter(r.filter) : 'card'
					if (r.different === 'SPECIES')
						return `${n} different species${r.filter?.not !== undefined ? ` (excluding ${describeFilter(r.filter.not)})` : ''}`
					if (r.different !== undefined)
						return `${n} different of ${r.different.join(' / ')}`
					return n === 1 ? withArticle(what) : `${n} ${what}`
				})
				.join(' and ')} on the same SHIP`
		case 'CONTROLS_LOCATION':
			return `you control ${pred.count} or more Locations`
		case 'CAPTAIN_HAS_TRAIT':
			return `your captain has ${pred.trait}`
		case 'TOTAL_VP_AT_LEAST':
			return `you have ${pred.value}+ value`
		case 'COLLECTIVE_AT_LEAST':
			return `you have ${pred.value}+ collective value`
		case 'IS_SOLO_BOT':
			return 'this card is owned by the Bot'
		case 'COMPARE':
			return `${describeAmount(pred.a)} is ${pred.op === 'LT' ? 'lower than' : 'at least'} ${describeAmount(pred.b)}`
		case 'AWAY_TEAMS_AT': {
			const who =
				pred.seat === 'OPPONENT'
					? 'your opponent has'
					: pred.seat === 'ANY'
						? 'there are'
						: 'you have'
			return `${who} ${pred.value} or more AWAY TEAMS at ${withArticle(describeQuery(pred.at))}`
		}
		case 'DID': {
			// "if they do" when the bound step was the other player's
			const binds = Array.isArray(pred.bind) ? pred.bind : [pred.bind]
			const who = binds.every(
				(b) => (bindSide.get(b) ?? false) === opponentActs,
			)
				? 'you do'
				: opponentActs
					? 'your opponent does'
					: 'they do'
			return binds.length > 1
				? binds.length === 2
					? `${who} both`
					: `${who} all of them`
				: who
		}
		case 'BOUND_IS':
			return `the ${pred.bind} card is ${describeFilter(pred.filter)}`
		case 'BOUND_SHARES_TRAIT':
			return `the ${pred.bind} card shares at least one trait with ${traitPartnerTarget(pred.with)}`
		case 'LOG_LEGAL': {
			const what =
				pred.filter !== undefined
					? withArticle(describeFilter(pred.filter))
					: 'a card'
			const from =
				pred.from !== undefined && pred.from !== 'IN_PLAY'
					? ` in ${describeZoneSpec(pred.from)}`
					: ' in play'
			return `there is ${what} you can log${from}`
		}
		case 'AND':
			return pred.terms.map(describePredicate).join(' and ')
		case 'OR':
			return pred.terms.map(describePredicate).join(' or ')
		case 'NOT':
			return `not ${describePredicate(pred.term)}`
	}
}

/** The comparison target of a BOUND_SHARES_TRAIT predicate. A CAPTAIN-zone
 *  query reads as "your captain"; anything else renders as a card noun. */
function traitPartnerTarget(withQuery: Query): string {
	if (
		withQuery.zones.length === 1 &&
		typeof withQuery.zones[0] === 'object' &&
		withQuery.zones[0]!.k === 'CAPTAIN'
	) {
		return 'your captain'
	}
	return withArticle(describeQuery(withQuery))
}

// ---------------------------------------------------------------------------
// Bare-zone phrases (COST_PUT / place targets)
// ---------------------------------------------------------------------------

export function describeZoneSpec(z: ZoneSpec): string {
	if (z === 'ALL_OWNED') return 'all your cards'
	if (z === 'IN_PLAY') return 'your cards in play'
	if (z === 'LOCATIONS') return 'a LOCATION'
	if (z === 'NEUTRAL_LOCATIONS') return 'the Neutral Zone'
	if (typeof z === 'string') return z
	const your = zoneOwner(z) === 'OPPONENT' ? "your opponent's" : 'your'
	switch (z.k) {
		case 'BEAMED_TO':
			return 'host' in z ? 'beamed here' : `beamed to the ${z.bound} card`
		case 'HAND':
			return `${your} hand`
		case 'DRAW':
			return `the top of ${your} deck`
		case 'DISCARD':
			return `${your} Discard pile`
		case 'RESERVE':
			return `${your} Reserve`
		case 'DEVELOPMENT':
			return `${your} Development pile`
		case 'LOG':
			return `${your} Log`
		case 'STAGING':
			return `${your} Staging Area`
		case 'FLEET':
			return `${your} Fleet`
		case 'LOCATION_AREA':
			return `${your} Location area`
		case 'DUTY_OFFICER':
			return `${your} Duty Officer`
		case 'CAPTAIN':
			return `${your} Captain`
		case 'STATUS':
			return `${your} Status card`
		case 'BOT_ROW':
			return "the Bot's Staging row"
		case 'SUPPLEMENT':
			return "the Bot's Supplement deck"
		case 'REINFORCEMENT':
			return `${your} Reinforcement deck`
		case 'JUNK':
			return 'the Junk'
		case 'INCIDENT_DECK':
			return 'the Incident deck'
		case 'ENCOUNTER_DECK':
			return 'the Encounter deck'
		case 'LOCATION_DECK':
			return 'the Location deck'
		case 'NEUTRAL_ZONE':
			return 'the Neutral Zone'
		case 'STARDATE_PILE':
			return 'the Stardate pile'
		case 'BOX':
			return 'the box'
		case 'MARKET_OFFER':
			return 'the Market'
		case 'MARKET_DECK':
			return `the ${suitWord(z.suit)} Market deck`
		case 'BEAMED':
			return `beamed to ${z.host}`
	}
}

// ---------------------------------------------------------------------------
// The renderer — total over all 63 node kinds
// ---------------------------------------------------------------------------

function render(node: Effect): string {
	switch (node.k) {
		// -------- control (10) --------
		case 'SEQ':
			return node.steps
				.map((s, i) => (i === 0 ? render(s) : theyDo(s, render(s))))
				.join(' ')
		case 'MAY':
			return `You may ${phrase(render(node.body))}.`
		case 'CHOOSE_ONE':
			if (node.count !== undefined && node.count > 1)
				return `Choose ${node.count} of the following: ${node.options.map((o) => phrase(render(o.body))).join(' OR ')}.`
			return `Either ${node.options.map((o) => phrase(render(o.body))).join(' or ')}.`
		case 'PAY_THEN': {
			// "… to if …" doesn't read: a body that isn't a command gets a colon
			const to = followsTo(node.body) ? 'to' : 'to do the following:'
			return `${render(node.cost).replace(/\.$/, '')} ${to} ${phrase(render(node.body))}.`
		}
		case 'IF': {
			const branch = (e: Effect): string => theyDo(e, phrase(render(e)))
			const tail =
				node.else !== undefined ? ` Otherwise, ${branch(node.else)}.` : ''
			return `If ${describePredicate(node.cond)}, ${branch(node.then)}.${tail}`
		}
		case 'REPEAT':
			return `Repeat ${describeAmount(node.times)} times: ${phrase(render(node.body))}.`
		case 'FOR_EACH':
			return `For each ${describeQuery(node.over)}, ${theyDo(node.body, phrase(render(node.body)))}.`
		case 'LET':
			return `Let ${node.bind} equal ${
				node.value !== null &&
				typeof node.value === 'object' &&
				'zones' in node.value
					? describeQuery(node.value as Query)
					: describeAmount(node.value as Amount)
			}. ${render(node.body)}`
		case 'OPPONENT':
			return renderOtherSide(node.body, false)
		case 'NOOP':
			return 'Do nothing.'
		case 'PUT_ON_DECK_TOP':
			return node.target === 'THIS'
				? 'Put this card on the top of your deck.'
				: `Put ${describeCardTarget(node.target)} on the top of your deck.`

		// -------- costs (9) --------
		case 'COST_RESOURCE':
			return `Spend ${describeAmount(node.amount)} ${resourceToken(node.res)}.`
		case 'COST_ACTION':
			return 'Spend an {ACTION}.'
		case 'COST_DISCARD': {
			if (node.target === 'THIS') return 'Discard this card.'
			const what =
				node.filter !== undefined
					? describeFilter(node.filter)
					: node.count === 1
						? 'a card'
						: `${node.count} cards`
			const fromHand =
				node.whose === 'OPPONENT' ? "your opponent's hand" : 'your hand'
			return `Discard ${node.count === 1 ? '' : node.count + ' '}${what} from ${fromHand}.`
		}
		case 'COST_PUT': {
			if (node.target === 'THIS')
				return `Put this card on ${describeZoneSpec(node.to)}.`
			// "Put a DIRECTIVE / a SECURITY on the top of your deck…" — render the
			// count/filter so suit & trait tokens survive the fidelity round-trip
			// ("put a DIRECTIVE on the top of your deck").
			const what =
				node.filter !== undefined
					? node.count === 1
						? withArticle(describeFilter(node.filter))
						: `${node.count} ${describeFilter(node.filter)}`
					: node.count === 1
						? 'a card'
						: `${node.count} cards`
			const from =
				node.from === undefined
					? 'your hand'
					: (Array.isArray(node.from) ? node.from : [node.from])
							.map(describeZoneSpec)
							.join(' or ')
			return `Put ${what} from ${from} on ${describeZoneSpec(node.to)}.`
		}
		case 'COST_EXHAUST':
			if (node.target === 'THIS') return 'Exhaust this card.'
			return `Exhaust ${withArticle(describeFilter(node.filter))} you have in play.`
		case 'COST_REFRESH':
			if (node.target === 'THIS') return 'Refresh this card.'
			return `Refresh ${withArticle(describeFilter(node.filter))} you have in play.`
		case 'COST_REMOVE_AWAY_TEAM':
			if (node.distinct === true) {
				return `Remove an Away Team from ${node.count} different ${node.from !== undefined ? describeQuery(node.from) : 'Locations'}.`
			}
			return `Remove ${node.count} ${node.count === 1 ? 'Away Team' : 'Away Teams'}${
				node.from !== undefined
					? ` from ${withArticle(describeQuery(node.from))}`
					: ''
			}.`
		case 'COST_TAKE_INCIDENT':
			return `Take ${node.count} Incident card${node.count === 1 ? '' : 's'}.`
		case 'COST_DISMISS':
			if (node.target === 'THIS') return 'Dismiss this card.'
			return `Dismiss ${node.count} ${node.count === 1 ? 'card' : 'cards'} ${describeFilter(node.filter)}${node.from !== undefined && node.from !== 'IN_PLAY' ? ` ${describeZoneSpec(node.from)}` : ''}.`
		case 'COST_LOG_THIS':
			return 'Log this card.'
		case 'COST_REQUIRE':
			return `Only if ${describePredicate(node.cond)}.`
		case 'COST_RETURN_INCIDENT':
			return `Return ${node.count} ${node.count === 1 ? 'Incident' : 'Incidents'}${
				node.filter !== undefined ? ` ${describeFilter(node.filter)}` : ''
			} from your hand.`
		case 'COST_RECALL':
			if (node.target === 'THIS') return 'Recall this card.'
			return `Recall ${withArticle(describeFilter(node.filter))}${inPlayFrom(node.from)}.`
		case 'COST_LOG': {
			if (node.target === 'THIS') return 'Log this card.'
			return `Log ${withArticle(describeFilter(node.filter))}${inPlayFrom(node.from)}.`
		}
		case 'COST_BEAM': {
			if (node.target === 'THIS')
				return `Beam this card to ${describeCardTarget(node.to)}.`
			const what =
				node.count === 1
					? withArticle(describeFilter(node.filter))
					: `${node.count} cards`
			return `Beam ${what} to ${describeCardTarget(node.to)}.`
		}

		// -------- card movement (12) --------
		case 'BEAM': {
			const what =
				node.target === 'THIS'
					? 'this card'
					: node.count === 1
						? `${withArticle(describeFilter(node.filter))}`
						: `${node.count} cards`
			const fromPhrase =
				node.from !== undefined
					? ` ${zonePhrase(Array.isArray(node.from) ? node.from : [node.from], undefined)}`
					: ''
			return `Beam ${what}${fromPhrase} to ${describeCardTarget(node.to)}.`
		}
		case 'DEPLOY':
			return node.target.filter?.suits?.includes('SHIP') === true
				? 'Deploy this ship.'
				: 'Deploy this card.'
		case 'DESTROY':
			return node.target === 'THIS'
				? 'Destroy this card.'
				: `Destroy ${describeCardTarget(node.target)}.`
		case 'DISCARD': {
			if (node.from === 'DECK_TOP' && node.count === 1) {
				return node.whose === 'OPPONENT'
					? "Discard the top card of your opponent's deck."
					: 'Discard the top card of your deck.'
			}
			if (node.onlyBound !== undefined && node.count === 1)
				return node.onlyBound.length === 1
					? 'Discard it.'
					: 'Discard one of them.'
			const what =
				node.filter !== undefined
					? describeFilter(node.filter)
					: node.count === 1
						? 'a card'
						: 'cards'
			const fromZone =
				node.from === 'HAND'
					? node.whose === 'OPPONENT'
						? "opponent's hand"
						: 'hand'
					: 'deck'
			return `Discard ${node.count === 1 ? '' : node.count + ' '}${what} from your ${fromZone}.`
		}
		case 'DISMISS':
			return node.target === 'THIS'
				? 'Dismiss this card.'
				: `Dismiss ${describeCardTarget(node.target)}.`
		case 'DRAW': {
			if (node.fromBottom === true && node.count === 1)
				return 'Draw the bottom card of your deck.'
			const per = perOf(node.count)
			if (per !== undefined)
				return `Draw a card for every ${per.every} ${perBasePhrase(per.base)}${perCapTail(per)}.`
			return typeof node.count === 'number'
				? node.count === 1
					? 'Draw a card.'
					: `Draw ${node.count} cards.`
				: node.count.k === 'COUNT'
					? `Draw a card for each ${describeQuery(node.count.query)}.`
					: `Draw ${describeAmount(node.count)} cards.`
		}
		case 'DRAW_FROM_DISCARD':
			return `Draw ${node.count} ${node.count === 1 ? 'card' : 'cards'}${
				node.filter !== undefined ? ` ${describeFilter(node.filter)}` : ''
			} from your Discard pile.`
		case 'RECALL':
			return `Recall ${describeCardTarget(node.target)}.`
		case 'LOG':
			return node.target === 'THIS'
				? 'Log this card.'
				: `Log ${describeCardTarget(node.target)}.`
		case 'PROMOTE':
			if (node.target === 'THIS') return 'Promote this card to Duty Officer.'
			return `Promote ${describeFilter(node.filter)} from your ${node.from.toLowerCase()} to Duty Officer.`
		case 'JUNK':
			return `Junk ${describeCardTarget(node.target)}.`
		case 'PUT_INTO_STAGING':
			return `Put ${describeCardTarget(node.target)} into your Staging Area.`

		// -------- acquisition (8) --------
		case 'GAIN_CARD':
			return `Gain ${node.suits.map((s) => withArticle(suitWord(s))).join(' or ')}${
				node.onlyJunk === true
					? ' from the Junk'
					: node.includeJunk === true
						? ', including from the Junk'
						: ''
			}${
				node.to !== undefined && node.to.length === 1
					? node.to[0] === 'DISCARD'
						? ' to your Discard pile'
						: ' to the top of your deck'
					: ''
			}.`
		case 'SCAN_N':
			return `Scan ${describeAmount(node.n)} of ${node.suits.map(suitWord).join(' or ')}${
				node.includeJunk === true ? ', including from the Junk' : ''
			}.`
		case 'SCAN_FOR_TRAIT':
			return `Scan for ${withArticle(node.traits.join(' or '))}${
				node.includeJunk === true ? ', including from the Junk' : ''
			}${
				node.to !== undefined && node.to.length > 1
					? ', placing the gained card on top of your deck or in your Discard pile'
					: ''
			}.`
		case 'TAKE':
			if (node.deck === 'REINFORCEMENT')
				return `Take ${node.count === 1 ? 'a card' : `${node.count} cards`} from your Reinforcement pile.`
			return `Take ${node.count} ${node.deck === 'INCIDENT' ? 'Incident' : 'Encounter'} card${
				node.count === 1 ? '' : 's'
			}${node.look !== undefined ? `, look at the top ${node.look}` : ''}${
				node.returnUnpicked === true
					? ', returning the other to the bottom of its deck'
					: ''
			}${
				node.to === 'DISCARD'
					? ' to your Discard pile'
					: node.to === 'DECK_TOP'
						? ' onto the top of your deck'
						: node.to === 'DECK_BOTTOM'
							? ' and put it under your Draw deck'
							: ''
			}.`
		case 'SELECT':
			return `Select ${describeCardTarget(node.target)}.`
		case 'FIND':
			return `Find ${withArticle(describeFilter(node.filter))}${
				node.zones.length > 0 ? ` ${zonePhrase(node.zones, undefined)}` : ''
			}.`
		case 'RETURN_INCIDENT':
			return node.target === 'THIS'
				? 'Return this card to the bottom of the Incident deck.'
				: `Return ${describeCardTarget(node.target)} to the bottom of the Incident deck.`
		case 'ENLIST_RESERVE':
			return 'Enlist a Reserve.'
		case 'ENLIST_DEVELOPMENT':
			if (node.free === true)
				return node.filter !== undefined
					? `Enlist ${withArticle(describeFilter(node.filter))} for free.`
					: 'Enlist a Development for free.'
			if (node.discount !== undefined)
				return `Enlist a Development, reducing the cost by ${node.discount
					.map((d) =>
						Array.isArray(d.res)
							? `${describeAmount(d.amount)} ${d.res.map(resourceToken).join(' or ')} (your split)`
							: `${describeAmount(d.amount)} ${resourceToken(d.res)}`,
					)
					.join(' and ')}.`
			return 'Enlist a Development.'

		// -------- resources & actions (6) --------
		case 'GAIN_RESOURCE': {
			const per = perOf(node.amount)
			return per !== undefined
				? `Gain 1 ${resourceToken(node.res)} for every ${per.every} ${perBasePhrase(per.base)}${perCapTail(per)}, rounded down.`
				: `Gain ${describeAmount(node.amount)} ${resourceToken(node.res)}${
						node.fromSupply === true
							? ' from the supply (not the Stardate card)'
							: ''
					}.`
		}
		case 'SPEND_RESOURCE':
			return `Spend ${describeAmount(node.amount)} ${resourceToken(node.res)}.`
		case 'STEAL':
			return `Steal ${describeAmount(node.amount)} ${resourceToken(node.res)} from your opponent.`
		case 'GAIN_ACTION':
			return `Gain ${describeAmount(node.amount)} {ACTION}.`
		case 'ADVANCE_SPECIALTY':
			if (typeof node.specialty === 'object')
				return `Gain ${describeAmount(node.amount)} ${node.specialty.of
					.map(specialtyWord)
					.join(' / ')} (whichever is ${
					node.specialty.pick === 'LOWER' ? 'lower' : 'higher'
				}).`
			if (node.specialty === 'LOWEST')
				return `Gain ${describeAmount(node.amount)} to your lowest of RESEARCH/INFLUENCE/MILITARY (your pick if tied).`
			return node.specialty === 'CHOICE'
				? `Advance a specialty of your choice by ${describeAmount(node.amount)}.`
				: `Advance ${specialtyWord(node.specialty)} by ${describeAmount(node.amount)}.`
		case 'RECRYSTALLIZE':
			return node.amount === 'ALL'
				? 'Recrystallize all {DIL}.'
				: `Recrystallize ${describeAmount(node.amount)} {DIL}.`

		// -------- board (10) --------
		case 'SEND_AWAY_TEAM':
			return `Send ${describeAmount(node.count)} ${
				typeof node.count === 'number' && node.count === 1
					? 'Away Team'
					: 'Away Teams'
			} to ${describeLocation(node.target)}.`
		case 'REMOVE_AWAY_TEAM':
			return `Remove ${node.count} ${node.count === 1 ? 'Away Team' : 'Away Teams'} from ${
				node.whose === 'SELF' ? 'your' : "your opponent's"
			} ${describeLocation(node.target)}.`
		case 'WARP':
			if (node.count !== undefined)
				return `Warp ${describeAmount(node.count)} of ${describeCardTarget(node.ship)} to ${describeLocation(node.to)}.`
			return node.ship.filter?.suits?.includes('SHIP') === true
				? `Warp this ship to ${describeLocation(node.to)}.`
				: `Warp ${describeCardTarget(node.ship)} to ${describeLocation(node.to)}.`
		case 'TAKE_CONTROL':
			if (node.target === 'FROM_LOCATION_DECK')
				return 'Take control of a Location from the Location deck.'
			if (node.target === 'THIS') return 'Take control of this Location.'
			return `Take control of ${describeLocation(node.target)}.`
		case 'TRIGGER_CONTROL':
			return `Trigger the control operation of ${describeLocation(node.target)}.`
		case 'EXHAUST':
			return `Exhaust ${describeCardTarget(node.target)}.`
		case 'REFRESH': {
			const base = `Refresh ${describeCardTarget(node.target)}`
			if (node.count === undefined) return `${base}.`
			if (typeof node.count === 'number')
				return `${base}, ${node.count === 1 ? '1 card' : `${node.count} cards`}.`
			return `${base}, ${describeAmount(node.count)}.`
		}
		case 'PLACE_RESOURCE_ON_MARKET':
			return `Place ${describeAmount(node.amount)} ${resourceToken(node.res)} on a Market card.`
		case 'WIPE_MARKET':
			return 'Wipe the Market.'
		case 'WIPE_NEUTRAL_ZONE':
			return 'Wipe the Neutral Zone.'
		case 'DRONE':
			return node.verb === 'REGENERATE'
				? `Regenerate ${node.count} ${node.count === 1 ? 'drone' : 'drones'}.`
				: `Send ${node.count === 1 ? 'a drone' : `${node.count} drones`} to ${
						node.to !== undefined ? describeLocation(node.to) : 'a LOCATION'
					}.`
		case 'ASSIMILATE':
			return node.target === 'THIS'
				? 'Assimilate this card.'
				: `Assimilate ${describeCardTarget(node.target)}.`
		case 'REMOVE_STARDATE_GLORY':
			return `Remove ${node.amount} {GLO} from the Stardate card.`
		case 'ARRANGE_DECK':
			return `Look at the top ${node.n} ${node.decks.join(` or the top ${node.n} `)}; put them back, top and/or bottom, in any order.`
		case 'IGNORE_ATTACK':
			return node.scope === 'EFFECT'
				? 'Ignore the effect.'
				: 'Ignore the negative effect.'
		case 'REPLACE_GAIN':
			return `Scan ${node.scan} of the same suit instead.`

		// -------- meta (6) --------
		case 'FREE_PLAY':
			if (node.bound !== undefined) return 'Free play the found card.'
			return `Free play ${withArticle(describeFilter(node.filter))}${
				node.from !== undefined
					? ` ${zonePhrase(Array.isArray(node.from) ? node.from : [node.from], undefined)}`
					: ''
			}.`
		case 'DUPLICATE':
			if (node.from.length === 1 && node.from[0] === 'RESOLVED_THIS_TURN')
				return `Duplicate a ${node.opType} operation you have already resolved this turn.`
			if (node.from.length === 1 && node.from[0] === 'BOUND')
				return `Duplicate the ${node.bound ?? 'bound'} card's ${node.other === true ? 'other ' : ''}${node.opType} operation.`
			return `Duplicate a ${node.opType} operation of ${
				node.filter !== undefined ? `${describeFilter(node.filter)} ` : ''
			}${node.suits.map(suitWord).join(' or ')} from the ${node.from
				.map((f) =>
					f === 'DEPLOYED' ? 'cards deployed by any player' : f.toLowerCase(),
				)
				.join(' or ')}.`
		case 'FORCE':
			return renderOtherSide(node.body, true)
		case 'COMPLETE_MISSION':
			return 'Complete a mission.'
		case 'MODIFIER_ATTACH': {
			const phrase = describeModifier(node.id)
			return phrase !== undefined ? phrase : `(attach rule modifier ${node.id})`
		}
		case 'MODIFIER_DETACH': {
			const phrase = describeModifier(node.id)
			return phrase !== undefined ? phrase : `(detach rule modifier ${node.id})`
		}
		case 'ALT_PLAY':
			return `You may play any ${node.suits.map(suitWord).join(' or ')} with "Play: ${describeOperation(node.operation).replace(/\.$/, '')}" in place of its own play operation.`
		case 'REVEAL':
			return node.whose === 'OPPONENT'
				? 'Force your opponent to reveal their hand.'
				: 'Reveal your hand.'

		// -------- scoring (1) --------
		case 'SCORE_VP': {
			const per = perOf(node.amount)
			if (per !== undefined) {
				return `Score 1 VP for every ${per.every} ${perBasePhrase(per.base)}${perCapTail(per)}, rounded down.`
			}
			if (
				typeof node.amount === 'object' &&
				node.amount !== null &&
				node.amount.k === 'COUNT'
			) {
				const noun = describeFilter(node.amount.query.filter)
				return `Score 1 VP for each of your ${noun} cards.`
			}
			return `Score ${describeAmount(node.amount)} VP.`
		}

		// -------- escape hatch (1) --------
		case 'SCRIPT':
			return `(script: ${node.fn})`

		// -------- solo Bot (rules/13) — Automated Command rows --------
		case 'TRY': {
			const lead = node.test !== undefined ? 'If able to do both' : 'If able'
			const then = `${lead}, ${phrase(render(node.body))}.`
			return node.otherwise === undefined
				? then
				: `${then} Otherwise, ${phrase(render(node.otherwise))}.`
		}
		case 'ATTACK':
			return `[ATTACK] ${render(node.body)}`
		case 'BOT_DECK':
			return describeBotDeck(node)
		case 'BOT_ACQUIRE':
			return describeBotAcquire(node)
		case 'BOT_JUNK':
			return 'Junk the most valuable card in the Market (ignoring any with tokens).'
		case 'BOT_SEND_AWAY_TEAM': {
			const n = describeAmount(node.count)
			const teams = n === '1' ? 'an Away Team' : `${n} Away Teams`
			const where =
				node.prefer !== undefined
					? `${node.prefer.join(' > ')} > LOCATION`
					: 'LOCATION'
			return `Send ${teams} to a neutral ${where}${
				node.ignoreShips === true ? ', ignoring any opponent SHIP' : ''
			}.`
		}
		case 'BOT_DEPLOY': {
			const ship =
				node.target === 'THIS'
					? 'this SHIP'
					: node.target === 'DISCARD'
						? 'a SHIP from the Bot Discard pile'
						: 'the gained SHIP'
			const then =
				node.then === undefined
					? ''
					: `; it ${node.then === 'EXPLORE' ? 'explores' : 'engages'}`
			return `Deploy ${ship}${then}.`
		}
		case 'BOT_PROMOTE':
			return node.target === 'THIS'
				? 'If this card is a PERSON, promote it to Duty Officer.'
				: node.target === 'DISCARD'
					? 'Promote a PERSON from the Bot Discard pile to Duty Officer.'
					: 'Promote it to Duty Officer.'
		case 'BOT_RESOLVE':
			switch (node.from) {
				case 'ROW':
					return 'Resolve the next card of the Staging row.'
				case 'DECK_TOP':
					return 'Resolve the top card of the Bot deck.'
				case 'SUPPLEMENT_TOP':
					return 'Resolve the top card of the Supplement deck.'
				case 'DISCARD':
					return `Resolve ${withArticle(describeFilter(node.filter))} from the Bot Discard pile.`
				case 'BOUND':
					return 'Resolve it.'
			}
			break
		case 'BOT_TAKE_CONTROL':
			return 'Take control of the neutral LOCATION with most Bot tokens (minimum 1).'
		case 'TRANSFER':
			return 'Put this card on the bottom of your Draw deck (it is now yours).'
		case 'BOT_REMOVE_AWAY_TEAM':
			return node.count === 1
				? 'Remove an Away Team.'
				: `Remove ${node.count} Away Teams.`
	}
}

/** "Log the top 2 cards of the Bot deck." and the Supplement variants. */
function describeBotDeck(node: Extract<Effect, { k: 'BOT_DECK' }>): string {
	const deck = node.from === 'DECK' ? 'the Bot deck' : 'the Supplement deck'
	if (node.op === 'TAKE') return `Take the top card of ${deck}.`
	const verb = node.op === 'LOG' ? 'Log' : 'Discard'
	return node.count === 1
		? `${verb} the top card of ${deck}.`
		: `${verb} the top ${node.count} cards of ${deck}.`
}

/** "Gain a KLINGON > PERSON / SHIP." — the Bot's preference expression. */
function describeBotAcquire(node: Extract<Effect, { k: 'BOT_ACQUIRE' }>): string {
	const verb = node.mode === 'GAIN' ? 'Gain' : 'Take'
	if (node.from === 'ENCOUNTER') return `${verb} the top ENCOUNTER.`
	if (node.from === 'INCIDENT') return `${verb} an INCIDENT.`
	if (node.pref === undefined)
		return `${verb} the most valuable card in the Market.`
	const steps = node.pref.map((step) =>
		step
			.map((term) =>
				'most' in term
					? `most ${resourceToken(term.most)}`
					: describeFilter(term),
			)
			.join(' / '),
	)
	if (node.pref.every((step) => step.every((term) => 'most' in term)))
		return `${verb} the card in the Market with the ${steps.join(' > ')}.`
	return `${verb} ${withArticle(steps.join(' > '))}.`
}

// ---------------------------------------------------------------------------
// Triggers (REACTION operations) — docs/effect-dsl.md §6
// ---------------------------------------------------------------------------

const TRIGGER_PHRASES: Record<TriggerSpec['on'], string> = {
	CARD_PLAYED: 'After you play',
	CARD_GAINED: 'After gaining',
	RESOURCE_GAINED: 'After gaining',
	SPECIALTY_ADVANCED: 'After gaining',
	PUT_INTO_PLAY: 'After putting',
	CARD_DEPLOYED: 'After deploying',
	LOCATION_CONTROLLED: 'After you control a Location',
	CARD_LOGGED: 'When you log',
	AWAY_TEAM_SENT: 'After sending an Away Team',
	SHIP_WARPED: 'After your ship warps',
	INCIDENT_TAKEN: 'After taking an Incident',
	INCIDENT_RETURNED: 'After returning an Incident',
	ATTACKED: 'When you are attacked',
	ATTACK_MADE: 'After you attack',
	MISSION_COMPLETED: 'After completing a mission',
	ENCOUNTER_TAKEN: 'After taking an Encounter',
	OPERATION_RESOLVED: 'After resolving an operation',
	WOULD_BE_ATTACKED: 'When you would be attacked',
	WOULD_GAIN_CARD: 'When you would gain a card',
	BEFORE_SCORING: 'Before scoring',
}

/** Render a trigger spec ("After you play an ENCOUNTER"). */
export function describeTrigger(trigger: TriggerSpec): string {
	switch (trigger.on) {
		case 'CARD_PLAYED':
			return `After ${actor(trigger.seat, 'you play', 'plays')} ${phrase(withArticle(describeFilter(trigger.filter)))}`
		case 'CARD_GAINED': {
			const where =
				trigger.dest === 'DECK_TOP'
					? ' onto your deck top'
					: trigger.dest === 'DISCARD'
						? ' to your Discard pile'
						: ''
			return `After ${actor(trigger.seat, trigger.seat === 'SELF' ? 'you gain' : 'gaining', 'gains')} ${withArticle(describeFilter(trigger.filter))}${where}`
		}
		case 'RESOURCE_GAINED':
			return `After gaining ${trigger.res !== undefined ? resourceToken(trigger.res) : 'resources'}`
		case 'SPECIALTY_ADVANCED': {
			const list = [
				...(trigger.specialty !== undefined ? [trigger.specialty] : []),
				...(trigger.specialties ?? []),
			]
			const what =
				list.length > 0 ? list.map(specialtyWord).join('/') : 'Specialty'
			return trigger.seat === 'OPPONENT' || trigger.seat === 'ANY'
				? `After ${actor(trigger.seat, 'gaining', 'gains')} ${what}`
				: `After gaining at least 1 ${what}`
		}
		case 'PUT_INTO_PLAY':
			return `After ${actor(trigger.seat, 'putting', 'puts')} ${withArticle(describeFilter(trigger.filter))} into play`
		case 'CARD_DEPLOYED':
			return `After ${actor(trigger.seat, 'deploying', 'deploys')} ${withArticle(describeFilter(trigger.filter))}`
		case 'CARD_LOGGED':
			return trigger.seat === 'OPPONENT' || trigger.seat === 'ANY'
				? `After ${actor(trigger.seat, 'logging', 'logs')} ${withArticle(describeFilter(trigger.filter))}`
				: `When you log ${withArticle(describeFilter(trigger.filter))}`
		case 'LOCATION_CONTROLLED':
			return trigger.seat === 'OPPONENT'
				? 'After your opponent takes control of a Location'
				: TRIGGER_PHRASES.LOCATION_CONTROLLED
		case 'AWAY_TEAM_SENT':
			return trigger.neutral === true
				? 'After sending an Away Team to a neutral Location'
				: TRIGGER_PHRASES.AWAY_TEAM_SENT
		case 'INCIDENT_TAKEN':
			return trigger.orReturned === true
				? 'Whenever you take or return an Incident'
				: TRIGGER_PHRASES.INCIDENT_TAKEN
		case 'WOULD_BE_ATTACKED':
			return trigger.effect === 'DISMISS_DUTY_OFFICER'
				? 'When an attack would dismiss your Duty Officer'
				: trigger.effect === 'REMOVE_AWAY_TEAM'
					? 'When an attack would make you remove 1 or more AWAY TEAM'
					: TRIGGER_PHRASES.WOULD_BE_ATTACKED
		case 'OPERATION_RESOLVED':
			return trigger.paid !== undefined
				? `After resolving an operation with a ${resourceToken(trigger.paid)} cost`
				: TRIGGER_PHRASES.OPERATION_RESOLVED
		default:
			return TRIGGER_PHRASES[trigger.on]
	}
}

/** Who the trigger listens to: the owner's own verb ("you play" / "gaining"),
 *  "your opponent <verb>s" or "any player <verb>s". */
function actor(
	seat: 'SELF' | 'OPPONENT' | 'ANY' | undefined,
	self: string,
	third: string,
): string {
	if (seat === 'OPPONENT') return `your opponent ${third}`
	if (seat === 'ANY') return `any player ${third}`
	return self
}

// ---------------------------------------------------------------------------
// Operation-level rendering (prefixes + trigger + effect)
// ---------------------------------------------------------------------------

/** Render a full operation: {ACTION}/[ATTACK]/requires/trigger prefixes plus
 *  describe(effect). Used by the fidelity checker and the UI tooltips. */
export function describeOperation(op: Operation): string {
	bindSide.clear()
	const atoms: string[] = []
	if (op.costsAction) atoms.push('{ACTION}')
	if (op.isAttack) atoms.push('[ATTACK]')
	if (op.requires !== undefined) {
		atoms.push(
			`Requires ${specialtyWord(op.requires.specialty)} ${op.requires.min}`,
		)
	}
	const head = atoms.length > 0 ? `${atoms.join(' ')} ` : ''
	const trigger =
		op.trigger !== undefined ? `${describeTrigger(op.trigger)}: ` : ''
	return `${head}${trigger}${render(op.effect)}`
}

/** The public entry point: render an effect tree as a complete sentence. */
export function describe(effect: Effect): string {
	bindSide.clear()
	return render(effect)
}
