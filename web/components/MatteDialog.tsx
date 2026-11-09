import React, { useRef, useState } from 'react';
import type { Asset, Project } from '../../src/flow/types';
import { api } from '../api';
import { IconX } from '../icons';

type Model = 'modnet' | 'ben2-base';
type Phase = 'setup' | 'check' | 'download' | 'process' | 'upload' | 'done' | 'error';

const MODELS: Array<{ id: Model; label: string; note: string }> = [
  { id: 'modnet', label: 'MODNet — tách người', note: '~26 MB, nhanh, tốt nhất cho người' },
  { id: 'ben2-base', label: 'BEN2 — mọi vật thể (thử nghiệm)', note: '~219 MB, cần GPU hỗ trợ shader-f16, tốn nhiều bộ nhớ' },
];

/**
 * Background removal with @remotion/video-matting, entirely in the browser (WebGPU).
 * Produces an opaque base layer and a transparent foreground; both are saved as project assets.
 */
export const MatteDialog: React.FC<{ project: Project; asset: Asset; onClose: () => void; onDone: (p: Project) => void }> = ({ project, asset, onClose, onDone }) => {
  const [model, setModel] = useState<Model>('modnet');
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      setPhase('check');
      setMessage('Đang kiểm tra GPU của trình duyệt…');
      // Loaded on demand: the matting runtime is large.
      const vm = await import('@remotion/video-matting');
      const support = await vm.canUseVideoMatting({ model });
      if (!support.supported) {
        throw new Error(
          support.reason === 'webgpu-unavailable'
            ? 'Trình duyệt này không có WebGPU. Dùng Chrome hoặc Edge bản mới trên máy có card đồ hoạ.'
            : support.reason === 'shader-f16-unavailable'
              ? 'GPU không hỗ trợ shader-f16 nên không chạy được BEN2. Hãy chọn MODNet.'
              : support.detailedReason || 'Máy này không chạy được tách nền.',
        );
      }

      setPhase('download');
      setProgress(0);
      setMessage('Đang tải model (chỉ lần đầu)…');
      await vm.downloadVideoMattingModel({ model, signal: abort.signal, onProgress: ({ progress: p }) => setProgress(p) });

      setPhase('process');
      setProgress(0);
      setMessage('Đang tách nền từng khung hình…');
      const input = await (await fetch(asset.src!)).blob();
      const result = await vm.separateVideoLayers({
        src: input,
        model,
        audio: 'base',
        signal: abort.signal,
        onProgress: (p) => {
          if (p.stage === 'processing' && p.progress !== null) {
            setProgress(p.progress);
            setMessage(`Đang tách nền… ${p.processedFrames} khung hình`);
          } else {
            setMessage('Đang hoàn tất file video…');
          }
        },
      });

      setPhase('upload');
      setMessage('Đang lưu hai lớp video…');
      const [baseBlob, fgBlob] = await Promise.all([result.base.getBlob(), result.foreground.getBlob()]);
      await result.base.dispose();
      await result.foreground.dispose();
      const [baseUp, fgUp] = await Promise.all([api.uploadRaw(baseBlob, 'video/webm'), api.uploadRaw(fgBlob, 'video/webm')]);
      const pairId = Math.random().toString(36).slice(2, 10);
      const name = asset.prompt || 'Video';
      await api.registerAsset(project.id, { kind: 'video', src: baseUp.src, name: `${name} (lớp nền gốc)`, mode: 'matte', role: 'base', pairId, duration: result.durationInSeconds, sourceAssetId: asset.id, model, thumb: asset.thumb || null });
      const p = await api.registerAsset(project.id, { kind: 'video', src: fgUp.src, name: `${name} (đã tách nền)`, mode: 'matte', role: 'foreground', pairId, duration: result.durationInSeconds, sourceAssetId: asset.id, model });
      onDone(p);
      setPhase('done');
      setMessage(`Xong: ${result.processedFrames} khung hình, ${result.width}×${result.height}. Thêm clip “đã tách nền” vào cảnh rồi chọn nền mới.`);
    } catch (e) {
      if (abort.signal.aborted) {
        onClose();
        return;
      }
      setPhase('error');
      setMessage((e as Error).message || String(e));
    }
  };

  const busy = phase === 'check' || phase === 'download' || phase === 'process' || phase === 'upload';

  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Tách nền video</h3>
          <button className="icon-btn" onClick={() => (busy ? abortRef.current?.abort() : onClose())} title={busy ? 'Huỷ' : 'Đóng'}>
            <IconX />
          </button>
        </div>
        {phase === 'setup' ? (
          <>
            <p className="muted small">
              Chạy ngay trên máy bạn bằng GPU (WebGPU), không gửi video đi đâu. Kết quả gồm lớp người/vật thể có nền trong suốt và lớp nền gốc, để thay nền hoặc đặt chữ phía
              sau người.
            </p>
            <div className="model-list">
              {MODELS.map((m) => (
                <label key={m.id} className={`model-opt ${model === m.id ? 'on' : ''}`}>
                  <input type="radio" name="matte-model" checked={model === m.id} onChange={() => setModel(m.id)} />
                  <span>
                    <b>{m.label}</b>
                    <span className="muted small">{m.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>
                Huỷ
              </button>
              <button className="btn primary" onClick={run}>
                Bắt đầu tách nền
              </button>
            </div>
          </>
        ) : (
          <>
            {busy ? (
              <div className="progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : null}
            <p className={phase === 'error' ? 'error-banner' : 'muted small'}>{message}</p>
            <div className="modal-actions">
              {busy ? (
                <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
                  Huỷ
                </button>
              ) : (
                <button className="btn primary" onClick={onClose}>
                  Đóng
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
