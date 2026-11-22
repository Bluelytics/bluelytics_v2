// bluelytics social cards: "Editorial Bold", final.
// renderCardHtml(kind, size, data) -> one self-contained HTML document (no scripts, no external URLs).
// Plain ESM, deterministic, no node: imports, no I/O: portable to a Cloudflare Worker.
// Also exports the pure helpers the caption and alt-text code reuses (formatting, computeCardFacts, cardAltText).
import { CHIVO_700, CHIVO_900, CHIVO_MONO_500 } from './fonts.mjs'

// ───────────────────────── design tokens ─────────────────────────
export const TOKENS = {
  color: {
    ink: '#040A14',       // canvas: blue-black
    navy: '#06203D',      // deep field
    blue: '#0069AC',      // brand blue (blade body)
    blueDeep: '#005E9D',  // brand blue, lower stop
    blueHi: '#1C7FD6',    // brand blue, dark-mode lift (blade head)
    line: '#7DBEFF',      // chart line
    text: '#F4F8FC',      // hero, values
    soft: '#C3D6EA',      // keys, secondary values
    muted: '#93A9C2',     // mono notes, footer
    ghost: '#6F87A2',     // days without a close (>= 4.5:1 on the field)
    slabInk: '#03121F',   // text on the direction slab
    up: '#2FD67B',
    down: '#FF5D5D',
    flat: '#A9B8CA',
    unknown: '#A9B8CA',   // no reference close: outlined chip, never a direction colour
  },
  // Light source tint at full intensity: up = cool teal dawn at the top, down = a low crimson dusk at the bottom
  // (mixed at 60 % of the up strength, so it reads as a red cast on the navy rather than a mauve patch).
  glow: { up: '#08607E', down: '#6E1430', flat: '#0B4F8C' },
  glowStrength: { up: 1, down: 0.6, flat: 1 },
  font: { sans: 'Chivo', mono: 'Chivo Mono' },
  // Chivo / Chivo Mono share vertical metrics: cap height 0.69 em; baseline 0.845 em below the top of a line-height:1 box.
  metric: { cap: 0.69, base: 0.845 },
  size: { landscape: [1600, 900], portrait: [1080, 1350], story: [1080, 1920], og: [1200, 630] },
  minText: { landscape: 34, portrait: 30, story: 30, og: 30 },
}
const C = TOKENS.color, CAP = TOKENS.metric.cap, BASE = TOKENS.metric.base
const FACES = [['sans', 700, CHIVO_700], ['sans', 900, CHIVO_900], ['mono', 500, CHIVO_MONO_500]]

// ───────────────────────── formatting (es-AR) ─────────────────────────
const TZ = 'America/Argentina/Buenos_Aires'
const NBSP = ' ', MINUS = '−', DASH = '–'
const fInt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0, useGrouping: 'always' })
const fPct = {}
const pctFormatter = (digits, signed) => (fPct[digits + '' + signed] ??= new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto' }))
const fDate = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: TZ })
const fTime = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })
const fDayMonth = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fDayMonthYear = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' })
const fWeekday = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
// Prose (alt text): full month names, so screen readers do not spell out "sept" or "dic".
const fDateLong = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: TZ })
const fDayMonthLong = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const fDayMonthYearLong = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' })
// Prose (alt text): full month names, so screen readers do not spell out "sept" or "dic".
const fDateLong = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: TZ })
const fDayMonthLong = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const fDayMonthYearLong = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' })

/** Card typography: true minus, no-break spaces. */
const typo = s => s.replace(/-/g, MINUS).replace(/\s/g, NBSP)
/** Plain text for captions and alt text: ASCII hyphen, ordinary spaces. */
export const plainText = s => String(s).replace(/[−–]/g, '-').replace(/ /g, ' ')

/** 1675 -> "1.675" (grouping forced, so it never depends on CLDR's minimumGroupingDigits). */
export const formatNumber = n => fInt.format(Math.round(n))
/** 1675 -> "$ 1.675"; negative values keep the minus before the sign. */
export const formatPesos = n => (n < 0 ? MINUS : '') + '$' + NBSP + formatNumber(Math.abs(n))
/** 15 -> "+$ 15", -25 -> "−$ 25", 0 -> "$ 0". */
export const formatSignedPesos = n => (n > 0 ? '+' : n < 0 ? MINUS : '') + formatPesos(Math.abs(n))
/** 0.009 -> "+0,90%". A non-zero move that would round to 0,00 gets one more decimal so it never reads "+0,00%"
 *  (turn that off with { escalate: false }). */
export function formatPercent(ratio, { digits = 2, signed = true, escalate = true } = {}) {
  let d = digits
  while (escalate && ratio !== 0 && d < 4 && Math.abs(ratio) < 0.5 * 10 ** -(d + 2)) d++
  return typo(pctFormatter(d, signed).format(ratio))
}
/** Brecha: always one decimal, sign only when negative ("4,6%", "−1,5%", "0,0%"). */
export const formatGap = ratio => formatPercent(ratio, { digits: 1, signed: false, escalate: false })
/** ISO instant -> "20 nov 2026, 15:45 (ART)"; plain: "20 de noviembre de 2026, 15:45, hora de Argentina". */
export function formatTimestamp(iso, { plain = false } = {}) {
  const d = new Date(iso)
  return plain ? `${fDateLong.format(d)}, ${fTime.format(d)}, hora de Argentina` : typo(`${fDate.format(d)}, ${fTime.format(d)} (ART)`)
}
const dayDate = day => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)) }
/** Trading-day range: "16 – 20 nov 2026", "30 nov – 4 dic 2026", "28 dic 2026 – 1 ene 2027", "11 dic 2026".
 *  { year: false }: no year unless the range crosses one ("15 – 30 dic", "17 dic 2026 – 3 ene 2027").
 *  { year: 'end' }: the year only once, at the end ("28 dic – 1 ene 2027").
 *  { prose: true }: full month names, "del 16 al 20 de noviembre de 2026" / "del 11 de diciembre de 2026". */
