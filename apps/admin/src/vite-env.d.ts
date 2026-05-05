/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_ADMIN_BASE_URL: string;
  readonly VITE_APP_BASE_URL: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_DEFAULT_LOCALE?: "vi" | "en";
  readonly VITE_AMAZON_CONNECT_CCP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
