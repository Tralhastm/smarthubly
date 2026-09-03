// Remove o fundo sólido (preto/branco/cor chapada) de logos.
// Faz flood-fill a partir das bordas, então só apaga o fundo que "encosta"
// na moldura — detalhes internos da arte são preservados.

const distance = (a: number[], b: number[]) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

const loadImage = (src: string | Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem'));
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });

export const hasSolidBorder = (data: Uint8ClampedArray, w: number, h: number, tolerance = 40) => {
  const px = (i: number) => [data[i], data[i + 1], data[i + 2]];
  const corner = px(0);
  const samples = [px((w - 1) * 4), px((h - 1) * w * 4), px(((h - 1) * w + w - 1) * 4)];
  return samples.every((s) => distance(corner, s) <= tolerance);
};

/**
 * Retorna um PNG com o fundo transparente, ou null se a imagem não tiver
 * um fundo sólido nas bordas (nesse caso não mexemos na arte original).
 */
export const removeSolidBackground = async (
  src: string | Blob,
  tolerance = 60,
): Promise<Blob | null> => {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // canvas "sujo" (CORS)
  }
  const data = imageData.data;
  if (!hasSolidBorder(data, w, h)) return null;

  const bg = [data[0], data[1], data[2]];
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  let removed = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    const d = distance([data[i], data[i + 1], data[i + 2]], bg);
    if (d > tolerance) continue;
    // borda suave: pixels quase no limite ficam semitransparentes
    data[i + 3] = d > tolerance * 0.7 ? Math.round(((d - tolerance * 0.7) / (tolerance * 0.3)) * 255) : 0;
    removed++;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  if (removed < w * h * 0.02) return null; // quase nada removido

  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
};
