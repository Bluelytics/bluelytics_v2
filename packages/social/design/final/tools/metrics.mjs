// Review aid (not part of the card). Measures advance widths (em) of the glyphs card.mjs sets, in the embedded
// faces, with Chrome's canvas measureText, so the width table in card.mjs (SANS, sansEm) can be checked after a font change.
//   node tools/metrics.mjs
import { chromium } from '../../../node_modules/playwright-core/index.mjs'
import { CHIVO_700, CHIVO_900, CHIVO_MONO_500 } from '../fonts.mjs'

const GLYPHS = '0123456789.,$ %+−–·()/:abcdefghijklmnopqrstuvwxyzáéíóúñABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑ'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable' })
const page = await browser.newPage()
await page.setContent('<body></body>')
const faces = { 'Chivo 700': ['Chivo', '700', CHIVO_700], 'Chivo 900': ['Chivo', '900', CHIVO_900], 'Chivo Mono 500': ['Chivo Mono', '500', CHIVO_MONO_500] }
const measured = await page.evaluate(async ({ faces, glyphs }) => {
  const out = {}
  for (const [label, [family, weight, b64]] of Object.entries(faces)) {
    const face = new FontFace(family, `url(data:font/woff2;base64,${b64})`, { weight })
    document.fonts.add(await face.load())
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = `${weight} 1000px "${family}"`
    out[label] = Object.fromEntries([...glyphs].map(ch => [ch, ctx.measureText(ch).width / 1000]))
  }
  return out
}, { faces, glyphs: GLYPHS })
await browser.close()

for (const [label, table] of Object.entries(measured)) console.log(`${label}\n  ${Object.entries(table).map(([ch, w]) => `${ch}:${w.toFixed(3)}`).join(' ')}`)
