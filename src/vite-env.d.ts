/// <reference types="vite/client" />

declare const __SEFER_BUILD__: string;

declare const __GALLEY_TAG__: string;

declare const __SEFER_DESIGN__: boolean;

interface ImportMetaEnv {
  readonly VITE_SEFER_LOG?: string;
  readonly VITE_SEFER_STREAM?: string;
}