export function formatDateRange(days, { prose = false, year = true } = {}) {
  if (!days.length) return ''
  const a = dayDate(days[0]), b = dayDate(days[days.length - 1])
  const crossYear = a.getUTCFullYear() !== b.getUTCFullYear(), sameMonth = !crossYear && a.getUTCMonth() === b.getUTCMonth()
  if (prose) {
    const end = fDayMonthYearLong.format(b)
    if (days[0] === days[days.length - 1]) return `del ${end}`
    return `del ${crossYear ? fDayMonthYearLong.format(a) : sameMonth ? a.getUTCDate() : fDayMonthLong.format(a)} al ${end}`
  }
  const withYear = year === true || (year === 'end') || crossYear
  const end = (withYear ? fDayMonthYear : fDayMonth).format(b)
  if (days[0] === days[days.length - 1]) return typo(end)
  const start = crossYear && year !== 'end' ? fDayMonthYear.format(a) : sameMonth ? String(a.getUTCDate()) : fDayMonth.format(a)
  return typo(`${start} ${DASH} ${end}`)
}

// ───────────────────────── facts ─────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** Everything the card, captions and alt text derive from CardData. Ratios are fractions (0.009 = 0,9 %).
 *  Without a usable prevSell there is no move to report: hasRef is false, direction is 'unknown' and
 *  deltaAbs/deltaPct are null (never a made-up "sin cambios"). */
export function computeCardFacts(data) {
  const sell = data.blue.sell, buy = data.blue.buy
  const prevSell = Number.isFinite(data.prevSell) && data.prevSell > 0 ? data.prevSell : null
  const hasRef = prevSell !== null
  const deltaAbs = hasRef ? sell - prevSell : null
  const deltaPct = hasRef ? deltaAbs / prevSell : null
  const direction = !hasRef ? 'unknown' : deltaAbs > 0 ? 'up' : deltaAbs < 0 ? 'down' : 'flat'
  const oficialSell = data.oficial?.sell > 0 ? data.oficial.sell : null
  const series = (data.series ?? []).filter(p => p && Number.isFinite(p.sell) && /^\d{4}-\d{2}-\d{2}$/.test(p.day))
  const values = series.map(p => p.sell)
  return {
    sell, buy, prevSell, hasRef, deltaAbs, deltaPct, direction, oficialSell,
    gapPct: oficialSell ? sell / oficialSell - 1 : null,
    series, points: series.length,
    min: values.length ? Math.min(...values) : sell,
    max: values.length ? Math.max(...values) : sell,
    firstDay: series[0]?.day ?? null, lastDay: series.at(-1)?.day ?? null,
    updatedAt: data.updatedAt,
    // 0..1: how loudly the background speaks. sqrt so 0,1 % is quiet, 1,5 % is clear, >= 3 % is full.
    intensity: !hasRef || direction === 'flat' ? 0 : clamp(Math.sqrt(Math.abs(deltaPct) / 0.03), 0.2, 1),
  }
}

// ───────────────────────── alt text ─────────────────────────
const MOVE_REF = { update: 'respecto del cierre anterior', og: 'respecto del cierre anterior', weekly: 'respecto de la semana anterior' }
/** One Spanish description of the card for screen readers (<= 420 characters). */
export function cardAltText(kind, data) {
  const f = computeCardFacts(data)
  const P = n => plainText(formatPesos(n))
  // no reference close: say nothing about a move rather than claim "sin cambios"
  const move = !f.hasRef ? '' : f.direction === 'flat' ? `Sin cambios ${MOVE_REF[kind]}.`
    : `${f.direction === 'up' ? 'Subió' : 'Bajó'} ${P(Math.abs(f.deltaAbs))} (${plainText(formatPercent(f.deltaPct))}) ${MOVE_REF[kind]}.`
  const oficial = f.oficialSell ? `Oficial ${P(f.oficialSell)}, brecha ${plainText(formatGap(f.gapPct))}.` : ''
  const when = formatTimestamp(f.updatedAt, { plain: true }) + '.'
  const days = f.series.map(p => p.day)
  const range = f.points > 1 && f.min !== f.max ? `En las últimas ${f.points} ruedas osciló entre ${P(f.min)} y ${P(f.max)}.` : ''
  const weekRange = f.points > 1 && f.min !== f.max ? `Mínimo de la semana ${P(f.min)}, máximo ${P(f.max)}.`
    : f.points === 1 ? 'Un solo cierre en la semana.' : ''
  const parts = kind === 'weekly'
    ? [`Dólar blue, resumen semanal ${formatDateRange(days, { prose: true })}: cerró en ${P(f.sell)} (venta), compra ${P(f.buy)}.`, move,
      weekRange, oficial, when]
    : kind === 'og'
      ? [`Dólar blue hoy: venta ${P(f.sell)}, compra ${P(f.buy)}.`, move, 'Fuente: bluelytics.com.ar.']
      : [`Dólar blue: venta ${P(f.sell)}, compra ${P(f.buy)}.`, move, oficial, range, when]
  const text = parts.filter(Boolean).join(' ')
  // the 30-day range is the only optional sentence; drop it first if a limit is ever hit
  return text.length <= 420 ? text : parts.filter(p => p && p !== range).join(' ').slice(0, 420)
}

// ───────────────────────── text measurement ─────────────────────────
// Advance widths in em, measured from the embedded faces (Chivo 900 ≈ 700 for these glyphs; the wider value is kept).
const SANS = { '.': 0.287, ',': 0.287, '$': 0.6, ' ': 0.207, ' ': 0.207, '%': 0.713, '+': 0.616, [MINUS]: 0.605, [DASH]: 0.5, '·': 0.289, I: 0.446, 'Í': 0.446, M: 1.004, W: 1.021, i: 0.298, l: 0.298, j: 0.299, f: 0.419, t: 0.419, r: 0.507, m: 0.871, w: 0.855, '(': 0.313, ')': 0.313 }
const sansEm = ch => SANS[ch] ?? (/\d/.test(ch) ? 0.615 : /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.7 : 0.62)
/** Advance width of s in em (mono glyphs are all 0.6 em), including letter-spacing `track` per glyph. */
const textEm = (s, font = 'sans', track = 0) => [...s].reduce((a, ch) => a + (font === 'mono' ? 0.6 : sansEm(ch)) + track, 0)
/** Largest size <= max at which s fits `avail` px (never below `min`). */
const fitSize = (s, avail, max, min = 0, font = 'sans', track = 0) => Math.max(min, Math.floor(Math.min(max, avail / textEm(s, font, track))))

