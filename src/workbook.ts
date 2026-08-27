import './components/index.js';
import { initializeWorkbookControls } from './demo/workbook-controls.js';

const dispose = initializeWorkbookControls({
  root: document,
  preview: document.querySelector<HTMLInputElement>('#print-preview')!,
  printButton: document.querySelector<HTMLButtonElement>('#print-scores')!,
  status: document.querySelector<HTMLElement>('#workbook-status')!,
  requestPrint: () => window.print(),
});

if (import.meta.hot) import.meta.hot.dispose(dispose);
