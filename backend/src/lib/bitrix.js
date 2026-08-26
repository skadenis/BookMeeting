// Работа с Bitrix24: белый список доменов и проверка токена.
//
// Раньше домен приходил из query и подставлялся в URL без ограничений
// (routes/placement.js собирал `https://${domain}/rest/...`), то есть сервер
// ходил POST-запросом по любому адресу и уносил туда токен — SSRF.
// Здесь домен всегда сверяется с белым списком, а сам токен проверяется
// вызовом Bitrix, а не принимается на веру.

const axios = require('axios');
const crypto = require('crypto');
const { redis } = require('./redis');

const VERIFY_TIMEOUT_MS = Number(process.env.BITRIX_VERIFY_TIMEOUT_MS || 8000);
const VERIFY_CACHE_SECONDS = Number(process.env.BITRIX_VERIFY_CACHE_SECONDS || 300);

// Список берётся из BITRIX_ALLOWED_DOMAINS, а если он не задан — из хоста
// BITRIX_REST_URL, чтобы конфигурация по умолчанию оставалась рабочей.
function allowedDomains() {
	const explicit = String(process.env.BITRIX_ALLOWED_DOMAINS || '')
		.split(',')
		.map((s) => normalizeDomain(s))
		.filter(Boolean);
	if (explicit.length) return explicit;
	try {
		const host = new URL(String(process.env.BITRIX_REST_URL)).host.toLowerCase();
		return host ? [host] : [];
	} catch {
		return [];
	}
}

function normalizeDomain(value) {
	const raw = String(value || '').trim().toLowerCase();
	if (!raw) return '';
	const withoutScheme = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
	// Только буквы, цифры, точки и дефисы: отсекает user@host, IPv6-скобки и путь
	if (!/^[a-z0-9.-]+$/.test(withoutScheme)) return '';
	if (withoutScheme.includes('..') || withoutScheme.startsWith('.') || withoutScheme.endsWith('.')) return '';
	return withoutScheme;
}

function isAllowedDomain(value) {
	const domain = normalizeDomain(value);
	if (!domain) return false;
	return allowedDomains().includes(domain);
}

function cacheKey(domain, token) {
	const digest = crypto.createHash('sha256').update(`${domain}|${token}`).digest('hex');
	return `bx:auth:${digest}`;
}

// Проверяет токен вызовом user.current на разрешённом домене.
// Возвращает { ok, userId } либо { ok: false, reason }.
// reason === 'unavailable' означает «не смогли проверить», а не «токен плохой»:
// вызывающий код обязан различать эти случаи и не пускать запрос ни в одном из них.
async function verifyAccessToken(domain, token) {
	const normalized = normalizeDomain(domain);
	if (!normalized || !isAllowedDomain(normalized)) return { ok: false, reason: 'domain_not_allowed' };
	if (!token || typeof token !== 'string' || token.length > 512) return { ok: false, reason: 'bad_token' };

	const key = cacheKey(normalized, token);
	try {
		const cached = await redis.get(key);
		if (cached !== null && cached !== undefined) {
			return { ok: true, userId: Number(cached) || 0, cached: true };
		}
	} catch (e) {
		// Кеш недоступен — просто идём в Bitrix
		console.error('bitrix: не удалось прочитать кеш проверки токена:', e?.message || e);
	}

	try {
		const url = `https://${normalized}/rest/user.current.json`;
		const response = await axios.post(url, { auth: token }, { timeout: VERIFY_TIMEOUT_MS });
		const userId = Number(response?.data?.result?.ID);
		if (!Number.isFinite(userId) || userId <= 0) {
			return { ok: false, reason: 'rejected' };
		}
		try {
			await redis.set(key, String(userId), 'EX', VERIFY_CACHE_SECONDS);
		} catch { /* кеш необязателен */ }
		return { ok: true, userId };
	} catch (e) {
		const status = e?.response?.status;
		// 401/403 от Bitrix — это именно отказ, а не сбой связи
		if (status === 401 || status === 403) return { ok: false, reason: 'rejected' };
		console.error('bitrix: проверка токена не удалась:', e?.message || e);
		return { ok: false, reason: 'unavailable' };
	}
}

// Базовый URL входящего вебхука. Метод подставляется без склейки строк
// в вызывающем коде, чтобы не потерять/не задвоить слеш.
function restUrl(method) {
	const base = String(process.env.BITRIX_REST_URL || '').replace(/\/+$/, '');
	const path = String(method || '').replace(/^\/+/, '');
	return `${base}/${path}`;
}

module.exports = {
	allowedDomains,
	normalizeDomain,
	isAllowedDomain,
	verifyAccessToken,
	restUrl,
};
