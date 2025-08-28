import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4400'

export default defineConfig({
	plugins: [react()],
	server: {
		host: true,
		port: 5173,
		allowedHosts: ['vic-chain-grown-restrict.trycloudflare.com', 'localhost'],
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