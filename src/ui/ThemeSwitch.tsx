// The palette picker for the console strip and the start screen (the phone
// menu carries the same choice as a segmented control). Stored per device —
// see theme.ts.

import type { CSSProperties } from 'react'
import { setTheme, THEMES, useTheme, type Theme } from './theme'

/** The start screen's picker: one swatch of each theme's frame hue. */
export function ThemeSwatches() {
	const theme = useTheme()
	return (
		<div className="theme-swatches" role="group" aria-label="Colour theme">
			{THEMES.map((t) => (
				<button
					key={t.v}
					type="button"
					className="theme-swatch"
					style={{ '--sw': t.frame } as CSSProperties}
					aria-pressed={theme === t.v}
					aria-label={t.label}
					title={t.label}
					onClick={() => setTheme(t.v)}
				/>
			))}
		</div>
	)
}

/** `compact` drops the text label (the console strip is short on width; the
 *  selected theme's name says what the control is). */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
	const theme = useTheme()
	return (
		<label className="layout-switch theme-switch" title="Colour theme">
			{!compact && <span className="nav-label">Theme</span>}
			<select
				value={theme}
				onChange={(e) => setTheme(e.target.value as Theme)}
				aria-label="Colour theme"
			>
				{THEMES.map((t) => (
					<option key={t.v} value={t.v}>
						{t.label}
					</option>
				))}
			</select>
		</label>
	)
}
