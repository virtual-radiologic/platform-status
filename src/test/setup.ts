import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The suite runs with `globals: false`, so there is no global afterEach for Testing Library's
// automatic cleanup to attach to. Without this, every render accumulates in the same document and
// queries start failing with "found multiple elements" in whichever test happens to run second.
afterEach(() => {
  cleanup();
});
