import React, { useEffect, useState } from 'react';
import type { AspectRatio } from '../../src/flow/types';
import { api, ProjectSummary } from '../api';
import { IconPlus, IconSettings, IconSparkles, IconTrash } from '../icons';
import { SettingsDialog } from './SettingsDialog';

export const Home: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = () =>
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    try {
      const p = await api.createProject(name.trim() || 'Dự án mới', aspect);
      onOpen(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Xóa dự án này? Không thể hoàn tác.')) return;
    await api.deleteProject(id);
    load();
  };

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">
            <IconSparkles size={18} />
          </span>
          Flow Studio
        </div>
        <button className="btn ghost" onClick={() => setShowSettings(true)}>
          <IconSettings /> Cài đặt
        </button>
      </header>

      <section className="hero">
        <h1>Biến ý tưởng thành thước phim</h1>
        <p>Tạo clip bằng AI từ prompt và hình ảnh, rồi dựng cảnh, thêm chữ, chuyển cảnh và xuất MP4.</p>
        <div className="new-project">
          <input
            placeholder="Tên dự án mới…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <div className="seg">
            {(['16:9', '9:16'] as AspectRatio[]).map((a) => (
              <button key={a} className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>
                {a === '16:9' ? 'Ngang 16:9' : 'Dọc 9:16'}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={create}>
            <IconPlus /> Dự án mới
          </button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="project-grid">
        {projects === null ? <div className="muted">Đang tải…</div> : null}
        {projects && projects.length === 0 ? <div className="muted">Chưa có dự án nào. Tạo dự án đầu tiên ở trên.</div> : null}
        {projects &&
          projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
              <div className={`project-thumb ${p.aspect === '9:16' ? 'portrait' : ''}`}>
                {p.cover ? (
                  p.cover.kind === 'video' ? (
                    <video src={p.cover.src} muted preload="metadata" />
                  ) : (
                    <img src={p.cover.src} alt="" />
                  )
                ) : (
                  <IconSparkles size={28} />
                )}
              </div>
              <div className="project-meta">
                <div>
                  <div className="project-name">{p.name}</div>
                  <div className="muted small">
                    {p.aspect} · {p.assetCount} tệp · {new Date(p.updatedAt).toLocaleDateString('vi-VN')}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  title="Xóa dự án"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(p.id);
                  }}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </div>
          ))}
      </section>
      {showSettings ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}
    </div>
  );
};
