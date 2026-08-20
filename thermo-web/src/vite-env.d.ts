/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_THERMO_DATA_MODE?: 'demo' | 'proxy'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_PROXY_TARGET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