// ───────────────────────── render context ─────────────────────────
const r1 = n => Math.round(n * 10) / 10
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const upper = s => s.toLocaleUpperCase('es')

// Every text goes through ctx.T, so the faces in use are known and every small text is registered as an
// obstacle the background blade must route around.
function makeCtx(size) {
  const [W, H] = TOKENS.size[size]
  const used = new Set(), obstacles = []
  const block = (x0, y0, x1, y1, kind = 'text') => obstacles.push({ x0, y0, x1, y1, kind })
  const T = (s, o) => {
    const { x, y, size: fs, font = 'sans', weight = font === 'mono' ? 500 : 700, color = C.text, align = 'left', track = 0, raw = false, plain = s, cls = 't' } = o
    used.add(font + weight)
    const w = textEm(plain, font, track) * fs
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    block(left, y - CAP * fs, left + w, y + 0.2 * fs)
    const pos = align === 'right' ? `right:${r1(W - x - track * fs)}px` : align === 'center' ? `left:${r1(x)}px;transform:translateX(-50%)` : `left:${r1(x)}px`
    const fam = font === 'mono' ? ';font-family:\'Chivo Mono\',monospace' : ''
    return `<div class="${cls}" style="${pos};top:${r1(y - BASE * fs)}px;font-size:${fs}px;font-weight:${weight}${fam};color:${color}${track ? `;letter-spacing:${track}em` : ''}">${raw ? s : esc(s)}</div>`
  }
  return { W, H, size, used, obstacles, block, T }
}

// ───────────────────────── brand ─────────────────────────
function logoMark(x, y, s) {
  return `<svg class="mark" style="left:${x}px;top:${y}px" width="${s}" height="${s}" viewBox="0 0 2048 2048"><defs><linearGradient id="lb" x1="0" x2="0" y1="0" y2="2048" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3aa0f2"/><stop offset="1" stop-color="#1c7fd6"/></linearGradient><linearGradient id="lg" x1="0" x2="0" y1="716" y2="2048" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5bd06a"/><stop offset="1" stop-color="#34b24e"/></linearGradient></defs><g fill="url(#lb)">${LOGO_BLUE.map(d => `<path d="${d}"/>`).join('')}</g><g fill="url(#lg)">${LOGO_GREEN.map(d => `<path d="${d}"/>`).join('')}</g></svg>`
}
/** Mark + "bluelytics" wordmark; (x, y) is the top-left of the mark. */
function lockup(ctx, x, y, mark, word) {
  ctx.block(x, y, x + mark, y + mark, 'logo')
  return logoMark(x, y, mark) + ctx.T('bluelytics', { x: x + mark + Math.round(mark * 0.24), y: y + mark / 2 + word * 0.3, size: word, track: -0.01 })
}
/** "RESUMEN SEMANAL" edition tag (weekly only): a solid white block that sits on the kicker row, so a weekly card
 *  is told apart from an update even as a 125 px grid thumbnail. Left edge x, text baseline `base`; `width`
 *  stretches it (text centred), and the tracking tightens if the natural width does not fit it. */
const TAG = 'RESUMEN SEMANAL'
const tagEm = track => textEm(TAG, 'sans', track) + 1   // + 2 × 0.5 em side padding
function editionTag(ctx, { x, base, fs, width = 0 }) {
  ctx.used.add('sans700')
  const track = width && tagEm(0.08) * fs > width ? 0.03 : 0.08
  const w = Math.max(width, tagEm(track) * fs), top = base - 1.145 * fs, hgt = Math.round(1.5 * fs)
  ctx.block(x, top, x + w, top + hgt, 'tag')
  return { w, html: `<div class="tag" style="left:${r1(x)}px;top:${r1(top)}px;width:${r1(w)}px;height:${hgt}px;font-size:${fs}px;letter-spacing:${track}em;text-indent:${track}em;padding-top:${r1(0.3 * fs)}px;text-align:center">${TAG}</div>` }
}

// ───────────────────────── background: the blade ─────────────────────────
// A tapered ribbon along a cubic Bézier, the shape language of the logo's swept strokes.
// lo(t)/hi(t) are offsets along the normal (positive = the upper side when travelling left to right).
function bez(P, t) {
  const u = 1 - t, [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = P
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t
  const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t
  const dx = d0 * (x1 - x0) + d1 * (x2 - x1) + d2 * (x3 - x2), dy = d0 * (y1 - y0) + d1 * (y2 - y1) + d2 * (y3 - y2)
  const len = Math.hypot(dx, dy) || 1
  return [b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3, b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3, dy / len, -dx / len]
}
// The two sides of a ribbon from t0 to 1: `hi` is the upper edge, `lo` the lower one. The ribbon then runs on
// straight along its end tangent for EXTEND px, so its end cap always lies far outside the canvas (the curve ends
// beyond an edge, but a wide, steep ribbon would otherwise show its square cut inside the frame).
const EXTEND = 700
// The two sides of a ribbon from t0 to 1: `hi` is the upper edge, `lo` the lower one. The ribbon then runs on
// straight along its end tangent for EXTEND px, so its end cap always lies far outside the canvas (the curve ends
// beyond an edge, but a wide, steep ribbon would otherwise show its square cut inside the frame).
const EXTEND = 700
// Offsets along the normal per sample: [[lo, hi] of the band, [lo, hi] of the sliver].
function ribbons(P, t0, n, count, sides, ext = EXTEND) {
  const out = Array.from({ length: count }, () => ({ a: [], b: [] }))
  let last
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((1 - t0) * i) / n, [x, y, nx, ny] = (last = bez(P, t)), off = sides(t)
    off.forEach(([lo, hi], j) => { out[j].a.push([x + nx * hi, y + ny * hi]); out[j].b.push([x + nx * lo, y + ny * lo]) })
  }
  const tx = -last[3] * ext, ty = last[2] * ext            // unit tangent = (−ny, nx)
  return out.map(({ a, b }) => {
    a.push([a[n][0] + tx, a[n][1] + ty]); b.push([b[n][0] + tx, b[n][1] + ty])
    return withBoxes({ a, b, poly: [...a, ...[...b].reverse()] })
  })
}
const pathOf = pts => 'M' + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L') + 'Z'

