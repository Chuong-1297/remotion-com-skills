import type { AspectRatio, GenMode, Project, SceneClip } from '../src/flow/types';

export interface ProjectSummary {
  id: string;
  name: string;
  aspect: AspectRatio;
  updatedAt: number;
  assetCount: number;
  cover: { src: string; kind: 'video' | 'image' } | null;
}

export interface GenerateBody {
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

export interface RenderJob {
  id: string;
  status: 'rendering' | 'done' | 'error';
  progress: number;
  url: string | null;
  error: string | null;
}

const KEY_STORAGE = 'flowStudio.geminiKey';
export const getApiKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
};
export const setApiKey = (k: string) => {
  try {
    if (k) localStorage.setItem(KEY_STORAGE, k);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
};

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['x-gemini-key'] = key;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.error) || `Lỗi ${res.status}`);
  return data as T;
}

export const api = {
  config: () => call<{ serverKey: boolean }>('GET', '/api/config'),
  listProjects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (name: string, aspect: AspectRatio) => call<Project>('POST', '/api/projects', { name, aspect }),
  getProject: (id: string) => call<Project>('GET', `/api/projects/${id}`),
  updateProject: (id: string, patch: { name?: string; aspect?: AspectRatio; clips?: SceneClip[] }) =>
    call<Project>('PUT', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => call<{ ok: boolean }>('DELETE', `/api/projects/${id}`),
  deleteAsset: (id: string, assetId: string) => call<Project>('DELETE', `/api/projects/${id}/assets/${assetId}`),
  upload: (dataUrl: string, opts: { projectId?: string; name?: string; duration?: number } = {}) =>
    call<{ src: string; kind: 'image' | 'video' }>('POST', '/api/upload', { dataUrl, ...opts }),
  uploadRaw: async (data: Blob, type?: string): Promise<{ src: string }> => {
    const res = await fetch('/api/upload-raw', { method: 'POST', headers: { 'Content-Type': type || data.type || 'application/octet-stream' }, body: data });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((d && d.error) || `Tải lên thất bại (${res.status})`);
    return d as { src: string };
  },
  registerAsset: (
    id: string,
    body: { kind: 'video' | 'image' | 'motion' | 'character'; src: string; name: string; mode: 'matte' | 'motion' | 'upload'; duration?: number; thumb?: string | null; role?: 'base' | 'foreground' | 'motion'; pairId?: string; sourceAssetId?: string; model?: string },
  ) => call<Project>('POST', `/api/projects/${id}/assets`, body),
  generate: (id: string, body: GenerateBody) => call<Project>('POST', `/api/projects/${id}/generate`, body),
  render: (id: string, height: number) => call<RenderJob>('POST', `/api/projects/${id}/render`, { height }),
  renderStatus: (jobId: string) => call<RenderJob>('GET', `/api/render/${jobId}`),
};

export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export const probeVideoDuration = (src: string) =>
  new Promise<number>((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => resolve(0);
    v.src = src;
  });

/** Grab a frame of a video as a PNG data URL ("end" = last frame). */
export const grabVideoFrame = (src: string, at: number | 'end') =>
  new Promise<string>((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => {
      v.currentTime = at === 'end' ? Math.max(0, v.duration - 0.05) : Math.min(at, v.duration);
    };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('Canvas không khả dụng'));
      ctx.drawImage(v, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    v.onerror = () => reject(new Error('Không đọc được video'));
    v.src = src;
  });

export const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

export const fmtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};
