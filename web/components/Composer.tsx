import React, { useEffect, useState } from 'react';
import type { GenMode, Project } from '../../src/flow/types';
import { api, getApiKey } from '../api';
import { IconArrowRight, IconExpand, IconFrame, IconImage, IconLayers, IconPlus, IconSettings, IconType, IconX } from '../icons';
import { ImagePicker } from './ImagePicker';

export interface ComposerState {
  mode: GenMode;
  prompt: string;
  startImage: string | null;
  endImage: string | null;
  refImages: string[];
  extendAssetId: string | null;
  videoModel: string;
  imageModel: string;
  duration: number;
  count: number;
  resolution: string;
  negativePrompt: string;
}

export const defaultComposer: ComposerState = {
  mode: 'text',
  prompt: '',
  startImage: null,
  endImage: null,
  refImages: [],
  extendAssetId: null,
  videoModel: 'veo-3.1-fast-generate-preview',
  imageModel: 'gemini-2.5-flash-image',
  duration: 8,
  count: 1,
  resolution: '720p',
  negativePrompt: '',
};

const VIDEO_MODELS = [
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', note: 'Nhanh, có âm thanh' },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1', note: 'Chất lượng cao nhất' },
  { id: 'veo-3.0-fast-generate-001', label: 'Veo 3 Fast', note: '' },
  { id: 'veo-3.0-generate-001', label: 'Veo 3', note: '' },
  { id: 'veo-2.0-generate-001', label: 'Veo 2', note: 'Không có âm thanh' },
];
const IMAGE_MODELS = [{ id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }];

const MODES: Array<{ id: GenMode; label: string; icon: React.FC<{ size?: number }>; hint: string }> = [
  { id: 'text', label: 'Văn bản → Video', icon: IconType, hint: 'Mô tả cảnh quay: chủ thể, hành động, góc máy, ánh sáng, âm thanh…' },
  { id: 'frames', label: 'Khung hình → Video', icon: IconFrame, hint: 'Mô tả chuyển động từ khung đầu (tới khung cuối nếu có)…' },
  { id: 'ingredients', label: 'Thành phần → Video', icon: IconLayers, hint: 'Mô tả cảnh có sử dụng nhân vật / đồ vật trong ảnh thành phần…' },
  { id: 'image', label: 'Tạo ảnh', icon: IconImage, hint: 'Mô tả ảnh cần tạo (có thể kèm ảnh tham chiếu để chỉnh sửa)…' },
];

interface Props {
  project: Project;
  state: ComposerState;
  setState: React.Dispatch<React.SetStateAction<ComposerState>>;
  onGenerated: (p: Project) => void;
  onError: (msg: string) => void;
}

type PickTarget = { kind: 'start' } | { kind: 'end' } | { kind: 'ref' };

