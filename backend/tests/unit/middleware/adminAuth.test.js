const jwt = require('jsonwebtoken');
const { adminAuthMiddleware, signAdminJwt, requireRole } = require('../../../src/middleware/adminAuth');

describe('Admin Auth Middleware', () => {
  const mockReq = {
    header: jest.fn(),
    query: {},
    admin: null
  };
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };
  const mockNext = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq.query = {};
    mockReq.admin = null;
    process.env.ADMIN_JWT_SECRET = 'test-secret';
  });

  describe('signAdminJwt', () => {
    it('should sign JWT with admin payload', () => {
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      // Verify token can be decoded
      const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
      expect(decoded.id).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
    });
  });

  describe('adminAuthMiddleware', () => {
    it('should authenticate with valid Bearer token', () => {
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);
      
      mockReq.header.mockReturnValue(`Bearer ${token}`);
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockReq.admin).toBeDefined();
      expect(mockReq.admin.id).toBe(payload.id);
      expect(mockReq.admin.email).toBe(payload.email);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    // Раньше здесь было три теста, закреплявших приём токена через
    // ?admin_token= / ?adminToken= / ?token=. Это отправляло долгоживущий
    // админский JWT в access-логи nginx, в историю браузера и в Referer.
    // Приём из query удалён, поэтому тесты проверяют обратное — отказ.
    it('should reject token passed via query params', () => {
      const token = signAdminJwt({ id: 'admin-123', email: 'admin@test.com' });

      for (const key of ['admin_token', 'adminToken', 'token']) {
        jest.clearAllMocks();
        mockReq.admin = null;
        mockReq.query = { [key]: token };
        mockReq.header.mockReturnValue('');

        adminAuthMiddleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockNext).not.toHaveBeenCalled();
      }
    });

    it('should reject request without token', () => {
      mockReq.header.mockReturnValue('');
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid Bearer format', () => {
      mockReq.header.mockReturnValue('InvalidToken');
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid JWT token', () => {
      mockReq.header.mockReturnValue('Bearer invalid-token');
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with expired token', () => {
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const expiredToken = jwt.sign(payload, process.env.ADMIN_JWT_SECRET, { expiresIn: '0s' });
      
      mockReq.header.mockReturnValue(`Bearer ${expiredToken}`);
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use default secret if ADMIN_JWT_SECRET not set (non-production only)', () => {
      delete process.env.ADMIN_JWT_SECRET;

      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);

      mockReq.header.mockReturnValue(`Bearer ${token}`);

      adminAuthMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.admin).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should refuse to sign with a default secret in production', () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_JWT_SECRET = 'change-me-in-production';

      expect(() => signAdminJwt({ id: 'admin-123' })).toThrow(/ADMIN_JWT_SECRET/);

      process.env.NODE_ENV = prevEnv;
      process.env.ADMIN_JWT_SECRET = 'test-secret';
    });
  });

  // Роли в модели User существовали и валидировались при создании, но ни один
  // маршрут их не проверял: токен с ролью viewer давал полный доступ.
  describe('requireRole', () => {
    const run = (role, minRole) => {
      const req = { admin: role ? { role } : null };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      requireRole(minRole)(req, res, next);
      return { res, next };
    };

    it('allows a role at or above the required rank', () => {
      expect(run('admin', 'editor').next).toHaveBeenCalled();
      expect(run('editor', 'editor').next).toHaveBeenCalled();
      expect(run('admin', 'admin').next).toHaveBeenCalled();
    });

    it('rejects a role below the required rank with 403', () => {
      const { res, next } = run('viewer', 'editor');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a request with no role at all', () => {
      const { res, next } = run(null, 'viewer');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an unknown role name', () => {
      const { res, next } = run('superuser', 'viewer');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
