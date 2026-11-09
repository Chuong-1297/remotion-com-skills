// Local AI through ComfyUI (e.g. Wan 2.2 Animate): character replacement / animation from a reference video.
// Flow Studio sends the character image, the reference video and the prompt to a workflow the user exported
// from ComfyUI in API format, then downloads the resulting video into the project library.
import type express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Asset, Project } from '../src/flow/types';

type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export interface WorkflowMapping {
  image: { node: string; input: string } | null;
  video: { node: string; input: string } | null;
  prompt: { node: string; input: string } | null;
  negative: { node: string; input: string } | null;
  seed: { node: string; input: string } | null;
}

export interface StoredWorkflow {
  id: string;
  name: string;
  mode: 'animate' | 'replace';
  graph: ApiGraph;
  mapping: WorkflowMapping;
  createdAt: number;
}

export interface NodeChoice {
  node: string;
  input: string;
  label: string;
}

interface Ctx {
  DATA_DIR: string;
  MEDIA_DIR: string;
  uid: () => string;
  save: () => void;
  getProject: (id: string) => Project & { assets: Array<Asset & Record<string, unknown>> };
  publicProject: (p: never) => Project;
  mediaPath: (src: string) => string;
  wrap: (fn: (req: express.Request, res: express.Response) => unknown) => express.RequestHandler;
  errMessage: (e: unknown) => string;
}

const IMAGE_LOADERS = ['LoadImage', 'LoadImageMask', 'Image Load', 'LoadImageFromPath'];
const VIDEO_LOADERS = ['LoadVideo', 'VHS_LoadVideo', 'VHS_LoadVideoPath', 'VHS_LoadVideoFFmpeg', 'LoadVideoPath'];
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|gif|webp)$/i;

const titleOf = (g: ApiGraph, id: string) => (g[id]._meta && g[id]._meta!.title) || g[id].class_type;

/** Input choices for each role, best guess first. */
export const analyseGraph = (g: ApiGraph) => {
  const ids = Object.keys(g);
  const images: NodeChoice[] = [];
  const videos: NodeChoice[] = [];
  const texts: NodeChoice[] = [];
  const seeds: NodeChoice[] = [];
  const positiveIds = new Set<string>();
  const negativeIds = new Set<string>();
  for (const id of ids) {
    const n = g[id];
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (Array.isArray(v) && typeof v[0] === 'string') {
        if (/^positive/i.test(k)) positiveIds.add(v[0]);
        if (/^negative/i.test(k)) negativeIds.add(v[0]);
      }
    }
  }
  for (const id of ids) {
    const n = g[id];
    const title = titleOf(g, id);
    const label = `#${id} ${title}`;
    if (IMAGE_LOADERS.indexOf(n.class_type) >= 0 && 'image' in n.inputs) images.push({ node: id, input: 'image', label });
    if (VIDEO_LOADERS.indexOf(n.class_type) >= 0 || /loadvideo/i.test(n.class_type)) {
      const key = ['file', 'video', 'path', 'video_path'].find((k) => k in n.inputs && typeof n.inputs[k] === 'string');
      if (key) videos.push({ node: id, input: key, label });
    }
    for (const k of ['text', 'prompt', 'positive_prompt']) {
      if (typeof n.inputs[k] === 'string') texts.push({ node: id, input: k, label: `${label} — “${String(n.inputs[k]).slice(0, 40)}”` });
    }
    for (const k of ['seed', 'noise_seed']) {
      if (typeof n.inputs[k] === 'number') seeds.push({ node: id, input: k, label });
    }
  }
  const hint = (c: NodeChoice, re: RegExp) => (re.test(titleOf(g, c.node)) ? -1 : 0);
  images.sort((a, b) => hint(a, /char|ref|subject|person|nhân/i) - hint(b, /char|ref|subject|person|nhân/i));
  videos.sort((a, b) => hint(a, /video|pose|driv|motion|ref/i) - hint(b, /video|pose|driv|motion|ref/i));
  const pos = texts.filter((t) => positiveIds.has(t.node));
  const neg = texts.filter((t) => negativeIds.has(t.node));
  const mapping: WorkflowMapping = {
    image: images[0] ? { node: images[0].node, input: images[0].input } : null,
    video: videos[0] ? { node: videos[0].node, input: videos[0].input } : null,
    prompt: (pos[0] || texts.find((t) => !negativeIds.has(t.node))) ? { node: (pos[0] || texts.find((t) => !negativeIds.has(t.node)))!.node, input: (pos[0] || texts.find((t) => !negativeIds.has(t.node)))!.input } : null,
    negative: neg[0] ? { node: neg[0].node, input: neg[0].input } : null,
    seed: seeds[0] ? { node: seeds[0].node, input: seeds[0].input } : null,
  };
  return { choices: { images, videos, texts, seeds }, mapping };
};

