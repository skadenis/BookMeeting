import axios from 'axios'

function getAuthToken() {
	try {
		return sessionStorage.getItem('bx.AUTH_ID') || import.meta.env.VITE_DEV_BITRIX_TOKEN || null
	} catch {
		return null
	}
}

function getPublicToken() {
    try {
        return sessionStorage.getItem('app.publicToken') || import.meta.env.VITE_PUBLIC_APP_TOKEN || null
    } catch {
        return import.meta.env.VITE_PUBLIC_APP_TOKEN || null
    }
}

function getPublicId() {
    try {
        return sessionStorage.getItem('app.publicId') || import.meta.env.VITE_PUBLIC_APP_ID || null
    } catch {
        return import.meta.env.VITE_PUBLIC_APP_ID || null
    }
}

function getDomain() {
	try {
		return sessionStorage.getItem('bx.DOMAIN') || import.meta.env.VITE_DEV_BITRIX_DOMAIN || null
	} catch {
		return null
	}
}

function getUserId() {
	try {
		return sessionStorage.getItem('bx.USER_ID') || null
	} catch {
		return null
	}
}

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

export const apiClient = axios.create({ baseURL })

apiClient.interceptors.request.use((config) => {
	const url = String(config.url || '')
	
	// Admin endpoints use admin JWT
	if (url.startsWith('/admin') || url.startsWith('/auth')) {
		const adminToken = localStorage.getItem('admin.token')
		if (adminToken) {
			config.headers.Authorization = `Bearer ${adminToken}`
		}
		return config
	}
	
	// Public endpoints (Bitrix/iframe)
	const token = getAuthToken()
	const domain = getDomain()
	if (token) config.headers.Authorization = `Bearer ${token}`
	if (domain) config.headers['X-Bitrix-Domain'] = domain
	const userId = getUserId()
	if (userId) {
		config.params = { ...(config.params || {}), user_id: userId }
	}
	const appToken = getPublicToken()
	const appId = getPublicId()
	if (appId && appToken) {
		config.headers['X-App-Id'] = appId
		config.headers['X-App-Token'] = appToken
	}
	return config
})

export default apiClient


