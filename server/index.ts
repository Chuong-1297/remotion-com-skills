// Flow Studio server: projects/assets storage, AI generation (Google Veo + Gemini image) and Remotion rendering.
// Run with: npm run flow  (dev: npm run flow:dev)
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Asset, AspectRatio, GenMode, Project, SceneClip } from '../src/flow/types';
import { FPS, dimensionsFor } from '../src/flow/types';

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'flow-data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DB_FILE = path.join(DATA_DIR, 'projects.json');
const PORT = Number(process.env.PORT || 3123);
const ORIGIN = `http://localhost:${PORT}`;

// Optional: use an existing Chrome/Chromium instead of letting Remotion download one.
const BROWSER = process.env.REMOTION_BROWSER_EXECUTABLE || null;
// WebGL backend for the 3D motion clips. 'angle' uses the GPU; 'swangle' renders in software (servers without a GPU).
const GL = (process.env.REMOTION_GL || 'angle') as 'angle' | 'swangle' | 'egl' | 'swiftshader' | 'vulkan' | 'angle-egl';
const browserOpts = { browserExecutable: BROWSER, chromiumOptions: { gl: GL } };
const MODELS_DIR = path.join(DATA_DIR, 'models');

fs.mkdirSync(MEDIA_DIR, { recursive: true });

process.on('unhandledRejection', (e) => console.error('[unhandled]', e));

// ---------- storage ----------
type StoredAsset = Asset & { veoVideo?: { uri?: string; mimeType?: string } };
type StoredProject = Omit<Project, 'assets'> & { assets: StoredAsset[] };

let db: Record<string, StoredProject> = {};
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  db = {};
}
// Jobs that were running when the server stopped will never finish.
for (const p of Object.values(db)) {
  for (const a of p.assets) {
    if (a.status === 'pending') {
      a.status = 'error';
      a.error = 'Máy chủ đã khởi động lại trong lúc tạo.';
    }
  }
}

let saveTimer: NodeJS.Timeout | null = null;
const save = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 2));
    fs.renameSync(DB_FILE + '.tmp', DB_FILE);
  }, 200);
};

const uid = () => crypto.randomBytes(6).toString('hex');
const publicAsset = (a: StoredAsset): Asset => {
  const { veoVideo, ...rest } = a;
  return { ...rest, canExtend: Boolean(veoVideo && veoVideo.uri) };
};
const publicProject = (p: StoredProject): Project => ({ ...p, assets: p.assets.map(publicAsset) });

const mediaPath = (src: string) => {
  const name = path.basename(src);
  const full = path.join(MEDIA_DIR, name);
  if (!src.startsWith('/media/') || !fs.existsSync(full)) throw new Error(`Không tìm thấy file: ${src}`);
  return full;
};
const mimeOf = (file: string) => {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
};
const extOf = (mime: string) =>
  mime.indexOf('json') >= 0 ? '.json' : mime.indexOf('png') >= 0 ? '.png' : mime.indexOf('webp') >= 0 ? '.webp' : mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0 ? '.jpg' : mime.indexOf('mp4') >= 0 ? '.mp4' : mime.indexOf('webm') >= 0 ? '.webm' : '.bin';
const imageInput = (src: string) => {
  const full = mediaPath(src);
  return { imageBytes: fs.readFileSync(full).toString('base64'), mimeType: mimeOf(full) };
};

// ---------- Remotion bundle (lazy, cached) ----------
let bundlePromise: Promise<string> | null = null;
const getBundle = () => {
  if (!bundlePromise) {
    console.log('[remotion] bundling src/flow/index.ts ...');
    bundlePromise = bundle({ entryPoint: path.join(ROOT, 'src/flow/index.ts') }).then((url) => {
      console.log('[remotion] bundle ready');
      return url;
    });
    bundlePromise.catch(() => (bundlePromise = null));
  }
  return bundlePromise;
};

// ---------- generation ----------
interface GenRequest {
  mode: GenMode;
  prompt: string;
  model: string;
  aspect: AspectRatio;
  duration: number;
  count: number;
  negativePrompt?: string;
  resolution?: string;
  startImage?: string | null;
  endImage?: string | null;
  refImages?: string[];
  sourceAssetId?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const errMessage = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(msg);
    if (parsed && parsed.error && parsed.error.message) return parsed.error.message as string;
  } catch {
    /* not JSON */
  }
  return msg.length > 400 ? msg.slice(0, 400) + '…' : msg;
};

