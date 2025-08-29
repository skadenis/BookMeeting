import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Layout from '../../modules/admin/Layout';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// Mock fetch
global.fetch = jest.fn();

// Mock window.location
const mockLocation = {
  href: 'http://localhost:3000/admin',
  search: '',
  replace: jest.fn(),
  reload: jest.fn(),
};
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

// Mock window.history
const mockHistory = {
  replaceState: jest.fn(),
};
Object.defineProperty(window, 'history', {
  value: mockHistory,
  writable: true,
});

const renderWithRouter = (component) => {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  );
};

describe('Admin Layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    fetch.mockClear();
    mockLocation.replace.mockClear();
    mockLocation.reload.mockClear();
    mockHistory.replaceState.mockClear();
  });

  describe('Authentication State', () => {
    it('should show login form when not authenticated', () => {
      renderWithRouter(<Layout />);
      
      expect(screen.getByText('Вход в админку')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
      expect(screen.getByText('Войти')).toBeInTheDocument();
    });

    it('should show admin interface when authenticated', () => {
      localStorageMock.getItem.mockReturnValue('valid-token');
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'admin-123', email: 'admin@test.com' })
      });
      
      renderWithRouter(<Layout />);
      
      expect(screen.getByText('Админка')).toBeInTheDocument();
      expect(screen.getByText('Управление расписанием')).toBeInTheDocument();
      expect(screen.getByText('Выйти')).toBeInTheDocument();
    });

    it('should show login form when token is invalid', async () => {
      localStorageMock.getItem.mockReturnValue('invalid-token');
      fetch.mockResolvedValueOnce({
        ok: false
      });
      
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        expect(screen.getByText('Вход в админку')).toBeInTheDocument();
      });
    });
  });

  describe('Login Form', () => {
    it('should validate required fields', async () => {
      renderWithRouter(<Layout />);
      
      const loginButton = screen.getByText('Войти');
      fireEvent.click(loginButton);
      
      // Should show validation errors
      await waitFor(() => {
        expect(screen.getByText('Вход в админку')).toBeInTheDocument();
      });
    });

    it('should handle successful login', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'new-token' })
      });
      
      renderWithRouter(<Layout />);
      
      const emailInput = screen.getByLabelText('Email');
      const passwordInput = screen.getByLabelText('Пароль');
      const loginButton = screen.getByText('Войти');
      
      fireEvent.change(emailInput, { target: { value: 'admin@test.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(loginButton);
      
      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith('admin.token', 'new-token');
        expect(mockLocation.replace).toHaveBeenCalledWith('/admin');
        expect(mockLocation.reload).toHaveBeenCalled();
      });
    });

    it('should handle login failure', async () => {
      fetch.mockResolvedValueOnce({
        ok: false
      });
      
      renderWithRouter(<Layout />);
      
      const emailInput = screen.getByLabelText('Email');
      const passwordInput = screen.getByLabelText('Пароль');
      const loginButton = screen.getByText('Войти');
      
      fireEvent.change(emailInput, { target: { value: 'admin@test.com' } });
      fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
      fireEvent.click(loginButton);
      
      // Should stay on login form
      expect(screen.getByText('Вход в админку')).toBeInTheDocument();
    });
  });

  describe('Navigation Menu', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('valid-token');
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'admin-123', email: 'admin@test.com' })
      });
    });

    it('should render navigation menu items', async () => {
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        expect(screen.getByText('Офисы')).toBeInTheDocument();
        expect(screen.getByText('Шаблоны')).toBeInTheDocument();
        expect(screen.getByText('Встречи')).toBeInTheDocument();
        expect(screen.getByText('Пользователи')).toBeInTheDocument();
      });
    });

    it('should highlight active menu item', async () => {
      // Mock current location to be on templates page
      Object.defineProperty(window, 'location', {
        value: { ...mockLocation, pathname: '/admin/templates' },
        writable: true,
      });
      
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        // Templates should be highlighted
        const templatesItem = screen.getByText('Шаблоны');
        expect(templatesItem.closest('li')).toHaveClass('ant-menu-item-selected');
      });
    });

    it('should navigate to correct routes when menu items are clicked', async () => {
      const { container } = renderWithRouter(<Layout />);
      
      await waitFor(() => {
        const officesItem = screen.getByText('Офисы');
        fireEvent.click(officesItem);
        
        // Should navigate to offices page
        expect(window.location.pathname).toBe('/admin/offices');
      });
    });
  });

  describe('URL Token Handling', () => {
    it('should extract token from URL query parameters', () => {
      // Mock URL with token
      Object.defineProperty(window, 'location', {
        value: {
          ...mockLocation,
          search: '?admin_token=url-token&other=param'
        },
        writable: true,
      });
      
      renderWithRouter(<Layout />);
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('admin.token', 'url-token');
    });

    it('should extract token from adminToken parameter', () => {
      Object.defineProperty(window, 'location', {
        value: {
          ...mockLocation,
          search: '?adminToken=alt-token'
        },
        writable: true,
      });
      
      renderWithRouter(<Layout />);
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('admin.token', 'alt-token');
    });

    it('should extract token from token parameter', () => {
      Object.defineProperty(window, 'location', {
        value: {
          ...mockLocation,
          search: '?token=simple-token'
        },
        writable: true,
      });
      
      renderWithRouter(<Layout />);
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('admin.token', 'simple-token');
    });

    it('should clean URL after extracting token', () => {
      Object.defineProperty(window, 'location', {
        value: {
          ...mockLocation,
          search: '?admin_token=url-token&other=param'
        },
        writable: true,
      });
      
      renderWithRouter(<Layout />);
      
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        {},
        '',
        'http://localhost:3000/admin'
      );
    });
  });

  describe('Logout', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('valid-token');
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'admin-123', email: 'admin@test.com' })
      });
    });

    it('should logout when logout button is clicked', async () => {
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        const logoutButton = screen.getByText('Выйти');
        fireEvent.click(logoutButton);
      });
      
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('admin.token');
      expect(mockLocation.replace).toHaveBeenCalledWith('/admin');
    });
  });

  describe('Responsive Design', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('valid-token');
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'admin-123', email: 'admin@test.com' })
      });
    });

    it('should handle sidebar collapse on small screens', async () => {
      // Mock small screen
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768,
      });
      
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        expect(screen.getByText('Админка')).toBeInTheDocument();
      });
      
      // Sidebar should be collapsible
      const sidebar = document.querySelector('.ant-layout-sider');
      expect(sidebar).toHaveAttribute('breakpoint', 'lg');
    });

    it('should render correctly on different screen sizes', async () => {
      const { rerender } = renderWithRouter(<Layout />);
      
      await waitFor(() => {
        expect(screen.getByText('Админка')).toBeInTheDocument();
      });
      
      // Test with different viewport sizes
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1200,
      });
      
      window.dispatchEvent(new Event('resize'));
      
      rerender(
        <BrowserRouter>
          <Layout />
        </BrowserRouter>
      );
      
      expect(screen.getByText('Админка')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      localStorageMock.getItem.mockReturnValue('valid-token');
      fetch.mockRejectedValueOnce(new Error('Network error'));
      
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('admin.token');
        expect(screen.getByText('Вход в админку')).toBeInTheDocument();
      });
    });

    it('should handle invalid token gracefully', async () => {
      localStorageMock.getItem.mockReturnValue('invalid-token');
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });
      
      renderWithRouter(<Layout />);
      
      await waitFor(() => {
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('admin.token');
        expect(screen.getByText('Вход в админку')).toBeInTheDocument();
      });
    });
  });
});
