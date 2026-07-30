// Détourage d'image, en canvas 2D pur — aucune dépendance à three.js.
//
// Ce code vivait dans `scene/keyImage.ts`, qui construisait aussi une
// `THREE.CanvasTexture`. Le sprite 2D, lui, n'a besoin que du dataURL : il
// tirait donc three.js entier dans le paquet de démarrage pour rien. La partie
// texture est restée dans `scene/keyImage.ts`, et s'appuie sur celle-ci.

export interface KeyedCanvas {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  aspect: number;
}

const cache = new Map<string, Promise<KeyedCanvas>>();

/** Charge une image et détoure le fond (studio gris/blanc) via flood-fill depuis les bords. */
export function loadKeyedCanvas(url: string, tolerance = 50): Promise<KeyedCanvas> {
  let p = cache.get(url);
  if (!p) {
    p = process(url, tolerance);
    cache.set(url, p);
  }
  return p;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function process(url: string, tol: number): Promise<KeyedCanvas> {
  const img = await loadImage(url);
  const maxDim = 768;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  floodKey(data, w, h, tol);
  ctx.putImageData(data, 0, 0);

  return { canvas: cv, dataUrl: cv.toDataURL('image/png'), aspect: w / h };
}

/** Détourage : ne supprime que le fond connecté aux bords (préserve l'intérieur). */
function floodKey(img: ImageData, w: number, h: number, tol: number): void {
  const d = img.data;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (h * w - 1) * 4];
  let br = 0;
  let bg = 0;
  let bb = 0;
  for (const c of corners) {
    br += d[c];
    bg += d[c + 1];
    bb += d[c + 2];
  }
  br /= 4;
  bg /= 4;
  bb /= 4;

  const tol2 = tol * tol;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    const dr = d[i] - br;
    const dg = d[i + 1] - bg;
    const db = d[i + 2] - bb;
    if (dr * dr + dg * dg + db * db > tol2) continue; // bord du robot : on s'arrête
    d[i + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // Érosion d'un pixel : enlève le liseré gris semi-aliasé en bordure.
  const big = tol * 1.7;
  const big2 = big * big;
  const toClear: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (d[p * 4 + 3] === 0) continue;
    const x = p % w;
    const y = (p - x) / w;
    const neighborTransparent =
      (x > 0 && d[(p - 1) * 4 + 3] === 0) ||
      (x < w - 1 && d[(p + 1) * 4 + 3] === 0) ||
      (y > 0 && d[(p - w) * 4 + 3] === 0) ||
      (y < h - 1 && d[(p + w) * 4 + 3] === 0);
    if (!neighborTransparent) continue;
    const i = p * 4;
    const dr = d[i] - br;
    const dg = d[i + 1] - bg;
    const db = d[i + 2] - bb;
    if (dr * dr + dg * dg + db * db < big2) toClear.push(p);
  }
  for (const p of toClear) d[p * 4 + 3] = 0;
}
