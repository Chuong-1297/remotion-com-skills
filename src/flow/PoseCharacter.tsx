import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_CHARACTER, FPS, MotionData, PoseOptions } from './types';
import { RiggedCharacter } from './RiggedCharacter';

// MediaPipe Pose landmark indices used for the character.
const L = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lIdx: 19, rIdx: 20, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 };
const LIMBS: Array<[number, number, number]> = [
  // [from, to, thickness multiplier]
  [L.lSh, L.lEl, 1], [L.lEl, L.lWr, 0.85], [L.lWr, L.lIdx, 0.6],
  [L.rSh, L.rEl, 1], [L.rEl, L.rWr, 0.85], [L.rWr, L.rIdx, 0.6],
  [L.lHip, L.lKn, 1.25], [L.lKn, L.lAn, 1.05], [L.lAn, L.lToe, 0.7], [L.lAn, L.lHeel, 0.6],
  [L.rHip, L.rKn, 1.25], [L.rKn, L.rAn, 1.05], [L.rAn, L.rToe, 0.7], [L.rAn, L.rHeel, 0.6],
  [L.lSh, L.rSh, 1.1], [L.lHip, L.rHip, 1.1], [L.lSh, L.lHip, 1.1], [L.rSh, L.rHip, 1.1],
];
const JOINTS = [L.lSh, L.rSh, L.lEl, L.rEl, L.lWr, L.rWr, L.lHip, L.rHip, L.lKn, L.rKn, L.lAn, L.rAn];

const cache = new Map<string, MotionData>();

