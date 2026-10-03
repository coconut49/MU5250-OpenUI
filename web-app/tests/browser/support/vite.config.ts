/**
 * Vite config used ONLY by the Playwright web server (see playwright.config.ts).
 * It extends the app's own config; production builds never read this file.
 *
 * Differences from `npm run dev`:
 *  - React StrictMode is stripped from src/main.tsx (set PW_STRICT_MODE=1 to keep it).
 *    StrictMode's dev-only mount/unmount/mount sends every first poll twice and
 *    discards the first answer, which makes `defer()` and request-count
 *    assertions describe behaviour production never has.
 *  - The dependency cache is per port, so suites started in parallel on
 *    different ports never write the same cache directory.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import appConfig from '../../../vite.config.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const port = process.env.PW_PORT ?? '5199'

function stripStrictMode(): Plugin {
  return {
    name: 'pw-strip-strict-mode',
    enforce: 'pre',
    transform(code, id) {
      if (process.env.PW_STRICT_MODE === '1') return null
      if (!/\/src\/main\.tsx(\?|$)/.test(id)) return null
      return { code: code.replace(/<StrictMode>/g, '<>').replace(/<\/StrictMode>/g, '</>'), map: null }
    },
  }
}

export default mergeConfig(
  appConfig,
  defineConfig({
    root,
    cacheDir: `${root}node_modules/.vite-playwright-${port}`,
    plugins: [stripStrictMode()],
  }),
)
