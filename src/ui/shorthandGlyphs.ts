// Shorthand glyph art (docs/shorthand.md). Our own drawings on a 24×24 grid —
// no printed or STCC artwork. Glyphs the game prints an icon for are shown
// with that icon instead (src/ui/printedIcons.ts); their drawings here are
// the fallback without an icon set, as in the tests. Each entry is the inner SVG of one glyph; the
// renderer (shorthand.tsx) wraps it in an <svg viewBox="0 0 24 24"> whose
// stroke is currentColor, so a glyph takes the colour of its token.
//
// Shapes carry the meaning; colour only supports it (docs/ui-spec.md §8):
// Dilithium, Latinum and Glory differ in outline, not just hue.
//
// The Record types make a missing glyph a compile error when the engine's
// GlyphId union, the suit list or the operation types grow.

import type { Suit } from '../data/ids'
import type { GlyphId, ShorthandLine } from '../engine/shorthand'

const FILL = 'fill="currentColor" stroke="none"'

const CARD = '<rect x="6" y="2.8" width="12" height="18.4" rx="2.2"/>'
const PLANET =
	'<circle cx="12" cy="12" r="5.6"/><ellipse cx="12" cy="12" rx="10.4" ry="3.3" transform="rotate(-20 12 12)"/>'
const MARKET =
	'<path d="M3.2 9.4 5.3 3.6h13.4l2.1 5.8Z"/><path d="M4.8 9.4V20.8h14.4V9.4"/>'
const LANDSCAPE_CARD =
	'<rect x="2.8" y="10" width="15.4" height="10.6" rx="2"/>'
const FLAG = `<path d="M6.5 21.8V3"/><path d="M6.5 3.6h11.6l-2.6 4.1 2.6 4.1H6.5" fill="currentColor" fill-opacity=".28"/><path d="M3 21.8h8"/>`
const CHEQUERED = `<path d="M5.2 22V2.8"/><path d="M5.2 3.4h14.6v9.4H5.2Z"/><path d="M5.2 3.4h3.7v4.7H5.2ZM12.6 3.4h3.6v4.7h-3.6ZM8.9 8.1h3.7v4.7H8.9ZM16.2 8.1h3.6v4.7h-3.6Z" ${FILL}/>`
const EXHAUST = `${LANDSCAPE_CARD}<path d="M8 6.6a8.4 8.4 0 0 1 12.2 2.1M20.6 3.8v4.8h-4.8"/>`

