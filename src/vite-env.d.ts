/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the published status.json URL. Used in local development to read a fixture. */
  readonly VITE_STATUS_URL?: string;
  /** Overrides the published incidents.json URL. Used in local development to read a fixture. */
  readonly VITE_INCIDENTS_URL?: string;
  /** Overrides the api.github.com URL a manual refresh reads status.json from. */
  readonly VITE_STATUS_API_URL?: string;
  /** Overrides the api.github.com URL a manual refresh reads incidents.json from. */
  readonly VITE_INCIDENTS_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
