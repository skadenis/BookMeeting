import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [react()],
	server: {
		host: true,
		port: 5173,
		allowedHosts: ['vic-chain-grown-restrict.trycloudflare.com'],
		proxy: {
			'/api': {
				target: 'http://localhost:4000',
				changeOrigin: true,
				ws: true, // Enable WebSocket proxy
			},
		},
	},
	build: {
		outDir: 'dist',
	},
})