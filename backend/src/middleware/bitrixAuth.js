'use strict';

// Аутентификация публичного контура (виджет внутри Bitrix24).
//
// Что было сломано до переписывания:
//  1. Ветка «на всякий случай» повторяла условие проверки пары токенов, но уже
//     без сверки секрета: любые X-App-Id/X-App-Token пропускались.
//  2. Заголовок Upgrade: websocket на обычном HTTP-запросе полностью обходил
//     проверку. WebSocket-соединения обрабатывает ws-сервер на событии upgrade
//     HTTP-сервера и до express-middleware не доходят — ветка была только дырой.
//  3. Токен Bitrix не проверялся вообще (`TODO: call Bitrix to validate token`),
//     достаточно было передать ?domain=что-угодно.
//  4. Список «публичных» GET-эндпоинтов включал /bitrix/lead, который отдаёт
//     карточку лида с персональными данными.
//
// Теперь доступ даёт ровно одно из двух: совпавшая пара из PUBLIC_TOKEN_PAIRS
// или токен Bitrix, проверенный вызовом user.current на разрешённом домене.

const { verifyAccessToken, isAllowedDomain, normalizeDomain } = require('../lib/bitrix');

function parseTokenPairs() {
	return String(process.env.PUBLIC_TOKEN_PAIRS || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((pair) => {
			const idx = pair.indexOf(':');
			if (idx <= 0) return null;
			return { id: pair.slice(0, idx), secret: pair.slice(idx + 1) };
		})
		.filter((p) => p && p.id && p.secret);
}

// Сравнение постоянного времени, чтобы секрет нельзя было подобрать по таймингам
function safeEqual(a, b) {
	const bufA = Buffer.from(String(a));
	const bufB = Buffer.from(String(b));
	if (bufA.length !== bufB.length) return false;
	return require('crypto').timingSafeEqual(bufA, bufB);
}

function matchesTokenPair(appId, appToken) {
	if (!appId || !appToken) return false;
	const pairs = parseTokenPairs();
	if (pairs.length === 0) return false;
	let matched = false;
	for (const pair of pairs) {
		// Без раннего выхода: время ответа не зависит от позиции пары в списке
		if (safeEqual(pair.id, appId) && safeEqual(pair.secret, appToken)) matched = true;
	}
	return matched;
}

function numericOrUndefined(value) {
	if (value === undefined || value === null || value === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function readContext(req) {
	return {
		leadId: numericOrUndefined(req.query.lead_id),
		dealId: numericOrUndefined(req.query.deal_id),
		contactId: numericOrUndefined(req.query.contact_id),
		userId: numericOrUndefined(req.query.user_id),
	};
}

async function bitrixAuthMiddleware(req, res, next) {
	try {
		const ctx = readContext(req);

		// 1. Общая пара токенов виджета
		if (matchesTokenPair(req.header('X-App-Id'), req.header('X-App-Token'))) {
			req.bitrix = {
				userId: ctx.userId || 0,
				domain: 'widget',
				leadId: ctx.leadId,
				dealId: ctx.dealId,
				contactId: ctx.contactId,
				accessToken: null,
				authMethod: 'token_pair',
			};
			return next();
		}

		// 2. Режим разработки. Раньше он включался переменной BITRIX_DEV_MODE
		// независимо от NODE_ENV, а в docker-compose.yml стоят одновременно
		// NODE_ENV=production и BITRIX_DEV_MODE=true — то есть прод-сборка
		// пускала всех. Теперь NODE_ENV=production отключает режим жёстко.
		if (process.env.NODE_ENV !== 'production' && process.env.BITRIX_DEV_MODE === 'true') {
			req.bitrix = {
				userId: ctx.userId || 0,
				domain: normalizeDomain(req.header('X-Bitrix-Domain') || req.query.DOMAIN || req.query.domain)
					|| process.env.VITE_DEV_BITRIX_DOMAIN
					|| 'example.bitrix24.ru',
				leadId: ctx.leadId,
				dealId: ctx.dealId,
				contactId: ctx.contactId,
				accessToken: 'dev-token',
				authMethod: 'dev',
			};
			return next();
		}

		// 3. Токен Bitrix — проверяется по-настоящему
		const authHeader = req.header('Authorization') || '';
		let token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
		if (!token) {
			const q = req.query.AUTH_ID || req.query.auth || req.query.access_token;
			if (q) token = String(q);
		}
		const domain = req.header('X-Bitrix-Domain') || req.query.DOMAIN || req.query.domain;

		if (!token || !domain) {
			return res.status(401).json({
				error: 'Unauthorized',
				details: 'Требуется пара X-App-Id/X-App-Token либо токен Bitrix вместе с доменом',
			});
		}

		if (!isAllowedDomain(domain)) {
			return res.status(403).json({ error: 'Forbidden', details: 'Домен Bitrix не разрешён' });
		}

		const verdict = await verifyAccessToken(domain, token);
		if (!verdict.ok) {
			// Сбой связи с Bitrix — это не повод пускать запрос, но и не 401:
			// отвечаем 503, чтобы отличать недоступность от неверного токена.
			if (verdict.reason === 'unavailable') {
				return res.status(503).json({ error: 'Bitrix unavailable', details: 'Не удалось проверить токен' });
			}
			return res.status(401).json({ error: 'Unauthorized', details: 'Токен Bitrix отклонён' });
		}

		req.bitrix = {
			userId: ctx.userId || verdict.userId || 0,
			domain: normalizeDomain(domain),
			leadId: ctx.leadId,
			dealId: ctx.dealId,
			contactId: ctx.contactId,
			accessToken: token,
			authMethod: 'bitrix_token',
			verifiedUserId: verdict.userId || null,
		};
		return next();
	} catch (e) {
		console.error('bitrixAuth: непредвиденная ошибка:', e?.message || e);
		return next(e);
	}
}

module.exports = { bitrixAuthMiddleware, matchesTokenPair };
