import React, { useEffect, useState } from 'react';
import { Home } from './components/Home';
import { Editor } from './components/Editor';

const readHash = () => {
  const m = /^#\/project\/([a-z0-9]+)/.exec(window.location.hash);
  return m ? m[1] : null;
};

export const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string | null>(readHash());

  useEffect(() => {
    const onHash = () => setProjectId(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (id: string | null) => {
    window.location.hash = id ? `#/project/${id}` : '#/';
  };

  return projectId ? <Editor key={projectId} projectId={projectId} onBack={() => open(null)} /> : <Home onOpen={open} />;
};
