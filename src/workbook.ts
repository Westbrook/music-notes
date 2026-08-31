import './components/index.js';
import './demo/workbook-toolbar.js';
import { createWorkbookState } from './demo/workbook-controls.js';

const toolbar = document.querySelector('music-workbook-toolbar')!;
const state = createWorkbookState({
  root: document,
  requestPrint: () => window.print(),
});
toolbar.model = state;

if (import.meta.hot) import.meta.hot.dispose(() => {
  toolbar.model = undefined;
  state.dispose();
});
