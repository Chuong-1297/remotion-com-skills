import React, { useRef, useState } from 'react';
import type { Asset, Project } from '../../src/flow/types';
import { api, fileToDataUrl, probeVideoDuration } from '../api';
import { IconAlert, IconCopy, IconDownload, IconExpand, IconFrame, IconLayers, IconPerson, IconPlus, IconScissors, IconTrash, IconUpload, IconWand } from '../icons';

const modeLabel: Record<string, string> = {
  text: 'Văn bản → Video',
  frames: 'Khung hình → Video',
  ingredients: 'Thành phần → Video',
  extend: 'Kéo dài',
  image: 'Tạo ảnh',
  upload: 'Tải lên',
  matte: 'Tách nền',
  motion: 'Chuyển động',
  comfy: 'AI trên máy',
};

interface Props {
  project: Project;
  onAddToScene: (a: Asset) => void;
  onUseAsFrame: (a: Asset, slot: 'start' | 'end') => void;
  onUseAsIngredient: (a: Asset) => void;
  onExtend: (a: Asset) => void;
  onReuse: (a: Asset) => void;
  onDelete: (a: Asset) => void;
  onMatte: (a: Asset) => void;
  onLearnMotion: (a: Asset) => void;
  onLocalAI: () => void;
  onUploaded: (p: Project) => void;
  onError: (msg: string) => void;
}

export const Library: React.FC<Props> = (props) => {
  const { project } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<'all' | 'video' | 'image' | 'motion'>('all');
  const [uploading, setUploading] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (/\.glb$/i.test(f.name)) {
          const up = await api.uploadRaw(f, 'model/gltf-binary');
          await api.registerAsset(project.id, { kind: 'character', src: up.src, name: f.name.replace(/\.glb$/i, ''), mode: 'upload' });
          continue;
        }
        const dataUrl = await fileToDataUrl(f);
        const duration = f.type.startsWith('video/') ? await probeVideoDuration(URL.createObjectURL(f)) : 0;
        await api.upload(dataUrl, { projectId: project.id, name: f.name, duration });
      }
      props.onUploaded(await api.getProject(project.id));
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const assets = project.assets.filter((a) => filter === 'all' || a.kind === filter || (filter === 'motion' && a.kind === 'character'));

  return (
    <div className="library">
      <div className="library-toolbar">
        <div className="seg">
          {(
            [
              ['all', 'Tất cả'],
              ['video', 'Video'],
              ['image', 'Ảnh'],
              ['motion', 'Chuyển động'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn ghost" onClick={props.onLocalAI} title="Thay nhân vật / làm theo video bằng Wan Animate qua ComfyUI trên máy bạn">
          <IconPerson /> AI trên máy
        </button>
        <button className="btn ghost" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}>
          <IconUpload /> {uploading ? 'Đang tải lên…' : 'Tải tệp lên'}
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,.glb,model/gltf-binary" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>

      {assets.length === 0 ? (
        <div className="empty">
          <IconWand size={36} />
          <h3>Bắt đầu tạo cảnh đầu tiên</h3>
          <p className="muted">Mô tả cảnh quay ở khung bên dưới, hoặc tải ảnh lên để làm khung hình / thành phần.</p>
        </div>
      ) : (
        <div className={`asset-grid ${project.aspect === '9:16' ? 'portrait' : ''}`}>
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} {...props} />
          ))}
        </div>
      )}
    </div>
  );
};

