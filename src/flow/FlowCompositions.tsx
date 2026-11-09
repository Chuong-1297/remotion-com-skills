import React from 'react';
import { Composition } from 'remotion';
import { FlowTimeline } from './FlowTimeline';
import { MockClip } from './MockClip';
import { FPS, FlowTimelineProps, MockClipProps, dimensionsFor, timelineDuration } from './types';

const defaultTimeline: FlowTimelineProps = { clips: [], aspect: '16:9', baseUrl: '' };
const defaultMock: MockClipProps = { prompt: 'Một chú mèo phi hành gia bay qua dải ngân hà', imageSrc: null, seed: 1, label: 'DEMO' };

// Compositions used by Flow Studio. Registered both in the main Studio Root and in src/flow/index.ts (server renders).
export const FlowCompositions: React.FC = () => (
  <>
    <Composition
      id="FlowTimeline"
      component={FlowTimeline}
      fps={FPS}
      width={1920}
      height={1080}
      durationInFrames={FPS * 4}
      defaultProps={defaultTimeline}
      calculateMetadata={({ props }) => {
        const d = dimensionsFor(props.aspect, 1080);
        return { durationInFrames: timelineDuration(props.clips), width: d.width, height: d.height };
      }}
    />
    <Composition
      id="FlowMockClip"
      component={MockClip}
      fps={FPS}
      width={1280}
      height={720}
      durationInFrames={FPS * 4}
      defaultProps={defaultMock}
    />
  </>
);
