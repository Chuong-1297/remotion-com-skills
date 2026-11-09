import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming, TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { iris } from '@remotion/transitions/iris';
import { ClipBackground, FlowTimelineProps, Overlay, KenBurns, SceneClip, TextOverlay, TransitionType, buildTimeline, defaultPose } from './types';
import { PoseCharacter } from './PoseCharacter';
import { PuppetOverlay } from './PuppetOverlay';

const resolveSrc = (src: string, baseUrl: string) => (/^(https?:|data:|blob:)/.test(src) ? src : baseUrl + src);

const KenBurnsImage: React.FC<{ src: string; mode: KenBurns; transparent?: boolean; fit?: 'cover' | 'contain' }> = ({ src, mode, transparent, fit }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });
  let transform = 'none';
  if (mode === 'zoomIn') transform = `scale(${1 + 0.15 * p})`;
  if (mode === 'zoomOut') transform = `scale(${1.15 - 0.15 * p})`;
  if (mode === 'panLeft') transform = `scale(1.15) translateX(${interpolate(p, [0, 1], [5, -5])}%)`;
  if (mode === 'panRight') transform = `scale(1.15) translateX(${interpolate(p, [0, 1], [-5, 5])}%)`;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: transparent ? 'transparent' : '#000' }}>
      <Img src={src} style={{ width: '100%', height: '100%', objectFit: fit || 'cover', transform }} />
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ text: TextOverlay }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const scale = height / 1080;
  const enter = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 90 } });

  let opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  let transform = 'none';
  let content = text.content;
  if (text.animation === 'slideUp') {
    opacity = enter;
    transform = `translateY(${(1 - enter) * 40 * scale}px)`;
  } else if (text.animation === 'pop') {
    opacity = Math.min(1, enter * 1.5);
    transform = `scale(${0.7 + 0.3 * enter})`;
  } else if (text.animation === 'typewriter') {
    opacity = 1;
    const chars = Math.floor(interpolate(frame, [4, 4 + text.content.length * 1.5], [0, text.content.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }));
    content = text.content.slice(0, chars);
  }

  const justify = text.position === 'top' ? 'flex-start' : text.position === 'center' ? 'center' : 'flex-end';
  return (
    <AbsoluteFill style={{ justifyContent: justify, alignItems: 'center', padding: 80 * scale }}>
      <div
        style={{
          opacity,
          transform,
          color: text.color,
          fontSize: text.size * scale,
          fontWeight: 700,
          fontFamily: 'Inter, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '90%',
          whiteSpace: 'pre-wrap',
          textShadow: text.background ? 'none' : '0 4px 24px rgba(0,0,0,0.6)',
          backgroundColor: text.background ? 'rgba(0,0,0,0.55)' : 'transparent',
          padding: text.background ? `${14 * scale}px ${28 * scale}px` : 0,
          borderRadius: 16 * scale,
        }}
      >
        {content}
      </div>
    </AbsoluteFill>
  );
};

const OverlayItem: React.FC<{ o: Overlay; baseUrl: string }> = ({ o, baseUrl }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const enter = spring({ frame: frame - 3, fps, config: { damping: 14, stiffness: 110 } });
  let opacity = 1;
  let dx = 0;
  let dy = 0;
  let scale = 1;
  if (o.enter === 'fade') opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  if (o.enter === 'pop') {
    scale = 0.6 + 0.4 * enter;
    opacity = Math.min(1, enter * 2);
  }
  if (o.enter === 'slideLeft') dx = (1 - enter) * -width * 0.6;
  if (o.enter === 'slideRight') dx = (1 - enter) * width * 0.6;
  if (o.enter === 'slideUp') dy = (1 - enter) * height * 0.5;
  let rot = o.rotation;
  if (o.idle === 'bob') dy += Math.sin((frame / fps) * Math.PI * 1.2) * height * 0.012;
  if (o.idle === 'breathe') scale *= 1 + Math.sin((frame / fps) * Math.PI * 0.8) * 0.015;
  if (o.idle === 'sway') rot += Math.sin((frame / fps) * Math.PI * 0.9) * 3;
  const h = o.height * height;
  const filters = [`brightness(${o.brightness})`];
  if (o.shadow) filters.push(`drop-shadow(0 ${h * 0.02}px ${h * 0.04}px rgba(0,0,0,0.55))`);
  return (
    <div
      style={{
        position: 'absolute',
        left: o.x * width,
        top: o.y * height,
        height: h,
        transform: `translate(-50%, -100%) translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${scale})`,
        transformOrigin: '50% 100%',
        opacity,
      }}
    >
      <Img
        src={resolveSrc(o.src, baseUrl)}
        style={{ height: '100%', width: 'auto', display: 'block', transform: o.flip ? 'scaleX(-1)' : undefined, filter: filters.join(' ') }}
      />
    </div>
  );
};

