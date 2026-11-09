import React, { useRef, useState } from 'react';
import type { Asset, Project } from '../../src/flow/types';
import { api } from '../api';
import { IconX } from '../icons';

type Model = 'Xenova/modnet' | 'onnx-community/BEN2-ONNX';
type Phase = 'setup' | 'load' | 'process' | 'review' | 'saving' | 'done' | 'error';

const MODELS: Array<{ id: Model; label: string; note: string }> = [
  { id: 'Xenova/modnet', label: 'MODNet — tách người', note: '~25 MB, nhanh, tốt nhất cho chân dung và người' },
  { id: 'onnx-community/BEN2-ONNX', label: 'BEN2 — mọi vật thể (thử nghiệm)', note: '~220 MB, cho đồ vật, con vật, nhân vật hoạt hình' },
];

/**
 * Removes the background of an image in the browser with Transformers.js
 * (WebGPU when available, otherwise WebAssembly on the CPU) and saves a transparent PNG.
 */
export const ImageMatteDialog: React.FC<{ project: Project; asset: Asset; onClose: () => void; onDone: (p: Project) => void }> = ({ project, asset, onClose, onDone }) => {
  const [model, setModel] = useState<Model>('Xenova/modnet');
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const files = useRef<Record<string, { loaded: number; total: number }>>({});

  const run = async () => {
    try {
      setPhase('load');
      setMessage('Đang tải model (chỉ lần đầu, sau đó dùng lại từ bộ nhớ trình duyệt)…');
      const { pipeline } = await import('@huggingface/transformers');
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const make = (device: 'webgpu' | 'wasm') =>
        pipeline('background-removal', model, {
          device,
          progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
            if (p.status === 'progress' && p.file && p.total) {
              files.current[p.file] = { loaded: p.loaded || 0, total: p.total };
              const all = Object.values(files.current);
              setProgress(all.reduce((s, f) => s + f.loaded, 0) / Math.max(1, all.reduce((s, f) => s + f.total, 0)));
            }
          },
        });
      let seg;
      try {
        seg = await make(hasGpu ? 'webgpu' : 'wasm');
      } catch (e) {
        if (!hasGpu) throw e;
        seg = await make('wasm');
      }

      setPhase('process');
      setMessage('Đang tách nền…');
      const out = await seg(new URL(asset.src!, window.location.href).toString());
      const image = Array.isArray(out) ? out[0] : out;
      const blob: Blob = await image.toBlob('image/png');
      setResult({ blob, url: URL.createObjectURL(blob) });
      setPhase('review');
      setMessage('');
    } catch (e) {
      setPhase('error');
      const msg = (e as Error).message || String(e);
      setMessage(/fetch|network|Failed to load/i.test(msg) ? `Không tải được model từ huggingface.co. Kiểm tra kết nối mạng rồi thử lại. (${msg})` : msg);
    }
  };

  const saveIt = async () => {
    if (!result) return;
    setPhase('saving');
    try {
      const up = await api.uploadRaw(result.blob, 'image/png');
      const p = await api.registerAsset(project.id, {
        kind: 'image',
        src: up.src,
        name: `${asset.prompt || 'Ảnh'} (đã tách nền)`,
        mode: 'matte',
        role: 'foreground',
        sourceAssetId: asset.id,
        model,
        thumb: up.src,
      });
      onDone(p);
      setPhase('done');
      setMessage('Đã lưu ảnh nền trong suốt vào Thư viện. Trong Dựng cảnh, chọn một cảnh rồi bấm “Thêm nhân vật” để đặt vào video.');
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message);
    }
  };

  const busy = phase === 'load' || phase === 'process' || phase === 'saving';

  return (
    <div className="modal-backdrop">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Tách nền ảnh</h3>
          <button className="icon-btn" onClick={onClose} disabled={busy} title="Đóng">
            <IconX />
          </button>
        </div>
        <div className="matte-compare">
          <figure>
            <img src={asset.src || undefined} alt="Ảnh gốc" />
            <figcaption>Ảnh gốc</figcaption>
          </figure>
          <figure className="checker">
            {result ? <img src={result.url} alt="Đã tách nền" /> : <div className="matte-empty">{busy ? <div className="spinner" /> : 'Kết quả hiện ở đây'}</div>}
            <figcaption>Đã tách nền</figcaption>
          </figure>
        </div>
        {phase === 'setup' ? (
          <>
            <div className="model-list">
              {MODELS.map((m) => (
                <label key={m.id} className={`model-opt ${model === m.id ? 'on' : ''}`}>
                  <input type="radio" name="img-matte-model" checked={model === m.id} onChange={() => setModel(m.id)} />
                  <span>
                    <b>{m.label}</b>
                    <span className="muted small">{m.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="muted small">Chạy ngay trong trình duyệt, ảnh không gửi đi đâu. Có card đồ hoạ thì nhanh hơn, không có vẫn chạy được.</p>
          </>
        ) : null}
        {phase === 'load' ? (
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}
        {message ? <p className={phase === 'error' ? 'error-banner' : 'muted small'}>{message}</p> : null}
        <div className="modal-actions">
          {phase === 'setup' ? (
            <button className="btn primary" onClick={run}>
              Tách nền
            </button>
          ) : null}
          {phase === 'review' ? (
            <>
              <button
                className="btn ghost"
                onClick={() => {
                  setResult(null);
                  setPhase('setup');
                }}
              >
                Thử model khác
              </button>
              <button className="btn primary" onClick={saveIt}>
                Lưu vào Thư viện
              </button>
            </>
          ) : null}
          {phase === 'done' || phase === 'error' ? (
            <button className="btn primary" onClick={onClose}>
              Đóng
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
