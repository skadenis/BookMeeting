// Global test setup
process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5433';
process.env.DB_NAME = 'meetings_test';
process.env.DB_USERNAME = 'meetings_test';
process.env.DB_PASSWORD = 'meetings_test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6380';
process.env.BITRIX_DEV_MODE = 'true';
process.env.BITRIX_REST_URL = 'https://test.bitrix24.by/rest/test';
process.env.ADMIN_JWT_SECRET = 'test-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  // Helper to create test data
  createTestAppointment: (overrides = {}) => ({
    id: 'test-uuid-123',
    date: '2024-01-15',
    timeSlot: '10:00',
    status: 'pending',
    office_id: 'office-uuid-123',
    bitrix_lead_id: 12345,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  // Helper to create test office
  createTestOffice: (overrides = {}) => ({
    id: 'office-uuid-123',
    city: 'Минск',
    address: 'ул. Тестовая, 1',
    addressNote: 'Тестовый офис',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  // Helper to create test user
  createTestUser: (overrides = {}) => ({
    id: 'user-uuid-123',
    email: 'test@example.com',
    password: 'hashedPassword123',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  // Helper to create test admin token
  createTestAdminToken: () => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { id: 'admin-123', email: 'admin@example.com', role: 'admin' },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: '1h' }
    );
  }
};

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};