export const Composer: React.FC<Props> = ({ project, state, setState, onGenerated, onError }) => {
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [serverKey, setServerKey] = useState(false);
  const set = (patch: Partial<ComposerState>) => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    api
      .config()
      .then((c) => setServerKey(c.serverKey))
      .catch(() => undefined);
  }, []);

  const extendAsset = state.extendAssetId ? project.assets.find((a) => a.id === state.extendAssetId) : undefined;
  const mode = state.mode;
  const isVideo = mode !== 'image';
  const hint = mode === 'extend' ? 'Mô tả điều xảy ra tiếp theo trong đoạn kéo dài…' : (MODES.find((m) => m.id === mode) || MODES[0]).hint;

  const canSubmit =
    !busy &&
    (mode === 'text' || mode === 'image'
      ? state.prompt.trim().length > 0
      : mode === 'frames'
        ? Boolean(state.startImage)
        : mode === 'ingredients'
          ? state.refImages.length > 0 && state.prompt.trim().length > 0
          : Boolean(extendAsset));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const p = await api.generate(project.id, {
        mode,
        prompt: state.prompt.trim(),
        model: isVideo ? (mode === 'ingredients' && state.videoModel.indexOf('veo-3.1') < 0 ? 'veo-3.1-generate-preview' : state.videoModel) : state.imageModel,
        aspect: project.aspect,
        duration: state.duration,
        count: mode === 'extend' ? 1 : state.count,
        negativePrompt: state.negativePrompt.trim() || undefined,
        resolution: state.resolution,
        startImage: mode === 'frames' ? state.startImage : null,
        endImage: mode === 'frames' ? state.endImage : null,
        refImages: mode === 'ingredients' || mode === 'image' ? state.refImages : [],
        sourceAssetId: mode === 'extend' ? state.extendAssetId : null,
      });
      onGenerated(p);
      set({ prompt: mode === 'extend' ? '' : state.prompt, ...(mode === 'extend' ? { mode: 'text' as GenMode, extendAssetId: null } : {}) });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onPicked = (src: string) => {
    if (!pick) return;
    if (pick.kind === 'start') set({ startImage: src });
    if (pick.kind === 'end') set({ endImage: src });
    if (pick.kind === 'ref') set({ refImages: [...state.refImages, src].slice(0, 3) });
    setPick(null);
  };

  const modelLabel = isVideo
    ? (VIDEO_MODELS.find((m) => m.id === state.videoModel) || VIDEO_MODELS[0]).label
    : (IMAGE_MODELS.find((m) => m.id === state.imageModel) || IMAGE_MODELS[0]).label;
  const usingDemo = !getApiKey() && !serverKey;

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer-modes">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => set({ mode: m.id, extendAssetId: null })}>
              <m.icon size={15} /> {m.label}
            </button>
          ))}
          {mode === 'extend' ? (
            <button className="on">
              <IconExpand size={15} /> Kéo dài clip
            </button>
          ) : null}
        </div>

        {mode === 'frames' ? (
          <div className="slots">
            <Slot label="Khung đầu" src={state.startImage} onPick={() => setPick({ kind: 'start' })} onClear={() => set({ startImage: null })} />
            <IconArrowRight size={16} className="muted" />
            <Slot label="Khung cuối (tuỳ chọn)" src={state.endImage} onPick={() => setPick({ kind: 'end' })} onClear={() => set({ endImage: null })} />
          </div>
        ) : null}

        {mode === 'ingredients' || mode === 'image' ? (
          <div className="slots">
            {state.refImages.map((src, i) => (
              <Slot
                key={src + i}
                label={`${mode === 'image' ? 'Tham chiếu' : 'Thành phần'} ${i + 1}`}
                src={src}
                onPick={() => undefined}
                onClear={() => set({ refImages: state.refImages.filter((_, j) => j !== i) })}
              />
            ))}
            {state.refImages.length < 3 ? (
              <Slot label={mode === 'image' ? 'Ảnh tham chiếu (tuỳ chọn)' : 'Thêm thành phần'} src={null} onPick={() => setPick({ kind: 'ref' })} onClear={() => undefined} />
            ) : null}
          </div>
        ) : null}

        {mode === 'extend' ? (
          <div className="slots">
            {extendAsset && extendAsset.src ? (
              <div className="slot filled">
                <video src={extendAsset.src} muted preload="metadata" />
                <span className="slot-label">Clip gốc</span>
              </div>
            ) : (
              <div className="muted small">Chọn "Kéo dài" trên một clip trong thư viện.</div>
            )}
            <span className="muted small">Veo sẽ nối thêm ~7 giây vào cuối clip (chỉ clip do Veo tạo trong 2 ngày gần đây, 720p).</span>
          </div>
        ) : null}

        <div className="composer-input">
          <textarea
            placeholder={hint}
            value={state.prompt}
            rows={2}
            onChange={(e) => set({ prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="composer-side">
            <button className="chip-btn" onClick={() => setShowOptions((v) => !v)} title="Tuỳ chọn">
              <IconSettings size={14} /> {modelLabel}
              {isVideo && mode !== 'extend' ? ` · ${state.duration}s` : ''}
              {mode !== 'extend' ? ` · x${state.count}` : ''}
            </button>
            <button className="btn primary generate" disabled={!canSubmit} onClick={submit} title="Ctrl/Cmd + Enter">
              <IconArrowRight /> {busy ? 'Đang gửi…' : 'Tạo'}
            </button>
          </div>
        </div>
        {usingDemo ? <div className="demo-note">Chế độ Demo: chưa có Gemini API key nên clip được giả lập bằng Remotion. Nhập key trong Cài đặt để tạo bằng Veo.</div> : null}

        {showOptions ? (
          <div className="options">
            {isVideo ? (
              <>
                <label className="field">
                  <span>Model video</span>
                  <select className="select" value={state.videoModel} onChange={(e) => set({ videoModel: e.target.value })}>
                    {VIDEO_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                        {m.note ? ` — ${m.note}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Thời lượng</span>
                  <select className="select" value={state.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>
                    {(state.videoModel.indexOf('veo-2') === 0 ? [5, 6, 7, 8] : [4, 6, 8]).map((d) => (
                      <option key={d} value={d}>
                        {d} giây
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Độ phân giải</span>
                  <select className="select" value={state.resolution} onChange={(e) => set({ resolution: e.target.value })}>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p (Veo 3+, 8 giây)</option>
                  </select>
                </label>
              </>
            ) : (
              <label className="field">
                <span>Model ảnh</span>
                <select className="select" value={state.imageModel} onChange={(e) => set({ imageModel: e.target.value })}>
                  {IMAGE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Số kết quả</span>
              <select className="select" value={state.count} onChange={(e) => set({ count: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {isVideo ? (
              <label className="field grow">
                <span>Prompt phủ định (tránh)</span>
                <input value={state.negativePrompt} placeholder="vd: chữ, logo, mờ nhoè" onChange={(e) => set({ negativePrompt: e.target.value })} />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      {pick ? <ImagePicker project={project} onPick={onPicked} onClose={() => setPick(null)} onError={onError} /> : null}
    </div>
  );
};

const Slot: React.FC<{ label: string; src: string | null; onPick: () => void; onClear: () => void }> = ({ label, src, onPick, onClear }) =>
  src ? (
    <div className="slot filled">
      <img src={src} alt="" />
      <span className="slot-label">{label}</span>
      <button className="slot-clear" onClick={onClear} title="Bỏ">
        <IconX size={12} />
      </button>
    </div>
  ) : (
    <button className="slot" onClick={onPick}>
      <IconPlus size={18} />
      <span className="slot-label">{label}</span>
    </button>
  );
