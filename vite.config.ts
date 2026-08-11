/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import incidentsFixture from './fixtures/incidents.json';
import statusFixture from './fixtures/status.json';

// The site is served from https://virtual-radiologic.github.io/platform-status/, a project
// Pages site, so every asset URL needs that repo-name prefix. Getting this wrong produces a
// page that loads its HTML and then 404s every script and stylesheet, which looks like a
// blank white page with no obvious cause.
const REPOSITORY_BASE = '/platform-status/';

const FIXTURE_ROUTES = new Map<string, unknown>([
  [`${REPOSITORY_BASE}fixtures/status.json`, statusFixture],
  [`${REPOSITORY_BASE}fixtures/incidents.json`, incidentsFixture],
]);

/**
 * Serves the dev fixtures with `generatedAt` rewritten to the current instant.
 *
 * The fixtures carry fixed timestamps, so without this the page correctly declares itself stale
 * within minutes of starting the dev server. That is right in production and a nuisance while
 * building the UI. Patching in flight rather than on disk keeps the committed fixtures from
 * showing up as modified after every dev run.
 *
 * The fixtures are imported rather than read from disk, so this needs no filesystem access at all
 * and no path is ever built from request input. Editing a fixture restarts the dev server, which
 * is what a config-file dependency does anyway.
 *
 * Dev only: the fixtures live outside `public/`, so they never reach the Pages artifact, and
 * nothing in a production build reads them.
 */
function devFixtures(): Plugin {
  return {
    name: 'platform-status-dev-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        const fixture = FIXTURE_ROUTES.get(path);
        if (fixture === undefined) {
          next();

          return;
        }

        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ ...fixture, generatedAt: new Date().toISOString() }));
      });
    },
  };
}

export default defineConfig({
  base: REPOSITORY_BASE,
  plugins: [react(), devFixtures()],
  build: {
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 4000,
    strictPort: true,
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