const isApiGraph = (x: unknown): x is ApiGraph =>
  !!x && typeof x === 'object' && !Array.isArray(x) && Object.values(x as object).length > 0 && Object.values(x as object).every((n) => n && typeof n === 'object' && typeof (n as { class_type?: unknown }).class_type === 'string');

export const registerComfy = (app: express.Express, ctx: Ctx) => {
  const settingsFile = path.join(ctx.DATA_DIR, 'comfy-settings.json');
  const wfDir = path.join(ctx.DATA_DIR, 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  let settings: { url: string } = { url: process.env.COMFYUI_URL || 'http://127.0.0.1:8188' };
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    /* defaults */
  }
  const base = () => settings.url.replace(/\/+$/, '');
  const loadWf = (id: string): StoredWorkflow => {
    const f = path.join(wfDir, `${path.basename(id)}.json`);
    if (!fs.existsSync(f)) throw Object.assign(new Error('Không tìm thấy workflow'), { status: 404 });
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  };
  const listWf = (): StoredWorkflow[] =>
    fs
      .readdirSync(wfDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(wfDir, f), 'utf8')) as StoredWorkflow)
      .sort((a, b) => b.createdAt - a.createdAt);
  const summary = (w: StoredWorkflow) => ({ id: w.id, name: w.name, mode: w.mode, mapping: w.mapping, createdAt: w.createdAt, choices: analyseGraph(w.graph).choices });

  const comfyFetch = async (p: string, init?: RequestInit) => {
    let r: Response;
    try {
      r = await fetch(base() + p, init);
    } catch {
      throw new Error(`Không kết nối được ComfyUI tại ${base()}. Hãy mở ComfyUI trên máy rồi thử lại.`);
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`ComfyUI báo lỗi ${r.status}: ${t.slice(0, 500)}`);
    }
    return r;
  };

  app.get('/api/comfy/settings', (_req, res) => res.json(settings));
  app.put(
    '/api/comfy/settings',
    ctx.wrap((req, res) => {
      const url = String((req.body && req.body.url) || '').trim();
      if (!/^https?:\/\//.test(url)) throw new Error('Địa chỉ ComfyUI phải bắt đầu bằng http:// hoặc https://');
      settings.url = url;
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      res.json(settings);
    }),
  );
  app.get(
    '/api/comfy/status',
    ctx.wrap(async (_req, res) => {
      const r = await comfyFetch('/system_stats');
      const d = (await r.json()) as { system?: { comfyui_version?: string }; devices?: Array<{ name?: string; vram_total?: number; type?: string }> };
      res.json({
        ok: true,
        url: base(),
        version: d.system && d.system.comfyui_version,
        devices: (d.devices || []).map((x) => ({ name: x.name, type: x.type, vramGB: x.vram_total ? +(x.vram_total / 1073741824).toFixed(1) : null })),
      });
    }),
  );

  app.get('/api/comfy/workflows', (_req, res) => res.json(listWf().map(summary)));
  app.post(
    '/api/comfy/workflows',
    ctx.wrap((req, res) => {
      const { name, mode, graph } = req.body || {};
      if (graph && typeof graph === 'object' && Array.isArray((graph as { nodes?: unknown }).nodes)) {
        throw new Error('Đây là file workflow dạng giao diện. Trong ComfyUI hãy dùng Workflow → Export (API) rồi tải file đó lên.');
      }
      if (!isApiGraph(graph)) throw new Error('File không phải workflow ComfyUI định dạng API.');
      const a = analyseGraph(graph);
      if (!a.choices.images.length) throw new Error('Workflow không có ô nạp ảnh (LoadImage) cho nhân vật.');
      if (!a.choices.videos.length) throw new Error('Workflow không có ô nạp video (Load Video) cho video mẫu.');
      const wf: StoredWorkflow = { id: ctx.uid(), name: String(name || 'Wan Animate').slice(0, 80), mode: mode === 'replace' ? 'replace' : 'animate', graph, mapping: a.mapping, createdAt: Date.now() };
      fs.writeFileSync(path.join(wfDir, `${wf.id}.json`), JSON.stringify(wf));
      res.json(summary(wf));
    }),
  );
  app.put(
    '/api/comfy/workflows/:id',
    ctx.wrap((req, res) => {
      const wf = loadWf(req.params.id);
      const b = req.body || {};
      if (typeof b.name === 'string') wf.name = b.name.slice(0, 80);
      if (b.mode === 'animate' || b.mode === 'replace') wf.mode = b.mode;
      if (b.mapping) {
        const m = b.mapping as WorkflowMapping;
        for (const k of ['image', 'video', 'prompt', 'negative', 'seed'] as const) {
          const v = m[k];
          if (v === null) wf.mapping[k] = null;
          else if (v && wf.graph[v.node] && v.input in wf.graph[v.node].inputs) wf.mapping[k] = { node: v.node, input: v.input };
        }
      }
      fs.writeFileSync(path.join(wfDir, `${wf.id}.json`), JSON.stringify(wf));
      res.json(summary(wf));
    }),
  );
  app.delete(
    '/api/comfy/workflows/:id',
    ctx.wrap((req, res) => {
      loadWf(req.params.id);
      fs.unlinkSync(path.join(wfDir, `${path.basename(req.params.id)}.json`));
      res.json({ ok: true });
    }),
  );

  const upload = async (file: string, name: string) => {
    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(file)]), name);
    fd.append('overwrite', 'true');
    fd.append('type', 'input');
    const r = await comfyFetch('/upload/image', { method: 'POST', body: fd });
    const d = (await r.json()) as { name: string; subfolder?: string };
    return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
  };

  const run = async (asset: Asset & Record<string, unknown>, project: ReturnType<Ctx['getProject']>, wf: StoredWorkflow, body: { imageSrc: string; videoSrc: string; prompt: string; negative: string; seed: number | null }) => {
    const clientId = ctx.uid();
    const setProgress = (p: number) => {
      asset.progress = Math.max(0, Math.min(1, p));
    };
    try {
      const graph: ApiGraph = JSON.parse(JSON.stringify(wf.graph));
      const m = wf.mapping;
      if (!m.image || !m.video) throw new Error('Workflow chưa chọn ô nạp ảnh và ô nạp video.');
      const imgName = await upload(ctx.mediaPath(body.imageSrc), `flow_${asset.id}_character${path.extname(body.imageSrc) || '.png'}`);
      const vidName = await upload(ctx.mediaPath(body.videoSrc), `flow_${asset.id}_reference${path.extname(body.videoSrc) || '.mp4'}`);
      graph[m.image.node].inputs[m.image.input] = imgName;
      graph[m.video.node].inputs[m.video.input] = vidName;
      if (m.prompt && body.prompt) graph[m.prompt.node].inputs[m.prompt.input] = body.prompt;
      if (m.negative && body.negative) graph[m.negative.node].inputs[m.negative.input] = body.negative;
      if (m.seed) graph[m.seed.node].inputs[m.seed.input] = body.seed !== null ? body.seed : Math.floor(Math.random() * 2 ** 31);

      // Progress over the websocket (optional; polling below decides completion).
      let ws: WebSocket | null = null;
      let nodesDone = 0;
      const total = Object.keys(graph).length;
      try {
        ws = new WebSocket(base().replace(/^http/, 'ws') + `/ws?clientId=${clientId}`);
        ws.onmessage = (ev) => {
          if (typeof ev.data !== 'string') return;
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'progress' && msg.data && msg.data.max) setProgress((nodesDone + msg.data.value / msg.data.max) / total);
            if (msg.type === 'executing' && msg.data && msg.data.node) {
              nodesDone++;
              setProgress(nodesDone / total);
            }
          } catch {
            /* ignore */
          }
        };
      } catch {
        ws = null;
      }

      const q = await comfyFetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientId }) });
      const qd = (await q.json()) as { prompt_id: string; node_errors?: Record<string, unknown> };
      if (qd.node_errors && Object.keys(qd.node_errors).length) throw new Error(`Workflow lỗi: ${JSON.stringify(qd.node_errors).slice(0, 500)}`);

      const started = Date.now();
      let outputs: Record<string, Record<string, unknown>> | null = null;
      while (!outputs) {
        if (Date.now() - started > 3 * 60 * 60 * 1000) throw new Error('Quá 3 giờ mà ComfyUI chưa chạy xong.');
        await new Promise((r) => setTimeout(r, 3000));
        const h = (await (await comfyFetch(`/history/${qd.prompt_id}`)).json()) as Record<string, { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; completed?: boolean; messages?: unknown[] } }>;
        const entry = h[qd.prompt_id];
        if (!entry) continue;
        if (entry.status && entry.status.status_str === 'error') {
          const errMsg = (entry.status.messages || []).map((x) => JSON.stringify(x)).join(' ').slice(0, 600);
          throw new Error(`ComfyUI chạy lỗi: ${errMsg || 'không rõ'}`);
        }
        if (entry.status && entry.status.completed) outputs = entry.outputs || {};
      }
      if (ws) ws.close();

      const files: Array<{ filename: string; subfolder: string; type: string }> = [];
      for (const out of Object.values(outputs)) {
        for (const key of ['videos', 'gifs', 'images', 'animated']) {
          const list = out[key];
          if (Array.isArray(list)) for (const f of list) if (f && typeof f === 'object' && 'filename' in f) files.push(f as { filename: string; subfolder: string; type: string });
        }
      }
      const pick = files.filter((f) => f.type === 'output').find((f) => VIDEO_EXT.test(f.filename)) || files.find((f) => VIDEO_EXT.test(f.filename));
      if (!pick) throw new Error('Workflow chạy xong nhưng không có video đầu ra (cần một node lưu video như Save Video / Video Combine).');
      const r = await comfyFetch(`/view?filename=${encodeURIComponent(pick.filename)}&subfolder=${encodeURIComponent(pick.subfolder || '')}&type=${encodeURIComponent(pick.type || 'output')}`);
      const out = `${ctx.uid()}${path.extname(pick.filename).toLowerCase()}`;
      fs.writeFileSync(path.join(ctx.MEDIA_DIR, out), Buffer.from(await r.arrayBuffer()));
      asset.src = `/media/${out}`;
      asset.status = 'done';
      asset.progress = 1;
    } catch (e) {
      console.error('[comfy]', e);
      asset.status = 'error';
      asset.error = ctx.errMessage(e);
    }
    project.updatedAt = Date.now();
    ctx.save();
  };

  app.post(
    '/api/projects/:id/comfy',
    ctx.wrap((req, res) => {
      const p = ctx.getProject(req.params.id);
      const b = req.body || {};
      const wf = loadWf(String(b.workflowId || ''));
      const img = p.assets.find((a) => a.id === b.imageAssetId && a.kind === 'image' && a.src);
      const vid = p.assets.find((a) => a.id === b.videoAssetId && a.kind === 'video' && a.src);
      if (!img) throw new Error('Hãy chọn ảnh nhân vật.');
      if (!vid) throw new Error('Hãy chọn video mẫu.');
      const asset = {
        id: ctx.uid(),
        kind: 'video' as const,
        status: 'pending' as const,
        src: null,
        prompt: String(b.prompt || `${wf.mode === 'replace' ? 'Thay nhân vật' : 'Nhân vật làm theo video'}`).slice(0, 300),
        mode: 'comfy' as const,
        model: `ComfyUI · ${wf.name}`,
        aspect: p.aspect,
        durationSec: vid.durationSec,
        error: null,
        createdAt: Date.now(),
        mock: false,
        canExtend: false,
        thumb: img.thumb || img.src,
        sourceAssetId: vid.id,
        progress: 0,
      };
      p.assets.unshift(asset as never);
      p.updatedAt = Date.now();
      ctx.save();
      void run(asset as never, p, wf, {
        imageSrc: img.src!,
        videoSrc: vid.src!,
        prompt: String(b.prompt || ''),
        negative: String(b.negative || ''),
        seed: typeof b.seed === 'number' ? b.seed : null,
      });
      res.json(ctx.publicProject(p as never));
    }),
  );
};
