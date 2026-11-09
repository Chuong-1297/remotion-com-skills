import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { MockClipProps } from './types';

// Placeholder "generated" clip used in demo mode (no Gemini API key):
// animates the start image (or a gradient) and shows the prompt.
export const MockClip: React.FC<MockClipProps> = ({ prompt, imageSrc, seed, label }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, height } = useVideoConfig();
  const s = height / 1080;
  const p = interpolate(frame, [0, durationInFrames], [0, 1], { easing: Easing.inOut(Easing.quad) });
  const hueA = Math.floor(random(`a${seed}`) * 360);
  const hueB = (hueA + 60 + Math.floor(random(`b${seed}`) * 120)) % 360;
  const angle = 120 + p * 90;
  const textOpacity = interpolate(frame, [6, 20], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden', fontFamily: 'Inter, Arial, sans-serif' }}>
      {imageSrc ? (
        <Img
          src={imageSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.05 + 0.15 * p}) translateX(${(p - 0.5) * 4}%)` }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(${angle}deg, hsl(${hueA} 70% 35%), hsl(${hueB} 75% 18%))`,
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const x = random(`x${seed}${i}`) * 100;
            const y = random(`y${seed}${i}`) * 100;
            const r = (200 + random(`r${seed}${i}`) * 400) * s;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${x + Math.sin(p * 6 + i) * 6}%`,
                  top: `${y + Math.cos(p * 5 + i) * 6}%`,
                  width: r,
                  height: r,
                  borderRadius: '50%',
                  background: `hsla(${(hueA + i * 40) % 360}, 80%, 60%, 0.25)`,
                  filter: `blur(${60 * s}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            );
          })}
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ justifyContent: 'flex-end', padding: 48 * s }}>
        <div
          style={{
            opacity: textOpacity,
            background: 'rgba(0,0,0,0.5)',
            borderRadius: 18 * s,
            padding: `${18 * s}px ${26 * s}px`,
            color: 'white',
            fontSize: 30 * s,
            lineHeight: 1.35,
          }}
        >
          <div style={{ fontSize: 20 * s, letterSpacing: 2, color: '#7cc4ff', marginBottom: 8 * s }}>{label}</div>
          {prompt.length > 160 ? prompt.slice(0, 157) + '...' : prompt}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
