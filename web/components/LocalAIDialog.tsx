import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../../src/flow/types';
import { api, ComfyStatus, NodeChoice, WorkflowMapping, WorkflowSummary } from '../api';
import { IconTrash, IconUpload, IconX } from '../icons';

type Role = keyof WorkflowMapping;
const ROLES: Array<{ key: Role; label: string; list: keyof WorkflowSummary['choices']; optional: boolean }> = [
  { key: 'image', label: 'Ảnh nhân vật', list: 'images', optional: false },
  { key: 'video', label: 'Video mẫu', list: 'videos', optional: false },
  { key: 'prompt', label: 'Prompt', list: 'texts', optional: true },
  { key: 'negative', label: 'Prompt phủ định', list: 'texts', optional: true },
  { key: 'seed', label: 'Seed (ngẫu nhiên mỗi lần)', list: 'seeds', optional: true },
];
const keyOf = (c: { node: string; input: string } | null) => (c ? `${c.node}:${c.input}` : '');

/** Character replacement / animation through a ComfyUI workflow running on the user's own GPU (e.g. Wan 2.2 Animate). */
export const LocalAIDialog: React.FC<{ project: Project; onClose: () => void; onStarted: (p: Project) => void }> = ({ project, onClose, onStarted }) => {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ComfyStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [wfId, setWfId] = useState('');
  const [newMode, setNewMode] = useState<'animate' | 'replace'>('animate');
  const [imageId, setImageId] = useState('');
  const [videoId, setVideoId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const images = project.assets.filter((a) => a.kind === 'image' && a.status === 'done' && a.src).sort((a, b) => (a.role === 'foreground' ? 0 : 1) - (b.role === 'foreground' ? 0 : 1));
  const videos = project.assets.filter((a) => a.kind === 'video' && a.status === 'done' && a.src && a.role !== 'foreground');
  const wf = workflows.find((w) => w.id === wfId) || null;

  const check = async () => {
    setChecking(true);
    setStatusErr(null);
    try {
      setStatus(await api.comfyStatus());
    } catch (e) {
      setStatus(null);
      setStatusErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    api.comfySettings().then((s) => setUrl(s.url)).catch(() => undefined);
    api
      .listWorkflows()
      .then((l) => {
        setWorkflows(l);
        if (l[0]) setWfId(l[0].id);
      })
      .catch((e) => setError(e.message));
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!imageId && images[0]) setImageId(images[0].id);
    if (!videoId && videos[0]) setVideoId(videos[0].id);
  }, [images, videos, imageId, videoId]);

  const saveUrl = async () => {
    try {
      await api.setComfySettings(url);
      await check();
    } catch (e) {
      setStatusErr((e as Error).message);
    }
  };

  const uploadWf = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const graph = JSON.parse(await file.text());
      const w = await api.uploadWorkflow(file.name.replace(/\.json$/i, ''), newMode, graph);
      setWorkflows((l) => [w, ...l]);
      setWfId(w.id);
    } catch (e) {
      setError(e instanceof SyntaxError ? 'File không phải JSON hợp lệ.' : (e as Error).message);
    }
  };

  const setMapping = async (role: Role, value: string) => {
    if (!wf) return;
    const [node, input] = value.split(':');
    try {
      const w = await api.updateWorkflow(wf.id, { mapping: { [role]: value ? { node, input } : null } });
      setWorkflows((l) => l.map((x) => (x.id === w.id ? w : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeWf = async () => {
    if (!wf) return;
    await api.deleteWorkflow(wf.id);
    const rest = workflows.filter((w) => w.id !== wf.id);
    setWorkflows(rest);
    setWfId(rest[0] ? rest[0].id : '');
  };

  const start = async () => {
    if (!wf) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.runComfy(project.id, { workflowId: wf.id, imageAssetId: imageId, videoAssetId: videoId, prompt: prompt.trim() });
      onStarted(p);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canRun = Boolean(status && wf && wf.mapping.image && wf.mapping.video && imageId && videoId && !busy);

  return (
    <div className="modal-backdrop">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Thay nhân vật bằng AI trên máy (ComfyUI)</h3>
          <button className="icon-btn" onClick={onClose} title="Đóng">
            <IconX />
          </button>
        </div>
        <p className="muted small">
          Chạy mô hình như Wan 2.2 Animate trên card đồ hoạ của bạn qua ComfyUI: nhân vật trong ảnh làm theo động tác của video mẫu, hoặc thay người trong video. Miễn phí, không gửi dữ
          liệu ra ngoài.
        </p>

        <section className="lai-section">
          <h4>1. Kết nối ComfyUI</h4>
          <div className="row gap">
            <input id="comfy-url" className="grow-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
            <button className="btn ghost" onClick={saveUrl} disabled={checking}>
              {checking ? 'Đang kiểm tra…' : 'Kiểm tra'}
            </button>
          </div>
          {status ? (
            <div className="status-pill ok">
              Đã kết nối{status.version ? ` · ComfyUI ${status.version}` : ''}
              {status.devices.length ? ` · ${status.devices.map((d) => `${d.name || d.type}${d.vramGB ? ` (${d.vramGB} GB)` : ''}`).join(', ')}` : ''}
            </div>
          ) : statusErr ? (
            <div className="error-banner">{statusErr}</div>
          ) : null}
        </section>

        <section className="lai-section">
          <h4>2. Workflow</h4>
          <div className="row gap wrap">
            <select id="comfy-wf" className="select" value={wfId} onChange={(e) => setWfId(e.target.value)}>
              {!workflows.length ? <option value="">Chưa có workflow</option> : null}
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.mode === 'replace' ? 'Thay nhân vật' : 'Làm theo video'}
                </option>
              ))}
            </select>
            {wf ? (
              <button className="icon-btn danger" title="Xoá workflow" onClick={removeWf}>
                <IconTrash size={16} />
              </button>
            ) : null}
            <span className="spacer" />
            <select id="comfy-new-mode" className="select small" value={newMode} onChange={(e) => setNewMode(e.target.value as 'animate' | 'replace')}>
              <option value="animate">Làm theo video</option>
              <option value="replace">Thay nhân vật</option>
            </select>
            <button className="btn ghost" onClick={() => fileRef.current && fileRef.current.click()}>
              <IconUpload /> Tải workflow (.json API)
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => uploadWf(e.target.files ? e.target.files[0] : undefined)} />
          </div>
          <p className="muted small">Trong ComfyUI: mở mẫu Wan 2.2 Animate, chạy thử được, rồi chọn Workflow → Export (API) và tải file đó lên đây.</p>
          {wf ? (
            <div className="mapping">
              {ROLES.map((r) => {
                const list = wf.choices[r.list] as NodeChoice[];
                return (
                  <label key={r.key} className="row between field-row">
                    <span>{r.label}</span>
                    <select className="select small" value={keyOf(wf.mapping[r.key])} onChange={(e) => setMapping(r.key, e.target.value)}>
                      {r.optional || !list.length ? <option value="">{r.optional ? 'Không dùng' : 'Không tìm thấy'}</option> : null}
                      {list.map((c) => (
                        <option key={`${c.node}:${c.input}`} value={`${c.node}:${c.input}`}>
                          {c.label.slice(0, 60)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className="lai-section">
          <h4>3. Tạo video</h4>
          <label className="row between field-row">
            <span>Ảnh nhân vật</span>
            <select id="comfy-image" className="select small" value={imageId} onChange={(e) => setImageId(e.target.value)}>
              {!images.length ? <option value="">Chưa có ảnh trong Thư viện</option> : null}
              {images.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.role === 'foreground' ? '[Đã tách nền] ' : ''}
                  {(a.prompt || a.id).slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
          <label className="row between field-row">
            <span>Video mẫu</span>
            <select id="comfy-video" className="select small" value={videoId} onChange={(e) => setVideoId(e.target.value)}>
              {!videos.length ? <option value="">Chưa có video trong Thư viện</option> : null}
              {videos.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.prompt || a.id).slice(0, 40)}
                  {a.durationSec ? ` (${a.durationSec.toFixed(1)}s)` : ''}
                </option>
              ))}
            </select>
          </label>
          <textarea
            id="comfy-prompt"
            className="text-area"
            rows={2}
            placeholder="Mô tả (tuỳ chọn): ví dụ “cô gái mặc áo dài đỏ nhảy trong phòng khách, ánh sáng ấm”"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="muted small">Video mẫu nên ngắn (3–10 giây) và thấy rõ người. Mỗi lần chạy có thể mất từ vài phút đến hơn nửa giờ tuỳ card đồ hoạ.</p>
        </section>

        {error ? <div className="error-banner">{error}</div> : null}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Đóng
          </button>
          <button className="btn primary" onClick={start} disabled={!canRun}>
            {busy ? 'Đang gửi…' : 'Tạo video'}
          </button>
        </div>
      </div>
    </div>
  );
};
