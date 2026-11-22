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
export function formatGap(ratio) {
  const r = Math.round(ratio * 1000) / 1000                // a gap that rounds to 0,0 % never keeps its minus
  return formatPercent(r === 0 ? 0 : r, { digits: 1, signed: false, escalate: false })
}
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
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v))   // "1660" (JSON, D1 decimals) -> 1660
export function computeCardFacts(data) {
  const sell = num(data.blue?.sell), buy = num(data.blue?.buy)
  if (!Number.isFinite(sell) || sell <= 0) throw new Error(`computeCardFacts: blue.sell must be a positive number, got ${data.blue?.sell}`)
  const prev = num(data.prevSell), prevSell = Number.isFinite(prev) && prev > 0 ? prev : null
  const hasRef = prevSell !== null
  const deltaAbs = hasRef ? sell - prevSell : null
  const deltaPct = hasRef ? deltaAbs / prevSell : null
  const direction = !hasRef ? 'unknown' : deltaAbs > 0 ? 'up' : deltaAbs < 0 ? 'down' : 'flat'
  const ofi = num(data.oficial?.sell), oficialSell = Number.isFinite(ofi) && ofi > 0 ? ofi : null
  const series = (data.series ?? []).map(p => p && { day: p.day, sell: num(p.sell) })
    .filter(p => p && Number.isFinite(p.sell) && /^\d{4}-\d{2}-\d{2}$/.test(p.day))
  // a missing or unparsable instant means "no timestamp" for the card and the alt text alike (never a throw)
  const updatedAt = Number.isFinite(new Date(data.updatedAt ?? NaN).getTime()) ? data.updatedAt : null
  const values = series.map(p => p.sell)
  return {
    sell, buy, prevSell, hasRef, deltaAbs, deltaPct, direction, oficialSell,
    gapPct: oficialSell ? sell / oficialSell - 1 : null,
    series, points: series.length,
    min: values.length ? Math.min(...values) : sell,
    max: values.length ? Math.max(...values) : sell,
    firstDay: series[0]?.day ?? null, lastDay: series.at(-1)?.day ?? null,
    updatedAt,
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
  const when = f.updatedAt ? formatTimestamp(f.updatedAt, { plain: true }) + '.' : ''
  const days = f.series.map(p => p.day)
  const range = f.points > 1 && f.min !== f.max ? `En las últimas ${f.points} ruedas osciló entre ${P(f.min)} y ${P(f.max)}.` : ''
  const weekRange = f.points > 1 && f.min !== f.max ? `Mínimo de la semana ${P(f.min)}, máximo ${P(f.max)}.`
    : f.points === 1 ? 'Un solo cierre en la semana.' : ''
  const parts = kind === 'weekly'
    ? [`${['Dólar blue, resumen semanal', formatDateRange(days, { prose: true })].filter(Boolean).join(' ')}: cerró en ${P(f.sell)} (venta), compra ${P(f.buy)}.`, move,
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
    const { x, y, size: fs, font = 'sans', weight = font === 'mono' ? 500 : 700, color = C.text, align = 'left', track = 0, raw = false, plain = s, cls = 't', ob = 'text' } = o
    used.add(font + weight)
    const w = textEm(plain, font, track) * fs
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    // ink box: accents and the "$" rise above the cap height; descenders drop below the baseline
    block(left, y - (/[ÁÉÍÓÚÑ$]/.test(plain) ? 0.86 : CAP) * fs, left + w, y + (/[gjpqy(),;]/.test(plain) ? 0.22 : 0.05) * fs, ob)
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
/** "RESUMEN SEMANAL" edition tag (weekly only): a solid white block at the end of the logo row, so a weekly card
 *  is told apart from an update even as a 125 px grid thumbnail. Text baseline `base`; the block starts at `x`
 *  (or ends at `right`); `width` stretches it (text centred), and the tracking tightens if the natural width does
 *  not fit it. */
const TAG = 'RESUMEN SEMANAL'
const tagEm = track => textEm(TAG, 'sans', track) + 1   // + 2 × 0.5 em side padding
function editionTag(ctx, { x, right, base, fs, width = 0 }) {
  ctx.used.add('sans700')
  const track = width && tagEm(0.08) * fs > width ? 0.03 : 0.08
  const w = Math.max(width, tagEm(track) * fs), top = base - 1.145 * fs, hgt = Math.round(1.5 * fs)
  const left = right === undefined ? x : right - w
  ctx.block(left, top, left + w, top + hgt, 'tag')
  return `<div class="tag" style="left:${r1(left)}px;top:${r1(top)}px;width:${r1(w)}px;height:${hgt}px;font-size:${fs}px;letter-spacing:${track}em;text-indent:${track}em;padding-top:${r1(0.3 * fs)}px;text-align:center">${TAG}</div>`
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
// up: enters the left edge at height e and leaves through the top at x (through the right edge when x > 1.2);
// down, the mirror: enters the top at x = e, falls steeply through the right of the hero and levels out into the
// right edge at height x; flat (also no reference close): the up curve, but shallow, from height e on the left
// to height x on the right edge, with a list of route families tried in order (e.g. story: along the bottom band,
// then under the hero, then across the top corner). Flat blades keep their edges out of the hero's middle third
// and their thin line off the digits entirely, so they never read as a strikethrough of the price.
// The router tries routes near the preferred one (then thinner blades) and keeps the first whose sliver touches
// no small text, chart or logo, whose body neither covers nor cuts any small text (muted mono on the blade's
// brand blue would drop to ~2.5:1) and whose body edge stays 24 px clear of hatched empty-day cells. The hero
// digits, the opaque slab and the filled no-reference chip are fair game for up/down blades. The first 4 % of
// the blade (fully transparent, off the canvas edge) is not tested.
const BLADE = {
  landscape: { w: 300, up: [0.52, 0.86], down: [0.5, 0.4], flat: [[0.06, 0.12]] },
  portrait: { w: 280, up: [0.42, 1.07], down: [0.5, 0.3], flat: [[0.38, 0.36], [0.06, 0.1]] },
  story: { w: 330, up: [0.44, 1.07], down: [0.5, 0.31], flat: [[0.88, 0.97], [0.38, 0.34], [0.06, 0.1]] },
  og: { w: 250, up: [0.63, 1.07], down: [0.52, 0.55], flat: [[0.76, 0.34], [0.9, 0.99]] },
}
const VISIBLE_FROM = 0.04
// Centre line: up is a growth curve (flat start, steep end); down an inverted one (steep fall, levelling out).
function bladeCurve(dir, W, H, e, x) {
  const lerp = (a, b, t) => a + (b - a) * t
  if (dir === 'down') {
    const P0 = [e * W, -100], P3 = [W + 100, x * H]
    return [P0, [lerp(P0[0], P3[0], 0.12), lerp(P0[1], P3[1], 0.7)], [lerp(P0[0], P3[0], 0.55), P3[1]], P3]
  }
  const P0 = [-80, e * H]
  const P3 = dir === 'flat' ? [W + 80, x * H] : x > 1.2 ? [W + 100, (x - 1.2) * H] : [x * W, -100]
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
  const spec = BLADE[size], cands = []
  // up blades may also leave through the right edge (x > 1.2), as a costlier second family; flat blades have a
  // list of families in order of preference (each 6 steps dearer than the one before)
  const anchors = dir === 'flat' ? spec.flat.map(([e, x], i) => [i * 6, e, x])
    : dir === 'up' ? [[0, ...spec.up], [8, spec.up[0], 1.45]] : [[0, ...spec.down]]
  for (const [wi, wf] of [[0, 1], [3, 0.8], [6, 0.65]]) for (const a of STEPS) for (const b of STEPS)
    for (const [xi, ea, xa] of anchors) cands.push({ e: ea + a * 0.03, x: xa + b * (dir === 'flat' ? 0.02 : 0.04), w: spec.w * wf, cost: Math.abs(a) + Math.abs(b) + wi + xi })
  cands.sort((p, q) => p.cost - q.cost)        // stable: ties keep generation order
  candCache.set(key, cands)
  return cands
}
// Each candidate is screened with a coarse 8-segment ribbon that stops at its first conflict; only a candidate that
// screens clean is checked with the full 64-segment ribbon. Worst case a few ms (the 10 ms budget is asserted in
// render-extra.mjs).
function routeBlade(ctx, dir, k) {
  const { W, H, size, obstacles } = ctx
  // Small text may not sit on the blade at all (muted mono on brand blue is ~2.5:1), so a text box that meets the
  // body counts like one its edge cuts. Hatched empty-day cells keep the body edge 24 px away. For flat and
  // no-reference blades the hero box is off limits too: a near-level line through the digits reads as a
  // strikethrough, so those blades pass above the cap line or below the baseline. Up/down blades may cross it.
  const pad = { cell: 24 }, level = dir === 'flat'
  const rects = obstacles.filter(o => (o.kind !== 'hero' && o.kind !== 'heroBox') || level)
    .map(o => { const p = pad[o.kind] ?? 10; return { kind: o.kind, x0: o.x0 - p, y0: o.y0 - p, x1: o.x1 + p, y1: o.y1 + p } })
  const conflicts = ({ band, sliver }, limit) => {
    let n = 0
    for (const r of rects) {
      if (r.kind === 'hero' ? false : overlaps(sliver, r)) n++
      if (r.kind === 'heroBox') { if (n >= limit) break; continue }
      if (r.kind === 'text' ? overlaps(band, r) : (r.kind === 'cell' || r.kind === 'hero' || r.kind === 'sign') && sidesCross(band, r)) n++
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
  // Story: a low brand-blue light from below, so the band under the footer (Instagram's reply area) is not a dead
  // flat gradient. Down cards already have their dusk glow there. A 4.5 % grain over everything breaks up banding
  // in the large smooth glows before Instagram recompresses them.
  const floor = ctx.size === 'story' && dir !== 'down'
  return `<svg class="bg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${r1(light[0])}" cy="${r1(light[1])}" r="${r1(Math.max(W, H) * 0.95)}"><stop offset="0" stop-color="${glow}"/><stop offset=".45" stop-color="${C.navy}"/><stop offset="1" stop-color="${C.ink}"/></radialGradient>
<linearGradient id="band" gradientUnits="userSpaceOnUse" x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}"><stop offset="0" stop-color="${C.blueDeep}" stop-opacity="0"/><stop offset=".3" stop-color="${C.blueDeep}" stop-opacity=".75"/><stop offset=".7" stop-color="${C.blue}" stop-opacity=".95"/><stop offset="1" stop-color="${C.blueHi}"/></linearGradient>
<linearGradient id="slv" gradientUnits="userSpaceOnUse" x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}"><stop offset="0" stop-color="${C[dir]}" stop-opacity="0"/><stop offset=".16" stop-color="${C[dir]}" stop-opacity="0"/><stop offset=".42" stop-color="${C[dir]}"/><stop offset="1" stop-color="${C[dir]}"/></linearGradient>
<radialGradient id="floor" gradientUnits="userSpaceOnUse" cx="${r1(W * 0.12)}" cy="${H}" r="${r1(W * 0.95)}"><stop offset="0" stop-color="${C.blueDeep}" stop-opacity=".42"/><stop offset="1" stop-color="${C.blueDeep}" stop-opacity="0"/></radialGradient>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="1" seed="7" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 .045"/></filter>
</defs><rect width="${W}" height="${H}" fill="url(#glow)"/>${floor ? `<rect width="${W}" height="${H}" fill="url(#floor)"/>` : ''}<rect width="${W}" height="${H}" filter="url(#grain)"/><path id="blade" d="${pathOf(shapes.band.poly)}" fill="url(#band)"/><path id="blade-sliver" d="${pathOf(shapes.sliver.poly)}" fill="url(#slv)" opacity="${slvOpacity}"/></svg>`
}

// ───────────────────────── hero and slab ─────────────────────────
const HERO = { track: -0.02, sign: 0.46, signGap: 0.07 }
const heroEm = s => textEm(s, 'sans', HERO.track) + 0.6 * HERO.sign + HERO.signGap
const fitHero = (s, avail, max) => Math.floor(Math.min(max, avail / heroEm(s)))
/** Hero number: "$" as a superior at cap height, digits on the given baseline. Neutral, always. */
function hero(ctx, m, x, base, hs) {
  const sign = Math.round(hs * HERO.sign)
  ctx.used.add('sans900')
  // the middle third of the digits: a flat or no-reference blade never runs through it (it would read as a strikethrough)
  ctx.block(x, base - (CAP * hs * 2) / 3, x + heroEm(m.hero) * hs, base - (CAP * hs) / 3, 'hero')
  // … and its thin line stays off the digits altogether (cap line to baseline), so it never underlines or strikes them
  ctx.block(x + 0.6 * sign + HERO.signGap * hs, base - CAP * hs, x + heroEm(m.hero) * hs, base, 'heroBox')
  return ctx.T('$', { x, y: base - CAP * hs + CAP * sign, size: sign, weight: 900, color: C.soft, ob: 'sign' }) +
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
    // solid ink fill, so the chip reads the same on the field and on the blade (opaque, like the slab)
    return { w, html: `<div class="slab" style="left:${x}px;top:${y}px;width:${r1(w)}px;height:${h}px;padding:0 ${g.pad}px;justify-content:center;font-size:${fs}px;font-weight:700;color:${C.soft};background:${C.ink};box-shadow:inset 0 0 0 3px ${C.unknown}"><span>${NO_REF}</span></div>` }
  }
  const clip = m.direction === 'up' ? `polygon(0 0,100% 0,calc(100% - ${g.cut}px) 100%,0 100%)`
    : m.direction === 'down' ? `polygon(0 0,calc(100% - ${g.cut}px) 0,100% 100%,0 100%)` : 'none'
  const a = arrow(m.direction, g.aw, C.slabInk)
  const inner = m.direction === 'flat'
    ? `${a}<span style="margin-left:${Math.round(fs * 0.3)}px">sin cambios</span>`
    : mode === 'stack'
      ? `${a}<span style="margin-left:${Math.round(fs * 0.34)}px;display:flex;flex-direction:column;gap:${Math.round(fs * 0.36)}px"><span>${esc(m.slabAbs)}</span><span>${esc(m.slabPct)}</span></span>`
      : `${a}<span style="margin-left:${Math.round(fs * 0.26)}px">${esc(m.slabAbs)}</span><i style="width:3px;height:${Math.round(fs * 0.86)}px;background:${C.slabInk};opacity:.28;margin:0 ${Math.round(fs * 0.36)}px"></i><span>${esc(m.slabPct)}</span>`
  return { w, html: `<div class="slab" style="left:${x}px;top:${y}px;width:${r1(w)}px;height:${h}px;padding:0 ${g.pad + g.cut}px 0 ${g.pad}px;font-size:${fs}px;background:${C[m.direction]};clip-path:${clip}${m.direction === 'flat' ? ';justify-content:center' : ''}">${inner}</div>` }
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

/** Weekly chart: a "previo" column (last week's close: a ghost point on a dotted reference level), then one column
 *  per weekday with "lun 16" below. Days without a close are hatched and never bridged. Value labels are quiet mono,
 *  except the last close in bold white; each sits on the side of its point away from the reference level, and when
 *  labels would collide only previo, the first, the last, the min and the max keep theirs. */
function weekChart(ctx, m, { x, y, w, h, fs, vs, stroke }) {
  const { T } = ctx
  const slots = weekSlots(m.series)
  if (!slots.length) return ''
  const prev = m.prevSell
  const cols = [...(prev ? [{ day: null, value: prev, previo: true }] : []), ...slots].map((c, i) => ({ ...c, i }))
  const colW = w / cols.length, cx = i => x + colW * (i + 0.5)
  const r = stroke * 2
  const drawn = cols.filter(c => c.value !== null), live = drawn.filter(c => !c.previo), last = live.at(-1)
  const fit = (c, max, font) => fitSize(formatNumber(c.value), colW - 16, max, TOKENS.minText[ctx.size], font)
  const noteFs = Math.min(fs, ...drawn.map(c => fit(c, fs, 'mono'))), lastFs = fit(last, vs, 'sans')
  const lfs = c => (c === last ? lastFs : noteFs)
  const below = c => prev !== null && !c.previo && c.value < prev
  const dotR = c => (c === last ? r * 1.15 * 1.9 : r)
  const dayBase = y + h - 0.2 * fs, cellBot = dayBase - CAP * fs - 22
  const lowRoom = Math.max(0, ...drawn.filter(below).map(c => CAP * lfs(c) + 14 + dotR(c)))
  const top = y + CAP * Math.max(...drawn.filter(c => !below(c)).map(lfs)) + 14 + r * 2.2
  const bot = cellBot - 14 - Math.max(r * 2.2, lowRoom)
  const vals = drawn.map(c => c.value)
  const [lo, hi] = scale(Math.min(...vals), Math.max(...vals), Math.max(...vals), 0.02)
  const cy = v => bot - ((v - lo) / (hi - lo)) * (bot - top)
  const joined = (a, b) => b && Math.abs(a.i - b.i) === 1 && (!a.previo || b === live[0]) && (!b.previo || a === live[0])
  const seg = (a, b, color, width, extra = '') => `<path d="M${r1(cx(a.i))} ${r1(cy(a.value))}L${r1(cx(b.i))} ${r1(cy(b.value))}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${extra}/>`
  let g = `<defs><pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V14" stroke="${C.soft}" stroke-opacity=".13" stroke-width="3"/></pattern></defs>`
  if (prev) g += dottedRule(cx(0), x + w, cy(prev), 0.45)
  g += `<path d="M${x} ${r1(cellBot)}H${x + w}" stroke="${C.soft}" stroke-opacity=".22" stroke-width="2"/>`
  for (const c of cols) if (c.value === null) ctx.block(x + colW * c.i + 6, y, x + colW * (c.i + 1) - 6, cellBot, 'cell')
  for (const c of cols) if (c.value === null) g += `<rect x="${r1(x + colW * c.i + 6)}" y="${y}" width="${r1(colW - 12)}" height="${r1(cellBot - y)}" rx="10" fill="url(#hatch)" stroke="${C.soft}" stroke-opacity=".10" stroke-width="2"/>`
  // solid segments only between adjacent weekdays; the previo → Monday step is a quieter link (a different week)
  if (prev && joined(drawn[0], live[0])) g += seg(drawn[0], live[0], C.muted, stroke * 0.6, ' stroke-opacity=".6"')
  live.forEach((c, k) => { if (joined(c, live[k + 1])) g += seg(c, live[k + 1], C.line, stroke) })
  if (prev) g += `<circle cx="${r1(cx(0))}" cy="${r1(cy(prev))}" r="${r}" fill="${C.ink}" stroke="${C.muted}" stroke-width="${stroke * 0.6}"/>`
  for (const c of live) g += c === last ? endDot(cx(c.i), cy(c.value), r * 1.15, C[m.direction] ?? C.flat, stroke) : `<circle cx="${r1(cx(c.i))}" cy="${r1(cy(c.value))}" r="${r}" fill="${C.ink}" stroke="${C.line}" stroke-width="${stroke}"/>`
  ctx.block(x, y, x + w, cellBot, 'chart')
  // label baselines: clear of the dot and of the segments that leave it
  const label = c => {
    const s = lfs(c), half = (textEm(formatNumber(c.value), c === last ? 'sans' : 'mono') * s) / 2 + 8, k = drawn.indexOf(c)
    const segY = nb => cy(c.value) + (Math.min(half, Math.abs(cx(nb.i) - cx(c.i))) / Math.abs(cx(nb.i) - cx(c.i))) * (cy(nb.value) - cy(c.value))
    const nbs = [drawn[k - 1], drawn[k + 1]].filter(nb => nb && (joined(c, nb) || joined(nb, c)))
    let base
    if (below(c)) base = Math.min(cellBot - 8, Math.max(cy(c.value) + dotR(c) + 12 + CAP * s, ...nbs.map(nb => segY(nb) + stroke + 10 + CAP * s)))
    else base = Math.max(y + CAP * s, Math.min(cy(c.value) - dotR(c) - 12, ...nbs.map(nb => segY(nb) - stroke - 10)))
    return { c, s, base, x0: cx(c.i) - half, x1: cx(c.i) + half, y0: base - CAP * s, y1: base }
  }
  let labels = drawn.map(label)
  // padded boxes (8 px each side) must also keep 0.6 em of the label face between them, or two numbers butt
  // together and read as one ("152.597 152.597"); vertically, sharing any part of a line band counts as a clash
  const gap = l => Math.max(0, 0.6 * l.s - 16)
  const hits = (a, b) => a.x1 + gap(a) > b.x0 && b.x1 + gap(b) > a.x0 && a.y1 + 8 > b.y0 && b.y1 + 8 > a.y0
  if (labels.some((a, j) => labels.slice(j + 1).some(b => hits(a, b)))) {
    // only the last, previo, the max, the min and the first may keep a label, in that order of priority; a
    // label that would still clash with a higher-priority one is dropped too (e.g. previo 117.500 beside 118.000)
    const lv = live.map(c => c.value)
    const order = [last, prev ? drawn[0] : null, live[lv.indexOf(Math.max(...lv))], live[lv.indexOf(Math.min(...lv))], live[0]]
    const kept = []
    for (const c of order) { const l = labels.find(l => l.c === c); if (l && !kept.includes(l) && !kept.some(k => hits(k, l))) kept.push(l) }
    labels = kept
  }
  let o = `<svg class="plot" width="${ctx.W}" height="${ctx.H}" fill="none">${g}</svg>`
  for (const { c, s, base } of labels) o += c === last
    ? T(formatNumber(c.value), { x: cx(c.i), y: base, size: s, weight: 900, color: C.text, align: 'center' })
    : T(formatNumber(c.value), { x: cx(c.i), y: base, size: s, font: 'mono', color: C.muted, align: 'center' })
  for (const c of cols) {
    const text = c.previo ? 'previo' : typo(`${fWeekday.format(dayDate(c.day))} ${dayDate(c.day).getUTCDate()}`)
    o += T(text, { x: cx(c.i), y: dayBase, size: fs, font: 'mono', color: c.previo ? C.muted : c.value === null ? C.ghost : C.soft, align: 'center' })
  }
  return o
}

// ───────────────────────── stats ─────────────────────────
const KEY = { weight: 700, color: C.soft, track: 0.08 }
const GUTTER = 36
/** Columns of key over value (portrait, story), separated by hairlines with at least 36 px clear on each side.
 *  Keys and values each shrink together to fit their columns. */
function statCols(ctx, cells, { x, y, w, fs, vs }) {
  const col = w / cells.length, inset = i => (i ? GUTTER : 0), room = i => col - inset(i) - GUTTER
  const kfs = Math.min(...cells.map(([k], i) => fitSize(k, room(i), fs, TOKENS.minText[ctx.size], 'sans', KEY.track)))
  const size = Math.min(...cells.map(([, v], i) => fitSize(v, room(i), vs)))
  const keyBase = y + CAP * fs, valBase = keyBase + Math.round(fs * 0.7) + CAP * size
  return cells.map(([k, v], i) => {
    const cx = x + col * i + inset(i)
    return (i ? `<i class="vr" style="left:${r1(x + col * i)}px;top:${y}px;height:${r1(valBase - y)}px"></i>` : '') +
      ctx.T(k, { x: cx, y: keyBase, size: kfs, ...KEY }) + ctx.T(v, { x: cx, y: valBase, size })
  }).join('')
}
const statColsHeight = (fs, vs) => CAP * fs + Math.round(fs * 0.7) + CAP * vs
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
// weekly: the compact range (a year-crossing week names its year once)
const kicker = m => m.kind === 'og' ? 'DÓLAR BLUE HOY' : m.kind === 'weekly' && m.range ? `DÓLAR BLUE · ${upper(m.range)}` : 'DÓLAR BLUE · VENTA'
// one line, never shown when there is no reference close
const versus = m => (m.hasRef ? { update: 'vs. cierre anterior', weekly: 'vs. semana anterior' }[m.kind] ?? '' : '')
function footer(ctx, m, { L, R, y, fs }) {
  return ctx.T(m.stamp, { x: L, y, size: fs, font: 'mono', color: C.muted }) +
    ctx.T('bluelytics.com.ar', { x: R, y, size: fs, font: 'mono', color: C.soft, align: 'right' })
}
/** Slab in line mode with the versus note on the same line when it fits, else on its own line below.
 *  Returns the html and the y below the block. */
function slabWithNote(ctx, m, { x, y, h, max, min, avail, noteFs }) {
  const note = versus(m), noteW = textEm(note, 'mono') * noteFs + 32
  let fs = fitSlab(m, 'line', h, max, avail - noteW, min), beside = true
  if (slabGeom(m, 'line', h, fs).w > avail - noteW || fs < max * 0.8) { fs = fitSlab(m, 'line', h, max, avail, min); beside = !note }
  const s = slab(ctx, m, { x, y, h, fs })
  if (!note) return { html: s.html, bottom: y + h }
  const noteY = beside ? y + h / 2 + (CAP * noteFs) / 2 : y + h + 24 + CAP * noteFs
  return { html: s.html + ctx.T(note, { x: beside ? x + s.w + 32 : x, y: noteY, size: noteFs, font: 'mono', color: C.muted }), bottom: beside ? y + h : noteY }
}

// ───────────────────────── layouts ─────────────────────────
// X timeline: main column (kicker, hero, chart) + sidebar (slab, stats). The kicker is anchored to the logo row
// and the hero hangs from a fixed cap line, so a shrunken 6-digit hero leaves its spare room below, not above.
function landscape(ctx, m) {
  const { T } = ctx
  const L = 80, R = 1520, mainW = 960, sideX = 1104, sideW = R - sideX
  const heroTop = 222, footBase = 816
  let o = lockup(ctx, L, 72, 50, 40)
  if (m.kind === 'weekly') o += editionTag(ctx, { x: sideX, base: 109, fs: 34, width: sideW })
  o += T(kicker(m), { x: L, y: 190, size: fitSize(kicker(m), mainW, 38, 34, 'sans', 0.08), track: 0.08 })
  const hs = fitHero(m.hero, mainW, 300), slabH = Math.round(CAP * hs)
  o += hero(ctx, m, L, heroTop + CAP * hs, hs)
  o += slab(ctx, m, { x: sideX, y: heroTop, h: slabH, fs: fitSlab(m, 'stack', slabH, 76, sideW, 40), mode: 'stack' }).html
  const notes = heroTop + slabH + 66
  if (versus(m)) o += T(versus(m), { x: sideX, y: notes, size: 34, font: 'mono', color: C.muted })
  const bandBot = footBase - 66
  // a shrunken (6-digit) hero still keeps the chart's bold top label well clear of its baseline
  const wkY = Math.max(heroTop + slabH + 44, heroTop + CAP * 300 + 20)
  if (m.kind === 'weekly') o += weekChart(ctx, m, { x: L, y: wkY, w: mainW, h: footBase - 74 - wkY, fs: 34, vs: 46, stroke: 5 })
  else o += spark(ctx, m, { x: L, y: notes + 40, w: mainW, h: bandBot - notes - 40, fs: 34, stroke: 6, capGap: 40 })
  o += statRows(ctx, statCells(m), { x: sideX, y: notes + 34, w: sideW, h: bandBot - notes - 34, fs: 34, vs: m.kind === 'weekly' ? 46 : 54 })
  return o + footer(ctx, m, { L, R, y: footBase, fs: 34 })
}

/** One column (portrait, story): logo row, kicker, hero, slab + note, chart, stats, footer. `S` holds the
 *  per-size measures; the chart takes whatever height is left between the slab block and the stats. */
function column(ctx, m, S) {
  const { T } = ctx
  const L = 72, R = ctx.W - 72, W = R - L
  let o = lockup(ctx, L, S.logoY, S.mark, S.word)
  if (m.kind === 'weekly') o += editionTag(ctx, { right: R, base: S.logoY + S.mark / 2 + S.word * 0.3, fs: S.tag })
  o += T(kicker(m), { x: L, y: S.kicker, size: fitSize(kicker(m), W, S.label, TOKENS.minText[ctx.size], 'sans', 0.08), track: 0.08 })
  const hs = fitHero(m.hero, W, S.hero)
  o += hero(ctx, m, L, S.heroTop + CAP * hs, hs)
  const sw = slabWithNote(ctx, m, { x: L, y: S.heroTop + CAP * S.hero + S.slabGap, h: S.slabH, max: S.slabFs, min: 40, avail: W, noteFs: S.note })
  o += sw.html
  const chartTop = sw.bottom + S.chartGap
  // a one-close series has no line to draw: its caption stays, and the stats close up under it
  const noPlot = m.kind === 'update' && m.points < 2
  const statsTop = noPlot ? chartTop + S.capGap + S.chartGap : S.footer - CAP * S.note - S.statsGap - statColsHeight(S.label, S.value)
  const chartBot = statsTop - S.chartGap
  if (m.kind === 'weekly') o += weekChart(ctx, m, { x: L, y: chartTop, w: W, h: chartBot - chartTop, fs: S.note, vs: S.value * 0.75, stroke: S.stroke })
  else o += spark(ctx, m, { x: L, y: chartTop + S.capGap, w: W, h: chartBot - chartTop - S.capGap, fs: S.note, stroke: S.stroke, capGap: S.capGap - 12 })
  o += statCols(ctx, statCells(m), { x: L, y: statsTop, w: W, fs: S.label, vs: S.value })
  return o + footer(ctx, m, { L, R, y: S.footer, fs: S.note })
}
const COLUMN = {
  portrait: { logoY: 60, mark: 52, word: 42, tag: 30, kicker: 190, label: 34, heroTop: 222, hero: 270, slabGap: 44, slabH: 100, slabFs: 58, note: 30, chartGap: 56, capGap: 56, statsGap: 64, value: 62, footer: 1280, stroke: 5 },
  // story: tighter rhythm than before (the old one left a 210-280 px chart, smaller than portrait's) and the footer
  // on the last safe line, so the chart is at least as tall as the portrait one
  story: { logoY: 290, mark: 60, word: 48, tag: 34, kicker: 418, label: 38, heroTop: 452, hero: 300, slabGap: 48, slabH: 112, slabFs: 64, note: 34, chartGap: 60, capGap: 60, statsGap: 60, value: 70, footer: 1570, stroke: 6 },
}
const portrait = (ctx, m) => column(ctx, m, COLUMN.portrait)
const story = (ctx, m) => column(ctx, m, COLUMN.story)

// Link preview: everything inside the central 1200x600 band and the 48 px margin; no small print.
function og(ctx, m) {
  const L = 72, R = 1128
  let o = lockup(ctx, L, 64, 46, 38)
  o += ctx.T(kicker(m), { x: L, y: 186, size: 40, track: 0.08 })
  const hs = fitHero(m.hero, R - L, 220)
  o += hero(ctx, m, L, 222 + CAP * hs, hs)
  const fs = fitSlab(m, 'line', 92, 54, 640, 40), slabY = 426, slabH = 92
  o += slab(ctx, m, { x: L, y: slabY, h: slabH, fs }).html
  // the domain shares the slab's baseline and hangs under a hairline level with the slab's top, so the bottom
  // row reads as one line and the lower right is anchored even when the blade has left that corner
  const domainW = textEm('bluelytics.com.ar', 'mono') * 34
  o += `<i class="hr" style="left:${r1(R - domainW)}px;top:${slabY}px;width:${r1(domainW)}px"></i>`
  return o + ctx.T('bluelytics.com.ar', { x: R, y: slabY + slabH / 2 + (CAP * fs) / 2, size: 34, font: 'mono', color: C.soft, align: 'right' })
}

// ───────────────────────── document ─────────────────────────
/** Display strings for one card, derived from computeCardFacts. */
function viewModel(kind, data) {
  const f = computeCardFacts(data)
  return {
    ...f, kind,
    hero: formatNumber(f.sell),
    slabAbs: f.hasRef ? formatSignedPesos(f.deltaAbs) : '',
    slabPct: f.hasRef ? formatPercent(f.deltaPct) : '',
    oficial: f.oficialSell ? formatPesos(f.oficialSell) : DASH,
    gap: f.gapPct === null ? DASH : formatGap(f.gapPct),
    stamp: f.updatedAt ? formatTimestamp(f.updatedAt) : '',
    range: formatDateRange(f.series.map(p => p.day), { year: 'end' }),
  }
}
const LAYOUTS = { landscape, portrait, story, og }
const KINDS = { update: ['landscape', 'portrait', 'story'], weekly: ['landscape', 'portrait', 'story'], og: ['og'] }
const css = (W, H) => `*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden;background:${C.ink}}
body{position:relative;font-family:'${TOKENS.font.sans}',sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.bg,.plot,.mark,.t,.slab,.tag,.vr,.hr{position:absolute}.bg,.plot{left:0;top:0}
.t{line-height:1;white-space:nowrap}
.slab{display:flex;align-items:center;font-weight:900;line-height:1;white-space:nowrap;color:${C.slabInk}}.slab svg{flex:none}
.tag{background:${C.text};color:${C.ink};font-weight:700;line-height:1;white-space:nowrap}
.vr{width:2px;background:${C.soft};opacity:.22}.hr{height:2px;background:${C.soft};opacity:.22}`
const fontFaces = used => FACES.filter(([f, w]) => used.has(f + w))
  .map(([f, w, b64]) => `@font-face{font-family:'${TOKENS.font[f]}';font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2')}`).join('')

/** One self-contained HTML document for kind ('update' | 'weekly' | 'og') at size ('landscape' | 'portrait' |
 *  'story' | 'og'). */
export function renderCardHtml(kind, size, data) {
  if (!KINDS[kind]?.includes(size)) throw new Error(`renderCardHtml: no ${kind} card at size ${size}`)
  const ctx = makeCtx(size), m = viewModel(kind, data)
  const body = LAYOUTS[size](ctx, m)            // registers every obstacle first …
  const bg = background(ctx, m)                 // … so the blade can be routed around them
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(kicker(m))}</title><style>${fontFaces(ctx.used)}${css(ctx.W, ctx.H)}</style></head><body>${bg}${body}</body></html>`
}
// Brand mark, from assets/brand/logo-dark.svg (viewBox 0 0 2048 2048): blue swept strokes and the green rising stroke.
const LOGO_BLUE = [
  "M509 0h11l36 36v2h2l3 4 8 8 7 8 16 16v2h2l3 3 21 23v2h2l2 2 11 14 12 12 6 6 7 9 13 15 10 11 3 3 16 19 6 7 11 13 8 9 14 18 3 4 18 22 2 2 17 22 3 3 39 51 5 7 19 26 8 10 14 20 5 7 3 4 4 6 29 41 19 28 5 9 4 5 10 15 8 13 9 14 14 22 5 8 11 19 8 12 34 58 4 6 17 31 22 43-17 3-44 7-21 4-53 10-32 6-11 3-13 2-26 6-21 5-32 8-5 1-28 8h-8l-12-20-5-8-7-12-21-34-3-4-12-19-8-13-7-10-4-6-3-3-7-12-43-59-6-8-3-4-6-8-16-20-7-10-15-18-4-5-13-16-8-9-11-12-7-9-8-8-7-9-12-13-9-10-17-18-5-6-14-14-6-7-16-16-3-3-17-16-7-7-8-7v-2h-2v-2l-4-2-6-6-18-16v-2l-4-2-7-7-9-7v-2l-4-2-5-5-7-5v-2l-4-2-5-4-3-2-2-2v-2l-4-2-7-6-16-13-9-8q-1-35 13-68l2-6 11-24 1-3q14-25 33-46l8-10h2v-2h2l2-4 4-4h2v-2h2v-2l2-2 13-11a414 414 0 0 1 74-50l27-14 10-5 7-2z",
  "M1054 71h2l16 19 2 3a878 878 0 0 1 64 91l6 10q10 17 18 36l4 8 4 10 2 3 1 4 3 8 2 4 3 8 4 14 1 4 4 13 2 7 4 16 2 10 4 23 2 7 3 30 1 7v19l1 11v27l5 2 9 4q7-2 13-7l8-4 10-6 40-21 8-4 18-8 5-2 16-7 9-4 15-5 7-3 31-10 8-3 10-2 11-4 16-3 14-4 13-2 11-3 16-2 2-1 11-1 23-4 23-2 8-1 11-1 14-1h55l-1 2-3 1h-4l-4 1-13 4-9 2-26 8-15 4-9 2-18 6-11 4-11 3-3 2-15 4-7 3-7 2-17 7-11 4-19 8-11 4-14 6-12 4-18 9-8 3-21 11-14 7-21 11-14 7-11 6-4 2-33 20 4 14c7 23 5 49-5 70l-4 8-2 4-2 3h-2l-2 5a98 98 0 0 1-61 35h-18q-15 1-29-5l-4-1c-22-9-42-28-52-50l-2-4c-9-23-9-50 0-72l3-5 2-5q9-15 23-28h2v-2q16-12 35-17l6-2v-57l-1-8-1-13-1-7v-6c-2-18-2-18-4-23v-4l-3-14-3-18-2-5-1-7-6-21-3-14-4-11-2-8-10-30-5-14-7-16-4-12-8-18-4-10-8-17-4-9-10-18c-10-20-10-20-12-28",
  "m276 286 10 7 12 11 11 10 14 12 11 9 28 24 20 18 16 13v2l4 2 5 4 2 3 3 2 16 13v2l4 2 5 4 2 3 3 2 32 27v2l4 2 5 4 2 3 3 2 16 13v2l4 2c9 7 13 12 15 23l1 3 6 18 4 12 2 8 2 5 1 4c3 12 3 12 6 17l4 14 1 3 8 22 6 17 3 10 1 4 5 13 1 3 6 15 4 11 3 7 1 5 2 4 3 8 6 15q2 9 6 16l3 10 7 15 5 14 4 8 6 17 6 14-24 13-11 5-3 2-17 9-22 11-18 9-14 7-8 4-23 12-14 7q-7 5-18 8l-22 12-20 10-8 4c-6 3-6 3-10 2l-1-4-5-12-5-16c-3-11-3-11-6-15l-4-14-1-3-6-16-4-11-3-10-1-3-5-15-1-3q-4-7-5-15l-1-3-6-18-2-8q-4-8-6-17l-2-7-4-13-6-18-2-9-4-13-6-19-5-17-1-6-2-8-4-14-3-13-1-4-2-4-1-7-3-13-4-17-2-9-4-19-3-11-2-14-1-2-1-9-1-2-1-10-1-2-2-12-2-15v-6l-2-11-1-11-1-8q-5-52 0-104v-4c4-27 4-27 8-36",
  "m1212 1040 1 3 1 4 2 4q0 4 3 8l5 14 4 11 3 10 3 7 2 7 2 4 1 4 1 4 6 17 4 13 4 14 4 12q5 12 6 23l2 7 4 13 3 13 1 4 2 4v3l2 8 4 16 2 9 4 18 2 4 1 8 3 15 4 21 2 6 1 9 1 2 1 9 1 2 2 15 2 10 1 9 1 6 1 11 1 3v6l2 11 1 11 1 7 1 15 1 8v11l2 16v106l-1 10-1 11-1 15-1 11-1 7-1 10-1 5-1 8c-1 14-1 14-3 18v4l-3 14-3 15-4 14v3l-2 8q-3 4-3 10l-9 27-1 4-13 33-1 4-7 14-6 14-13 23-2 3q-18 31-41 59l-9 11h-2l-2 4-7 7-2 3-7 6-5 5c-11 11-11 11-13 11v2l-4 3-11 9-18 13-8 7c-7 5-7 5-11 5v-12l-1-4v-6l-1-9-1-17-1-11-1-16-1-9-1-15-1-9-1-14-1-8-1-13-1-8-1-12-1-7-1-12-1-7v-7l-2-11-1-11-1-6-1-10-1-6-1-10-1-6-1-10-1-5-1-9-1-6-1-9-1-6v-6l-2-7v-5l-2-13-4-21c-2-22-2-22-4-25l-1-10-1-2-1-10-1-2-1-9-1-2-1-9-1-2-1-9-4-21-3-12-3-18-3-11-3-18-4-19-3-11-1-7-5-20-2-8-4-17-1-7-1-1-1-7-1-1v-3l-2-8-4-15-2-6-1-5-6-21-3-14-2-7-6-19-2-9-6-18-4-13-4-14-4-12-2-6-2-8-4-12-12-34-3-10-2-6-1-3-2-6-6-15-2-7-5-14-8-19-3-10-6-13-3-11 39-10 4-1 24-5 9-2q7-3 13-3l20-4 50-10 27-5 52-8h4q21-4 44-6l4-1h4l4-1z",
  "m756 1158 2 1v13l-1 11v8l-5 37-2 13-6 23-3 11-4 14-4 12-4 11-2 6-14 32-4 6q-20 40-47 76h-2l-2 4-7 9-4 5-3 4h-2l-2 4-7 7-5 6-26 25-4 4h-2v2l-7 5-7 6-3 3-4 3-32 23-5 3-23 14-7 5q-31 18-66 30l-6 2q-17 7-34 11l-4 1q-14 6-29 7l-1 1-9 1-2 1-10 1-2 1h-6l-10 2h-9l-13 2h-40l-10-1-15-1-6-1-6-1-8-1h-4c-15-2-15-2-17-4l-6-1-29-8-4-1-16-7-9-3-20-10-12-6-13-7v-2l-4-1q-13-7-25-18l-10-7q2-5 7-8l12-10 15-13 18-15 5-2v-2l12-8v-2l12-8v-2l12-8v-2l3-2 11-10 15-11q7 2 12 6a124 124 0 0 0 42 16l5 2 10 1 6 1 17-1h7l18-4 6-1 19-7 6-2q28-12 52-31l4-3 22-18 7-4v-2l4-3 24-22 7-8 23-25 7-7 6-7 6-8 12-14 4-5 2-3 4-4 15-20 9-12 7-9 2-3 5-7q7-8 18-10l3-1 14-5 4-1 13-5 3-1 14-5 4-1 13-5 3-1 14-5 4-1 13-5 3-1 14-5 4-1 13-5 3-1 14-5 4-1 13-5 3-1 9-4z"
]
const LOGO_GREEN = [
  "M1622 721h4l23 1 11 1h11l21 2h11a459 459 0 0 1 62 4l23 2 34 3 35 3 24 3 32 4 19 2 27 4 17 2 26 4 10 1c4 1 4 1 8 5l4 20 2 12 1 3 1 11 1 4q5 30 3 60v13q1 21-2 43v3q-4 25-12 49l-1 4-8 20-3 8-9 16-4 7q-14 24-35 43l-3 3c-7 7-7 7-9 7v2q-4 3-10 2l-8-3-27-6-16-4-8-2-13-3-19-4-10-2-19-4-11-2-23-4-6-1-9-2-20-3-25-4-16-2-20-2-3-1-7-1-4-1h-4l-9-1h-4l-7-1-8-1-5-1h-5l-10-1h-4l-9-1-9-1-13-1-14-1-15-1-17-1h-11l-10-1-24-1h-124l-22 1-11 1h-11l-19 2h-17l-11 2h-14l-11 2h-12l-9 2h-6l-21 2-19 3q-41 3-83 11l-18 3-91 18-13 3c-50 10-50 10-72 16l-10 3-20 5-10 3-28 8-10 3-26 7-16 5-6 2-16 5-6 2-10 3-12 4-12 4-4 2-9 3-5 1-4 1-11 5-10 3-3 1-15 5-11 5-7 2-4 2-5 2-8 3-15 5-15 6-13 5-12 5-10 4-17 8-9 3-16 7-3 1-24 11-14 5-8 5-7 2-15 7-13 6-18 9-11 5-10 5-13 6-22 11-14 7-29 15-24 12-19 10-14 8-12 6-21 12-32 18-7 4-3 2-7 4-16 9-12 6-18 12-12 7-21 13-9 5-16 10-8 5-4 2-12 8-4 2-8 5-4 3-4 2-7 5-10 5q-5-47 4-93l3-14 4-19 2-11 4-11 3-9 6-18 5-14 4-8 2-6 10-20 6-12q21-40 49-75l4-5 3-4 4-5 27-31 4-5h2l2-4 6-6 3-4 4-3 3-4 18-16 5-5c21-18 21-18 23-18v-2l3-2 19-16 19-14 10-7 18-13 9-6 25-17 14-8 37-23 9-5 17-9 9-5 30-15 24-12 12-6 13-5 7-4 21-9 10-4 15-6 11-5 14-5 9-4 18-7 8-3 22-7 4-2 13-4 4-2 16-5 8-3 12-4 17-5 8-3 20-6 28-8 21-6 90-22 10-2 55-12 4-1 40-7 11-2 46-8 21-3 33-4 18-3 27-3 21-3 32-3 25-3 41-3 5-1h5l12-1 10-1 15-1 16-1 18-1 20-1h11l10-1 22-1h5q107-3 215 0",
  "m1613 1052 39 8 16 4 12 2 17 4 18 4 4 1 20 5h3l7 2 15 4 23 5 17 4 7 1 19 5 7 1 22 5 3 1 16 4 12 2 17 4 20 5c0 9-14 20-21 26-13 13-13 13-16 13v2l-6 5-4 3-4 3-3 2-29 21-9 6-5 4-3 1-16 10-7 4-3 2-10 6-16 8-13 7-23 11-9 5-8 3-11 5-15 7-8 4-10 3-11 6-16 6-8 4-17 6-9 4-15 5-3 1-10 4-11 4-26 9-8 3-18 6-15 6-11 3-3 1q-7 4-15 5l-3 1-12 4-5 2-4 1-7 2-3 1-7 2-12 4-16 6-22 6-12 4-6 2-10 2-10 4-14 4q-6 3-13 2-3-7-3-14l-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-1-2-1-10-4-18-3-24-3-12-3-24-3-16-4-25q9-4 17-5l25-7 22-5 8-2 15-4 22-7 10-2 21-6 24-7 12-4 9-2 7-2 13-4 20-7 17-5 11-4 7-2 26-8 4-1 17-7 11-4z",
  "m940 1251 1 4 3 10 4 13 2 7 4 13 2 7 4 13 2 7 4 13 6 17 7 25 6 18 3 13 2 7 4 13 6 17c5 15 5 15 1 24l-2 8-6 17-4 13-3 10-3 14-2 7-5 16-4 17-3 17-3 10-3 21-3 13-2 20-1 3-2 51v33l1 6 1 10 1 5v4q2 12 6 23l1 5 7 16 1 4q8 17 21 31v2h2l2 2 4 4v2h2v2l4 2 5 4q21 15 43 23l-1 17v10l-1 3v11l-1 9v10l-1 4v16l-1 9v4l-1 7v7l-1 8v13l-3 31q-15 0-28-7l-7-2-23-10-8-3-13-7-11-7-12-6v-2l-3-1-11-6-4-4-4-3-4-3-17-14-7-6-8-7v-2h-2v-2h-2v-2h-2v-2h-2l-3-3-9-11-16-19-2-3-15-20-2-3-10-17-4-8-5-8-2-4-13-27-5-11-6-16-3-8-4-14-1-4-4-14-2-4-1-7-1-1-1-7-4-16-4-24-1-8q-3-19-3-38v-58l5-46v-4l5-21 1-8 6-21 5-19 4-11 1-5 6-14 3-9 8-17 7-14 9-18 4-7q25-43 59-79l4-4 22-22 4-4h2v-2l4-3 10-8 4-4 5-3q3-4 5-3"
]