export const GLYPH_SVG: Record<GlyphId, string> = {
	// resources & tokens
	// a faceted dilithium rock, like the game's token: a flat top face, the
	// front facets fanning down from it and a small crystal on its right
	DIL: `<path d="M6 2.2l9.8 3.1 2.5 1.9 2.9 4.3.8 3.8-4 6.7H5.5L2.2 19 2 11.6Z" ${FILL}/><path d="M6 2.4l3.6 7.2h5.7l.5-4.3M2.2 11.6l7.4-2M9.6 9.6l4.6 12.2M15.3 9.6l1.6 12.2M18 21.6l3-9.4M2.4 16.4l11.4 5.2" style="stroke:var(--ground)" stroke-width="1" stroke-linecap="butt"/>`,
	// a tilted ingot, like the game's token: end face, top face, long front face
	LAT: `<path d="M2.9 12.2 15.8 3.3l4.4 2.7 1.4 7.1-12.9 7.5L2 18Z" ${FILL}/><path d="M2.9 12.2l4 3.1L20.2 6M6.9 15.3l1.8 5.3" style="stroke:var(--ground)" stroke-width="1.2" stroke-linecap="butt"/>`,
	GLO: `<path d="M12 2.2l2.95 6.2 6.8.85-5 4.7 1.3 6.75L12 17.3l-6.05 3.4 1.3-6.75-5-4.7 6.8-.85Z" ${FILL}/>`,
	// an isolinear chip, like the game's action token: a tilted slab with a
	// label band at its head, a circuit trace and a clipped foot
	ACT: `<g transform="rotate(32 12 12)"><path d="M8.2 1.6h7.6v20.8h-4.4l-3.2-3Z" ${FILL}/><path d="M8.2 6.2h7.6M10.2 3.9h3M12.9 8.8v4.6H11v5.3" style="stroke:var(--ground)" stroke-width="1.4" stroke-linecap="butt"/></g>`,
	VP: '<path d="M7.5 3.5h9V8a4.5 4.5 0 0 1-9 0Z"/><path d="M12 12.5v4M8.5 20.5h7M10 16.5h4M7.5 5.5H4.5v.8A3 3 0 0 0 7.6 9.5M16.5 5.5h3v.8a3 3 0 0 1-3.1 3.2"/>',
	AWAY: `<circle cx="12" cy="6.2" r="3.4" ${FILL}/><path d="M5.8 21.5l1.7-8.4A2.6 2.6 0 0 1 10 11h4a2.6 2.6 0 0 1 2.5 2.1l1.7 8.4Z" ${FILL}/>`,
	// specialties
	RESEARCH: `<circle cx="12" cy="12" r="1.9" ${FILL}/><ellipse cx="12" cy="12" rx="9.6" ry="3.7"/><ellipse cx="12" cy="12" rx="9.6" ry="3.7" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.6" ry="3.7" transform="rotate(-60 12 12)"/>`,
	INFLUENCE:
		'<path d="M3.5 5h17v11h-9l-4.5 4v-4H3.5Z"/><path d="M7.5 9h9M7.5 12h5.5"/>',
	MILITARY: `<circle cx="12" cy="12" r="6.6"/><path d="M12 2v5.2M12 16.8V22M2 12h5.2M16.8 12H22"/><circle cx="12" cy="12" r="1.4" ${FILL}/>`,
	ANY_SPECIALTY:
		'<circle cx="12" cy="6.5" r="3.6" style="fill:var(--research)" stroke="none"/><circle cx="6.3" cy="16.3" r="3.6" style="fill:var(--influence)" stroke="none"/><circle cx="17.7" cy="16.3" r="3.6" style="fill:var(--military)" stroke="none"/>',
	LOWEST_SPECIALTY:
		'<circle cx="5" cy="5.5" r="2.8" style="fill:var(--research)" stroke="none"/><circle cx="12" cy="5.5" r="2.8" style="fill:var(--influence)" stroke="none"/><circle cx="19" cy="5.5" r="2.8" style="fill:var(--military)" stroke="none"/><path d="M12 11v10M8.3 17.3 12 21l3.7-3.7"/>',
	// your cards and decks
	CARD,
	DECK: '<rect x="8" y="2.6" width="11.5" height="15.5" rx="2"/><path d="M5 6.5v12.6a2 2 0 0 0 2 2h9.5"/>',
	TOP_DECK:
		'<path d="M5 10v9.2a2 2 0 0 0 2 2h9.5"/><rect x="8" y="9.5" width="11.5" height="9.5" rx="2"/><path d="M13.7 1.8v5.4M11.3 4.9l2.4 2.4 2.4-2.4"/>',
	PUT: '<rect x="3" y="3" width="11" height="15.5" rx="2"/><path d="M14 16h7M18 13l3 3-3 3"/>',
	FIND: '<circle cx="10.4" cy="10.4" r="6.4"/><path d="M15.2 15.2l5.8 5.8"/>',
	FROM_DISCARD:
		'<rect x="2.8" y="8" width="10" height="13.4" rx="1.8" transform="rotate(-9 7.8 14.7)"/><path d="M17.6 20V4.2M14.2 7.6l3.4-3.4 3.4 3.4"/>',
	DISCARD_PILE:
		'<rect x="3.6" y="5.2" width="10" height="14.4" rx="1.8" transform="rotate(-11 8.6 12.4)"/><rect x="10" y="4.6" width="10" height="14.4" rx="1.8" transform="rotate(9 15 11.8)"/>',
	LOG: '<path d="M5 5a2 2 0 0 1 2-2h11.5v15H7a2 2 0 0 0-2 2Z"/><path d="M5 20a2 2 0 0 0 2 2h11.5v-4"/><path d="M13 3v6.6l1.9-1.4 1.9 1.4V3"/>',
	ENLIST:
		'<path d="M3.8 16v3.6a1.6 1.6 0 0 0 1.6 1.6h13.2a1.6 1.6 0 0 0 1.6-1.6V16"/><path d="M12 16.2V3.4M8 7.4l4-4 4 4"/>',
	DEVELOP: `<rect x="5.5" y="2.8" width="13" height="18.4" rx="2.2"/><path d="M12 16.8V7.6M8.7 10.9 12 7.6l3.3 3.3"/>`,
	HAND: '<rect x="3.4" y="4.8" width="9.4" height="13.6" rx="1.7" transform="rotate(-13 8.1 11.6)"/><rect x="11.2" y="4.8" width="9.4" height="13.6" rx="1.7" transform="rotate(13 15.9 11.6)"/>',
	RESERVE:
		'<rect x="7.6" y="2.6" width="12" height="15.4" rx="2"/><path d="M4.6 6.4v12.8a2 2 0 0 0 2 2h9.6M10.8 7.6h5.6M10.8 10.6h5.6M10.8 13.6h3.4"/>',
	// in play
	PLAY: `<rect x="5.5" y="2.8" width="13" height="18.4" rx="2.2"/><path d="M10.2 8.6v6.8l5.4-3.4Z" ${FILL}/>`,
	FREE_PLAY: '<path d="M5 4.6v14.8L16.8 12Z"/><path d="M19.5 2.5v5M17 5h5"/>',
	DEPLOY:
		'<rect x="7.5" y="2.6" width="9" height="12.6" rx="1.8"/><path d="M3.5 12.5v7.2h17v-7.2"/>',
	PROMOTE: '<path d="M5.2 12.4 12 5.6l6.8 6.8M5.2 18.6 12 11.8l6.8 6.8"/>',
	RECALL:
		'<rect x="10" y="2.6" width="10.5" height="14" rx="2"/><path d="M10 13.5H7.2a3.6 3.6 0 0 0 0 7.2h7.3"/><path d="M12.2 18.3l2.4 2.4-2.4 2.4"/>',
	DISMISS:
		'<rect x="3.8" y="2.6" width="11" height="15.4" rx="2"/><path d="M13 14.5l7.5 7.5M20.6 16.4v5.7h-5.7"/>',
	DESTROY: `${CARD}<path d="M9.4 9.1l5.2 5.8M14.6 9.1l-5.2 5.8"/>`,
	EXHAUST,
	REFRESH:
		'<path d="M19.8 12a7.8 7.8 0 1 1-2.3-5.5"/><path d="M20 3.2v4.2h-4.2"/>',
	DUPLICATE:
		'<rect x="3.4" y="6.4" width="11" height="15" rx="2"/><path d="M8.6 3.8a1.6 1.6 0 0 1 1.6-1.4H19a1.6 1.6 0 0 1 1.6 1.6v12.4a1.6 1.6 0 0 1-1.6 1.6h-1.6"/>',
	REVEAL:
		'<path d="M2.2 12S6 5.4 12 5.4 21.8 12 21.8 12 18 18.6 12 18.6 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3"/>',
	ENTER:
		'<rect x="6" y="2.4" width="12" height="13.4" rx="2"/><path d="M12 22.2v-8.4M8.6 17.2 12 13.8l3.4 3.4"/>',
	FLEET:
		'<path d="M8 2.8l4.6 12.2L8 12.6 3.4 15ZM16 8.6l4.6 12.2-4.6-2.4-4.6 2.4Z"/>',
	DUTY: '<path d="M7.4 3h9.2v8.4H7.4ZM4.6 11.4h14.8V15H4.6ZM7.8 15v6.4M16.2 15v6.4"/>',
	STAGING:
		'<rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2" stroke-dasharray="3.2 2.6"/>',
	// Market
	MARKET: `${MARKET}<path d="M9.6 20.8v-5.4h4.8v5.4"/>`,
	JUNK: '<path d="M4.2 6.5h15.6M9.5 6.5V3.8h5v2.7M6.4 6.5l1 14.5h9.2l1-14.5M10 10.3v6.8M14 10.3v6.8"/>',
	SCAN: `<path d="M12 12 18.6 5.4"/><path d="M21.2 12a9.2 9.2 0 1 1-2.7-6.5"/><path d="M16.6 12a4.6 4.6 0 1 1-1.35-3.25"/><circle cx="12" cy="12" r="1.5" ${FILL}/>`,
	WIPE_MARKET: `${MARKET}<path d="M2 22.2 22 2" stroke-width="2.3"/>`,
	STEAL:
		'<path d="M20.5 7H9.2a5 5 0 0 0 0 10h6.3"/><path d="M8.2 3.4 4.6 7l3.6 3.6"/>',
	// space
	WARP: `<path d="M2.2 8.4h6.3M3.8 12h7.2M2.2 15.6h6.3"/><path d="M12.3 6.2 21.8 12l-9.5 5.8 2.1-5.8Z" ${FILL}/>`,
	BEAM: '<path d="M7 3.5v17M12 2.2v19.6M17 3.5v17" stroke-dasharray="0.1 3.3" stroke-width="2.6"/>',
	SEND: `<circle cx="7.4" cy="6.6" r="2.8" ${FILL}/><path d="M3.2 20.5l1.1-6.2A2.2 2.2 0 0 1 6.5 12.5h1.8a2.2 2.2 0 0 1 2.2 1.8l1.1 6.2Z" ${FILL}/><path d="M14 12.5h7.8M18.6 9.3l3.2 3.2-3.2 3.2"/>`,
	CONTROL: FLAG,
	WIPE_NEUTRAL_ZONE: `${PLANET}<path d="M2 22.2 22 2" stroke-width="2.3"/>`,
	ARRANGE:
		'<path d="M8 20.5V3.8M4.4 7.4 8 3.8l3.6 3.6M16 3.5v16.7M12.4 16.6l3.6 3.6 3.6-3.6"/>',
	STARDATE:
		'<path d="M6.4 2.8h11.2M6.4 21.2h11.2M8 2.8v2.4c0 3.2 8 4 8 6.8s-8 3.6-8 6.8v2.4M16 2.8v2.4c0 3.2-8 4-8 6.8s8 3.6 8 6.8v2.4"/>',
	// checks & rules
	CHECK: '<path d="M4.4 12.6 9.6 17.8 19.8 6.4"/>',
	LOCK: '<rect x="4.8" y="10.4" width="14.4" height="10.8" rx="2"/><path d="M8 10.4V7.4a4 4 0 0 1 8 0v3"/>',
	SHIELD:
		'<path d="M12 2.6 19.8 5.4v6c0 5-3.3 8.6-7.8 10.2C7.5 20 4.2 16.4 4.2 11.4v-6Z"/><path d="M8.6 12l2.4 2.4 4.4-4.8"/>',
	ATTACK:
		'<path d="M4.4 3.4 15.8 14.8M19.6 3.4 8.2 14.8M13.4 17.6l4.2-4.2M10.6 17.6l-4.2-4.2M16.8 16.8l3.8 3.8M7.2 16.8l-3.8 3.8"/>',
	MISSION:
		'<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 2.8h6v3.2H9ZM8.4 13.2l2.6 2.6 4.6-5"/>',
	RECRYSTALLIZE:
		'<path d="M12 3.6 15.4 8.6 12 17 8.6 8.6Z"/><path d="M20.6 12.4a8.6 8.6 0 0 1-14.9 5.6M3.6 16.2v4.2h4.2"/>',
	OPERATION:
		'<circle cx="12" cy="12" r="3.3"/><path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2M5.4 5.4l2.2 2.2M16.4 16.4l2.2 2.2M5.4 18.6l2.2-2.2M16.4 7.6l2.2-2.2"/>',
	ENDGAME: CHEQUERED,
}

