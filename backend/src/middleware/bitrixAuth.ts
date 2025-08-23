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
		const token = authHeader?.startsWith('Bearer ')
			? authHeader.substring('Bearer '.length)
			: undefined;

		const domain = (req.header('X-Bitrix-Domain') || req.query.domain || '').toString();
		const leadId = req.query.lead_id ? Number(req.query.lead_id) : undefined;
		const dealId = req.query.deal_id ? Number(req.query.deal_id) : undefined;
		const contactId = req.query.contact_id ? Number(req.query.contact_id) : undefined;

		if (process.env.BITRIX_DEV_MODE === 'true') {
			const devToken = token || process.env.VITE_DEV_BITRIX_TOKEN || 'dev-token';
			req.bitrix = {
				userId: 1,
				domain: domain || (process.env.VITE_DEV_BITRIX_DOMAIN as string) || 'example.bitrix24.ru',
				leadId,
				dealId,
				contactId,
				accessToken: devToken,
			};
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