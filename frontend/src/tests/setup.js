import '@testing-library/jest-dom';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {
    return null;
  }
  disconnect() {
    return null;
  }
  unobserve() {
    return null;
  }
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  observe() {
    return null;
  }
  disconnect() {
    return null;
  }
  unobserve() {
    return null;
  }
};

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock dayjs locale
jest.mock('dayjs/locale/ru', () => ({}), { virtual: true });

// Mock API client
jest.mock('../api/client', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
}));

// Global test utilities
global.testUtils = {
  // Helper to create mock appointment data
  createMockAppointment: (overrides = {}) => ({
    id: 'test-uuid-123',
    date: '2024-01-15',
    timeSlot: '10:00',
    status: 'pending',
    office: {
      id: 'office-uuid-123',
      city: 'Минск',
      address: 'ул. Тестовая, 1'
    },
    bitrix_lead_id: 12345,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    ...overrides
  }),

  // Helper to create mock office data
  createMockOffice: (overrides = {}) => ({
    id: 'office-uuid-123',
    city: 'Минск',
    address: 'ул. Тестовая, 1',
    addressNote: 'Тестовый офис',
    ...overrides
  }),

  // Helper to create mock template data
  createMockTemplate: (overrides = {}) => ({
    id: 'template-uuid-123',
    name: 'Тестовый шаблон',
    baseStartTime: '09:00',
    baseEndTime: '18:00',
    defaultCapacity: 2,
    slotDuration: 30,
    weekdays: {
      monday: { capacity: 2, start: '09:00', end: '18:00' },
      tuesday: { capacity: 2, start: '09:00', end: '18:00' },
      wednesday: { capacity: 2, start: '09:00', end: '18:00' },
      thursday: { capacity: 2, start: '09:00', end: '18:00' },
      friday: { capacity: 2, start: '09:00', end: '18:00' },
      saturday: { capacity: 0, start: '09:00', end: '18:00' },
      sunday: { capacity: 0, start: '09:00', end: '18:00' }
    },
    ...overrides
  }),

  // Helper to create mock user data
  createMockUser: (overrides = {}) => ({
    id: 'user-uuid-123',
    email: 'test@example.com',
    role: 'user',
    ...overrides
  }),

  // Helper to create mock admin token
  createMockAdminToken: () => 'mock-admin-token-123',

  // Helper to wait for async operations
  waitFor: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to mock API responses
  mockApiResponse: (method, path, response, status = 200) => {
    const api = require('../api/client');
    api[method].mockResolvedValue({
      data: response,
      status
    });
  },

  // Helper to mock API errors
  mockApiError: (method, path, error, status = 500) => {
    const api = require('../api/client');
    api[method].mockRejectedValue({
      response: {
        data: error,
        status
      }
    });
  }
};