async function veoGenerate(key: string, req: GenRequest, source: StoredAsset | undefined) {
  const ai = new GoogleGenAI({ apiKey: key });
  const config: Record<string, unknown> = {
    numberOfVideos: 1,
    aspectRatio: req.aspect,
  };
  if (req.mode !== 'extend') config.durationSeconds = req.duration;
  if (req.negativePrompt) config.negativePrompt = req.negativePrompt;
  if (req.resolution && req.mode !== 'extend') config.resolution = req.resolution;

  const params: Record<string, unknown> = { model: req.model, prompt: req.prompt || undefined, config };
  if (req.mode === 'frames') {
    if (!req.startImage) throw new Error('Cần ảnh khung đầu.');
    params.image = imageInput(req.startImage);
    if (req.endImage) config.lastFrame = imageInput(req.endImage);
  } else if (req.mode === 'ingredients') {
    const refs = (req.refImages || []).slice(0, 3);
    if (!refs.length) throw new Error('Cần ít nhất 1 ảnh thành phần.');
    config.referenceImages = refs.map((src) => ({ image: imageInput(src), referenceType: VideoGenerationReferenceType.ASSET }));
  } else if (req.mode === 'extend') {
    if (!source || !source.veoVideo || !source.veoVideo.uri) throw new Error('Clip này không thể kéo dài (chỉ clip do Veo tạo gần đây).');
    params.video = { uri: source.veoVideo.uri, mimeType: 'video/mp4' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let op = await ai.models.generateVideos(params as any);
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('Quá thời gian chờ (15 phút).');
    await sleep(8000);
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  if (op.error) throw new Error(String((op.error as { message?: string }).message || JSON.stringify(op.error)));
  const resp = op.response;
  const vid = resp && resp.generatedVideos && resp.generatedVideos[0] && resp.generatedVideos[0].video;
  if (!vid) {
    const reasons = resp && resp.raiMediaFilteredReasons ? resp.raiMediaFilteredReasons.join('; ') : '';
    throw new Error(reasons ? `Bị chặn bởi bộ lọc an toàn: ${reasons}` : 'Không nhận được video từ Veo.');
  }
  const file = `${uid()}.mp4`;
  if (vid.videoBytes) {
    fs.writeFileSync(path.join(MEDIA_DIR, file), Buffer.from(vid.videoBytes, 'base64'));
  } else if (vid.uri) {
    const r = await fetch(vid.uri, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new Error(`Tải video thất bại (${r.status})`);
    fs.writeFileSync(path.join(MEDIA_DIR, file), Buffer.from(await r.arrayBuffer()));
  } else {
    throw new Error('Video không có dữ liệu.');
  }
  return { src: `/media/${file}`, veoVideo: vid.uri ? { uri: vid.uri, mimeType: 'video/mp4' } : undefined };
}

async function geminiImage(key: string, req: GenRequest) {
  const ai = new GoogleGenAI({ apiKey: key });
  const parts: Array<Record<string, unknown>> = [];
  for (const src of (req.refImages || []).slice(0, 3)) {
    const img = imageInput(src);
    parts.push({ inlineData: { data: img.imageBytes, mimeType: img.mimeType } });
  }
  parts.push({ text: `${req.prompt}\n\nAspect ratio: ${req.aspect}.` });
  const res = await ai.models.generateContent({
    model: req.model,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: req.aspect } },
  });
  const cand = res.candidates && res.candidates[0];
  const outParts = (cand && cand.content && cand.content.parts) || [];
  for (const p of outParts) {
    if (p.inlineData && p.inlineData.data) {
      const mime = p.inlineData.mimeType || 'image/png';
      const file = `${uid()}${extOf(mime)}`;
      fs.writeFileSync(path.join(MEDIA_DIR, file), Buffer.from(p.inlineData.data, 'base64'));
      return { src: `/media/${file}` };
    }
  }
  const text = outParts.map((p) => p.text || '').join(' ').trim();
  throw new Error(text ? `Model không trả về ảnh: ${text}` : 'Model không trả về ảnh.');
}

async function mockGenerate(req: GenRequest, source: StoredAsset | undefined) {
  const serveUrl = await getBundle();
  const dims = dimensionsFor(req.aspect, 720);
  const firstImage =
    req.mode === 'frames' ? req.startImage : req.mode === 'ingredients' || req.mode === 'image' ? (req.refImages || [])[0] : null;
  const labels: Record<GenMode, string> = {
    text: 'DEMO · VĂN BẢN → VIDEO',
    frames: 'DEMO · KHUNG HÌNH → VIDEO',
    ingredients: 'DEMO · THÀNH PHẦN → VIDEO',
    extend: 'DEMO · KÉO DÀI',
    image: 'DEMO · TẠO ẢNH',
  };
  const inputProps = {
    prompt: req.prompt || (source ? source.prompt : ''),
    imageSrc: firstImage ? ORIGIN + firstImage : null,
    seed: Math.floor(Math.random() * 100000),
    label: labels[req.mode],
  };
  const comp = await selectComposition({ ...browserOpts, serveUrl, id: 'FlowMockClip', inputProps });
  const seconds = req.mode === 'extend' ? (source ? source.durationSec : 4) + 4 : req.duration;
  const composition = { ...comp, width: dims.width, height: dims.height, durationInFrames: Math.round(seconds * FPS) };
  if (req.mode === 'image') {
    const file = `${uid()}.png`;
    await renderStill({ ...browserOpts, composition, serveUrl, inputProps, output: path.join(MEDIA_DIR, file), frame: 60, imageFormat: 'png' });
    return { src: `/media/${file}` };
  }
  const file = `${uid()}.mp4`;
  await renderMedia({ ...browserOpts, composition, serveUrl, inputProps, codec: 'h264', outputLocation: path.join(MEDIA_DIR, file) });
  return { src: `/media/${file}` };
}

async function runJob(project: StoredProject, asset: StoredAsset, req: GenRequest, key: string | null) {
  const source = req.sourceAssetId ? project.assets.find((a) => a.id === req.sourceAssetId) : undefined;
  try {
    let result: { src: string; veoVideo?: { uri?: string; mimeType?: string } };
    if (!key) result = await mockGenerate(req, source);
    else if (req.mode === 'image') result = await geminiImage(key, req);
    else result = await veoGenerate(key, req, source);
    asset.src = result.src;
    asset.veoVideo = result.veoVideo;
    asset.status = 'done';
    if (req.mode === 'extend' && !key && source) asset.durationSec = source.durationSec + 4;
  } catch (e) {
    console.error('[generate]', e);
    asset.status = 'error';
    asset.error = errMessage(e);
  }
  project.updatedAt = Date.now();
  save();
}

// ---------- render jobs ----------
interface RenderJob {
  id: string;
  status: 'rendering' | 'done' | 'error';
  progress: number;
  url: string | null;
  error: string | null;
}
const renders: Record<string, RenderJob> = {};

async function runRender(job: RenderJob, project: StoredProject, height: number) {
  try {
    const serveUrl = await getBundle();
    const inputProps = { clips: project.clips, aspect: project.aspect, baseUrl: ORIGIN };
    const comp = await selectComposition({ ...browserOpts, serveUrl, id: 'FlowTimeline', inputProps });
    const dims = dimensionsFor(project.aspect, height);
    const file = `export-${project.id}-${uid()}.mp4`;
    await renderMedia({
      ...browserOpts,
      composition: { ...comp, width: dims.width, height: dims.height },
      serveUrl,
      inputProps,
      codec: 'h264',
      outputLocation: path.join(MEDIA_DIR, file),
      onProgress: ({ progress }) => {
        job.progress = progress;
      },
    });
    job.url = `/media/${file}`;
    job.status = 'done';
    job.progress = 1;
  } catch (e) {
    console.error('[render]', e);
    job.status = 'error';
    job.error = errMessage(e);
  }
}

// ---------- HTTP ----------
const app = express();
const jsonParser = express.json({ limit: '60mb' });
app.use((req, res, next) => (req.path === '/api/upload-raw' ? next() : jsonParser(req, res, next)));
// CORS so the Remotion renderer (served from its own port) can fetch motion data and media.
app.use('/media', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(MEDIA_DIR));

const apiKeyOf = (req: express.Request) => {
  const h = req.header('x-gemini-key');
  return (h && h.trim()) || process.env.GEMINI_API_KEY || null;
};
const getProject = (id: string) => {
  const p = db[id];
  if (!p) throw Object.assign(new Error('Không tìm thấy dự án'), { status: 404 });
  return p;
};
const wrap =
  (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = (e as { status?: number }).status || 400;
      res.status(status).json({ error: errMessage(e) });
    }
  };

