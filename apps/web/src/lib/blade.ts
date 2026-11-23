/**
 * The brand blade of the social cards (packages/social/design/final/card.mjs), for the site's hero: a tapered
 * ribbon along a cubic Bézier plus a thin "sliver" in the direction colour. Server-rendered SVG paths in a fixed
 * viewBox; the hero scales and crops it with CSS.
 */
export type BladeDirection = 'up' | 'down' | 'flat';

export interface BladeShape {
  viewBox: string;
  band: string;
  sliver: string;
}

const W = 1200;
const H = 640;
const EXTEND = 600;

type Point = readonly [number, number];

function bez(P: readonly [Point, Point, Point, Point], t: number): [number, number, number, number] {
  const u = 1 - t;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = P;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
  const dx = d0 * (x1 - x0) + d1 * (x2 - x1) + d2 * (x3 - x2);
  const dy = d0 * (y1 - y0) + d1 * (y2 - y1) + d2 * (y3 - y2);
  const len = Math.hypot(dx, dy) || 1;
  return [b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3, b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3, dy / len, -dx / len];
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const pathOf = (pts: readonly Point[]): string => `M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;

/** Centre line: up is a growth curve, down an inverted one, flat a long shallow sweep (as on the cards). */
function curve(direction: BladeDirection): [Point, Point, Point, Point] {
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  if (direction === 'down') {
    const P0: Point = [0.42 * W, -80];
    const P3: Point = [W + 80, 0.78 * H];
    return [P0, [lerp(P0[0], P3[0], 0.12), lerp(P0[1], P3[1], 0.7)], [lerp(P0[0], P3[0], 0.55), P3[1]], P3];
  }
  const P0: Point = [-80, (direction === 'up' ? 0.92 : 0.7) * H];
  const P3: Point = direction === 'up' ? [0.98 * W, -80] : [W + 80, 0.12 * H];
  return [P0, [lerp(P0[0], P3[0], 0.4), P0[1]], [lerp(P0[0], P3[0], 0.75), lerp(P0[1], P3[1], 0.3)], P3];
}

export function bladeShape(direction: BladeDirection, width = 260, n = 64): BladeShape {
  const P = curve(direction);
  const sliverWidth = width * 0.06;
  const top: Point[] = [], bottom: Point[] = [], sTop: Point[] = [], sBottom: Point[] = [];
  let last: [number, number, number, number] = [0, 0, 0, 1];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y, nx, ny] = (last = bez(P, t));
    const half = (width / 2) * Math.pow(t, 0.9);
    const gap = width * 0.06 * Math.pow(t, 0.6);
    const sliver = sliverWidth * Math.pow(t, 1.1);
    top.push([x + nx * half, y + ny * half]);
    bottom.push([x - nx * half, y - ny * half]);
    sTop.push([x + nx * (half + gap + sliver), y + ny * (half + gap + sliver)]);
    sBottom.push([x + nx * (half + gap), y + ny * (half + gap)]);
  }
  const tx = -last[3] * EXTEND, ty = last[2] * EXTEND;
  for (const side of [top, bottom, sTop, sBottom]) {
    const end = side[side.length - 1] as Point;
    side.push([end[0] + tx, end[1] + ty]);
  }
  return {
    viewBox: `0 0 ${W} ${H}`,
    band: pathOf([...top, ...[...bottom].reverse()]),
    sliver: pathOf([...sTop, ...[...sBottom].reverse()]),
  };
}
