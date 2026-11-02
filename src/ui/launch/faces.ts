// Where each captain's face sits on their captain card's art, so the start
// screen's portraits frame the face instead of a fixed crop: the centre (x, y)
// and the height (h) of the face, brow to chin, as fractions of the card.
// Measured on the fetched STCC scans and the custom packs' renders with macOS
// Vision face detection (two cartoon faces it missed, by eye). Keyed by card
// id, like everything else; a captain missing here gets FALLBACK.

export interface Face {
	x: number
	y: number
	h: number
}

export const FALLBACK: Face = { x: 0.48, y: 0.3, h: 0.2 }

export const FACES: Readonly<Record<string, Face>> = {
	// box 1
	'1PIC01/24': { x: 0.583, y: 0.264, h: 0.175 },
	'1BUR01/26': { x: 0.47, y: 0.32, h: 0.232 },
	'1KOL01/24': { x: 0.513, y: 0.374, h: 0.259 },
	'1SHR01/24': { x: 0.563, y: 0.451, h: 0.239 },
	'1SIS01/25': { x: 0.487, y: 0.279, h: 0.19 },
	'1SEL01/24': { x: 0.428, y: 0.296, h: 0.205 },
	// box 2
	'2REB01/22': { x: 0.505, y: 0.2, h: 0.15 },
	'2GEO01/23': { x: 0.547, y: 0.314, h: 0.222 },
	'2ARC01/23': { x: 0.37, y: 0.315, h: 0.19 },
	'2SOV01/24': { x: 0.474, y: 0.3, h: 0.225 },
	'2KIRK01/25': { x: 0.553, y: 0.193, h: 0.152 },
	'2KHA01A/22': { x: 0.482, y: 0.284, h: 0.181 },
	'2KHA01B/22': { x: 0.542, y: 0.195, h: 0.183 },
	// box 3
	'3FRE01/25': { x: 0.479, y: 0.141, h: 0.101 },
	'3PIK01/26': { x: 0.449, y: 0.266, h: 0.195 },
	'3RIK01/25': { x: 0.55, y: 0.195, h: 0.15 },
	// custom packs
	'1MAL01/25': { x: 0.479, y: 0.421, h: 0.253 },
	'1SHP01/25': { x: 0.551, y: 0.38, h: 0.241 },
}