export const SUIT_SVG: Record<Suit | 'ANY', string> = {
	PERSON:
		'<circle cx="12" cy="7.8" r="3.9"/><path d="M4.2 21.2c.6-4.5 3.7-7.2 7.8-7.2s7.2 2.7 7.8 7.2"/>',
	CARGO:
		'<path d="M12 2.6 20.2 7.1v9.8L12 21.4l-8.2-4.5V7.1Z"/><path d="M3.8 7.1 12 11.6l8.2-4.5M12 11.6v9.8"/>',
	SHIP: '<path d="M12 2.4 18.8 19.4 12 15.8 5.2 19.4Z"/><path d="M12 7.5v8.3"/>',
	ALLY: '<circle cx="8.8" cy="12" r="5.6"/><circle cx="15.2" cy="12" r="5.6"/>',
	LOCATION: PLANET,
	DIRECTIVE: '<path d="M5 5.5 11.5 12 5 18.5M11.5 5.5 18 12l-6.5 6.5"/>',
	INCIDENT:
		'<path d="M12 3 21.8 20.2H2.2Z"/><path d="M12 9.3v5.2M12 17.4v.1"/>',
	ENCOUNTER:
		'<circle cx="15" cy="9" r="4.3"/><path d="M11.8 12.2 3.4 20.6M9.6 8.4 4.2 13.8M15.6 14.4l-5.4 5.4"/>',
	CAPTAIN: `<circle cx="4.6" cy="12" r="2.3" ${FILL}/><circle cx="9.5" cy="12" r="2.3" ${FILL}/><circle cx="14.5" cy="12" r="2.3" ${FILL}/><circle cx="19.4" cy="12" r="2.3" ${FILL}/>`,
	STATUS: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l4.2-5.3"/>',
	MISSION:
		'<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 2.8h6v3.2H9ZM8.4 13.2l2.6 2.6 4.6-5"/>',
	ANY: CARD,
}

