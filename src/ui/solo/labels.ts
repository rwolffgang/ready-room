// Labels for the official solo Bot (rules/13): difficulty levels and how a
// solo game is named in the save list and on the end screen.

import type { SoloLevel } from '../../engine/state'

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
