// Usage: node render-all.mjs <variantDir> [filter-substring]
// Imports <variantDir>/card.mjs (export function renderCardHtml(kind, size, data): string),
// renders the MATRIX to <variantDir>/out/<kind>-<size>-<scenario>.jpg (JPEG q90, exact pixel size),
// and writes out/_contact.jpg (all cards reduced) and out/_thumbs.jpg (125 px wide — the Instagram grid test).
import { chromium } from '../../node_modules/playwright-core/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { scenarios, SIZES, MATRIX } from './scenarios.mjs'

const dir = path.resolve(process.argv[2] ?? '.')
const filter = process.argv[3] ?? ''
const { renderCardHtml } = await import(pathToFileURL(path.join(dir, 'card.mjs')).href + '?t=' + process.hrtime.bigint())
const out = path.join(dir, 'out'); await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const problems = []; const files = []
for (const [kind, size, sc] of MATRIX) {
  const name = `${kind}-${size}-${sc}`
  if (filter && !name.includes(filter)) continue
  const [width, height] = SIZES[size]
  const html = renderCardHtml(kind, size, scenarios[sc])
  await writeFile(path.join(out, name + '.html'), html)
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const requests = []
  page.on('request', r => { if (!r.url().startsWith('data:') && !r.url().startsWith('about:')) requests.push(r.url()) })
  page.on('console', m => { if (m.type() === 'error') problems.push(`${name}: console error: ${m.text()}`) })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const m = await page.evaluate(() => {
    const de = document.documentElement
    const fonts = [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`)
    let minFont = Infinity, minText = ''; const overflow = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent.trim(); if (!txt) continue
      const el = n.parentElement; const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const fs = parseFloat(cs.fontSize); if (fs < minFont) { minFont = fs; minText = txt.slice(0, 40) }
      const range = document.createRange(); range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) { overflow.push(txt.slice(0, 40)); break }
    }
    return { scrollW: de.scrollWidth, scrollH: de.scrollHeight, fonts, minFont, minText, overflow, scripts: document.scripts.length }
  })
  if (requests.length) problems.push(`${name}: external requests (card must be self-contained): ${requests.slice(0, 3).join(', ')}`)
  if (m.scrollW > width || m.scrollH > height) problems.push(`${name}: content overflows canvas (${m.scrollW}x${m.scrollH} > ${width}x${height})`)
  if (m.overflow.length) problems.push(`${name}: text outside canvas: ${m.overflow.join(' | ')}`)
  if (m.fonts.some(f => !f.endsWith('loaded'))) problems.push(`${name}: font not loaded: ${m.fonts.filter(f => !f.endsWith('loaded')).join(', ')}`)
  if (m.scripts) problems.push(`${name}: contains <script> (not allowed)`)
  const minAllowed = width >= 1600 ? 34 : 30
  if (m.minFont < minAllowed) problems.push(`${name}: smallest text ${m.minFont}px ("${m.minText}") is below ${minAllowed}px`)
  const buf = await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width, height } })
  await writeFile(path.join(out, name + '.jpg'), buf)
  files.push({ name, width, height, bytes: buf.length, htmlBytes: html.length, minFont: m.minFont })
  await page.close()
}
const sheet = async (file, cellW, cols, label) => {
  const page = await browser.newPage({ viewport: { width: cols * (cellW + 24) + 24, height: 800 }, deviceScaleFactor: 1 })
  const cells = files.map(f => `<figure><img src="${pathToFileURL(path.join(out, f.name + '.jpg')).href}" style="width:${cellW}px"><figcaption>${label ? f.name : ''}</figcaption></figure>`).join('')
  await page.setContent(`<body style="margin:24px;background:#777;font:12px sans-serif;color:#fff"><div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">${cells}</div><style>figure{margin:0}figcaption{margin-top:4px}</style></body>`, { waitUntil: 'load' })
  await page.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 88, fullPage: true })
  await page.close()
}
if (files.length) { await sheet('_contact.jpg', 360, 4, true); await sheet('_thumbs.jpg', 125, 9, false) }
await browser.close()
console.table(files)
console.log(problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : 'No automatic problems found (checks: self-contained, no overflow, fonts loaded, no scripts, minimum text size).')
