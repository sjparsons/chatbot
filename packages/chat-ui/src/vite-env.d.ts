/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of chat-api. Defaults to http://localhost:3001. */
  readonly VITE_CHAT_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
