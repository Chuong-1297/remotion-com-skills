import React, { useRef, useState } from 'react';
import type { Project } from '../../src/flow/types';
import { api, fileToDataUrl } from '../api';
import { IconUpload, IconX } from '../icons';

export const ImagePicker: React.FC<{
  project: Project;
  onPick: (src: string) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}> = ({ project, onPick, onClose, onError }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const images = project.assets.filter((a) => a.kind === 'image' && a.status === 'done' && a.src);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.upload(await fileToDataUrl(file), { projectId: project.id, name: file.name });
      onPick(res.src);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Chọn ảnh</h3>
          <button className="icon-btn" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <button className="dropzone" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}>
          <IconUpload size={22} />
          {uploading ? 'Đang tải lên…' : 'Tải ảnh từ máy tính'}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files ? e.target.files[0] : undefined)} />
        <div className="muted small" style={{ margin: '14px 0 8px' }}>
          Hoặc chọn từ thư viện dự án
        </div>
        {images.length === 0 ? <div className="muted small">Chưa có ảnh nào trong thư viện.</div> : null}
        <div className="picker-grid">
          {images.map((a) => (
            <button key={a.id} className="picker-item" onClick={() => onPick(a.src!)}>
              <img src={a.src!} alt={a.prompt} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