/** The timing mark that opens each line — the printed strip, as a shape. */
export const TIMING_SVG: Record<ShorthandLine['timing'], string> = {
	PLAY: `<path d="M6.5 3.6v16.8L20 12Z" ${FILL}/>`,
	ACTIVATION: EXHAUST,
	PASSIVE:
		'<path d="M12 12c-2.1-2.8-3.7-4.2-5.6-4.2a4.2 4.2 0 0 0 0 8.4c1.9 0 3.5-1.4 5.6-4.2s3.7-4.2 5.6-4.2a4.2 4.2 0 0 1 0 8.4c-1.9 0-3.5-1.4-5.6-4.2Z"/>',
	REACTION: `<path d="M13.8 2.2 5.2 13.6h6.2l-1.2 8.2 8.6-11.4h-6.2Z" ${FILL}/>`,
	RESUPPLY:
		'<path d="M2.6 19.2h18.8M6.8 19.2a5.2 5.2 0 0 1 10.4 0"/><path d="M12 3v6.4M9.2 5.8 12 3l2.8 2.8"/>',
	CLEANUP:
		'<path d="M2.6 19.2h18.8M6.8 19.2a5.2 5.2 0 0 1 10.4 0"/><path d="M12 9.4V3M9.2 6.6 12 9.4l2.8-2.8"/>',
	CONTROL: FLAG,
	ENDGAME: CHEQUERED,
	SPECIAL: `<path d="M12 2.2c.8 5.2 2.6 9 9.8 9.8-7.2.8-9 4.6-9.8 9.8-.8-5.2-2.6-9-9.8-9.8 7.2-.8 9-4.6 9.8-9.8Z" ${FILL}/>`,
	// a warning triangle: the solo Bot's SURPRISE operation
	SURPRISE:
		'<path d="M12 3 21.8 20.2H2.2Z"/><path d="M12 9.3v5.2M12 17.4v.1"/>',
	DEVELOPMENT:
		'<path d="M3.2 12.6V4.2a1 1 0 0 1 1-1h8.4l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-7.1 7.1a1.5 1.5 0 0 1-2.1 0Z"/><circle cx="7.9" cy="7.9" r="1.5"/>',
}

