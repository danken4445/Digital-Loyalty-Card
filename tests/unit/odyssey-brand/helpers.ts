import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Pt {
  x: number;
  y: number;
}

/** On-curve points of an absolute SVG path (M L H V Q C A Z, with implicit repeats). Enough for bboxes of these masters. */
export function onCurvePoints(d: string): Pt[][] {
  const tokens = d.match(/[MLHVQCAZmlhvqcaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const subpaths: Pt[][] = [];
  let cur: Pt = { x: 0, y: 0 };
  let cmd = '';
  let i = 0;
  const at = (k: number): string => tokens[k] ?? '';
  const num = () => parseFloat(at(i++));
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(at(i))) cmd = at(i++);
    if (cmd !== cmd.toUpperCase()) throw new Error(`relative command ${cmd} not supported`);
    switch (cmd) {
      case 'M':
        cur = { x: num(), y: num() };
        subpaths.push([cur]);
        cmd = 'L';
        break;
      case 'L':
        cur = { x: num(), y: num() };
        break;
      case 'H':
        cur = { x: num(), y: cur.y };
        break;
      case 'V':
        cur = { x: cur.x, y: num() };
        break;
      case 'Q':
        i += 2;
        cur = { x: num(), y: num() };
        break;
      case 'C':
        i += 4;
        cur = { x: num(), y: num() };
        break;
      case 'A':
        i += 5;
        cur = { x: num(), y: num() };
        break;
      case 'Z':
        continue;
      default:
        throw new Error(`unexpected ${cmd}`);
    }
    subpaths[subpaths.length - 1]?.push(cur);
  }
  return subpaths;
}

/** Index into an array that must have that element (tests fail loudly otherwise). */
export function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`missing index ${i}`);
  return v;
}

export function bbox(points: Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x1 = Math.min(...xs);
  const y1 = Math.min(...ys);
  const x2 = Math.max(...xs);
  const y2 = Math.max(...ys);
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

export const allPoints = (...ds: string[]) => ds.flatMap((d) => onCurvePoints(d).flat());

export interface MasterPath {
  d: string;
  fill: string;
  fillRule: 'evenodd' | 'nonzero';
  tx: number;
  ty: number;
}

/** Flattens a supplied master SVG into paths with inherited fill, fill-rule and summed translate. */
export function readMaster(file: string): { width: number; height: number; paths: MasterPath[] } {
  const svg = readFileSync(
    join(__dirname, '..', '..', '..', 'tools', 'odyssey-brand', 'reference', 'masters', file),
    'utf8',
  );
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  const stack: { fill?: string; rule?: string; tx: number; ty: number }[] = [{ tx: 0, ty: 0 }];
  const paths: MasterPath[] = [];
  for (const m of svg.matchAll(/<\/g>|<g\b[^>]*>|<path\b[^>]*\/>/g)) {
    const tag = m[0];
    const top = stack[stack.length - 1] ?? { tx: 0, ty: 0 };
    if (tag === '</g>') {
      stack.pop();
      continue;
    }
    const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(attr(tag, 'transform') ?? '');
    const node = {
      fill: attr(tag, 'fill') ?? top.fill,
      rule: attr(tag, 'fill-rule') ?? top.rule,
      tx: top.tx + (t ? parseFloat(t[1] ?? '0') : 0),
      ty: top.ty + (t ? parseFloat(t[2] ?? '0') : 0),
    };
    if (tag.startsWith('<g')) stack.push(node);
    else
      paths.push({
        d: attr(tag, 'd')!,
        fill: node.fill!,
        fillRule: node.rule === 'evenodd' ? 'evenodd' : 'nonzero',
        tx: node.tx,
        ty: node.ty,
      });
  }
  return { width: parseFloat(vb[1] ?? ''), height: parseFloat(vb[2] ?? ''), paths };
}
