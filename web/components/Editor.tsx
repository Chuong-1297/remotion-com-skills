import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, AspectRatio, Project, SceneClip } from '../../src/flow/types';
import { defaultBackground, defaultPose } from '../../src/flow/types';
import { api, grabVideoFrame, probeVideoDuration } from '../api';
import { IconArrowLeft, IconDownload, IconGrid, IconSettings, IconTimeline } from '../icons';
import { Composer, ComposerState, defaultComposer } from './Composer';
import { Library } from './Library';
import { SceneBuilder } from './SceneBuilder';
import { SettingsDialog } from './SettingsDialog';
import { ExportDialog } from './ExportDialog';
import { MatteDialog } from './MatteDialog';
import { MotionDialog } from './MotionDialog';

const newId = () => Math.random().toString(36).slice(2, 10);

export const Editor: React.FC<{ projectId: string; onBack: () => void }> = ({ projectId, onBack }) => {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'scene'>('library');
  const [composer, setComposer] = useState<ComposerState>(defaultComposer);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [matteAsset, setMatteAsset] = useState<Asset | null>(null);
  const [motionAsset, setMotionAsset] = useState<Asset | null>(null);
  const saveTimer = useRef<number | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    api
      .getProject(projectId)
      .then(setProject)
      .catch((e) => setError(e.message));
  }, [projectId]);

  // Poll while something is generating; only merge assets so local timeline edits are kept.
  const hasPending = Boolean(project && project.assets.some((a) => a.status === 'pending'));
  useEffect(() => {
    if (!hasPending) return;
    const t = window.setInterval(async () => {
      try {
        const fresh = await api.getProject(projectId);
        setProject((p) => (p ? { ...p, assets: fresh.assets } : fresh));
      } catch {
        /* retry next tick */
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [hasPending, projectId]);

  const persist = useCallback(
    (patch: { name?: string; aspect?: AspectRatio; clips?: SceneClip[] }) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.updateProject(projectId, patch).catch((e) => setError(e.message));
      }, 400);
    },
    [projectId],
  );

  const setClips = useCallback(
    (updater: (clips: SceneClip[]) => SceneClip[]) => {
      setProject((p) => {
        if (!p) return p;
        const clips = updater(p.clips);
        persist({ clips });
        return { ...p, clips };
      });
    },
    [persist],
  );

  if (error && !project) {
    return (
      <div className="center-screen">
        <div className="error-banner">{error}</div>
        <button className="btn" onClick={onBack}>
          Quay lại
        </button>
      </div>
    );
  }
  if (!project) return <div className="center-screen muted">Đang tải dự án…</div>;

  const addToScene = async (asset: Asset) => {
    if (!asset.src) return;
    let duration = asset.durationSec;
    if (asset.kind === 'video') duration = (await probeVideoDuration(asset.src)) || asset.durationSec || 8;
    const timed = asset.kind !== 'image';
    const isFg = asset.kind === 'video' && asset.role === 'foreground';
    const base = isFg && asset.pairId ? project.assets.find((a) => a.pairId === asset.pairId && a.role === 'base') : undefined;
    if (asset.kind === 'character') return;
    const clip: SceneClip = {
      id: newId(),
      assetId: asset.id,
      kind: asset.kind,
      src: asset.src,
      sourceDuration: timed ? duration : 0,
      trimStart: 0,
      trimEnd: timed ? duration : 4,
      volume: 1,
      kenBurns: asset.kind === 'image' ? 'zoomIn' : 'none',
      text: null,
      transition: project.clips.length ? 'fade' : 'none',
      transitionDuration: 0.5,
      alpha: isFg,
      baseSrc: base && base.src ? base.src : null,
      textBehind: false,
      bg: isFg || asset.kind === 'motion' ? defaultBackground() : null,
      pose: asset.kind === 'motion' ? defaultPose() : null,
    };
    setClips((c) => [...c, clip]);
    flash('Đã thêm vào cảnh');
  };

  const useAsFrame = async (asset: Asset, slot: 'start' | 'end') => {
    if (!asset.src) return;
    let src = asset.src;
    if (asset.kind === 'video') {
      try {
        const dataUrl = await grabVideoFrame(asset.src, 'end');
        src = (await api.upload(dataUrl)).src;
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setComposer((c) => ({ ...c, mode: 'frames', [slot === 'start' ? 'startImage' : 'endImage']: src }));
    flash(slot === 'start' ? 'Đã đặt làm khung đầu' : 'Đã đặt làm khung cuối');
  };

  const useAsIngredient = (asset: Asset) => {
    if (!asset.src || asset.kind !== 'image') return;
    setComposer((c) => ({
      ...c,
      mode: c.mode === 'image' ? 'image' : 'ingredients',
      refImages: c.refImages.indexOf(asset.src!) >= 0 ? c.refImages : [...c.refImages, asset.src!].slice(-3),
    }));
    flash('Đã thêm vào thành phần');
  };

  const extend = (asset: Asset) => {
    setComposer((c) => ({ ...c, mode: 'extend', extendAssetId: asset.id, prompt: '' }));
    flash('Nhập mô tả cho đoạn kéo dài rồi bấm Tạo');
  };

  const reuse = (asset: Asset) => {
    setComposer((c) => ({ ...c, prompt: asset.prompt }));
  };

  const deleteAsset = async (asset: Asset) => {
    const p = await api.deleteAsset(project.id, asset.id);
    setProject((cur) => (cur ? { ...cur, assets: p.assets } : p));
  };

  const pendingCount = project.assets.filter((a) => a.status === 'pending').length;

  return (
    <div className="editor">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" onClick={onBack} title="Về danh sách dự án">
            <IconArrowLeft />
          </button>
          <input
            className="title-input"
            value={project.name}
            onChange={(e) => {
              const name = e.target.value;
              setProject({ ...project, name });
              persist({ name });
            }}
          />
          <select
            className="select small"
            value={project.aspect}
            onChange={(e) => {
              const aspect = e.target.value as AspectRatio;
              setProject({ ...project, aspect });
              persist({ aspect });
            }}
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </div>
        <div className="tabs">
          <button className={view === 'library' ? 'on' : ''} onClick={() => setView('library')}>
            <IconGrid size={16} /> Thư viện{pendingCount ? <span className="badge">{pendingCount}</span> : null}
          </button>
          <button className={view === 'scene' ? 'on' : ''} onClick={() => setView('scene')}>
            <IconTimeline size={16} /> Dựng cảnh{project.clips.length ? <span className="badge">{project.clips.length}</span> : null}
          </button>
        </div>
        <div className="topbar-right">
          <button className="icon-btn" title="Cài đặt" onClick={() => setShowSettings(true)}>
            <IconSettings />
          </button>
          <button className="btn primary" disabled={!project.clips.length} onClick={() => setShowExport(true)}>
            <IconDownload /> Xuất video
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner floating" onClick={() => setError(null)}>
          {error}
        </div>
      ) : null}

      <main className={`editor-main ${view}`}>
        {view === 'library' ? (
          <Library
            project={project}
            onAddToScene={addToScene}
            onUseAsFrame={useAsFrame}
            onUseAsIngredient={useAsIngredient}
            onExtend={extend}
            onReuse={reuse}
            onDelete={deleteAsset}
            onMatte={setMatteAsset}
            onLearnMotion={setMotionAsset}
            onUploaded={(p) => setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))}
            onError={setError}
          />
        ) : (
          <SceneBuilder project={project} setClips={setClips} onGoLibrary={() => setView('library')} />
        )}
      </main>

      {view === 'library' ? (
        <Composer
          project={project}
          state={composer}
          setState={setComposer}
          onGenerated={(p) => setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))}
          onError={setError}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
      {showSettings ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}
      {showExport ? <ExportDialog project={project} onClose={() => setShowExport(false)} /> : null}
      {matteAsset ? (
        <MatteDialog
          project={project}
          asset={matteAsset}
          onClose={() => setMatteAsset(null)}
          onDone={(p) => setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))}
        />
      ) : null}
      {motionAsset ? (
        <MotionDialog
          project={project}
          asset={motionAsset}
          onClose={() => setMotionAsset(null)}
          onDone={(p) => setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))}
        />
      ) : null}
    </div>
  );
};
