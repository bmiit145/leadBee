/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the LeadBee API — scheme and host, no path, no trailing slash.
   *
   * Unset in development, where the Vite proxy makes the API same-origin.
   * Required for any production build; see `src/config/env.ts`.
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
