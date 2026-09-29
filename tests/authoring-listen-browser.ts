import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import source from './fixtures/listen-score.music.html?raw';
// No fixture recovery data enters the user's storage.
const memory = new Map<string, string>();
const app = new AuthorWorkspace({ project: createProject(source, 'Listen fixture'),
  recovery: new RecoveryStore({ key: 'listen-browser-fixture', storage: {
    getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); }, removeItem: key => { memory.delete(key); },
  } }),
});
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
