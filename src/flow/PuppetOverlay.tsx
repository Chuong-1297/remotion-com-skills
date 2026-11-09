import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { FPS, MotionData, Overlay } from './types';
import { useMotionData } from './PoseCharacter';

// 2D puppet: a cut-out character image deformed by a skeleton that follows learned motion.

type Pt = [number, number];
const M = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 };

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const ang = (a: Pt) => Math.atan2(a[1], a[0]);
const rot = (p: Pt, t: number): Pt => [p[0] * Math.cos(t) - p[1] * Math.sin(t), p[0] * Math.sin(t) + p[1] * Math.cos(t)];

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(1e-6, ab[0] * ab[0] + ab[1] * ab[1])));
  return len(sub(p, add(a, mul(ab, t))));
};

const inQuad = (p: Pt, q: Pt[]) => {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i][1] > p[1] !== q[j][1] > p[1] && p[0] < ((q[j][0] - q[i][0]) * (p[1] - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) inside = !inside;
  }
  return inside;
};

// Bones: 0 torso, 1 head, 2 L upper arm, 3 L forearm, 4 R upper arm, 5 R forearm, 6 L thigh, 7 L shin, 8 R thigh, 9 R shin.
interface RestBones {
  seg: Array<[Pt, Pt]>;
  pts: Pt[];
  height: number;
}

const restBones = (pts: Pt[]): RestBones => {
  const midHip = mid(pts[M.lHip], pts[M.rHip]);
  const midSh = mid(pts[M.lSh], pts[M.rSh]);
  const headTop = add(pts[M.nose], mul(sub(pts[M.nose], midSh), 0.9));
  const ext = (a: Pt, b: Pt, k: number) => add(b, mul(sub(b, a), k));
  const seg: Array<[Pt, Pt]> = [
    [midHip, midSh],
    [midSh, headTop],
    [pts[M.lSh], pts[M.lEl]],
    [pts[M.lEl], ext(pts[M.lEl], pts[M.lWr], 0.35)],
    [pts[M.rSh], pts[M.rEl]],
    [pts[M.rEl], ext(pts[M.rEl], pts[M.rWr], 0.35)],
    [pts[M.lHip], pts[M.lKn]],
    [pts[M.lKn], ext(pts[M.lKn], pts[M.lAn], 0.25)],
    [pts[M.rHip], pts[M.rKn]],
    [pts[M.rKn], ext(pts[M.rKn], pts[M.rAn], 0.25)],
  ];
  return { seg, pts, height: Math.max(1, Math.max(pts[M.lAn][1], pts[M.rAn][1]) - headTop[1]) };
};

interface PuppetMesh {
  rest: Float32Array; // x,y per vertex in image pixels
  uv: Float32Array;
  index: Uint32Array;
  weights: Float32Array; // 10 per vertex
}

const buildMesh = (alpha: Uint8ClampedArray, w: number, h: number, bones: RestBones): PuppetMesh => {
  const step = Math.max(3, Math.round(Math.max(w, h) / 80));
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const a = (x: number, y: number) => alpha[(Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4 + 3];
  const vid = new Int32Array(cols * rows).fill(-1);
  const rest: number[] = [];
  const index: number[] = [];
  const vert = (c: number, r: number) => {
    const k = r * cols + c;
    if (vid[k] < 0) {
      vid[k] = rest.length / 2;
      rest.push(Math.min(w, c * step), Math.min(h, r * step));
    }
    return vid[k];
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const x = c * step;
      const y = r * step;
      const solid = a(x + step / 2, y + step / 2) > 10 || a(x, y) > 10 || a(x + step, y) > 10 || a(x, y + step) > 10 || a(x + step, y + step) > 10;
      if (!solid) continue;
      const v00 = vert(c, r);
      const v10 = vert(c + 1, r);
      const v01 = vert(c, r + 1);
      const v11 = vert(c + 1, r + 1);
      index.push(v00, v01, v10, v10, v01, v11);
    }
  }
  const n = rest.length / 2;
  const uv = new Float32Array(n * 2);
  const weights = new Float32Array(n * 10);
  const sigma = bones.height * 0.05;
  const p = bones.pts;
  const torsoQuad: Pt[] = [p[M.lSh], p[M.rSh], p[M.rHip], p[M.lHip]];
  for (let i = 0; i < n; i++) {
    const v: Pt = [rest[i * 2], rest[i * 2 + 1]];
    uv[i * 2] = v[0] / w;
    uv[i * 2 + 1] = 1 - v[1] / h;
    const ws: number[] = bones.seg.map(([s0, s1]) => Math.exp(-Math.pow(segDist(v, s0, s1) / sigma, 2)) + 1e-9);
    if (inQuad(v, torsoQuad)) ws[0] *= 6; // keep the chest on the torso even when arms hang close
    // keep only the 3 strongest influences
    const order = ws.map((x, k) => [x, k] as [number, number]).sort((x, y) => y[0] - x[0]);
    let sum = 0;
    for (let k = 0; k < 3; k++) sum += order[k][0];
    for (let k = 0; k < 3; k++) weights[i * 10 + order[k][1]] = order[k][0] / sum;
  }
  return { rest: new Float32Array(rest), uv, index: new Uint32Array(index), weights };
};

