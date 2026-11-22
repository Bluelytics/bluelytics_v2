// Robustness renders and layout checks for the final card (dev aid; never imported by card.mjs).
//   node render-extra.mjs            -> renders extra-scenarios.mjs to out-extra/, checks them, writes out-extra/_contact.jpg
//   node render-extra.mjs --main     -> also checks the harness matrix (harness/scenarios.mjs) without writing images
// Checks, beyond the harness: safe areas (measured text, logo, slab and tag boxes), text overlapping text,
// text touching a chart dot, the blade's sliver or body edge crossing (or its body covering) any text other than
// the hero digits and the superior "$",
// NaN/undefined in the HTML, and alt-text length.
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '../../node_modules/playwright-core/index.mjs'
import { extraScenarios, EXTRA_MATRIX } from './extra-scenarios.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const harness = path.join(here, '..', 'harness')
const { renderCardHtml, cardAltText, TOKENS } = await import(pathToFileURL(path.join(here, 'card.mjs')).href + '?t=' + Date.now())
const { scenarios, MATRIX } = await import(pathToFileURL(path.join(harness, 'scenarios.mjs')).href)

// [left, top, right, bottom] limits for essential ink, per size
const SAFE = { landscape: [64, 64, 1536, 836], portrait: [64, 56, 1016, 1294], story: [64, 270, 1016, 1580], og: [48, 48, 1152, 582] }

function inPage() {
  const out = { boxes: [], dots: [], blade: [] }
  const band = document.getElementById('blade'), sliver = document.getElementById('blade-sliver')
  const sliverOn = sliver && parseFloat(sliver.getAttribute('opacity') ?? '1') > 0
  const inside = (el, x, y) => el.isPointInFill(new DOMPoint(x, y))
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const txt = n.textContent.trim(); if (!txt) continue
    const el = n.parentElement, hero = !!el.closest('.hero'), opaque = !!el.closest('.slab,.tag')
    const r = document.createRange(); r.selectNodeContents(n)
    const lb = r.getBoundingClientRect(), fs = parseFloat(getComputedStyle(el).fontSize)
    // ink box, not line box: from the cap height (accent height for Á, É…) to the baseline (descender if any)
    const base = lb.top + (lb.height - fs) / 2 + 0.845 * fs
    const b = { left: lb.left, right: lb.right, top: base - (/[ÁÉÍÓÚÑ$]/.test(txt) ? 0.86 : 0.7) * fs, bottom: base + (/[gjpqy(),;]/.test(txt) ? 0.22 : 0.02) * fs }
    out.boxes.push({ txt: txt.slice(0, 28), x0: b.left, y0: b.top, x1: b.right, y1: b.bottom, hero, opaque })
    if (hero || opaque || !band) continue
    let inBand = 0, outBand = 0, inSliver = 0
    for (let x = b.left; x <= b.right; x += 6) for (let y = b.top; y <= b.bottom; y += 6) {
      inside(band, x, y) ? inBand++ : outBand++
      if (sliverOn && inside(sliver, x, y)) inSliver++
    }
    if (inSliver) out.blade.push(`sliver crosses "${txt.slice(0, 28)}"`)
    if (inBand && outBand) out.blade.push(`blade edge crosses "${txt.slice(0, 28)}"`)
    else if (inBand && txt !== '$') out.blade.push(`small text sits on the blade "${txt.slice(0, 28)}"`)
  }
  for (const sel of ['.mark', '.slab', '.tag']) for (const el of document.querySelectorAll(sel)) {
    const b = el.getBoundingClientRect(); out.boxes.push({ txt: sel, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom, opaque: true, shape: true })
  }
  for (const c of document.querySelectorAll('.plot circle')) {
    const b = c.getBoundingClientRect(); out.dots.push({ x0: b.left, y0: b.top, x1: b.right, y1: b.bottom })
  }
  out.scroll = [document.documentElement.scrollWidth, document.documentElement.scrollHeight]
  return out
}

