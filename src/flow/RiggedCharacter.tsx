import React, { useEffect, useMemo, useState } from 'react';
import { useDelayRender } from 'remotion';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Drives a rigged GLB character (made in Blender, or a Mixamo rig) from MediaPipe Pose world landmarks.

type V3 = [number, number, number];

// MediaPipe Pose indices.
const P = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lPinky: 17, rPinky: 18, lIdx: 19, rIdx: 20, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 };

// Bone name candidates (normalised: lower case, no "mixamorig" prefix, letters and digits only).
const NAMES: Record<string, string[]> = {
  hips: ['hips', 'pelvis', 'root'],
  spine: ['spine'],
  chest: ['chest', 'spine2', 'upperchest', 'spine1'],
  neck: ['neck'],
  head: ['head'],
  headTop: ['headtop', 'headtopend', 'headend'],
  lUpperArm: ['leftupperarm', 'leftarm', 'upperarml', 'upperarmleft'],
  lLowerArm: ['leftlowerarm', 'leftforearm', 'forearml', 'lowerarml'],
  lHand: ['lefthand', 'handl'],
  lHandTip: ['lefthandtip', 'lefthandmiddle1', 'lefthandindex1'],
  rUpperArm: ['rightupperarm', 'rightarm', 'upperarmr', 'upperarmright'],
  rLowerArm: ['rightlowerarm', 'rightforearm', 'forearmr', 'lowerarmr'],
  rHand: ['righthand', 'handr'],
  rHandTip: ['righthandtip', 'righthandmiddle1', 'righthandindex1'],
  lUpperLeg: ['leftupperleg', 'leftupleg', 'leftthigh', 'thighl'],
  lLowerLeg: ['leftlowerleg', 'leftleg', 'leftshin', 'shinl', 'calfl'],
  lFoot: ['leftfoot', 'footl'],
  lToe: ['lefttoe', 'lefttoebase', 'lefttoeend', 'toel'],
  rUpperLeg: ['rightupperleg', 'rightupleg', 'rightthigh', 'thighr'],
  rLowerLeg: ['rightlowerleg', 'rightleg', 'rightshin', 'shinr', 'calfr'],
  rFoot: ['rightfoot', 'footr'],
  rToe: ['righttoe', 'righttoebase', 'righttoeend', 'toer'],
};
const norm = (n: string) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

// Limb bones: [bone, child bone giving its rest direction, landmark from, landmark to (or midpoint pair)]
type LimbSpec = [string, string, number, number | [number, number]];
const LIMBS: LimbSpec[] = [
  ['lUpperArm', 'lLowerArm', P.lSh, P.lEl],
  ['lLowerArm', 'lHand', P.lEl, P.lWr],
  ['lHand', 'lHandTip', P.lWr, [P.lIdx, P.lPinky]],
  ['rUpperArm', 'rLowerArm', P.rSh, P.rEl],
  ['rLowerArm', 'rHand', P.rEl, P.rWr],
  ['rHand', 'rHandTip', P.rWr, [P.rIdx, P.rPinky]],
  ['lUpperLeg', 'lLowerLeg', P.lHip, P.lKn],
  ['lLowerLeg', 'lFoot', P.lKn, P.lAn],
  ['lFoot', 'lToe', P.lAn, P.lToe],
  ['rUpperLeg', 'rLowerLeg', P.rHip, P.rKn],
  ['rLowerLeg', 'rFoot', P.rKn, P.rAn],
  ['rFoot', 'rToe', P.rAn, P.rToe],
];

const gltfCache = new Map<string, Promise<THREE.Group>>();
const loadModel = (url: string) => {
  let p = gltfCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => g.scene);
    gltfCache.set(url, p);
    p.catch(() => gltfCache.delete(url));
  }
  return p;
};

interface Rig {
  root: THREE.Group;
  bones: Record<string, THREE.Bone>;
  restLocal: Map<THREE.Bone, THREE.Quaternion>;
  restWorldQ: Record<string, THREE.Quaternion>;
  restWorldP: Record<string, THREE.Vector3>;
  restHipHeight: number;
}

const buildRig = (source: THREE.Group, height: number): Rig => {
  const model = cloneSkinned(source) as THREE.Group;
  const root = new THREE.Group();
  root.add(model);
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.Mesh).isMesh) o.frustumCulled = false;
  });

  // Normalise size: stand on y=0, given height, centred on x/z.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 0 ? height / size.y : 1;
  root.scale.setScalar(s);
  root.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  root.updateMatrixWorld(true);

  const all: THREE.Bone[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) all.push(o as THREE.Bone);
  });
  const bones: Record<string, THREE.Bone> = {};
  for (const key of Object.keys(NAMES)) {
    for (const cand of NAMES[key]) {
      const b = all.find((x) => norm(x.name) === cand);
      if (b) {
        bones[key] = b;
        break;
      }
    }
  }
  const restLocal = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of all) restLocal.set(b, b.quaternion.clone());
  const restWorldQ: Record<string, THREE.Quaternion> = {};
  const restWorldP: Record<string, THREE.Vector3> = {};
  for (const k of Object.keys(bones)) {
    restWorldQ[k] = bones[k].getWorldQuaternion(new THREE.Quaternion());
    restWorldP[k] = bones[k].getWorldPosition(new THREE.Vector3());
  }
  const footY = Math.min(
    restWorldP.lFoot ? restWorldP.lFoot.y : 0,
    restWorldP.rFoot ? restWorldP.rFoot.y : 0,
  );
  const restHipHeight = restWorldP.hips ? restWorldP.hips.y - footY : height * 0.5;
  return { root, bones, restLocal, restWorldQ, restWorldP, restHipHeight };
};

