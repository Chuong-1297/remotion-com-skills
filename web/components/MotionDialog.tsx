import React, { useRef, useState } from 'react';
import type { Asset, MotionData, Project } from '../../src/flow/types';
import { api, dataUrlToBlob } from '../api';
import { IconX } from '../icons';

type Variant = 'lite' | 'full' | 'heavy';
type Phase = 'setup' | 'load' | 'track' | 'upload' | 'done' | 'error';

const VARIANTS: Array<{ id: Variant; label: string; note: string }> = [
  { id: 'lite', label: 'Nhanh', note: 'Model nhẹ ~6 MB, kém chính xác hơn' },
  { id: 'full', label: 'Cân bằng', note: 'Khuyên dùng, ~9 MB' },
  { id: 'heavy', label: 'Chính xác', note: '~30 MB, chậm hơn' },
];

// Bones drawn on the 2D preview (MediaPipe Pose indices).
const PREVIEW_BONES: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
];

const seekTo = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });

/**
 * Learns the body motion of the person in a video with MediaPipe Pose (in the browser),
 * and saves it as a "motion" asset that drives a 3D character on the timeline.
 */
export const MotionDialog: React.FC<{ project: Project; asset: Asset; onClose: () => void; onDone: (p: Project) => void }> = ({ project, asset, onClose, onDone }) => {
  const [variant, setVariant] = useState<Variant>('full');
  const [fps, setFps] = useState(30);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);

  const run = async () => {
    cancelRef.current = false;
    try {
      setPhase('load');
      setMessage('Đang tải MediaPipe Pose…');
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe');
      const create = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: `/api/models/pose/${variant}`, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      let landmarker;
      try {
        landmarker = await create('GPU');
      } catch {
        landmarker = await create('CPU');
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = asset.src!;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Không đọc được video này.'));
      });
      const duration = video.duration;
      const total = Math.max(1, Math.floor(duration * fps));
      const canvas = canvasRef.current!;
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d')!;

      setPhase('track');
      const frames: Array<number[] | null> = [];
      let found = 0;
      let thumb: string | null = null;
      for (let i = 0; i < total; i++) {
        if (cancelRef.current) {
          landmarker.close();
          onClose();
          return;
        }
        const t = i / fps;
        await seekTo(video, Math.min(t, duration - 0.001));
        const res = landmarker.detectForVideo(video, Math.round(t * 1000) + 1);
        const world = res.worldLandmarks && res.worldLandmarks[0];
        const screen = res.landmarks && res.landmarks[0];
        if (world) {
          found++;
          const flat: number[] = [];
          for (const p of world) flat.push(+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4));
          frames.push(flat);
        } else frames.push(null);

        // Live preview: frame + 2D skeleton.
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (screen) {
          ctx.strokeStyle = '#f0a04b';
          ctx.lineWidth = 3;
          for (const [a, b] of PREVIEW_BONES) {
            ctx.beginPath();
            ctx.moveTo(screen[a].x * canvas.width, screen[a].y * canvas.height);
            ctx.lineTo(screen[b].x * canvas.width, screen[b].y * canvas.height);
            ctx.stroke();
          }
          ctx.fillStyle = '#fff';
          for (const p of screen) {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          if (!thumb && i >= total / 3) thumb = canvas.toDataURL('image/jpeg', 0.8);
        }
        setProgress((i + 1) / total);
        setMessage(`Đang học chuyển động… ${i + 1}/${total} khung hình (nhận ra người ở ${found})`);
      }
      landmarker.close();
      if (found < total * 0.2) throw new Error('Không nhận ra người trong phần lớn video. Hãy dùng video thấy rõ toàn thân một người.');

      setPhase('upload');
      setMessage('Đang lưu dữ liệu chuyển động…');
      const data: MotionData = { fps, frames, source: asset.prompt || 'video' };
      const motionUp = await api.uploadRaw(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'application/json');
      if (!thumb) thumb = canvas.toDataURL('image/jpeg', 0.8);
      const thumbUp = await api.uploadRaw(await dataUrlToBlob(thumb), 'image/jpeg');
      const p = await api.registerAsset(project.id, {
        kind: 'motion',
        src: motionUp.src,
        name: `Chuyển động: ${asset.prompt || 'video'}`,
        mode: 'motion',
        role: 'motion',
        duration: duration,
        thumb: thumbUp.src,
        sourceAssetId: asset.id,
        model: `mediapipe-pose-${variant}`,
      });
      onDone(p);
      setPhase('done');
      setMessage(`Xong: học được ${found}/${total} khung hình. Thêm “Chuyển động” vào cảnh để nhân vật 3D làm theo.`);
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message || String(e));
    }
  };

  const busy = phase === 'load' || phase === 'track' || phase === 'upload';

  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Học chuyển động từ video</h3>
          <button className="icon-btn" onClick={() => (busy ? (cancelRef.current = true) : onClose())} title={busy ? 'Huỷ' : 'Đóng'}>
            <IconX />
          </button>
        </div>
        {phase === 'setup' ? (
          <>
            <p className="muted small">
              MediaPipe Pose đọc từng khung hình và ghi lại vị trí 33 khớp cơ thể (đầu, vai, tay, hông, chân) của một người. Nhân vật 3D trên timeline sẽ làm theo đúng các động tác
              đó. Chạy trên máy bạn, miễn phí. Video nên thấy rõ toàn thân một người.
            </p>
            <div className="model-list">
              {VARIANTS.map((v) => (
                <label key={v.id} className={`model-opt ${variant === v.id ? 'on' : ''}`}>
                  <input type="radio" name="pose-variant" checked={variant === v.id} onChange={() => setVariant(v.id)} />
                  <span>
                    <b>{v.label}</b>
                    <span className="muted small">{v.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="row between field-row">
              <span>Số khung hình mỗi giây</span>
              <select className="select small" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={15}>15 (nhanh)</option>
                <option value={30}>30 (mượt)</option>
              </select>
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>
                Huỷ
              </button>
              <button className="btn primary" onClick={run}>
                Bắt đầu học
              </button>
            </div>
          </>
        ) : null}
        <canvas ref={canvasRef} className="pose-preview" hidden={phase === 'setup'} />
        {phase !== 'setup' ? (
          <>
            {busy ? (
              <div className="progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : null}
            <p className={phase === 'error' ? 'error-banner' : 'muted small'}>{message}</p>
            <div className="modal-actions">
              {busy ? (
                <button className="btn ghost" onClick={() => (cancelRef.current = true)}>
                  Huỷ
                </button>
              ) : (
                <button className="btn primary" onClick={onClose}>
                  Đóng
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};
