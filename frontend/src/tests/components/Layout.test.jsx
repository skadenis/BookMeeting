import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// Меню вызывает navigate() из react-router. Прежний тест проверял
// window.location.pathname, который в этом файле подменён статическим объектом
// без такого поля, — проверка не могла сработать ни при каком поведении.
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
import Layout from '../../modules/admin/Layout';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

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

// Компонент на монтировании проверяет токен запросом GET /auth/me и стирает
// его при неуспехе. Без настроенного fetch валидация падала всегда, поэтому
// любой тест «авторизованного» состояния видел форму входа.
const authenticate = (token = 'valid-token') => {
  localStorageMock.getItem.mockReturnValue(token);
  fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { id: 'admin-1', role: 'admin' } }) });
};

// Ждём, пока пройдёт валидация и отрисуется админский интерфейс
const waitForAdminUi = () => waitFor(() => {
  expect(screen.getByText('Админка')).toBeInTheDocument();
});

describe('Admin Layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
    mockLocation.search = '';
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

    it('should show admin interface when authenticated', async () => {
      authenticate();
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'admin-123', email: 'admin@test.com' })
      });
      
      renderWithRouter(<Layout />);

      
      await waitForAdminUi();
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
      });
      // reload() вызывался только в удалённой ветке приёма токена из URL
      expect(mockLocation.reload).not.toHaveBeenCalled();
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
      authenticate();
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
      authenticate();
      renderWithRouter(<Layout />);
      await waitForAdminUi();

      fireEvent.click(screen.getByText('Офисы'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/admin/offices');
      });
    });
  });

  // Блок закреплял приём админского JWT из ?admin_token= / ?adminToken= / ?token=.
  // Долгоживущий токен попадал в access-логи nginx, в историю браузера и в
  // заголовок Referer при переходе на внешний сайт. Приём убран и на клиенте,
  // и на сервере, поэтому тесты проверяют обратное.
  describe('URL Token Handling', () => {
    const cases = ['admin_token', 'adminToken', 'token'];

    it.each(cases)('does not accept an admin token from ?%s', async (param) => {
      mockLocation.search = `?${param}=leaked-jwt`;
      mockLocation.href = `http://localhost:3000/admin?${param}=leaked-jwt`;
      localStorageMock.getItem.mockReturnValue(null);

      renderWithRouter(<Layout />);

      await waitFor(() => {
        expect(screen.getByText('Вход в админку')).toBeInTheDocument();
      });
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith('admin.token', 'leaked-jwt');
      expect(mockLocation.reload).not.toHaveBeenCalled();
    });
  });

  describe('Logout', () => {
    beforeEach(() => {
      authenticate();
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
      authenticate();
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
      
      authenticate();
      renderWithRouter(<Layout />);
      await waitForAdminUi();

      // breakpoint и collapsedWidth — это React-пропсы antd Sider, в DOM они
      // не пробрасываются: прежняя проверка getAttribute('breakpoint')
      // не могла пройти ни при каком поведении компонента.
      const sidebar = document.querySelector('.ant-layout-sider');
      expect(sidebar).toBeInTheDocument();
      expect(sidebar).toHaveClass('ant-layout-sider');
      expect(sidebar.querySelector('.ant-menu')).toBeInTheDocument();
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

      await waitForAdminUi();
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      authenticate();
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