const OverlayLayer: React.FC<{ overlays: Overlay[] | undefined; baseUrl: string; trimBefore?: number }> = ({ overlays, baseUrl, trimBefore }) =>
  overlays && overlays.length ? (
    <AbsoluteFill>
      {overlays.map((o) =>
        o.motion && o.motion.rig ? (
          <PuppetOverlay key={o.id} o={o} baseUrl={baseUrl} trimBeforeFrames={trimBefore || 0} />
        ) : (
          <OverlayItem key={o.id} o={o} baseUrl={baseUrl} />
        ),
      )}
    </AbsoluteFill>
  ) : null;

const BackgroundLayer: React.FC<{ bg: ClipBackground | null | undefined; baseUrl: string }> = ({ bg, baseUrl }) => {
  if (!bg || bg.type === 'none') return null;
  if (bg.type === 'color' || !bg.src) return <AbsoluteFill style={{ backgroundColor: bg.color }} />;
  const src = resolveSrc(bg.src, baseUrl);
  return bg.mediaKind === 'video' ? (
    <AbsoluteFill>
      <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  ) : (
    <KenBurnsImage src={src} mode="none" />
  );
};

const ClipView: React.FC<{ clip: SceneClip; trimBefore: number; baseUrl: string }> = ({ clip, trimBefore, baseUrl }) => {
  const src = resolveSrc(clip.src, baseUrl);
  const caption = clip.text && clip.text.content.trim() ? <Caption text={clip.text} /> : null;
  const trim = trimBefore > 0 ? trimBefore : undefined;

  if (clip.kind === 'motion') {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <BackgroundLayer bg={clip.bg} baseUrl={baseUrl} />
        <PoseCharacter src={src} trimBeforeFrames={trimBefore} options={clip.pose || defaultPose()} baseUrl={baseUrl} />
        <OverlayLayer overlays={clip.overlays} baseUrl={baseUrl} trimBefore={trimBefore} />
        {caption}
      </AbsoluteFill>
    );
  }

  if (clip.kind === 'video' && clip.alpha) {
    // Matted foreground: background (or the original base layer) behind, optional caption between.
    const useBase = Boolean(clip.textBehind && clip.baseSrc);
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {useBase ? (
          <AbsoluteFill>
            <OffthreadVideo src={resolveSrc(clip.baseSrc!, baseUrl)} trimBefore={trim} volume={clip.volume} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
        ) : (
          <BackgroundLayer bg={clip.bg} baseUrl={baseUrl} />
        )}
        {useBase ? caption : null}
        <AbsoluteFill>
          <OffthreadVideo
            src={src}
            transparent
            muted={useBase}
            trimBefore={trim}
            volume={clip.volume}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
        <OverlayLayer overlays={clip.overlays} baseUrl={baseUrl} trimBefore={trimBefore} />
        {useBase ? null : caption}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {clip.kind === 'image' && clip.alpha ? <BackgroundLayer bg={clip.bg} baseUrl={baseUrl} /> : null}
      {clip.kind === 'video' ? (
        <OffthreadVideo src={src} trimBefore={trim} volume={clip.volume} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <KenBurnsImage src={src} mode={clip.kenBurns} transparent={clip.alpha} fit={clip.alpha ? 'contain' : 'cover'} />
      )}
      <OverlayLayer overlays={clip.overlays} baseUrl={baseUrl} trimBefore={trimBefore} />
      {caption}
    </AbsoluteFill>
  );
};

type AnyPresentation = TransitionPresentation<Record<string, unknown>>;

const presentationFor = (t: TransitionType, width: number, height: number): AnyPresentation => {
  switch (t) {
    case 'slide':
      return slide({ direction: 'from-right' }) as unknown as AnyPresentation;
    case 'wipe':
      return wipe({ direction: 'from-left' }) as unknown as AnyPresentation;
    case 'flip':
      return flip() as unknown as AnyPresentation;
    case 'clockWipe':
      return clockWipe({ width, height }) as unknown as AnyPresentation;
    case 'iris':
      return iris({ width, height }) as unknown as AnyPresentation;
    default:
      return fade() as unknown as AnyPresentation;
  }
};

const EmptyState: React.FC = () => (
  <AbsoluteFill
    style={{
      background: 'radial-gradient(circle at 50% 40%, #1c2333 0%, #07080b 70%)',
      justifyContent: 'center',
      alignItems: 'center',
      color: '#8E8E93',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 36,
    }}
  >
    Chưa có cảnh nào — thêm clip từ Thư viện
  </AbsoluteFill>
);

export const FlowTimeline: React.FC<FlowTimelineProps> = ({ clips, baseUrl }) => {
  const { width, height } = useVideoConfig();
  if (!clips || clips.length === 0) return <EmptyState />;
  const items = buildTimeline(clips);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <TransitionSeries>
        {items.map((it) => (
          <React.Fragment key={it.clip.id}>
            {it.transitionFrames > 0 ? (
              <TransitionSeries.Transition
                presentation={presentationFor(it.clip.transition, width, height)}
                timing={linearTiming({ durationInFrames: it.transitionFrames })}
              />
            ) : null}
            <TransitionSeries.Sequence durationInFrames={it.durationInFrames}>
              <ClipView clip={it.clip} trimBefore={it.trimBeforeFrames} baseUrl={baseUrl} />
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
