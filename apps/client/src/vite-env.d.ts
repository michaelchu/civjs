/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string
  readonly VITE_API_BASE_URL?: string
  readonly PROD: boolean
  readonly DEV: boolean
  readonly MODE: string
  // Add other environment variables as needed
}
