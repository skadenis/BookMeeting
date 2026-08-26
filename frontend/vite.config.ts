import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4400'

export default defineConfig({
	plugins: [react()],
	server: {
		host: true,
		port: 5173,
		// Здесь был зашит одноразовый туннель trycloudflare.com, оставшийся от отладки.
		// Дополнительные хосты задаются через VITE_ALLOWED_HOSTS (через запятую).
		allowedHosts: ['localhost', ...String(process.env.VITE_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)],
		proxy: {
			'/api': {
				target: apiProxyTarget,
				changeOrigin: true,
				ws: true, // Enable WebSocket proxy
			},
		},
	},
	build: {
		outDir: 'dist',
	},
})