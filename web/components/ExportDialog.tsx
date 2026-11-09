import React, { useEffect, useState } from 'react';
import type { Project } from '../../src/flow/types';
import { api, RenderJob } from '../api';
import { IconDownload, IconX } from '../icons';

export const ExportDialog: React.FC<{ project: Project; onClose: () => void }> = ({ project, onClose }) => {
  const [height, setHeight] = useState(720);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status !== 'rendering') return;
    const t = window.setInterval(async () => {
      try {
        setJob(await api.renderStatus(job.id));
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [job]);

  const start = async () => {
    setError(null);
    try {
      // Make sure the latest timeline is saved before rendering.
      await api.updateProject(project.id, { clips: project.clips, aspect: project.aspect });
      setJob(await api.render(project.id, height));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Xuất video MP4</h3>
          <button className="icon-btn" onClick={onClose}>
            <IconX />
          </button>
        </div>
        {!job ? (
          <>
            <div className="seg">
              {[480, 720, 1080].map((h) => (
                <button key={h} className={height === h ? 'on' : ''} onClick={() => setHeight(h)}>
                  {h}p
                </button>
              ))}
            </div>
            <p className="muted small">Render bằng Remotion trên server: ghép các cảnh, cắt, chuyển cảnh và chữ thành một file MP4 (H.264).</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={start}>
                Bắt đầu render
              </button>
            </div>
          </>
        ) : job.status === 'rendering' ? (
          <>
            <div className="progress">
              <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
            <p className="muted small">Đang render… {Math.round(job.progress * 100)}% (lần đầu có thể mất thêm thời gian để đóng gói)</p>
          </>
        ) : job.status === 'done' && job.url ? (
          <>
            <video className="export-preview" src={job.url} controls />
            <div className="modal-actions">
              <a className="btn primary" href={job.url} download={`${project.name || 'video'}.mp4`}>
                <IconDownload /> Tải MP4
              </a>
            </div>
          </>
        ) : (
          <div className="error-banner">{job.error || 'Render thất bại'}</div>
        )}
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    </div>
  );
};