/** The word a glyph stands for — its hover title, so the language teaches
 *  itself on desktop. */
export const GLYPH_WORD: Record<GlyphId, string> = {
	DIL: 'Dilithium',
	LAT: 'Latinum',
	GLO: 'Glory',
	ACT: 'action',
	VP: 'victory points',
	AWAY: 'Away Team',
	RESEARCH: 'Research',
	INFLUENCE: 'Influence',
	MILITARY: 'Military',
	ANY_SPECIALTY: 'a specialty of your choice',
	LOWEST_SPECIALTY: 'your lowest specialty',
	CARD: 'card (+ draw, − discard)',
	DECK: 'top card of your deck',
	TOP_DECK: 'put on top of your deck',
	PUT: 'put a card',
	FIND: 'find (search your cards)',
	FROM_DISCARD: 'draw from your Discard pile',
	DISCARD_PILE: 'your Discard pile',
	LOG: "log (Captain's Log)",
	ENLIST: 'enlist from your Reserve',
	DEVELOP: 'enlist a Development',
	HAND: 'your hand',
	RESERVE: 'your Reserve',
	PLAY: 'put into play',
	FREE_PLAY: 'free play (no action)',
	DEPLOY: 'deploy to your Fleet',
	PROMOTE: 'promote to Duty Officer',
	RECALL: 'recall to hand',
	DISMISS: 'dismiss to Discard',
	DESTROY: 'destroy',
	EXHAUST: 'exhaust',
	REFRESH: 'refresh',
	DUPLICATE: 'duplicate an operation',
	REVEAL: 'reveal',
	ENTER: 'enters play',
	FLEET: 'your Fleet',
	DUTY: 'Duty Officer',
	STAGING: 'Staging Area',
	MARKET: 'the Market',
	JUNK: 'junk a Market card',
	SCAN: 'scan the Market',
	WIPE_MARKET: 'wipe the Market',
	STEAL: 'steal from your opponent',
	WARP: 'warp a SHIP',
	BEAM: 'beam a card onto a ship',
	SEND: 'send an Away Team',
	CONTROL: 'take control',
	WIPE_NEUTRAL_ZONE: 'wipe the Neutral Zone',
	ARRANGE: 'arrange a deck',
	STARDATE: 'the Stardate card',
	CHECK: 'if you did',
	LOCK: 'requirement',
	SHIELD: 'ignore the attack',
	ATTACK: 'attack',
	MISSION: 'a mission',
	RECRYSTALLIZE: 'recrystallize',
	OPERATION: 'an operation resolves',
	ENDGAME: 'end of game',
}