// Geometry tests used to route the blade around text. Each side is split into chunks of 8 segments with a
// bounding box, so a rectangle far from the ribbon costs a few comparisons instead of 64 clipping tests.
const CHUNK = 8
function boxOf(pts, i0, i1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = i0; i <= i1; i++) { const [x, y] = pts[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return { x0, y0, x1, y1, i0, i1 }
}
const chunksOf = pts => { const out = []; for (let i = 0; i < pts.length - 1; i += CHUNK) out.push(boxOf(pts, i, Math.min(i + CHUNK, pts.length - 1))); return out }
function withBoxes(s) { s.ca = chunksOf(s.a); s.cb = chunksOf(s.b); s.box = boxOf(s.poly, 0, s.poly.length - 1); return s }
const boxesMeet = (p, r) => p.x0 <= r.x1 && p.x1 >= r.x0 && p.y0 <= r.y1 && p.y1 >= r.y0
function segHitsRect(p1, p2, r) {                       // Liang–Barsky, unrolled and allocation-free
  const x1 = p1[0], y1 = p1[1], dx = p2[0] - x1, dy = p2[1] - y1
  let t0 = 0, t1 = 1
  if (dx === 0) { if (x1 < r.x0 || x1 > r.x1) return false } else {
    const ta = (r.x0 - x1) / dx, tb = (r.x1 - x1) / dx
    if (dx > 0) { t0 = Math.max(t0, ta); t1 = Math.min(t1, tb) } else { t0 = Math.max(t0, tb); t1 = Math.min(t1, ta) }
    if (t0 > t1) return false
  }
  if (dy === 0) { if (y1 < r.y0 || y1 > r.y1) return false } else {
    const ta = (r.y0 - y1) / dy, tb = (r.y1 - y1) / dy
    if (dy > 0) { t0 = Math.max(t0, ta); t1 = Math.min(t1, tb) } else { t0 = Math.max(t0, tb); t1 = Math.min(t1, ta) }
    if (t0 > t1) return false
  }
  return true
}
function inPoly(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function lineCrosses(pts, chunks, r) {
  for (const c of chunks) {
    if (!boxesMeet(c, r)) continue
    for (let i = c.i0 + 1; i <= c.i1; i++) if (segHitsRect(pts[i - 1], pts[i], r)) return true
  }
  return false
}
const sidesCross = (s, r) => boxesMeet(s.box, r) && (lineCrosses(s.a, s.ca, r) || lineCrosses(s.b, s.cb, r))
const overlaps = (s, r) => boxesMeet(s.box, r) && (sidesCross(s, r) || inPoly(r.x0, r.y0, s.poly))

// Preferred route per size and direction, as fractions of the canvas:
// up: enters the left edge at height e and leaves through the top at x (beyond the right edge when x > 1);
// down: enters the top at x = e and falls into the right edge at height x; flat: a level blade at height e.
// The router tries routes near the preferred one (then thinner blades) and keeps the first whose sliver touches
// no small text, chart or logo, and whose body edge cuts no small text. The hero digits and the opaque slab
// are fair game. The first 15 % of the blade is transparent, so it is not tested.
const BLADE = {
  landscape: { w: 300, up: [0.52, 0.86], down: [0.06, 0.47], flat: [0.42] },
  portrait: { w: 280, up: [0.42, 1.07], down: [0.31, 0.5], flat: [0.3] },
  story: { w: 330, up: [0.44, 1.07], down: [0.31, 0.45], flat: [0.36] },
  og: { w: 250, up: [0.63, 1.07], down: [0.28, 0.7], flat: [0.42] },
}
const VISIBLE_FROM = 0.15
// Centre line: flat start, steepening end (a growth curve for up, an accelerating fall for down).
function bladeCurve(dir, W, H, e, x) {
  const P0 = dir === 'down' ? [e * W, -100] : [-80, e * H]
  // up: x <= 1.2 leaves through the top at x·W; x > 1.2 leaves through the right edge at (x − 1.2)·H
  const P3 = dir === 'flat' ? [W + 80, e * H] : dir === 'down' ? [W + 100, x * H] : x > 1.2 ? [W + 100, (x - 1.2) * H] : [x * W, -100]
  const lerp = (a, b, t) => a + (b - a) * t
  return [P0, [lerp(P0[0], P3[0], 0.4), P0[1]], [lerp(P0[0], P3[0], 0.75), lerp(P0[1], P3[1], 0.3)], P3]
}
function bladeShapes(P, w, k, t0 = 0, n = 64) {
  const slvW = w * (0.03 + 0.06 * k)                        // thicker sliver for bigger moves
  const sides = t => {
    const half = (w / 2) * Math.pow(t, 0.9), gap = w * 0.06 * Math.pow(t, 0.6), slv = slvW * Math.pow(t, 1.1)
    return [[-half, half], [half + gap, half + gap + slv]]
  }
  const [band, sliver] = ribbons(P, t0, n, 2, sides)
  return { band, sliver }
}
// Candidate routes, cheapest first. Pure function of (size, direction): built once per pair and cached.
const STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8, 9, -9]
const candCache = new Map()
function candidates(size, dir) {
  const key = size + dir
  if (candCache.has(key)) return candCache.get(key)
  const spec = BLADE[size], [e0, x0 = 0] = spec[dir], cands = []
  // up blades may also leave through the right edge (x > 1.2), as a costlier second family
  const anchors = dir === 'up' ? [[0, x0], [8, 1.45]] : [[0, x0]]
  for (const [wi, wf] of [[0, 1], [3, 0.8], [6, 0.65]]) for (const a of STEPS) for (const b of dir === 'flat' ? [0] : STEPS)
    for (const [xi, xa] of anchors) cands.push({ e: e0 + a * 0.03, x: xa + b * 0.04, w: spec.w * wf, cost: Math.abs(a) + Math.abs(b) + wi + xi })
  cands.sort((p, q) => p.cost - q.cost)        // stable: ties keep generation order
  candCache.set(key, cands)
  return cands
}
// Each candidate is screened with a coarse 8-segment ribbon that stops at its first conflict; only a candidate that
// screens clean is checked with the full 64-segment ribbon. Worst case a few ms (the 10 ms budget is asserted in
// render-extra.mjs).
function routeBlade(ctx, dir, k) {
  const { W, H, size, obstacles } = ctx
  const pad = 10
  const rects = obstacles.map(o => ({ kind: o.kind, x0: o.x0 - pad, y0: o.y0 - pad, x1: o.x1 + pad, y1: o.y1 + pad }))
  const conflicts = ({ band, sliver }, limit) => {
    let n = 0
    for (const r of rects) {
      if (overlaps(sliver, r)) n++
      if (r.kind === 'text' && sidesCross(band, r)) n++
      if (n >= limit) break
    }
    return n
  }
  const cands = candidates(size, dir)
  // pass 1: the first clean route (screens stop at the first conflict)
  for (const c of cands) {
    const P = bladeCurve(dir, W, H, c.e, c.x)
    if (conflicts(bladeShapes(P, c.w, k, VISIBLE_FROM, 8), 1)) continue
    if (conflicts(bladeShapes(P, c.w, k, VISIBLE_FROM), 1) === 0) return { P, w: c.w, n: 0, shapes: bladeShapes(P, c.w, k) }
  }
  // pass 2 (rare): no clean route, so take the one with the fewest conflicts; the sliver will be dropped
  // (coarse counts, bounded by the best so far; the winner then gets its exact count)
  let best = null
  for (const c of cands) {
    const P = bladeCurve(dir, W, H, c.e, c.x)
    const n = conflicts(bladeShapes(P, c.w, k, VISIBLE_FROM, 8), best ? best.n : Infinity)
    if (!best || n < best.n) best = { P, w: c.w, n }
  }
  // exact count, at least 1 here: it switches the sliver off
  best.n = Math.max(1, conflicts(bladeShapes(best.P, best.w, k, VISIBLE_FROM), Infinity))
  return { ...best, shapes: bladeShapes(best.P, best.w, k) }
}

const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')
function background(ctx, m) {
  const { W, H } = ctx, dir = m.direction === 'unknown' ? 'flat' : m.direction, k = dir === 'flat' ? 0.35 : m.intensity
  const { P, shapes, n } = routeBlade(ctx, dir, k)
  const light = dir === 'up' ? [W * 0.94, H * 0.04] : dir === 'down' ? [W * 0.94, H * 0.96] : [W * 0.97, P[0][1]]
  const glow = mix(C.navy, TOKENS.glow[dir], (0.35 + 0.65 * k) * TOKENS.glowStrength[dir])
  const [[xa, ya], , , [xb, yb]] = P
  const slvOpacity = n ? 0 : r1(0.55 + 0.45 * k)            // no clean route: drop the sliver rather than cut text
  return `<svg class="bg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${r1(light[0])}" cy="${r1(light[1])}" r="${r1(Math.max(W, H) * 0.95)}"><stop offset="0" stop-color="${glow}"/><stop offset=".45" stop-color="${C.navy}"/><stop offset="1" stop-color="${C.ink}"/></radialGradient>
<linearGradient id="band" gradientUnits="userSpaceOnUse" x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}"><stop offset="0" stop-color="${C.blueDeep}" stop-opacity="0"/><stop offset=".3" stop-color="${C.blueDeep}" stop-opacity=".75"/><stop offset=".7" stop-color="${C.blue}" stop-opacity=".95"/><stop offset="1" stop-color="${C.blueHi}"/></linearGradient>
<linearGradient id="slv" gradientUnits="userSpaceOnUse" x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}"><stop offset="0" stop-color="${C[dir]}" stop-opacity="0"/><stop offset=".35" stop-color="${C[dir]}"/><stop offset="1" stop-color="${C[dir]}"/></linearGradient>
</defs><rect width="${W}" height="${H}" fill="url(#glow)"/><path id="blade" d="${pathOf(shapes.band.poly)}" fill="url(#band)"/><path id="blade-sliver" d="${pathOf(shapes.sliver.poly)}" fill="url(#slv)" opacity="${slvOpacity}"/></svg>`
}

// ───────────────────────── hero and slab ─────────────────────────
const HERO = { track: -0.02, sign: 0.46, signGap: 0.07 }
const heroEm = s => textEm(s, 'sans', HERO.track) + 0.6 * HERO.sign + HERO.signGap
const fitHero = (s, avail, max) => Math.floor(Math.min(max, avail / heroEm(s)))
/** Hero number: "$" as a superior at cap height, digits on the given baseline. Neutral, always. */
function hero(ctx, m, x, base, hs) {
  const sign = Math.round(hs * HERO.sign)
  ctx.used.add('sans900')
  return ctx.T('$', { x, y: base - CAP * hs + CAP * sign, size: sign, weight: 900, color: C.soft }) +
    `<div class="t hero" style="left:${r1(x + 0.6 * sign + HERO.signGap * hs)}px;top:${r1(base - BASE * hs)}px;font-size:${hs}px;font-weight:900;letter-spacing:${HERO.track}em;color:${C.text}">${esc(m.hero)}</div>`
}

function arrow(dir, s, color) {
  const shape = dir === 'up' ? '<path d="M50 10 94 86H6Z"/>' : dir === 'down' ? '<path d="M6 14h88L50 90Z"/>' : '<path d="M8 30h84v2H8zM8 68h84v2H8z"/>'
  return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" fill="${color}" stroke="${color}" stroke-width="${dir === 'flat' ? 14 : 9}" stroke-linejoin="round">${shape}</svg>`
}
// Direction slab: a solid block in the direction colour with dark ink, arrow + sign + percent (never colour alone).
// Its free end is cut on the diagonal of the move: "/" up, "\" down, square when unchanged.
// mode 'line': ▲ +$ 15 | +0,90%      mode 'stack': a tall ▲ beside "+$ 15" over "+0,90%" (landscape sidebar).
// No reference close: an outlined chip with no arrow and no colour, so it can never be read as "unchanged".
const NO_REF = 'sin cierre previo'
function slabGeom(m, mode, h, fs) {
  const cut = m.direction === 'flat' || m.direction === 'unknown' ? 0 : Math.round(h * (mode === 'stack' ? 0.16 : 0.22)), pad = Math.round(fs * 0.42)
  if (m.direction === 'unknown') return { cut, pad, aw: 0, w: pad * 2 + textEm(NO_REF) * fs }
  if (m.direction === 'flat') return { cut, pad, aw: Math.round(fs * 0.74), w: pad * 2 + fs * 0.74 + fs * 0.3 + textEm('sin cambios') * fs }
  if (mode === 'stack') {
    const aw = Math.round(fs * 1.05)
    return { cut, pad, aw, w: pad * 2 + cut + aw + fs * 0.34 + Math.max(textEm(m.slabAbs), textEm(m.slabPct)) * fs }
  }
  const aw = Math.round(fs * 0.74)
  return { cut, pad, aw, w: pad * 2 + cut + aw + fs * 0.26 + (textEm(m.slabAbs) + textEm(m.slabPct)) * fs + fs * 0.72 + 3 }
}
/** Largest slab font size (<= max) whose slab fits in avail px (and, stacked, whose two lines fit its height). */
function fitSlab(m, mode, h, max, avail, min) {
  let fs = mode === 'stack' ? Math.min(max, Math.floor((h - 36) / 2.36)) : max
  while (fs > min && slabGeom(m, mode, h, fs).w > avail) fs--
  return Math.max(min, fs)
}
function slab(ctx, m, { x, y, h, fs, mode = 'line', minW = 0 }) {
  ctx.used.add('sans900')
  const g = slabGeom(m, mode, h, fs), w = Math.max(minW, g.w)
  if (m.direction === 'unknown') {
    ctx.used.add('sans700')
    ctx.block(x, y, x + w, y + h)                         // see-through: the blade must route around it like text
    return { w, html: `<div class="slab" style="left:${x}px;top:${y}px;width:${r1(w)}px;height:${h}px;padding:0 ${g.pad}px;font-size:${fs}px;font-weight:700;color:${C.soft};box-shadow:inset 0 0 0 3px ${C.unknown}"><span>${NO_REF}</span></div>` }
  }
  const clip = m.direction === 'up' ? `polygon(0 0,100% 0,calc(100% - ${g.cut}px) 100%,0 100%)`
    : m.direction === 'down' ? `polygon(0 0,calc(100% - ${g.cut}px) 0,100% 100%,0 100%)` : 'none'
  const a = arrow(m.direction, g.aw, C.slabInk)   // (unknown returned above)   // (unknown returned above)
  const inner = m.direction === 'flat'
    ? `${a}<span style="margin-left:${Math.round(fs * 0.3)}px">sin cambios</span>`
    : mode === 'stack'
      ? `${a}<span style="margin-left:${Math.round(fs * 0.34)}px;display:flex;flex-direction:column;gap:${Math.round(fs * 0.36)}px"><span>${esc(m.slabAbs)}</span><span>${esc(m.slabPct)}</span></span>`
      : `${a}<span style="margin-left:${Math.round(fs * 0.26)}px">${esc(m.slabAbs)}</span><i style="width:3px;height:${Math.round(fs * 0.86)}px;background:${C.slabInk};opacity:.28;margin:0 ${Math.round(fs * 0.36)}px"></i><span>${esc(m.slabPct)}</span>`
  return { w, html: `<div class="slab" style="left:${x}px;top:${y}px;width:${r1(w)}px;height:${h}px;padding:0 ${g.pad + g.cut}px 0 ${g.pad}px;font-size:${fs}px;background:${C[m.direction]};clip-path:${clip}">${inner}</div>` }
}

// ───────────────────────── charts ─────────────────────────
// Honest scale: the plot never spans less than a fixed share of the price (4 % over 30 days, 2 % in a week),
// so a quiet month or a one-peso day is drawn flat-ish instead of as a cliff. Real min/max sit on dotted guides.
function scale(lo, hi, ref, minShare) {
  const span = Math.max(hi - lo, ref * minShare)
  const mid = (hi + lo) / 2
  return [mid - span / 2, mid + span / 2]
}
const dottedRule = (x1, x2, y, opacity = 0.4) => `<path d="M${r1(x1)} ${r1(y)}H${r1(x2)}" stroke="${C.soft}" stroke-opacity="${opacity}" stroke-width="2" stroke-dasharray="2 11" stroke-linecap="round"/>`
const endDot = (x, y, r, color, ring) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 1.9)}" fill="${color}" fill-opacity=".18"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${color}" stroke="${C.ink}" stroke-width="${ring}"/>`

/** 30-day sparkline. Caption (period) above, y-axis values in a right gutter, last segment in the move colour.
 *  (x, y, w, h) is the plot box including the gutter; the caption baseline sits `capGap` above it. */
function spark(ctx, m, { x, y, w, h, fs, stroke, capGap }) {
  const { T } = ctx
  const pts = m.series, n = pts.length
  if (!n) return ''
  // period caption, collapsed like the weekly range: "30 ruedas · 12 oct – 20 nov", "12 ruedas · 15 – 30 dic"
  const period = formatDateRange([pts[0].day, pts[n - 1].day], { year: false })
  let o = T(typo(`${n} ${n > 1 ? 'ruedas' : 'rueda'} · `) + period, { x, y: y - capGap, size: fs, font: 'mono', color: C.muted })
  if (n < 2) return o                                       // one close: no plot, the caller gives the space to the stats
  const labels = m.min === m.max ? [m.max] : [m.max, m.min]
  const gutter = Math.max(...labels.map(v => textEm(formatNumber(v), 'mono'))) * fs + 28
  const r = stroke * 2.2, pw = w - gutter - r * 1.9
  const [lo, hi] = scale(m.min, m.max, m.max, 0.04)
  const top = y + r, bot = y + h - r
  const px = i => x + (n > 1 ? (i / (n - 1)) * pw : pw)
  const py = v => bot - ((v - lo) / (hi - lo)) * (bot - top)
  const xy = pts.map((p, i) => [px(i), py(p.sell)])
  const line = xy.map(([a, b]) => `${r1(a)} ${r1(b)}`).join('L')
  let g = labels.map(v => dottedRule(x, x + w - gutter + 12, py(v))).join('')
  if (n > 1) {
    g += `<path d="M${line}L${r1(px(n - 1))} ${y + h}L${x} ${y + h}Z" fill="url(#area)"/>`
    g += `<path d="M${line}" stroke="${C.line}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`
    if (m.direction === 'up' || m.direction === 'down') g += `<path d="M${xy.slice(-2).map(([a, b]) => `${r1(a)} ${r1(b)}`).join('L')}" stroke="${C[m.direction]}" stroke-width="${stroke}" stroke-linecap="round"/>`
  }
  g += endDot(xy[n - 1][0], xy[n - 1][1], r, C[m.direction], stroke)
  o += `<svg class="plot" width="${ctx.W}" height="${ctx.H}" fill="none"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.line}" stop-opacity=".26"/><stop offset="1" stop-color="${C.line}" stop-opacity="0"/></linearGradient></defs>${g}</svg>`
  ctx.block(x, y - 8, x + w, y + h + 8, 'chart')
  // Axis values, centred on their guides; pushed apart when the guides are close.
  const need = CAP * fs + 16
  let ys = labels.map(v => py(v) + (CAP * fs) / 2)
  if (ys.length === 2 && ys[1] - ys[0] < need) { const mid = (ys[0] + ys[1]) / 2; ys = [mid - need / 2, mid + need / 2] }
  labels.forEach((v, i) => { o += T(formatNumber(v), { x: x + w, y: ys[i], size: fs, font: 'mono', color: C.soft, align: 'right' }) })
  return o
}

