/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Drawesome API, e.g. https://<app>.azurewebsites.net/api. Empty hides sign-in. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
