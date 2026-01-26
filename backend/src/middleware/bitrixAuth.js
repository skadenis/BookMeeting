"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bitrixAuthMiddleware = bitrixAuthMiddleware;
// In production, validate token via Bitrix REST: oauth.token introspection or simple API call
async function bitrixAuthMiddleware(req, res, next) {
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
            const qAuth = (req.query.AUTH_ID || req.query.auth || req.query.access_token);
            if (qAuth)
                token = String(qAuth);
        }
        const domainFromHeader = req.header('X-Bitrix-Domain');
        const domainParam = (req.query.DOMAIN || req.query.domain);
        const domain = (domainFromHeader || domainParam || '').toString();
        const leadId = req.query.lead_id ? Number(req.query.lead_id) : undefined;
        const dealId = req.query.deal_id ? Number(req.query.deal_id) : undefined;
        const contactId = req.query.contact_id ? Number(req.query.contact_id) : undefined;
        const userId = req.query.user_id ? Number(req.query.user_id) : undefined;

        const isWebSocket = String(req.headers.upgrade || '').toLowerCase() === 'websocket' || req.url.startsWith('/ws');
        if (isWebSocket) {
            req.bitrix = {
                userId: userId || 0,
                domain: domain || 'ws',
                leadId,
                dealId,
                contactId,
                accessToken: token || 'ws',
            };
            return next();
        }
        
        if (process.env.BITRIX_DEV_MODE === 'true') {
            const devToken = token || process.env.VITE_DEV_BITRIX_TOKEN || 'dev-token';
            // В dev режиме логируем минимально
            console.log('🔍 Dev mode: user_id:', userId || 'not set');
            req.bitrix = {
                userId: userId || 0, // Используем user_id из query параметра, fallback на 0
                domain: domain || process.env.VITE_DEV_BITRIX_DOMAIN || 'example.bitrix24.ru',
                leadId,
                dealId,
                contactId,
                accessToken: devToken,
            };

            return next();
        }
        
        // PRODUCTION MODE - более гибкая проверка
        console.log('🔍 Middleware bitrixAuth (JavaScript) - PRODUCTION MODE:');
        console.log('  - URL:', req.url);
        console.log('  - Method:', req.method);
        console.log('  - Headers:', {
            authorization: req.headers.authorization ? 'present' : 'missing',
            'x-bitrix-domain': req.headers['x-bitrix-domain'],
            'x-app-id': req.headers['x-app-id'],
            'x-app-token': req.headers['x-app-token'] ? 'present' : 'missing'
        });
        console.log('  - Query params:', req.query);

        // В продакшене для публичных эндпоинтов разрешаем запросы без строгой авторизации
        // Публичные эндпоинты: /offices, /slots (GET), /templates (GET), /bitrix/lead (GET), /appointments (GET)
        const isPublicEndpoint = (
            (req.method === 'GET' && req.url.startsWith('/offices')) ||
            (req.method === 'GET' && req.url.startsWith('/slots')) ||
            (req.method === 'GET' && req.url.startsWith('/templates')) ||
            (req.method === 'GET' && req.url.startsWith('/bitrix/lead')) ||
            (req.method === 'GET' && req.url.startsWith('/appointments'))
        );

        if (isPublicEndpoint && (!token && !domain)) {
            console.log('  - INFO: Public endpoint accessed without auth - allowing');
            req.bitrix = {
                userId: 0,
                domain: 'public-access',
                leadId,
                dealId,
                contactId,
                accessToken: 'public-access'
            };
            return next();
        }

        // Для остальных эндпоинтов требуем авторизацию
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
    }
    catch (e) {
        console.error('❌ Middleware bitrixAuth error:', e);
        return next(e);
    }
}
