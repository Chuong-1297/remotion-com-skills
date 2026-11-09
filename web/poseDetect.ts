import type { OverlayMotion } from '../src/flow/types';

// Finds the rest pose (33 MediaPipe landmarks, in image pixels) of the character in a cut-out image.

let landmarkerPromise: Promise<import('@mediapipe/tasks-vision').PoseLandmarker> | null = null;
const getLandmarker = () => {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe');
      const opts = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: '/api/models/pose/full', delegate }, runningMode: 'IMAGE' as const, numPoses: 1 });
      try {
        return await PoseLandmarker.createFromOptions(vision, opts('GPU'));
      } catch {
        return await PoseLandmarker.createFromOptions(vision, opts('CPU'));
      }
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
};

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = src;
  });

/** Generic standing pose fitted to the opaque area of the picture (used when detection fails). */
const estimate = (img: HTMLImageElement): number[] => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0;
  for (let y = 0; y < c.height; y += 2)
    for (let x = 0; x < c.width; x += 2)
      if (d[(y * c.width + x) * 4 + 3] > 20) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  if (x1 <= x0) { x0 = 0; x1 = c.width; y0 = 0; y1 = c.height; }
  const H = y1 - y0;
  const cx = (x0 + x1) / 2;
  const pts: number[] = new Array(66).fill(0);
  const set = (i: number, x: number, y: number) => { pts[i * 2] = x; pts[i * 2 + 1] = y; };
  for (let i = 0; i < 33; i++) set(i, cx, y0 + H * 0.1);
  set(0, cx, y0 + H * 0.09); set(7, cx + H * 0.04, y0 + H * 0.08); set(8, cx - H * 0.04, y0 + H * 0.08);
  set(11, cx + H * 0.11, y0 + H * 0.2); set(12, cx - H * 0.11, y0 + H * 0.2);
  set(13, cx + H * 0.14, y0 + H * 0.36); set(14, cx - H * 0.14, y0 + H * 0.36);
  set(15, cx + H * 0.15, y0 + H * 0.5); set(16, cx - H * 0.15, y0 + H * 0.5);
  set(23, cx + H * 0.07, y0 + H * 0.52); set(24, cx - H * 0.07, y0 + H * 0.52);
  set(25, cx + H * 0.08, y0 + H * 0.73); set(26, cx - H * 0.08, y0 + H * 0.73);
  set(27, cx + H * 0.08, y0 + H * 0.94); set(28, cx - H * 0.08, y0 + H * 0.94);
  return pts.map((v) => Math.round(v * 10) / 10);
};

export const detectRig = async (src: string): Promise<OverlayMotion['rig']> => {
  const img = await loadImg(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  try {
    const lm = await getLandmarker();
    // Detect on a neutral grey backdrop: transparent pixels confuse the detector.
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const res = lm.detect(c);
    const l = res.landmarks && res.landmarks[0];
    if (l && l.length === 33) {
      const vis = (i: number) => (l[i].visibility === undefined ? 1 : l[i].visibility!);
      const core = [11, 12, 23, 24].every((i) => vis(i) > 0.3);
      if (core) return { w, h, pts: l.flatMap((p) => [Math.round(p.x * w * 10) / 10, Math.round(p.y * h * 10) / 10]), estimated: false };
    }
  } catch {
    /* fall back to the estimate */
  }
  return { w, h, pts: estimate(img), estimated: true };
};