/** Motion frame (2D, metres, y down) averaged over neighbours; loops over the clip. */
const motionPts = (data: MotionData, index: number, mirror: boolean): Pt[] | null => {
  const n = data.frames.length;
  if (!n) return null;
  const out: Pt[] = [];
  for (let j = 0; j < 33; j++) out.push([0, 0]);
  let total = 0;
  for (let k = -2; k <= 2; k++) {
    const f = data.frames[(((index + k) % n) + n) % n];
    if (!f) continue;
    const wgt = k === 0 ? 2 : 1;
    for (let j = 0; j < 33; j++) {
      const src = mirror ? (j >= 11 && j <= 32 ? (j % 2 === 1 ? j + 1 : j - 1) : j === 7 ? 8 : j === 8 ? 7 : j) : j;
      out[j][0] += (mirror ? -f[src * 3] : f[src * 3]) * wgt;
      out[j][1] += f[src * 3 + 1] * wgt;
    }
    total += wgt;
  }
  if (!total) return null;
  return out.map((q) => [q[0] / total, q[1] / total] as Pt);
};

interface BoneXf {
  t: number;
  a0: Pt;
  a1: Pt;
}
const apply = (x: BoneXf, p: Pt): Pt => add(x.a1, rot(sub(p, x.a0), x.t));

/** Per-bone transforms (image pixels) that pose the rest skeleton like the motion frame. */
const solve = (b: RestBones, m: Pt[]): BoneXf[] => {
  const p = b.pts;
  const midHip0 = mid(p[M.lHip], p[M.rHip]);
  const midSh0 = mid(p[M.lSh], p[M.rSh]);
  const mHip = mid(m[M.lHip], m[M.rHip]);
  const mSh = mid(m[M.lSh], m[M.rSh]);
  const mHead = mid(m[M.lEar], m[M.rEar]);
  const torso: BoneXf = { t: ang(sub(mSh, mHip)) - ang(sub(midSh0, midHip0)), a0: midHip0, a1: midHip0 };
  const neck = apply(torso, midSh0);
  const head: BoneXf = { t: ang(sub(mHead, mSh)) - ang(sub(mid(p[M.lEar], p[M.rEar]), midSh0)), a0: midSh0, a1: neck };
  const limb = (a0: Pt, b0: Pt, start: Pt, from: number, to: number): BoneXf => ({ t: ang(sub(m[to], m[from])) - ang(sub(b0, a0)), a0, a1: start });
  const lUp = limb(p[M.lSh], p[M.lEl], apply(torso, p[M.lSh]), M.lSh, M.lEl);
  const lFo = limb(p[M.lEl], p[M.lWr], apply(lUp, p[M.lEl]), M.lEl, M.lWr);
  const rUp = limb(p[M.rSh], p[M.rEl], apply(torso, p[M.rSh]), M.rSh, M.rEl);
  const rFo = limb(p[M.rEl], p[M.rWr], apply(rUp, p[M.rEl]), M.rEl, M.rWr);
  const lTh = limb(p[M.lHip], p[M.lKn], apply(torso, p[M.lHip]), M.lHip, M.lKn);
  const lSh = limb(p[M.lKn], p[M.lAn], apply(lTh, p[M.lKn]), M.lKn, M.lAn);
  const rTh = limb(p[M.rHip], p[M.rKn], apply(torso, p[M.rHip]), M.rHip, M.rKn);
  const rSh = limb(p[M.rKn], p[M.rAn], apply(rTh, p[M.rKn]), M.rKn, M.rAn);
  const all = [torso, head, lUp, lFo, rUp, rFo, lTh, lSh, rTh, rSh];
  // Keep the lowest foot on the ground line of the image.
  const footRest = Math.max(p[M.lAn][1], p[M.rAn][1]);
  const footNow = Math.max(apply(lSh, p[M.lAn])[1], apply(rSh, p[M.rAn])[1]);
  const dy = footRest - footNow;
  return all.map((x) => ({ ...x, a1: [x.a1[0], x.a1[1] + dy] as Pt }));
};