export const useMotionData = (url: string) => {
  const [data, setData] = useState<MotionData | null>(() => cache.get(url) || null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => (cache.has(url) ? null : delayRender(`Loading motion ${url}`)));
  useEffect(() => {
    if (cache.has(url)) {
      setData(cache.get(url)!);
      if (handle !== null) continueRender(handle);
      return;
    }
    let alive = true;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Không tải được dữ liệu chuyển động (${r.status})`);
        return r.json();
      })
      .then((d: MotionData) => {
        cache.set(url, d);
        if (alive) setData(d);
        if (handle !== null) continueRender(handle);
      })
      .catch((e) => cancelRender(e));
    return () => {
      alive = false;
    };
  }, [url, handle, continueRender, cancelRender]);
  return data;
};

type V3 = [number, number, number];

/** Landmarks for a frame, averaged over neighbours to reduce jitter, converted to three.js axes. */
const poseAt = (data: MotionData, index: number, mirror: boolean): V3[] | null => {
  const out: V3[] = [];
  for (let j = 0; j < 33; j++) out.push([0, 0, 0]);
  let n = 0;
  for (let k = -2; k <= 2; k++) {
    const f = data.frames[Math.min(data.frames.length - 1, Math.max(0, index + k))];
    if (!f) continue;
    const w = k === 0 ? 2 : 1;
    for (let j = 0; j < 33; j++) {
      out[j][0] += (mirror ? -f[j * 3] : f[j * 3]) * w;
      out[j][1] += -f[j * 3 + 1] * w;
      out[j][2] += -f[j * 3 + 2] * w;
    }
    n += w;
  }
  if (!n) return null;
  return out.map((p) => [p[0] / n, p[1] / n, p[2] / n] as V3);
};

/** Height of the floor: a low percentile of the lowest joint over the whole clip. */
const floorOf = (data: MotionData) => {
  const lows: number[] = [];
  for (const f of data.frames) {
    if (!f) continue;
    let low = Infinity;
    for (let j = 25; j < 33; j++) low = Math.min(low, -f[j * 3 + 1]);
    lows.push(low);
  }
  if (!lows.length) return -1;
  lows.sort((a, b) => a - b);
  return lows[Math.floor(lows.length * 0.1)];
};

const up = new THREE.Vector3(0, 1, 0);

const Bone: React.FC<{ a: V3; b: V3; r: number; material: THREE.Material }> = ({ a, b, r, material }) => {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = Math.max(0.001, dir.length());
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
  const mid = va.add(vb).multiplyScalar(0.5);
  return (
    <mesh position={mid} quaternion={q} material={material}>
      <capsuleGeometry args={[r, len, 6, 12]} />
    </mesh>
  );
};

const CameraRig: React.FC<{ angle: number; target: V3 }> = ({ angle, target }) => {
  const camera = useThree((s) => s.camera);
  const a = (angle * Math.PI) / 180;
  // Narrow lens so the character fills the frame (default three.js fov is a wide 75°).
  const cam = camera as THREE.PerspectiveCamera;
  if (cam.isPerspectiveCamera) cam.fov = 35;
  camera.position.set(Math.sin(a) * 3.7 + target[0], 0.15 + target[1], Math.cos(a) * 3.7 + target[2]);
  camera.lookAt(target[0], target[1], target[2]);
  camera.updateProjectionMatrix();
  return null;
};

export const PoseCharacter: React.FC<{ src: string; trimBeforeFrames: number; options: PoseOptions; baseUrl: string }> = ({ src, trimBeforeFrames, options, baseUrl }) => {
  const data = useMotionData(src);
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const material = useMemo(() => {
    if (options.style === 'neon') return new THREE.MeshBasicMaterial({ color: options.color });
    if (options.style === 'wire') return new THREE.MeshBasicMaterial({ color: options.color, wireframe: true });
    return new THREE.MeshStandardMaterial({ color: options.color, roughness: 0.45, metalness: 0.15 });
  }, [options.style, options.color]);
  const jointMat = useMemo(
    () => (options.style === 'mannequin' ? new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 }) : material),
    [options.style, material],
  );
  const isRig = options.style === 'character';
  const charUrl = (() => { const c = options.characterSrc || DEFAULT_CHARACTER; return /^(https?:|data:|blob:)/.test(c) ? c : baseUrl + c; })();
  const floor = useMemo(() => (isRig ? 0 : data ? floorOf(data) : -1), [data, isRig]);

  if (!data) return null;
  const t = (trimBeforeFrames + frame) / FPS;
  const pose = poseAt(data, Math.round(t * data.fps), options.mirror);
  const thick = options.style === 'wire' ? 0.012 : options.style === 'neon' ? 0.022 : 0.045;

  let content: React.ReactNode = null;
  if (isRig) {
    content = <RiggedCharacter url={charUrl} pose={pose} />;
  } else if (pose) {
    const mid = (i: number, j: number): V3 => [(pose[i][0] + pose[j][0]) / 2, (pose[i][1] + pose[j][1]) / 2, (pose[i][2] + pose[j][2]) / 2];
    const neck = mid(L.lSh, L.rSh);
    const pelvis = mid(L.lHip, L.rHip);
    const ears = mid(L.lEar, L.rEar);
    const head: V3 = [ears[0] * 0.7 + pose[L.nose][0] * 0.3, ears[1] * 0.7 + pose[L.nose][1] * 0.3 + 0.03, ears[2] * 0.7 + pose[L.nose][2] * 0.3];
    content = (
      <group>
        {LIMBS.map(([a, b, k], i) => (
          <Bone key={i} a={pose[a]} b={pose[b]} r={thick * k} material={material} />
        ))}
        <Bone a={neck} b={pelvis} r={thick * (options.style === 'mannequin' ? 2.6 : 1.2)} material={material} />
        <Bone a={neck} b={head} r={thick * 0.8} material={material} />
        <mesh position={head} material={material}>
          <sphereGeometry args={[options.style === 'mannequin' ? 0.11 : 0.09, 24, 16]} />
        </mesh>
        {JOINTS.map((j) => (
          <mesh key={j} position={pose[j]} material={jointMat}>
            <sphereGeometry args={[thick * 1.25, 12, 10]} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <AbsoluteFill>
      <ThreeCanvas width={width} height={height} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ background: 'transparent' }}>
        <CameraRig angle={options.cameraAngle} target={isRig ? [0, 0.95, 0] : [0, Math.min(0, floor + 0.9), 0]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[2, 4, 3]} intensity={1.4} />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#8fb7ff" />
        <gridHelper args={[6, 24, '#666666', '#333333']} position={[0, floor, 0]} />
        {content}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
