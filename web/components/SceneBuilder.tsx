import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { FlowTimeline } from '../../src/flow/FlowTimeline';
import {
  ClipBackground,
  FPS,
  KenBurns,
  PoseOptions,
  PoseStyle,
  defaultBackground,
  defaultPose,
  Project,
  SceneClip,
  TextAnimation,
  TextOverlay,
  TextPosition,
  TransitionType,
  buildTimeline,
  clipLength,
  dimensionsFor,
  timelineDuration,
} from '../../src/flow/types';
import { fmtTime } from '../api';
import { IconCopy, IconFilm, IconImage, IconPerson, IconScissors, IconTrash, IconType } from '../icons';

const PX_PER_SEC = 46;

const TRANSITIONS: Array<[TransitionType, string]> = [
  ['none', 'Cắt thẳng'],
  ['fade', 'Mờ dần'],
  ['slide', 'Trượt'],
  ['wipe', 'Quét'],
  ['flip', 'Lật'],
  ['clockWipe', 'Quét đồng hồ'],
  ['iris', 'Mống mắt'],
];
const KEN_BURNS: Array<[KenBurns, string]> = [
  ['none', 'Đứng yên'],
  ['zoomIn', 'Phóng to chậm'],
  ['zoomOut', 'Thu nhỏ chậm'],
  ['panLeft', 'Lia sang trái'],
  ['panRight', 'Lia sang phải'],
];
const TEXT_ANIMS: Array<[TextAnimation, string]> = [
  ['fade', 'Hiện dần'],
  ['slideUp', 'Trượt lên'],
  ['pop', 'Bật ra'],
  ['typewriter', 'Đánh máy'],
];
const TEXT_POS: Array<[TextPosition, string]> = [
  ['top', 'Trên'],
  ['center', 'Giữa'],
  ['bottom', 'Dưới'],
];

const POSE_STYLES: Array<[PoseStyle, string]> = [
  ['mannequin', 'Ma-nơ-canh'],
  ['neon', 'Neon'],
  ['wire', 'Khung dây'],
];

const defaultText = (): TextOverlay => ({ content: 'Tiêu đề của bạn', position: 'bottom', animation: 'slideUp', color: '#ffffff', size: 64, background: false });
const newId = () => Math.random().toString(36).slice(2, 10);

interface Props {
  project: Project;
  setClips: (updater: (clips: SceneClip[]) => SceneClip[]) => void;
  onGoLibrary: () => void;
}

