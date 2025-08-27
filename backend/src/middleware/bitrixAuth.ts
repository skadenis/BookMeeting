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
			console.log('🔍 Middleware bitrixAuth (TypeScript):');
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

		if (!token || !domain) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		// TODO: call Bitrix to validate token; here we trust but set context
		req.bitrix = {
			userId: 0,
			domain,
			leadId,
			dealId,
			contactId,
			accessToken: token,
		};
		return next();
	} catch (e) {
		return next(e);
	}
}