// Labels for the official solo Bot (rules/13): difficulty levels and how a
// solo game is named in the save list and on the end screen.

import type { SoloLevel } from '../../engine/state'
import type { CampaignMode, Challenge, Rank } from '../../session/campaign'

export const SOLO_LEVEL_LABEL: Record<SoloLevel, string> = {
	ENSIGN: 'Ensign',
	LIEUTENANT: 'Lieutenant',
	COMMANDER: 'Commander',
	CAPTAIN: 'Captain',
	ADMIRAL: 'Admiral',
}

/** "The Bot (Commander)" */
export function soloBotLabel(level: SoloLevel): string {
	return `The Bot (${SOLO_LEVEL_LABEL[level]})`
}

// ---------------------------------------------------------------------------
// The Five-Year Mission (rules/14), in our own words
// ---------------------------------------------------------------------------

export const RANK_LABEL: Record<Rank, string> = {
	ENSIGN: 'Ensign',
	LIEUTENANT: 'Lieutenant',
	COMMANDER: 'Commander',
	CAPTAIN: 'Captain',
	COMMODORE: 'Commodore',
	ADMIRAL: 'Admiral',
}

export const MODE_LABEL: Record<CampaignMode, { title: string; text: string }> =
	{
		EASY: { title: 'Easy', text: 'The Bot plays at your rank.' },
		NORMAL: { title: 'Normal', text: 'The Bot plays a level above your rank.' },
		HARD: { title: 'Hard', text: 'The Bot plays two levels above your rank.' },
		BRUTAL: { title: 'Brutal', text: 'The Bot always plays at Admiral.' },
	}

export const CHALLENGE_LABEL: Record<
	Challenge,
	{ title: string; text: string }
> = {
	LEAN_START: {
		title: 'Lean start',
		text: 'After a win, start the next game without Dilithium or Latinum; after two wins in a row, without both. A loss resets it.',
	},
	SHUFFLED_RESERVE: {
		title: 'Random Reserve',
		text: 'From Lieutenant on, deal yourself a random Reserve deck of the usual size.',
	},
	DIRECTIVE_IN_RESERVE: {
		title: 'Distant support',
		text: 'After a win, the campaign Directive goes into your Reserve deck instead of your starting deck.',
	},
	INCIDENT_STREAK: {
		title: 'Trouble follows',
		text: 'After two wins in a row, an INCIDENT starts in your deck, every game until you lose.',
	},
	MARKET_ONLY: {
		title: 'Market only',
		text: 'After a win, the only upgrade is a matching Market card.',
	},
	ONE_SHIP: {
		title: 'One ship',
		text: 'You lose if your starting SHIP is ever dismissed or recalled.',
	},
	LATE_TEAMS: {
		title: 'Late Away Teams',
		text: 'One Away Team (two after a win) is set aside until your Reserve deck is empty.',
	},
}