export const TIMING_WORD: Record<ShorthandLine['timing'], string> = {
	PLAY: 'Play',
	ACTIVATION: 'Activation (exhausts the card)',
	PASSIVE: 'Passive (always on)',
	REACTION: 'Reaction',
	RESUPPLY: 'Resupply',
	CLEANUP: 'Clean-up',
	CONTROL: 'Control (on taking control)',
	ENDGAME: 'Endgame',
	SPECIAL: 'Special',
	SURPRISE: 'Surprise (Bot only)',
	DEVELOPMENT: 'Development cost',
}

// ---------------------------------------------------------------------------
// Sprite
// ---------------------------------------------------------------------------

/** The element id of the mounted sprite (src/ui/shorthand.tsx). */
export const SPRITE_ID = 'sh-sprite'

export const glyphSymbol = (g: GlyphId): string => `sh-g-${g}`
export const suitSymbol = (s: Suit | 'ANY'): string => `sh-s-${s}`
export const timingSymbol = (t: ShorthandLine['timing']): string => `sh-t-${t}`

/** One glyph as a standalone inline <svg>, for places outside the sprite's
 *  reach (the icon fallback, the flight layer). Carries the stroke defaults
 *  the Shorthand stylesheet gives the sprite's <svg>s. */
export function glyphMarkup(g: GlyphId): string {
	return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${GLYPH_SVG[g]}</svg>`
}

/** Every glyph, suit and timing mark as a <symbol> in one hidden <svg>. */
export function spriteMarkup(): string {
	const symbol = (id: string, body: string) =>
		`<symbol id="${id}" viewBox="0 0 24 24">${body}</symbol>`
	const all = [
		...Object.entries(GLYPH_SVG).map(([g, b]) =>
			symbol(glyphSymbol(g as GlyphId), b),
		),
		...Object.entries(SUIT_SVG).map(([s, b]) =>
			symbol(suitSymbol(s as Suit | 'ANY'), b),
		),
		...Object.entries(TIMING_SVG).map(([t, b]) =>
			symbol(timingSymbol(t as ShorthandLine['timing']), b),
		),
	]
	return `<svg xmlns="http://www.w3.org/2000/svg"><defs>${all.join('')}</defs></svg>`
}