app.get('/api/config', (_req, res) => {
  res.json({ serverKey: Boolean(process.env.GEMINI_API_KEY) });
});

app.get('/api/projects', (_req, res) => {
  const list = Object.values(db)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => {
      const cover = p.assets.find((a) => a.status === 'done' && a.src);
      return { id: p.id, name: p.name, aspect: p.aspect, updatedAt: p.updatedAt, assetCount: p.assets.length, cover: cover ? { src: cover.src, kind: cover.kind } : null };
    });
  res.json(list);
});

app.post(
  '/api/projects',
  wrap((req, res) => {
    const now = Date.now();
    const p: StoredProject = {
      id: uid(),
      name: String(req.body.name || 'Dự án không tên').slice(0, 120),
      aspect: req.body.aspect === '9:16' ? '9:16' : '16:9',
      createdAt: now,
      updatedAt: now,
      assets: [],
      clips: [],
    };
    db[p.id] = p;
    save();
    res.json(publicProject(p));
  }),
);

app.get(
  '/api/projects/:id',
  wrap((req, res) => res.json(publicProject(getProject(req.params.id)))),
);

app.put(
  '/api/projects/:id',
  wrap((req, res) => {
    const p = getProject(req.params.id);
    if (typeof req.body.name === 'string') p.name = req.body.name.slice(0, 120);
    if (req.body.aspect === '9:16' || req.body.aspect === '16:9') p.aspect = req.body.aspect;
    if (Array.isArray(req.body.clips)) p.clips = req.body.clips as SceneClip[];
    p.updatedAt = Date.now();
    save();
    res.json(publicProject(p));
  }),
);

