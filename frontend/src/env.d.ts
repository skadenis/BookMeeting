/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL?: string
	readonly VITE_DEV_BITRIX_DOMAIN?: string
	readonly VITE_DEV_BITRIX_TOKEN?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}