// Entry point bundled by the Flow Studio server for rendering (see server/index.ts).
import { registerRoot } from 'remotion';
import { FlowCompositions } from './FlowCompositions';

registerRoot(FlowCompositions);
