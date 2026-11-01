import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Browser features that jsdom does not implement.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close() {
  this.removeAttribute('open');
};
