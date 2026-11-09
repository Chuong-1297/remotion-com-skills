// Shared data model for Flow Studio (used by the web app, the server and the Remotion compositions).
// Keep this file ES2015-compatible: the repo's root tsconfig uses lib es2015.

export type AspectRatio = '16:9' | '9:16';

export type KenBurns = 'none' | 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';

export type TransitionType = 'none' | 'fade' | 'slide' | 'wipe' | 'flip' | 'clockWipe' | 'iris';

export type TextAnimation = 'fade' | 'slideUp' | 'pop' | 'typewriter';

export type TextPosition = 'top' | 'center' | 'bottom';

export interface TextOverlay {
  content: string;
  position: TextPosition;
  animation: TextAnimation;
  color: string;
  size: number; // px at 1080p height
  background: boolean;
}

/** What is drawn behind a transparent clip (matted video or 3D motion character). */
export interface ClipBackground {
  type: 'none' | 'color' | 'media';
  color: string;
  src: string | null;
  mediaKind: 'image' | 'video' | null;
}

export type PoseStyle = 'character' | 'mannequin' | 'neon' | 'wire';

/** Default rigged character, built in Blender by blender/build_character.py. */
export const DEFAULT_CHARACTER = '/characters/flow-character.glb';

export interface PoseOptions {
  style: PoseStyle;
  color: string;
  mirror: boolean;
  cameraAngle: number; // degrees around the character
  characterSrc?: string | null; // rigged GLB for style 'character'
}

/** One frame of MediaPipe world landmarks: 33 joints, flattened [x,y,z,...] in meters (hip-centred). */
export interface MotionData {
  fps: number;
  frames: Array<number[] | null>;
  source: string;
}

/** A clip on the scene-builder timeline. Times are in seconds. */
export interface SceneClip {
  id: string;
  assetId: string | null;
  kind: 'video' | 'image' | 'motion';
  src: string; // "/media/xyz.mp4" (relative to the server)
  sourceDuration: number; // full length of the source video (images: 0)
  trimStart: number;
  trimEnd: number; // for videos: end point inside the source; for images: shown duration
  volume: number; // 0..1
  kenBurns: KenBurns;
  text: TextOverlay | null;
  transition: TransitionType; // transition INTO this clip from the previous one
  transitionDuration: number;
  // Optional, added for background removal and motion clips.
  alpha?: boolean; // video has a transparent background (matted foreground)
  baseSrc?: string | null; // opaque base layer paired with a matted foreground
  textBehind?: boolean; // draw the caption between base and foreground
  bg?: ClipBackground | null;
  pose?: PoseOptions | null;
}

export type GenMode = 'text' | 'frames' | 'ingredients' | 'extend' | 'image';

export type AssetRole = 'base' | 'foreground' | 'motion' | null;

export interface Asset {
  id: string;
  kind: 'video' | 'image' | 'motion' | 'character';
  status: 'pending' | 'done' | 'error';
  src: string | null;
  prompt: string;
  mode: GenMode | 'upload' | 'matte' | 'motion';
  model: string;
  aspect: AspectRatio;
  durationSec: number;
  error: string | null;
  createdAt: number;
  mock: boolean;
  canExtend: boolean;
  thumb?: string | null;
  role?: AssetRole;
  pairId?: string | null; // links a matted foreground with its base
  sourceAssetId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  aspect: AspectRatio;
  createdAt: number;
  updatedAt: number;
  assets: Asset[];
  clips: SceneClip[];
}

export const FPS = 30;

export const dimensionsFor = (aspect: AspectRatio, height = 720) => {
  if (aspect === '9:16') {
    return { width: height, height: Math.round((height * 16) / 9) };
  }
  return { width: Math.round((height * 16) / 9), height };
};

export const defaultBackground = (): ClipBackground => ({ type: 'color', color: '#101418', src: null, mediaKind: null });
export const defaultPose = (): PoseOptions => ({ style: 'character', color: '#f0a04b', mirror: false, cameraAngle: 0, characterSrc: null });

/** Length a clip occupies on the timeline, in seconds. */
export const clipLength = (c: SceneClip) => {
  if (c.kind === 'image') return Math.max(0.5, c.trimEnd);
  return Math.max(0.2, c.trimEnd - c.trimStart);
};

export interface TimelineItem {
  clip: SceneClip;
  durationInFrames: number;
  trimBeforeFrames: number;
  transitionFrames: number; // overlap with the previous clip (0 for the first)
}

export const buildTimeline = (clips: SceneClip[], fps = FPS): TimelineItem[] => {
  const items: TimelineItem[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const durationInFrames = Math.max(1, Math.round(clipLength(clip) * fps));
    let transitionFrames = 0;
    if (i > 0 && clip.transition !== 'none') {
      const prev = items[i - 1].durationInFrames;
      const wanted = Math.round(clip.transitionDuration * fps);
      transitionFrames = Math.max(0, Math.min(wanted, prev - 1, durationInFrames - 1));
    }
    items.push({
      clip,
      durationInFrames,
      trimBeforeFrames: clip.kind === 'image' ? 0 : Math.round(clip.trimStart * fps),
      transitionFrames,
    });
  }
  return items;
};

export const timelineDuration = (clips: SceneClip[], fps = FPS) => {
  const items = buildTimeline(clips, fps);
  let total = 0;
  for (const it of items) total += it.durationInFrames - it.transitionFrames;
  return Math.max(1, total);
};

export interface FlowTimelineProps {
  clips: SceneClip[];
  aspect: AspectRatio;
  baseUrl: string; // prefix for relative media URLs ("" in the browser, server origin when rendering)
  [key: string]: unknown;
}

export interface MockClipProps {
  prompt: string;
  imageSrc: string | null;
  seed: number;
  label: string;
  [key: string]: unknown;
}