const basis = (right: THREE.Vector3, up: THREE.Vector3) => {
  const x = right.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
};

/** Sets a bone's local rotation so that its world rotation becomes `world`. */
const setWorld = (bone: THREE.Bone, world: THREE.Quaternion) => {
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parentQ.invert().multiply(world));
  bone.updateMatrixWorld(true);
};

const applyPose = (rig: Rig, pose: V3[]) => {
  const { bones, restWorldQ, restWorldP } = rig;
  for (const [bone, q] of rig.restLocal) bone.quaternion.copy(q);
  rig.root.updateMatrixWorld(true);

  const v = (i: number) => new THREE.Vector3(pose[i][0], pose[i][1], pose[i][2]);
  const mid = (a: number, b: number) => v(a).add(v(b)).multiplyScalar(0.5);
  const midHip = mid(P.lHip, P.rHip);
  const midSh = mid(P.lSh, P.rSh);
  const headC = mid(P.lEar, P.rEar).lerp(v(P.nose), 0.3);
  const has = (...k: string[]) => k.every((x) => bones[x]);

  // Torso: full orientation from hip line / shoulder line + spine direction.
  const spineUp = midSh.clone().sub(midHip);
  if (has('hips', 'lUpperLeg', 'rUpperLeg')) {
    const restUp = (bones.chest ? restWorldP.chest : restWorldP.spine || restWorldP.hips.clone().add(new THREE.Vector3(0, 1, 0))).clone().sub(restWorldP.hips);
    const qR = basis(restWorldP.lUpperLeg.clone().sub(restWorldP.rUpperLeg), restUp);
    const qT = basis(v(P.lHip).sub(v(P.rHip)), spineUp);
    setWorld(bones.hips, qT.multiply(qR.invert()).multiply(restWorldQ.hips));
  }
  if (has('chest', 'lUpperArm', 'rUpperArm', 'neck')) {
    const from = restWorldP.spine || restWorldP.hips;
    const qR = basis(restWorldP.lUpperArm.clone().sub(restWorldP.rUpperArm), restWorldP.neck.clone().sub(from));
    const qT = basis(v(P.lSh).sub(v(P.rSh)), spineUp);
    setWorld(bones.chest, qT.multiply(qR.invert()).multiply(restWorldQ.chest));
  }
  if (has('neck', 'head')) {
    const restDir = restWorldP.head.clone().sub(restWorldP.neck).normalize();
    const dir = headC.clone().sub(midSh).normalize();
    setWorld(bones.neck, new THREE.Quaternion().setFromUnitVectors(restDir, dir).multiply(restWorldQ.neck));
  }
  if (has('head', 'headTop')) {
    const qR = basis(new THREE.Vector3(1, 0, 0), restWorldP.headTop.clone().sub(restWorldP.head));
    const qT = basis(v(P.lEar).sub(v(P.rEar)), headC.clone().sub(midSh));
    setWorld(bones.head, qT.multiply(qR.invert()).multiply(restWorldQ.head));
  }

  // Limbs: rotate each bone from its rest direction to the landmark direction.
  for (const [bone, child, a, b] of LIMBS) {
    if (!has(bone, child)) continue;
    const restDir = restWorldP[child].clone().sub(restWorldP[bone]).normalize();
    const to = Array.isArray(b) ? mid(b[0], b[1]) : v(b);
    const dir = to.sub(v(a));
    if (dir.lengthSq() < 1e-8) continue;
    setWorld(bones[bone], new THREE.Quaternion().setFromUnitVectors(restDir, dir.normalize()).multiply(restWorldQ[bone]));
  }

  // Crouch / sit: lower the body when the hips come closer to the feet.
  const lowestFoot = Math.min(pose[P.lAn][1], pose[P.rAn][1], pose[P.lHeel][1], pose[P.rHeel][1], pose[P.lToe][1], pose[P.rToe][1]);
  const hipHeight = midHip.y - lowestFoot;
  const scale = rig.restHipHeight / 0.95; // landmark metres vs character size
  const drop = Math.max(-0.9 * rig.restHipHeight, Math.min(0, hipHeight * scale - rig.restHipHeight));
  rig.root.userData.baseY = rig.root.userData.baseY ?? rig.root.position.y;
  rig.root.position.y = rig.root.userData.baseY + drop;
  rig.root.updateMatrixWorld(true);
};

export const useRig = (url: string, height = 1.75) => {
  const [source, setSource] = useState<THREE.Group | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender(`Loading character ${url}`));
  useEffect(() => {
    let alive = true;
    loadModel(url)
      .then((g) => {
        if (alive) setSource(g);
        continueRender(handle);
      })
      .catch((e) => cancelRender(new Error(`Không tải được nhân vật 3D (${url}): ${e && e.message ? e.message : e}`)));
    return () => {
      alive = false;
    };
  }, [url, handle, continueRender, cancelRender]);
  return useMemo(() => (source ? buildRig(source, height) : null), [source, height]);
};

export const RiggedCharacter: React.FC<{ url: string; pose: V3[] | null }> = ({ url, pose }) => {
  const rig = useRig(url);
  if (!rig) return null;
  if (pose) applyPose(rig, pose);
  return <primitive object={rig.root} />;
};