/** Monday → Friday slots of the series' week, or one slot per point when the series is not one calendar week. */
function weekSlots(series) {
  const slots = series.map(p => ({ day: p.day, value: p.sell }))
  if (!series.length) return slots
  const last = dayDate(series.at(-1).day), monday = last.getTime() - ((last.getUTCDay() + 6) % 7) * 864e5
  const week = Array.from({ length: 5 }, (_, i) => new Date(monday + i * 864e5).toISOString().slice(0, 10))
  return series.every(p => week.includes(p.day)) ? week.map(day => ({ day, value: series.find(p => p.day === day)?.sell ?? null })) : slots
}

/** Weekly chart: a "previo" column (last week's close, a ghost point and a dotted reference level), then one
 *  column per weekday with its close above and "lun 16" below. Days without a close are hatched, never bridged. */
function weekChart(ctx, m, { x, y, w, h, fs, vs, stroke }) {
  const minFs = TOKENS.minText[ctx.size]
  const { T } = ctx
  const prev = m.prevSell
  const slots = weekSlots(m.series)
  const cols = [...(prev ? [{ day: null, value: prev, previo: true }] : []), ...slots]
  if (!slots.length) return ''
  const colW = w / cols.length, cx = i => x + colW * (i + 0.5)
  const r = stroke * 2
  const dayBase = y + h - 0.2 * fs
  const cellBot = dayBase - CAP * fs - 22
  const valueFs = Math.min(vs, ...cols.filter(c => c.value !== null).map(c => fitSize(formatNumber(c.value), colW - 26, vs, minFs)))
  const top = y + CAP * valueFs + 20 + r, bot = cellBot - r - 18
  const vals = cols.filter(c => c.value !== null).map(c => c.value)
  const [lo, hi] = scale(Math.min(...vals), Math.max(...vals), Math.max(...vals), 0.02)
  const cy = v => bot - ((v - lo) / (hi - lo)) * (bot - top)
  const live = cols.map((c, i) => ({ ...c, i })).filter(c => c.value !== null && !c.previo)
  const lastI = live.at(-1)?.i ?? -1
  let g = `<defs><pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V14" stroke="${C.soft}" stroke-opacity=".13" stroke-width="3"/></pattern></defs>`
  if (prev) g += dottedRule(cx(0), x + w, cy(prev), 0.45)
  g += `<path d="M${x} ${r1(cellBot)}H${x + w}" stroke="${C.soft}" stroke-opacity=".22" stroke-width="2"/>`
  cols.forEach((c, i) => { if (c.value === null) g += `<rect x="${r1(x + colW * i + 6)}" y="${y}" width="${r1(colW - 12)}" height="${h}" rx="10" fill="url(#hatch)" stroke="${C.soft}" stroke-opacity=".10" stroke-width="2"/>` })
  // solid segments only between adjacent weekdays; the previo → Monday step is dotted (a different week)
  if (prev && live[0]?.i === 1) g += `<path d="M${r1(cx(0))} ${r1(cy(prev))}L${r1(cx(1))} ${r1(cy(live[0].value))}" stroke="${C.muted}" stroke-opacity=".6" stroke-width="${stroke * 0.6}"/>`
  live.forEach((c, k) => { const nb = live[k + 1]; if (nb && nb.i === c.i + 1) g += `<path d="M${r1(cx(c.i))} ${r1(cy(c.value))}L${r1(cx(nb.i))} ${r1(cy(nb.value))}" stroke="${C.line}" stroke-width="${stroke}" stroke-linecap="round"/>` })
  if (prev) g += `<circle cx="${r1(cx(0))}" cy="${r1(cy(prev))}" r="${r}" fill="${C.ink}" stroke="${C.muted}" stroke-width="${stroke * 0.6}"/>`
  for (const c of live) g += c.i === lastI ? endDot(cx(c.i), cy(c.value), r * 1.15, C[m.direction], stroke) : `<circle cx="${r1(cx(c.i))}" cy="${r1(cy(c.value))}" r="${r}" fill="${C.ink}" stroke="${C.line}" stroke-width="${stroke}"/>`
  let o = `<svg class="plot" width="${ctx.W}" height="${ctx.H}" fill="none">${g}</svg>`
  ctx.block(x, y, x + w, cellBot, 'chart')
  // value label: above its point, lifted when a neighbouring segment would run through it
  const drawn = cols.map((c, i) => ({ ...c, i })).filter(c => c.value !== null)
  const labelBase = c => {
    let b = cy(c.value) - (c.i === lastI ? r * 2.2 : r) - 12
    const half = (textEm(formatNumber(c.value)) * valueFs) / 2 + 8
    const k = drawn.findIndex(d => d.i === c.i)
    for (const nb of [drawn[k - 1], drawn[k + 1]]) {
      if (!nb) continue
      const xe = cx(c.i) + Math.sign(cx(nb.i) - cx(c.i)) * half
      const t = (xe - cx(c.i)) / (cx(nb.i) - cx(c.i))
      b = Math.min(b, cy(c.value) + t * (cy(nb.value) - cy(c.value)) - stroke - 10)
    }
    return Math.max(b, y + CAP * valueFs)
  }
  for (const c of drawn) {
    o += T(formatNumber(c.value), { x: cx(c.i), y: labelBase(c), size: valueFs, weight: c.i === lastI ? 900 : 700, color: c.i === lastI ? C.text : c.previo ? C.muted : C.soft, align: 'center' })
  }
  cols.forEach((c, i) => {
    const label = c.previo ? 'previo' : typo(`${fWeekday.format(dayDate(c.day))} ${dayDate(c.day).getUTCDate()}`)
    o += T(label, { x: cx(i), y: dayBase, size: fs, font: 'mono', color: c.previo ? C.muted : c.value === null ? C.ghost : C.soft, align: 'center' })
  })
  return o
}