function problemsOf(name, size, m, html) {
  const p = []
  const [W, H] = TOKENS.size[size], [l, t, r, b] = SAFE[size]
  if (m.scroll[0] > W || m.scroll[1] > H) p.push(`canvas overflow ${m.scroll}`)
  for (const x of m.boxes) if (x.x0 < l - 0.5 || x.y0 < t - 0.5 || x.x1 > r + 0.5 || x.y1 > b + 0.5) p.push(`outside safe area: "${x.txt}" [${x.x0 | 0},${x.y0 | 0} – ${x.x1 | 0},${x.y1 | 0}]`)
  const hit = (a, c, g = 0) => Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > g && Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0) > g
  const texts = m.boxes.filter(x => !x.shape)
  for (let i = 0; i < m.boxes.length; i++) for (let j = i + 1; j < m.boxes.length; j++) {
    const a = m.boxes[i], c = m.boxes[j]
    if (a.opaque && c.opaque) continue                    // text inside its own slab/tag
    if (hit(a, c, 4)) p.push(`overlap: "${a.txt}" × "${c.txt}"`)
  }
  for (const d of m.dots) for (const x of texts) if (hit(d, x, 0)) p.push(`chart dot touches "${x.txt}"`)
  p.push(...m.blade)
  const bare = html.replace(/data:[^"')]+/g, '')
  if (/NaN|undefined|Infinity/.test(bare)) p.push('NaN/undefined/Infinity in HTML')
  return p.map(s => `${name}: ${s}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', args: ['--font-render-hinting=none', '--disable-lcd-text'] })
async function run(matrix, data, outDir) {
  const problems = [], files = []
  for (const [kind, size, sc] of matrix) {
    const name = `${kind}-${size}-${sc}`
    const html = renderCardHtml(kind, size, data[sc])
    const alt = cardAltText(kind, data[sc])
    if (alt.length > 420) problems.push(`${name}: alt text ${alt.length} > 420`)
    const [width, height] = TOKENS.size[size]
    const page = await browser.newPage({ viewport: { width, height } })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    problems.push(...problemsOf(name, size, await page.evaluate(inPage), html))
    if (outDir) { await page.screenshot({ path: path.join(outDir, name + '.jpg'), type: 'jpeg', quality: 90 }); files.push(name) }
    await page.close()
  }
  return { problems, files }
}

const outDir = path.join(here, 'out-extra'); await mkdir(outDir, { recursive: true })
const extra = await run(EXTRA_MATRIX, extraScenarios, outDir)
const alts = EXTRA_MATRIX.filter(([, size]) => size !== 'portrait' && size !== 'story').map(([k, , sc]) => `${k}/${sc}: ${cardAltText(k, extraScenarios[sc])}`)
await writeFile(path.join(outDir, '_alt.txt'), alts.join('\n') + '\n')
// contact sheet with inlined images (file:// images do not load in a setContent page)
{
  const cells = await Promise.all(extra.files.map(async f => `<figure><img src="data:image/jpeg;base64,${(await readFile(path.join(outDir, f + '.jpg'))).toString('base64')}" style="height:300px"><figcaption>${f}</figcaption></figure>`))
  const page = await browser.newPage({ viewport: { width: 1900, height: 600 } })
  await page.setContent(`<body style="margin:20px;background:#777;font:13px sans-serif;color:#fff"><div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">${cells.join('')}</div><style>figure{margin:0}</style></body>`)
  await page.screenshot({ path: path.join(outDir, '_contact.jpg'), type: 'jpeg', quality: 85, fullPage: true })
  await page.close()
}
let all = extra.problems
if (process.argv.includes('--main')) all = [...(await run(MATRIX, scenarios, null)).problems, ...all]
// CPU budget: every render (warm, best of 3) must stay within 10 ms, so a Workers Free-plan invocation can afford it
{
  const cases = [...MATRIX.map(([k, s, sc]) => [k, s, sc, scenarios[sc]]), ...EXTRA_MATRIX.map(([k, s, sc]) => [k, s, sc, extraScenarios[sc]])]
  for (const [k, s, , d] of cases) renderCardHtml(k, s, d)
  let worst = [0, '']
  for (const [k, s, sc, d] of cases) {
    let best = Infinity
    for (let i = 0; i < 3; i++) { const t = performance.now(); renderCardHtml(k, s, d); best = Math.min(best, performance.now() - t) }
    if (best > worst[0]) worst = [best, `${k}-${s}-${sc}`]
  }
  console.log(`slowest render: ${worst[0].toFixed(1)} ms (${worst[1]})`)
  if (worst[0] > 10) all.push(`${worst[1]}: render took ${worst[0].toFixed(1)} ms > 10 ms`)
}
await browser.close()
console.log(`${extra.files.length} extra renders in out-extra/`)
console.log(all.length ? 'PROBLEMS:\n- ' + all.join('\n- ') : 'No layout problems found.')