const AssetCard: React.FC<{ asset: Asset } & Props> = ({ asset, onAddToScene, onUseAsFrame, onUseAsIngredient, onExtend, onReuse, onDelete, onMatte, onLearnMotion }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div className={`asset-card ${asset.status}`}>
      <div
        className={`asset-media ${asset.aspect === '9:16' ? 'portrait' : ''} ${asset.role === 'foreground' ? 'checker' : ''}`}
        onMouseEnter={() => videoRef.current && videoRef.current.play().catch(() => undefined)}
        onMouseLeave={() => {
          if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
          }
        }}
      >
        {asset.status === 'pending' ? (
          <div className="asset-pending">
            <div className="spinner" />
            <span>
              {asset.mode === 'comfy'
                ? `Đang chạy trên ComfyUI… ${Math.round((asset.progress || 0) * 100)}%`
                : asset.kind === 'image'
                  ? 'Đang tạo ảnh…'
                  : 'Đang tạo video… (1–3 phút)'}
            </span>
          </div>
        ) : asset.status === 'error' ? (
          <div className="asset-error">
            <IconAlert size={22} />
            <span>{asset.error}</span>
          </div>
        ) : asset.kind === 'character' ? (
          <div className="asset-pending">
            <IconPerson size={36} />
            <span>Nhân vật 3D (GLB) — chọn trong mục Nhân vật 3D của cảnh chuyển động</span>
          </div>
        ) : asset.kind === 'motion' ? (
          <img src={asset.thumb || undefined} alt={asset.prompt} />
        ) : asset.kind === 'video' ? (
          <video ref={videoRef} src={asset.src || undefined} muted loop playsInline preload="metadata" controls={false} />
        ) : (
          <img src={asset.src || undefined} alt={asset.prompt} />
        )}
        {asset.status === 'done' && asset.kind !== 'character' ? (
          <div className="asset-overlay">
            <button className="chip-btn primary" onClick={() => onAddToScene(asset)} title="Thêm vào timeline dựng cảnh">
              <IconPlus size={14} /> Thêm vào cảnh
            </button>
          </div>
        ) : null}
        <div className="asset-tags">
          <span className="tag">{modeLabel[asset.mode] || asset.mode}</span>
          {asset.mock ? <span className="tag warn">Demo</span> : null}
          {asset.role === 'foreground' ? <span className="tag">Nền trong suốt</span> : null}
          {asset.role === 'base' ? <span className="tag">Lớp nền gốc</span> : null}
          {asset.kind === 'motion' ? <span className="tag">3D · {asset.durationSec.toFixed(1)}s</span> : null}
          {asset.kind === 'character' ? <span className="tag">Nhân vật GLB</span> : null}
        </div>
      </div>
      <div className="asset-body">
        <p className="asset-prompt" title={asset.prompt}>
          {asset.prompt || '(không có prompt)'}
        </p>
        <div className="asset-actions">
          {asset.status === 'done' && asset.kind === 'image' ? (
            <>
              <button className="icon-btn" title="Dùng làm khung đầu" onClick={() => onUseAsFrame(asset, 'start')}>
                <IconFrame size={16} />
              </button>
              <button className="icon-btn" title="Dùng làm thành phần" onClick={() => onUseAsIngredient(asset)}>
                <IconLayers size={16} />
              </button>
              {asset.role !== 'foreground' ? (
                <button className="icon-btn" title="Tách nền nhân vật trong ảnh" onClick={() => onMatte(asset)}>
                  <IconScissors size={16} />
                </button>
              ) : null}
            </>
          ) : null}
          {asset.status === 'done' && asset.kind === 'video' ? (
            <>
              <button className="icon-btn" title="Lấy khung cuối làm khung đầu cảnh tiếp theo" onClick={() => onUseAsFrame(asset, 'start')}>
                <IconFrame size={16} />
              </button>
              {asset.role !== 'foreground' ? (
                <button className="icon-btn" title="Tách nền (người / vật thể)" onClick={() => onMatte(asset)}>
                  <IconScissors size={16} />
                </button>
              ) : null}
              {asset.role !== 'foreground' ? (
                <button className="icon-btn" title="Học chuyển động cho nhân vật 3D" onClick={() => onLearnMotion(asset)}>
                  <IconPerson size={16} />
                </button>
              ) : null}
              {asset.canExtend || asset.mock ? (
                <button className="icon-btn" title="Kéo dài clip (Veo)" onClick={() => onExtend(asset)}>
                  <IconExpand size={16} />
                </button>
              ) : null}
            </>
          ) : null}
          {asset.mode !== 'upload' && asset.mode !== 'matte' && asset.mode !== 'motion' ? (
            <button className="icon-btn" title="Dùng lại prompt" onClick={() => onReuse(asset)}>
              <IconCopy size={16} />
            </button>
          ) : null}
          {asset.src ? (
            <a className="icon-btn" title="Tải xuống" href={asset.src} download>
              <IconDownload size={16} />
            </a>
          ) : null}
          <button className="icon-btn danger" title="Xóa" onClick={() => onDelete(asset)}>
            <IconTrash size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