// ───────────────────────── stats ─────────────────────────
const KEY = { weight: 700, color: C.soft, track: 0.08 }
/** Columns of key over value (portrait, story), separated by hairlines with at least 36 px clear on each side.
 *  Values shrink together to fit. */
const GUTTER = 36
function statCols(ctx, cells, { x, y, w, fs, vs }) {
  const col = w / cells.length, inset = i => (i ? Math.max(GUTTER, Math.round(col * 0.12)) : 0)
  const size = Math.min(...cells.map(([, v], i) => fitSize(v, col - inset(i) - GUTTER, vs)))
  const keyBase = y + CAP * fs, valBase = keyBase + Math.round(fs * 0.7) + CAP * size
  return cells.map(([k, v], i) => {
    const cx = x + col * i + inset(i)
    return (i ? `<i class="vr" style="left:${r1(x + col * i)}px;top:${y}px;height:${r1(valBase - y)}px"></i>` : '') +
      ctx.T(k, { x: cx, y: keyBase, size: fs, ...KEY }) + ctx.T(v, { x: cx, y: valBase, size })
  }).join('')
}
/** Rows of key ← → value (landscape sidebar), separated by hairlines. */
function statRows(ctx, cells, { x, y, w, h, fs, vs }) {
  const row = h / cells.length
  const keyW = Math.max(...cells.map(([k]) => textEm(k, 'sans', 0.08))) * fs
  const size = Math.min(...cells.map(([, v]) => fitSize(v, w - keyW - 28, vs)))
  return cells.map(([k, v], i) => {
    const mid = y + row * (i + 0.5)
    return `<i class="hr" style="left:${x}px;top:${r1(y + row * i)}px;width:${w}px"></i>` +
      ctx.T(k, { x, y: mid + (CAP * fs) / 2, size: fs, ...KEY }) + ctx.T(v, { x: x + w, y: mid + (CAP * size) / 2, size, align: 'right' })
  }).join('')
}
const statCells = m => m.kind === 'weekly'
  ? [['MÍNIMO', formatPesos(m.min)], ['MÁXIMO', formatPesos(m.max)], ['OFICIAL', m.oficial], ['BRECHA', m.gap]]
  : [['COMPRA', formatPesos(m.buy)], ['OFICIAL', m.oficial], ['BRECHA', m.gap]]
