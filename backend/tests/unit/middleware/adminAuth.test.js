const jwt = require('jsonwebtoken');
const { adminAuthMiddleware, signAdminJwt } = require('../../../src/middleware/adminAuth');

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

    it('should authenticate with token in query params', () => {
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);
      
      mockReq.header.mockReturnValue('');
      mockReq.query.admin_token = token;
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockReq.admin).toBeDefined();
      expect(mockReq.admin.id).toBe(payload.id);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should authenticate with adminToken in query params', () => {
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);
      
      mockReq.header.mockReturnValue('');
      mockReq.query.adminToken = token;
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockReq.admin).toBeDefined();
      expect(mockReq.admin.id).toBe(payload.id);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should authenticate with token in query params', () => {
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);
      
      mockReq.header.mockReturnValue('');
      mockReq.query.token = token;
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockReq.admin).toBeDefined();
      expect(mockReq.admin.id).toBe(payload.id);
      expect(mockNext).toHaveBeenCalled();
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

    it('should use default secret if ADMIN_JWT_SECRET not set', () => {
      delete process.env.ADMIN_JWT_SECRET;
      
      const payload = { id: 'admin-123', email: 'admin@test.com' };
      const token = signAdminJwt(payload);
      
      mockReq.header.mockReturnValue(`Bearer ${token}`);
      
      adminAuthMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockReq.admin).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
