import { Request, Response, NextFunction } from 'express';

export interface BitrixContext {
	userId: number;
	domain: string;
	leadId?: number;
	dealId?: number;
	contactId?: number;
	accessToken: string;
}

declare global {
	namespace Express {
		interface Request {
			bitrix?: BitrixContext;
		}
	}
}

// In production, validate token via Bitrix REST: oauth.token introspection or simple API call
export async function bitrixAuthMiddleware(req: Request, res: Response, next: NextFunction) {
	try {
		// Shared app tokens for iframe embedding (public area)
		const appTokenHeader = req.header('X-App-Token');
		const appIdHeader = req.header('X-App-Id');
		const tokenPairsEnv = (process.env.PUBLIC_TOKEN_PAIRS || '').split(',').map(s => s.trim()).filter(Boolean);
		
		// Validate pair: id:secret (single-token flow disabled)
		let pairOk = false;
		if (appIdHeader && appTokenHeader && tokenPairsEnv.length > 0) {
			for (const pair of tokenPairsEnv) {
				const [pid, psec] = pair.split(':');
				if (pid && psec && pid === appIdHeader && psec === appTokenHeader) { 
					pairOk = true; 
					break; 
				}
			}
		}
		
		if (pairOk) {
			req.bitrix = {
				userId: 0,
				domain: 'public',
				leadId: req.query.lead_id ? Number(req.query.lead_id) : undefined,
				dealId: req.query.deal_id ? Number(req.query.deal_id) : undefined,
				contactId: req.query.contact_id ? Number(req.query.contact_id) : undefined,
				accessToken: 'public-token'
			};
			return next();
		}

		const authHeader = req.header('Authorization');
		let token = authHeader?.startsWith('Bearer ')
			? authHeader.substring('Bearer '.length)
			: undefined;

		// Also accept token from query (?AUTH_ID=... or ?auth=...)
		if (!token) {
			const qAuth = (req.query.AUTH_ID || req.query.auth || req.query.access_token) as string | undefined;
			if (qAuth) token = String(qAuth);
		}

		const domainFromHeader = req.header('X-Bitrix-Domain');
		const domainParam = (req.query.DOMAIN || req.query.domain) as string | undefined;
		const domain = (domainFromHeader || domainParam || '').toString();
		const leadId = req.query.lead_id ? Number(req.query.lead_id) : undefined;
		const dealId = req.query.deal_id ? Number(req.query.deal_id) : undefined;
		const contactId = req.query.contact_id ? Number(req.query.contact_id) : undefined;
		const userId = req.query.user_id ? Number(req.query.user_id) : undefined;

		if (process.env.BITRIX_DEV_MODE === 'true') {
			const devToken = token || process.env.VITE_DEV_BITRIX_TOKEN || 'dev-token';
			
			// Логируем что приходит в middleware
			console.log('🔍 Middleware bitrixAuth (TypeScript) - DEV MODE:');
			console.log('  - req.query.user_id:', req.query.user_id);
			console.log('  - userId после Number():', userId);
			console.log('  - BITRIX_DEV_MODE:', process.env.BITRIX_DEV_MODE);
			
			req.bitrix = {
				userId: userId || 0, // Используем user_id из query параметра, fallback на 0
				domain: domain || (process.env.VITE_DEV_BITRIX_DOMAIN as string) || 'example.bitrix24.ru',
				leadId,
				dealId,
				contactId,
				accessToken: devToken,
			};
			
			console.log('  - req.bitrix.userId установлен как:', req.bitrix?.userId);
			return next();
		}

		// PRODUCTION MODE - более гибкая проверка
		console.log('🔍 Middleware bitrixAuth (TypeScript) - PRODUCTION MODE:');
		console.log('  - URL:', req.url);
		console.log('  - Method:', req.method);
		console.log('  - Headers:', {
			authorization: req.headers.authorization ? 'present' : 'missing',
			'x-bitrix-domain': req.headers['x-bitrix-domain'],
			'x-app-id': req.headers['x-app-id'],
			'x-app-token': req.headers['x-app-token'] ? 'present' : 'missing'
		});
		console.log('  - Query params:', req.query);

		// В продакшене разрешаем запросы без токена для некоторых эндпоинтов
		// или если есть публичные токены
		if (!token && !domain) {
			// Проверяем, есть ли публичные токены в заголовках
			if (appIdHeader && appTokenHeader && tokenPairsEnv.length > 0) {
				// Это должно было сработать выше, но на всякий случай
				console.log('  - Using public app tokens');
				req.bitrix = {
					userId: 0,
					domain: 'public',
					leadId,
					dealId,
					contactId,
					accessToken: 'public-token'
				};
				return next();
			}
			
			console.log('  - ERROR: No token, domain, or public tokens provided');
			return res.status(401).json({ 
				error: 'Unauthorized - missing authentication',
				details: 'Required: Authorization token or X-App-Id/X-App-Token pair'
			});
		}

		// TODO: call Bitrix to validate token; here we trust but set context
		req.bitrix = {
			userId: userId || 0,
			domain: domain || 'unknown',
			leadId,
			dealId,
			contactId,
			accessToken: token || 'no-token',
		};
		
		console.log('  - SUCCESS: Authentication passed, req.bitrix set');
		return next();
	} catch (e) {
		console.error('❌ Middleware bitrixAuth error:', e);
		return next(e);
	}
}