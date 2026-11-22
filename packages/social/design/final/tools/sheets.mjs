// Review aid (not part of the card). The harness contact sheets reference file:// images from a setContent page,
// which Chrome blocks, so they come out as broken-image placeholders. This rewrites them with inlined JPEGs:
//   node tools/sheets.mjs [variantDir]  -> out/_contact.jpg (360 px cells, labelled), out/_thumbs.jpg (125 px wide),
//                                          out/_grid.jpg (portrait cards at 125 px, 3:4 centre crop, on Instagram white)
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../../node_modules/playwright-core/index.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))

const out = path.join(path.resolve(process.argv[2] ?? path.join(here, '..')), 'out')
const names = (await readdir(out)).filter(f => f.endsWith('.jpg') && !f.startsWith('_')).sort()
const src = {}
for (const f of names) src[f] = 'data:image/jpeg;base64,' + (await readFile(path.join(out, f))).toString('base64')
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable' })
const shot = async (file, width, body) => {
  const page = await browser.newPage({ viewport: { width, height: 400 } })
  await page.setContent(body)
  await page.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 88, fullPage: true })
  await page.close()
}
const sheet = (cellW, cols, label) => shot(label ? '_contact.jpg' : '_thumbs.jpg', cols * (cellW + 24) + 24,
  `<body style="margin:24px;background:#777;font:12px sans-serif;color:#fff"><div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">${names.map(f => `<figure style="margin:0"><img src="${src[f]}" style="width:${cellW}px;display:block"><figcaption>${label ? f.replace('.jpg', '') : ''}</figcaption></figure>`).join('')}</div></body>`)
await sheet(360, 4, true)
await sheet(125, 9, false)
const portraits = names.filter(f => f.includes('portrait'))
await shot('_grid.jpg', 440, `<body style="margin:20px;background:#fff"><div style="display:grid;grid-template-columns:repeat(3,125px);gap:3px">${portraits.map(f => `<div style="width:125px;height:166px;overflow:hidden;position:relative"><img src="${src[f]}" style="position:absolute;height:166px;left:50%;transform:translateX(-50%)"></div>`).join('')}</div></body>`)
await browser.close()
console.log('sheets written: _contact.jpg, _thumbs.jpg, _grid.jpg')