app.delete(
  '/api/projects/:id',
  wrap((req, res) => {
    getProject(req.params.id);
    delete db[req.params.id];
    save();
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/projects/:id/assets/:assetId',
  wrap((req, res) => {
    const p = getProject(req.params.id);
    p.assets = p.assets.filter((a) => a.id !== req.params.assetId);
    save();
    res.json(publicProject(p));
  }),
);

// Upload an image/video (base64 data URL). Optionally registers it as a project asset.
app.post(
  '/api/upload',
  wrap((req, res) => {
    const m = /^data:([^;]+);base64,(.+)$/.exec(String(req.body.dataUrl || ''));
    if (!m) throw new Error('Dữ liệu tải lên không hợp lệ');
    const mime = m[1];
    if (!/^(image|video)\//.test(mime)) throw new Error('Chỉ hỗ trợ ảnh hoặc video');
    const file = `${uid()}${extOf(mime)}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), Buffer.from(m[2], 'base64'));
    const src = `/media/${file}`;
    const kind = mime.startsWith('video/') ? 'video' : 'image';
    if (req.body.projectId) {
      const p = getProject(String(req.body.projectId));
      const asset: StoredAsset = {
        id: uid(),
        kind,
        status: 'done',
        src,
        prompt: String(req.body.name || 'Tệp tải lên'),
        mode: 'upload',
        model: '',
        aspect: p.aspect,
        durationSec: Number(req.body.duration) || 0,
        error: null,
        createdAt: Date.now(),
        mock: false,
        canExtend: false,
      };
      p.assets.unshift(asset);
      p.updatedAt = Date.now();
      save();
      return res.json({ src, kind, asset: publicAsset(asset) });
    }
    res.json({ src, kind });
  }),
);

// Binary upload (large videos, matted layers, motion JSON). Body = raw bytes, type from Content-Type.
app.post(
  '/api/upload-raw',
  express.raw({ type: () => true, limit: '2gb' }),
  wrap((req, res) => {
    const mime = String(req.header('content-type') || 'application/octet-stream').split(';')[0];
    if (!/^(image|video)\//.test(mime) && mime !== 'application/json') throw new Error('Định dạng tệp không được hỗ trợ');
    const body = req.body as Buffer;
    if (!body || !body.length) throw new Error('Tệp rỗng');
    const file = `${uid()}${extOf(mime)}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), body);
    res.json({ src: `/media/${file}` });
  }),
);

// Register an already-uploaded file as a project asset (matting results, motion data).
app.post(
  '/api/projects/:id/assets',
  wrap((req, res) => {
    const p = getProject(req.params.id);
    const b = req.body || {};
    const kind = b.kind === 'motion' ? 'motion' : b.kind === 'image' ? 'image' : 'video';
    mediaPath(String(b.src || ''));
    const asset: StoredAsset = {
      id: uid(),
      kind,
      status: 'done',
      src: String(b.src),
      prompt: String(b.name || '').slice(0, 300),
      mode: b.mode === 'matte' || b.mode === 'motion' ? b.mode : 'upload',
      model: String(b.model || ''),
      aspect: p.aspect,
      durationSec: Number(b.duration) || 0,
      error: null,
      createdAt: Date.now(),
      mock: false,
      canExtend: false,
      thumb: typeof b.thumb === 'string' ? b.thumb : null,
      role: b.role === 'base' || b.role === 'foreground' || b.role === 'motion' ? b.role : null,
      pairId: typeof b.pairId === 'string' ? b.pairId : null,
      sourceAssetId: typeof b.sourceAssetId === 'string' ? b.sourceAssetId : null,
    };
    p.assets.unshift(asset);
    p.updatedAt = Date.now();
    save();
    res.json(publicProject(p));
  }),
);

// MediaPipe Pose runtime (wasm) and model, served locally so the browser never needs a CDN.
app.use('/vendor/mediapipe', express.static(path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')));
const POSE_MODELS: Record<string, string> = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
};
app.get(
  '/api/models/pose/:variant',
  wrap(async (req, res) => {
    const variant = POSE_MODELS[req.params.variant] ? req.params.variant : 'full';
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    const file = path.join(MODELS_DIR, `pose_landmarker_${variant}.task`);
    if (!fs.existsSync(file)) {
      console.log(`[pose] downloading ${variant} model ...`);
      const r = await fetch(POSE_MODELS[variant]);
      if (!r.ok) throw new Error(`Không tải được model MediaPipe Pose (${r.status}). Tải thủ công rồi đặt vào ${file}`);
      fs.writeFileSync(file + '.tmp', Buffer.from(await r.arrayBuffer()));
      fs.renameSync(file + '.tmp', file);
    }
    res.sendFile(file);
  }),
);

app.post(
  '/api/projects/:id/generate',
  wrap((req, res) => {
    const p = getProject(req.params.id);
    const body = req.body as GenRequest;
    const modes: GenMode[] = ['text', 'frames', 'ingredients', 'extend', 'image'];
    if (modes.indexOf(body.mode) < 0) throw new Error('Chế độ không hợp lệ');
    if (!body.prompt && body.mode !== 'frames' && body.mode !== 'extend') throw new Error('Hãy nhập prompt.');
    const key = apiKeyOf(req);
    const count = Math.max(1, Math.min(4, Number(body.count) || 1));
    const duration = Math.max(4, Math.min(8, Number(body.duration) || 8));
    const source = body.sourceAssetId ? p.assets.find((a) => a.id === body.sourceAssetId) : undefined;
    const genReq: GenRequest = { ...body, count, duration, aspect: body.aspect === '9:16' ? '9:16' : '16:9' };
    const created: StoredAsset[] = [];
    for (let i = 0; i < count; i++) {
      const asset: StoredAsset = {
        id: uid(),
        kind: body.mode === 'image' ? 'image' : 'video',
        status: 'pending',
        src: null,
        prompt: body.prompt || (source ? source.prompt : ''),
        mode: body.mode,
        model: key ? body.model : 'demo',
        aspect: genReq.aspect,
        durationSec: body.mode === 'image' ? 0 : body.mode === 'extend' ? (source ? source.durationSec : 0) + 7 : duration,
        error: null,
        createdAt: Date.now(),
        mock: !key,
        canExtend: false,
      };
      p.assets.unshift(asset);
      created.push(asset);
    }
    p.updatedAt = Date.now();
    save();
    // Run sequentially per request in demo mode (rendering is CPU heavy), in parallel for the API.
    if (!key) {
      (async () => {
        for (const a of created) await runJob(p, a, genReq, null);
      })();
    } else {
      for (const a of created) void runJob(p, a, genReq, key);
    }
    res.json(publicProject(p));
  }),
);

app.post(
  '/api/projects/:id/render',
  wrap((req, res) => {
    const p = getProject(req.params.id);
    if (!p.clips.length) throw new Error('Timeline đang trống.');
    const height = [480, 720, 1080].indexOf(Number(req.body.height)) >= 0 ? Number(req.body.height) : 720;
    const job: RenderJob = { id: uid(), status: 'rendering', progress: 0, url: null, error: null };
    renders[job.id] = job;
    void runRender(job, p, height);
    res.json(job);
  }),
);

app.get(
  '/api/render/:jobId',
  wrap((req, res) => {
    const job = renders[req.params.jobId];
    if (!job) throw Object.assign(new Error('Không tìm thấy tác vụ'), { status: 404 });
    res.json(job);
  }),
);

// Serve the built web app in production.
const WEB_DIST = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Flow Studio server: ${ORIGIN}`);
  console.log(process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY: đã cấu hình' : 'Chưa có GEMINI_API_KEY trên server — dùng key trong Cài đặt hoặc chế độ Demo.');
  // Warm up the Remotion bundle so the first render/demo clip is faster.
  getBundle().catch((e) => console.error('[remotion] bundle failed', e));
});
