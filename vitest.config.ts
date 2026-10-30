import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
			'@data': fileURLToPath(new URL('./src/data', import.meta.url)),
			'@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
			'@session': fileURLToPath(new URL('./src/session', import.meta.url)),
		},
	},
	test: {
		// Project-level environments (Vitest 5's replacement for environmentMatchGlobs):
		// engine/data must stay DOM-free (node); everything else gets a DOM (jsdom).
		projects: [
			{
				test: {
					name: 'engine-node',
					environment: 'node',
					// Session tests load the real card catalog (node:fs + file:// URLs),
					// so they run headless in node too — todo/17 DoD. So do the bot
					// tests, which play full games on it.
					include: [
						'src/engine/**/*.test.ts',
						'src/data/**/*.test.ts',
						'src/session/**/*.test.ts',
						'src/bot/**/*.test.ts',
						'server/**/*.test.ts',
					],
				},
			},
			{
				test: {
					name: 'dom',
					environment: 'jsdom',
					setupFiles: ['src/ui/testSetup.ts'],
					include: [
						'src/**/*.test.{ts,tsx}',
						'!src/engine/**/*.test.ts',
						'!src/data/**/*.test.ts',
						'!src/session/**/*.test.ts',
						'!src/bot/**/*.test.ts',
					],
				},
			},
		],
	},
})