interface PuppetAssets {
  mesh: PuppetMesh;
  texture: THREE.Texture;
  w: number;
  h: number;
  bones: RestBones;
}

const assetCache = new Map<string, Promise<{ img: HTMLImageElement; texture: THREE.Texture }>>();
const loadImage = (url: string) => {
  let p = assetCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        resolve({ img, texture });
      };
      img.onerror = () => reject(new Error(`Không tải được ảnh nhân vật ${url}`));
      img.src = url;
    });
    assetCache.set(url, p);
    p.catch(() => assetCache.delete(url));
  }
  return p;
};

const usePuppet = (url: string, rigPts: number[]) => {
  const [assets, setAssets] = useState<PuppetAssets | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender(`Loading puppet ${url}`));
  const key = rigPts.join(',');
  useEffect(() => {
    let alive = true;
    loadImage(url)
      .then(({ img, texture }) => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const alpha = ctx.getImageData(0, 0, w, h).data;
        const pts: Pt[] = [];
        for (let j = 0; j < 33; j++) pts.push([rigPts[j * 2], rigPts[j * 2 + 1]]);
        const bones = restBones(pts);
        if (alive) setAssets({ mesh: buildMesh(alpha, w, h, bones), texture, w, h, bones });
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, handle]);
  return assets;
};

const PuppetMeshView: React.FC<{ assets: PuppetAssets; data: MotionData; o: Overlay; time: number }> = ({ assets, data, o, time }) => {
  const { width, height } = useVideoConfig();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((assets.mesh.rest.length / 2) * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(assets.mesh.uv, 2));
    g.setIndex(new THREE.BufferAttribute(assets.mesh.index, 1));
    return g;
  }, [assets]);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ map: assets.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    [assets],
  );

  const motion = o.motion!;
  const m = motionPts(data, Math.round((time + motion.offset) * data.fps), motion.mirror);
  const bones = assets.bones;
  // Motion metres → image pixels: only directions are used, lengths come from the picture.
  const xfs = m ? solve(bones, m) : null;

  const s = (o.height * height) / assets.h;
  const fx = (u: number) => o.x * width + (o.flip ? -(u - assets.w / 2) : u - assets.w / 2) * s - width / 2;
  const fy = (v: number) => height / 2 - (o.y * height - (assets.h - v) * s);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const { rest, weights } = assets.mesh;
  const nVerts = rest.length / 2;
  for (let i = 0; i < nVerts; i++) {
    const p: Pt = [rest[i * 2], rest[i * 2 + 1]];
    let x = p[0];
    let y = p[1];
    if (xfs) {
      x = 0;
      y = 0;
      for (let k = 0; k < 10; k++) {
        const wgt = weights[i * 10 + k];
        if (!wgt) continue;
        const q = apply(xfs[k], p);
        x += q[0] * wgt;
        y += q[1] * wgt;
      }
    }
    arr[i * 3] = fx(x);
    arr[i * 3 + 1] = fy(y);
    arr[i * 3 + 2] = 0;
  }
  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
};

export const PuppetOverlay: React.FC<{ o: Overlay; baseUrl: string; trimBeforeFrames: number }> = ({ o, baseUrl }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const resolve = (s: string) => (/^(https?:|data:|blob:)/.test(s) ? s : baseUrl + s);
  const data = useMotionData(resolve(o.motion!.src));
  const assets = usePuppet(resolve(o.src), o.motion!.rig.pts);

  const enter = spring({ frame: frame - 3, fps, config: { damping: 14, stiffness: 110 } });
  const opacity = o.enter === 'fade' ? interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' }) : o.enter === 'pop' ? Math.min(1, enter * 2) : 1;
  const scale = o.enter === 'pop' ? 0.6 + 0.4 * enter : 1;
  const dx = o.enter === 'slideLeft' ? (1 - enter) * -width * 0.6 : o.enter === 'slideRight' ? (1 - enter) * width * 0.6 : 0;
  const dy = o.enter === 'slideUp' ? (1 - enter) * height * 0.5 : 0;
  const filters = [`brightness(${o.brightness})`];
  if (o.shadow) filters.push(`drop-shadow(0 ${height * 0.012}px ${height * 0.025}px rgba(0,0,0,0.55))`);

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        transformOrigin: `${o.x * 100}% ${o.y * 100}%`,
        filter: filters.join(' '),
      }}
    >
      {assets && data ? (
        <ThreeCanvas width={width} height={height} orthographic camera={{ position: [0, 0, 10], near: 0.1, far: 100, zoom: 1 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
          <PuppetMeshView assets={assets} data={data} o={o} time={frame / FPS} />
        </ThreeCanvas>
      ) : null}
    </AbsoluteFill>
  );
};
