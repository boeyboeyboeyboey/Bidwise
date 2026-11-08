import type { Theme } from './chart';

export const CREDIT = 'Bidwise · data from SMU BOSS Overall Results, collected Nov 2026';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Standalone SVG: concrete colours, background, credit line in the corner. */
export function standaloneSvg(svg: SVGSVGElement, theme: Theme): { xml: string; w: number; h: number } {
  const c = svg.cloneNode(true) as SVGSVGElement;
  const w = Number(c.getAttribute('width')) || svg.getBoundingClientRect().width;
  const h0 = Number(c.getAttribute('height')) || svg.getBoundingClientRect().height;
  const h = h0 + 22;
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  c.setAttribute('width', String(w));
  c.setAttribute('height', String(h));
  c.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const ns = 'http://www.w3.org/2000/svg';
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', theme.surface);
  c.insertBefore(bg, c.firstChild);
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', String(w - 8));
  t.setAttribute('y', String(h - 7));
  t.setAttribute('text-anchor', 'end');
  t.setAttribute('font-size', '11');
  t.setAttribute('font-family', theme.font);
  t.setAttribute('fill', theme.muted);
  t.textContent = CREDIT;
  c.appendChild(t);
  return { xml: new XMLSerializer().serializeToString(c), w, h };
}

export function saveSvg(svg: SVGSVGElement, theme: Theme, name: string) {
  const { xml } = standaloneSvg(svg, theme);
  download(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), name);
}

export async function savePng(svg: SVGSVGElement, theme: Theme, name: string) {
  const { xml, w, h } = standaloneSvg(svg, theme);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * 2);
    canvas.height = Math.round(h * 2);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) download(blob, name);
  } finally {
    URL.revokeObjectURL(url);
  }
}