// weekly: the compact range (a year-crossing week names its year once), so the kicker leaves room for the blade
const kicker = m => m.kind === 'weekly' ? `DÓLAR BLUE · ${upper(m.rangeShort)}` : m.kind === 'og' ? 'DÓLAR BLUE HOY' : 'DÓLAR BLUE · VENTA'
// one line, never shown when there is no reference close
const versus = m => (m.hasRef ? { update: 'vs. cierre anterior', weekly: 'vs. semana anterior' }[m.kind] : '')
const CHART_NOTE = 'cierre diario · venta'
function footer(ctx, m, { L, R, y, fs }) {
  return ctx.T(m.stamp, { x: L, y, size: fs, font: 'mono', color: C.muted }) +
    ctx.T('bluelytics.com.ar', { x: R, y, size: fs, font: 'mono', color: C.soft, align: 'right' })
}

// ───────────────────────── layouts ─────────────────────────
// X timeline: main column (kicker, hero, chart) + sidebar (slab, stats), sharing a mono notes row.
function landscape(ctx, m) {
  const { T } = ctx
  const L = 80, R = 1520, mainW = 960, sideX = 1104, sideW = R - sideX
  const heroBase = 424, slabTop = 217, notes = 496
  let o = lockup(ctx, L, 72, 50, 40)
  if (m.kind === 'weekly') o += editionTag(ctx, R, 73, 34)
  const hs = fitHero(m.hero, mainW, 300)
  const capTop = heroBase - CAP * hs
  const kfs = fitSize(kicker(m), mainW, 38, 34, 'sans', 0.08)
  o += T(kicker(m), { x: L, y: capTop - 36, size: kfs, track: 0.08 })
  o += hero(ctx, m, L, heroBase, hs)