export const SceneBuilder: React.FC<Props> = ({ project, setClips, onGoLibrary }) => {
  const playerRef = useRef<PlayerRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(project.clips[0] ? project.clips[0].id : null);
  const [frame, setFrame] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  const clips = project.clips;
  const items = useMemo(() => buildTimeline(clips), [clips]);
  const duration = timelineDuration(clips);
  const dims = dimensionsFor(project.aspect, 1080);
  const inputProps = useMemo(() => ({ clips, aspect: project.aspect, baseUrl: '' }), [clips, project.aspect]);

  // Start frame of every clip on the output timeline.
  const starts = useMemo(() => {
    const out: number[] = [];
    let cursor = 0;
    items.forEach((it, i) => {
      if (i > 0) cursor -= it.transitionFrames;
      out.push(cursor);
      cursor += it.durationInFrames;
    });
    return out;
  }, [items]);

  // Pixel geometry of the timeline boxes, used to place the playhead.
  const boxes = useMemo(() => {
    let left = 12;
    return items.map((it, i) => {
      const trans = i > 0 ? it.transitionFrames : 0;
      const width = Math.max(56, ((it.durationInFrames - trans) / FPS) * PX_PER_SEC);
      const box = { left, width, from: starts[i] + trans, to: starts[i] + it.durationInFrames };
      left += width + 4;
      return box;
    });
  }, [items, starts]);
  const playheadLeft = (() => {
    for (const b of boxes) {
      if (frame < b.to) return b.left + (Math.max(0, frame - b.from) / Math.max(1, b.to - b.from)) * b.width;
    }
    const last = boxes[boxes.length - 1];
    return last ? last.left + last.width : 12;
  })();

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener('frameupdate', onFrame);
    return () => p.removeEventListener('frameupdate', onFrame);
  }, [clips.length]);

  const selectedIndex = clips.findIndex((c) => c.id === selectedId);
  const selected = selectedIndex >= 0 ? clips[selectedIndex] : null;

  const update = (id: string, patch: Partial<SceneClip>) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updateText = (id: string, patch: Partial<TextOverlay>) =>
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, text: { ...(c.text || defaultText()), ...patch } } : c)));

  const updatePose = (id: string, patch: Partial<PoseOptions>) =>
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, pose: { ...(c.pose || defaultPose()), ...patch } } : c)));
  const updateBg = (id: string, patch: Partial<ClipBackground>) =>
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, bg: { ...(c.bg || defaultBackground()), ...patch } } : c)));
  const bgAssets = project.assets.filter((a) => a.status === 'done' && a.src && (a.kind === 'image' || (a.kind === 'video' && a.role !== 'foreground')));
  const bgValue = (bg: ClipBackground | null | undefined) => {
    if (!bg || bg.type !== 'media') return 'color';
    const a = bgAssets.find((x) => x.src === bg.src);
    return a ? a.id : 'color';
  };
  const thumbOf = (c: SceneClip) => {
    const a = c.assetId ? project.assets.find((x) => x.id === c.assetId) : undefined;
    return a && a.thumb ? a.thumb : null;
  };

  const seekToClip = (i: number) => {
    setSelectedId(clips[i].id);
    if (playerRef.current) playerRef.current.seekTo(starts[i] + (items[i] ? items[i].transitionFrames : 0));
  };

  const remove = (id: string) => {
    setClips((cs) => cs.filter((c) => c.id !== id));
    setSelectedId(null);
  };

  const duplicate = (c: SceneClip) => {
    const copy = { ...c, id: newId(), text: c.text ? { ...c.text } : null };
    setClips((cs) => {
      const i = cs.findIndex((x) => x.id === c.id);
      const next = cs.slice();
      next.splice(i + 1, 0, copy);
      return next;
    });
    setSelectedId(copy.id);
  };

  // Split the selected clip at the playhead.
  const split = () => {
    if (!selected) return;
    const i = selectedIndex;
    const local = (frame - starts[i]) / FPS;
    const len = clipLength(selected);
    if (local <= 0.3 || local >= len - 0.3) return;
    const a: SceneClip = { ...selected };
    const b: SceneClip = { ...selected, id: newId(), transition: 'none', text: null };
    if (selected.kind !== 'image') {
      a.trimEnd = selected.trimStart + local;
      b.trimStart = selected.trimStart + local;
    } else {
      a.trimEnd = local;
      b.trimEnd = len - local;
    }
    setClips((cs) => {
      const next = cs.slice();
      next.splice(i, 1, a, b);
      return next;
    });
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setClips((cs) => {
      const from = cs.findIndex((c) => c.id === dragId);
      const to = cs.findIndex((c) => c.id === targetId);
      const next = cs.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragId(null);
  };

  const canSplit = selected ? (() => {
    const local = (frame - starts[selectedIndex]) / FPS;
    return local > 0.3 && local < clipLength(selected) - 0.3;
  })() : false;

  return (
    <div className="scene">
      <div className="scene-top">
        <div className={`player-box ${project.aspect === '9:16' ? 'portrait' : ''}`}>
          <Player
            ref={playerRef}
            component={FlowTimeline}
            inputProps={inputProps}
            durationInFrames={duration}
            fps={FPS}
            compositionWidth={dims.width}
            compositionHeight={dims.height}
            controls
            acknowledgeRemotionLicense
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        <aside className="inspector">
          {!selected ? (
            <div className="muted">
              {clips.length ? (
                'Chọn một cảnh trên timeline để chỉnh sửa.'
              ) : (
                <>
                  Timeline đang trống.{' '}
                  <button className="link" onClick={onGoLibrary}>
                    Mở Thư viện
                  </button>{' '}
                  và bấm "Thêm vào cảnh".
                </>
              )}
            </div>
          ) : (
            <>
              <div className="inspector-head">
                <h4>
                  Cảnh {selectedIndex + 1} · {selected.kind === 'motion' ? 'Nhân vật 3D' : selected.kind === 'video' ? (selected.alpha ? 'Video tách nền' : 'Video') : 'Ảnh'}
                </h4>
                <div className="row gap-s">
                  <button className="icon-btn" title="Tách tại vị trí phát" onClick={split} disabled={!canSplit}>
                    <IconScissors size={16} />
                  </button>
                  <button className="icon-btn" title="Nhân đôi" onClick={() => duplicate(selected)}>
                    <IconCopy size={16} />
                  </button>
                  <button className="icon-btn danger" title="Xóa khỏi timeline" onClick={() => remove(selected.id)}>
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>

              <section>
                <h5>Thời lượng</h5>
                {selected.kind !== 'image' ? (
                  <>
                    <Range
                      label="Cắt đầu"
                      value={selected.trimStart}
                      min={0}
                      max={Math.max(0, selected.trimEnd - 0.5)}
                      step={0.1}
                      fmt={(v) => `${v.toFixed(1)}s`}
                      onChange={(v) => update(selected.id, { trimStart: v })}
                    />
                    <Range
                      label="Cắt cuối"
                      value={selected.trimEnd}
                      min={selected.trimStart + 0.5}
                      max={selected.sourceDuration || selected.trimEnd}
                      step={0.1}
                      fmt={(v) => `${v.toFixed(1)}s`}
                      onChange={(v) => update(selected.id, { trimEnd: v })}
                    />
                    {selected.kind === 'video' ? <Range label="Âm lượng" value={selected.volume} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update(selected.id, { volume: v })} /> : null}
                  </>
                ) : (
                  <>
                    <Range label="Hiển thị" value={selected.trimEnd} min={1} max={15} step={0.5} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => update(selected.id, { trimEnd: v })} />
                    <Select label="Chuyển động" value={selected.kenBurns} options={KEN_BURNS} onChange={(v) => update(selected.id, { kenBurns: v })} />
                  </>
                )}
              </section>

              {selected.kind === 'motion' ? (
                <section>
                  <h5>
                    <IconPerson size={12} /> Nhân vật 3D
                  </h5>
                  <Select label="Kiểu" value={(selected.pose || defaultPose()).style} options={POSE_STYLES} onChange={(v) => updatePose(selected.id, { style: v })} />
                  <div className="row between field-row">
                    <span>Màu</span>
                    <input type="color" value={(selected.pose || defaultPose()).color} onChange={(e) => updatePose(selected.id, { color: e.target.value })} />
                  </div>
                  <Range
                    label="Góc máy"
                    value={(selected.pose || defaultPose()).cameraAngle}
                    min={-180}
                    max={180}
                    step={5}
                    fmt={(v) => `${v}°`}
                    onChange={(v) => updatePose(selected.id, { cameraAngle: v })}
                  />
                  <label className="row between field-row">
                    <span>Lật gương</span>
                    <input type="checkbox" checked={(selected.pose || defaultPose()).mirror} onChange={(e) => updatePose(selected.id, { mirror: e.target.checked })} />
                  </label>
                </section>
              ) : null}

              {selected.kind === 'motion' || selected.alpha ? (
                <section>
                  <h5>Nền phía sau</h5>
                  {selected.alpha && selected.baseSrc ? (
                    <label className="row between field-row">
                      <span>Chữ nằm sau người (giữ nền gốc)</span>
                      <input type="checkbox" checked={Boolean(selected.textBehind)} onChange={(e) => update(selected.id, { textBehind: e.target.checked })} />
                    </label>
                  ) : null}
                  {selected.textBehind && selected.baseSrc ? (
                    <div className="muted small">Đang dùng nền gốc của video. Thêm chữ ở mục bên dưới, chữ sẽ nằm giữa nền và người.</div>
                  ) : (
                    <>
                      <label className="row between field-row">
                        <span>Loại nền</span>
                        <select
                          className="select small"
                          value={bgValue(selected.bg)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'color') updateBg(selected.id, { type: 'color', src: null, mediaKind: null });
                            else {
                              const a = bgAssets.find((x) => x.id === v);
                              if (a) updateBg(selected.id, { type: 'media', src: a.src, mediaKind: a.kind === 'video' ? 'video' : 'image' });
                            }
                          }}
                        >
                          <option value="color">Màu trơn</option>
                          {bgAssets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.kind === 'video' ? 'Video: ' : 'Ảnh: '}
                              {(a.prompt || a.id).slice(0, 34)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!selected.bg || selected.bg.type === 'color' ? (
                        <div className="row between field-row">
                          <span>Màu nền</span>
                          <input type="color" value={(selected.bg || defaultBackground()).color} onChange={(e) => updateBg(selected.id, { type: 'color', color: e.target.value })} />
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              ) : null}

              <section>
                <h5>Chuyển cảnh vào</h5>
                {selectedIndex === 0 ? (
                  <div className="muted small">Cảnh đầu tiên không có chuyển cảnh.</div>
                ) : (
                  <>
                    <Select label="Kiểu" value={selected.transition} options={TRANSITIONS} onChange={(v) => update(selected.id, { transition: v })} />
                    {selected.transition !== 'none' ? (
                      <Range
                        label="Độ dài"
                        value={selected.transitionDuration}
                        min={0.2}
                        max={2}
                        step={0.1}
                        fmt={(v) => `${v.toFixed(1)}s`}
                        onChange={(v) => update(selected.id, { transitionDuration: v })}
                      />
                    ) : null}
                  </>
                )}
              </section>

              <section>
                <div className="row between">
                  <h5>Chữ trên cảnh</h5>
                  {selected.text ? (
                    <button className="link" onClick={() => update(selected.id, { text: null })}>
                      Bỏ chữ
                    </button>
                  ) : (
                    <button className="chip-btn" onClick={() => update(selected.id, { text: defaultText() })}>
                      <IconType size={14} /> Thêm chữ
                    </button>
                  )}
                </div>
                {selected.text ? (
                  <>
                    <textarea className="text-area" rows={2} value={selected.text.content} onChange={(e) => updateText(selected.id, { content: e.target.value })} />
                    <Select label="Vị trí" value={selected.text.position} options={TEXT_POS} onChange={(v) => updateText(selected.id, { position: v })} />
                    <Select label="Hiệu ứng" value={selected.text.animation} options={TEXT_ANIMS} onChange={(v) => updateText(selected.id, { animation: v })} />
                    <Range label="Cỡ chữ" value={selected.text.size} min={24} max={160} step={2} fmt={(v) => `${v}px`} onChange={(v) => updateText(selected.id, { size: v })} />
                    <div className="row between field-row">
                      <span>Màu</span>
                      <input type="color" value={selected.text.color} onChange={(e) => updateText(selected.id, { color: e.target.value })} />
                    </div>
                    <label className="row between field-row">
                      <span>Nền tối sau chữ</span>
                      <input type="checkbox" checked={selected.text.background} onChange={(e) => updateText(selected.id, { background: e.target.checked })} />
                    </label>
                  </>
                ) : null}
              </section>
            </>
          )}
        </aside>
      </div>

      <div className="timeline">
        <div className="timeline-head">
          <span className="muted small">
            {fmtTime(frame / FPS)} / {fmtTime(duration / FPS)} · {clips.length} cảnh · kéo thả để sắp xếp
          </span>
        </div>
        <div className="timeline-track">
          {clips.length ? (
            <div className="playhead" style={{ left: playheadLeft }} />
          ) : null}
          {items.map((it, i) => {
            const c = it.clip;
            const width = boxes[i].width;
            return (
              <div
                key={c.id}
                className={`tl-clip ${c.id === selectedId ? 'selected' : ''} ${dragId === c.id ? 'dragging' : ''}`}
                style={{ width }}
                draggable
                onDragStart={() => setDragId(c.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(c.id)}
                onClick={() => seekToClip(i)}
                title={`Cảnh ${i + 1}`}
              >
                {c.kind === 'motion' ? (
                  <img src={thumbOf(c) || undefined} alt="" />
                ) : c.kind === 'video' ? (
                  <video className={c.alpha ? 'checker' : ''} src={`${c.src}#t=${c.trimStart + 0.1}`} muted preload="metadata" />
                ) : (
                  <img src={c.src} alt="" />
                )}
                <div className="tl-info">
                  {c.kind === 'motion' ? <IconPerson size={12} /> : c.kind === 'video' ? <IconFilm size={12} /> : <IconImage size={12} />} {clipLength(c).toFixed(1)}s{c.text ? ' · chữ' : ''}
                </div>
                {i > 0 && c.transition !== 'none' ? <div className="tl-trans" title="Chuyển cảnh" /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function Range(props: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="range">
      <div className="row between">
        <span>{props.label}</span>
        <span className="muted">{props.fmt(props.value)}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

function Select<T extends string>(props: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <label className="row between field-row">
      <span>{props.label}</span>
      <select className="select small" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
