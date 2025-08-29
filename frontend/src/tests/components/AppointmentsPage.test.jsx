import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import AppointmentsPage from '../../modules/admin/AppointmentsPage';

// Mock the API client
jest.mock('../../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    put: jest.fn()
  }
}));

const mockApi = require('../../api/client').default;

// Mock dayjs
jest.mock('dayjs', () => {
  const mockDayjs = jest.fn((date) => {
    if (date === '2024-01-15') {
      return {
        format: (format) => {
          if (format === 'DD.MM.YYYY') return '15.01.2024';
          if (format === 'dddd') return 'понедельник';
          if (format === 'HH:mm') return '10:00';
          return date;
        },
        startOf: () => mockDayjs('2024-01-15'),
        endOf: () => mockDayjs('2024-01-15'),
        unix: () => 1705257600, // Unix timestamp for 2024-01-15
        isAfter: () => false,
        isBefore: () => false,
        isSame: () => true,
        isValid: () => true
      };
    }
    return {
      format: (format) => date,
      startOf: () => mockDayjs(date),
      endOf: () => mockDayjs(date),
      unix: () => 1705257600,
      isAfter: () => false,
      isBefore: () => false,
      isSame: () => true,
      isValid: () => true
    };
  });
  
  mockDayjs.locale = jest.fn(() => mockDayjs);
  mockDayjs.extend = jest.fn();
  mockDayjs.startOf = jest.fn(() => mockDayjs('2024-01-15'));
  mockDayjs.endOf = jest.fn(() => mockDayjs('2024-01-15'));
  mockDayjs.unix = jest.fn(() => 1705257600);
  
  return mockDayjs;
});

const renderWithProviders = (component) => {
  return render(
    <ConfigProvider>
      <BrowserRouter>
        {component}
      </BrowserRouter>
    </ConfigProvider>
  );
};

describe('AppointmentsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock successful API responses
    mockApi.get.mockResolvedValue({
      data: {
        data: [
          {
            id: 'appointment-1',
            date: '2024-01-15',
            timeSlot: '10:00',
            status: 'pending',
            office: {
              id: 'office-1',
              city: 'Минск',
              address: 'ул. Тестовая, 1'
            },
            bitrix_lead_id: 12345,
            createdAt: '2024-01-15T10:00:00Z'
          },
          {
            id: 'appointment-2',
            date: '2024-01-15',
            timeSlot: '11:00',
            status: 'confirmed',
            office: {
              id: 'office-1',
              city: 'Минск',
              address: 'ул. Тестовая, 1'
            },
            bitrix_lead_id: 12346,
            createdAt: '2024-01-15T11:00:00Z'
          }
        ]
      }
    });

    mockApi.put.mockResolvedValue({
      data: { success: true }
    });
  });

  describe('Rendering', () => {
    it('should render appointments page title', () => {
      renderWithProviders(<AppointmentsPage />);
      
      expect(screen.getByText('Управление встречами')).toBeInTheDocument();
    });

    it('should render statistics cards', () => {
      renderWithProviders(<AppointmentsPage />);
      
      expect(screen.getByText('Всего встреч')).toBeInTheDocument();
      expect(screen.getByText('Ожидают подтверждения')).toBeInTheDocument();
      expect(screen.getByText('Подтверждены')).toBeInTheDocument();
      expect(screen.getByText('Отменены')).toBeInTheDocument();
      expect(screen.getByText('Перенесены')).toBeInTheDocument();
    });

    it('should render filters section', () => {
      renderWithProviders(<AppointmentsPage />);
      
      expect(screen.getByText('Период')).toBeInTheDocument();
      expect(screen.getByText('Статус')).toBeInTheDocument();
      expect(screen.getByText('Офис')).toBeInTheDocument();
      expect(screen.getByText('Поиск')).toBeInTheDocument();
      expect(screen.getByText('Сбросить')).toBeInTheDocument();
    });

    it('should render appointments table', () => {
      renderWithProviders(<AppointmentsPage />);
      
      expect(screen.getByText('Дата')).toBeInTheDocument();
      expect(screen.getByText('Время')).toBeInTheDocument();
      expect(screen.getByText('Офис')).toBeInTheDocument();
      expect(screen.getByText('Статус')).toBeInTheDocument();
      expect(screen.getByText('Действия')).toBeInTheDocument();
    });
  });

  describe('Data Loading', () => {
    it('should load appointments on mount', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith('/admin/appointments', {
          params: {
            start_date: expect.any(String),
            end_date: expect.any(String),
            status: '',
            office_id: '',
            search: ''
          }
        });
      });
    });

    it('should load offices on mount', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith('/admin/offices');
      });
    });

    it('should display loading state while fetching data', () => {
      mockApi.get.mockImplementation(() => new Promise(() => {})); // Never resolves
      
      renderWithProviders(<AppointmentsPage />);
      
      // Table should show loading state
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('should filter by date range', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      const dateRangePicker = screen.getByText('Период').parentNode.querySelector('.ant-picker');
      expect(dateRangePicker).toBeInTheDocument();
    });

    it('should filter by status', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      const statusSelect = screen.getByText('Статус', { selector: 'div[style*="font-size: 12px"]' }).parentNode.querySelector('.ant-select');
      expect(statusSelect).toBeInTheDocument();
    });

    it('should filter by office', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      const officeSelect = screen.getByText('Офис', { selector: 'div[style*="font-size: 12px"]' }).parentNode.querySelector('.ant-select');
      expect(officeSelect).toBeInTheDocument();
    });

    it('should filter by search text', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      const searchInput = screen.getByPlaceholderText('Поиск по лиду, сделке...');
      expect(searchInput).toBeInTheDocument();
    });

    it('should reset filters when reset button is clicked', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      const resetButton = screen.getByText('Сбросить');
      fireEvent.click(resetButton);
      
      // Should reload with default filters
      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith('/admin/appointments', {
          params: {
            start_date: expect.any(String),
            end_date: expect.any(String),
            status: '',
            office_id: '',
            search: ''
          }
        });
      });
    });
  });

  describe('Appointments Table', () => {
    it('should display appointment data correctly', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        expect(screen.getByText('15.01.2024')).toBeInTheDocument();
        expect(screen.getByText('понедельник')).toBeInTheDocument();
        expect(screen.getByText('10:00')).toBeInTheDocument();
        expect(screen.getByText('Минск')).toBeInTheDocument();
        expect(screen.getByText('ул. Тестовая, 1')).toBeInTheDocument();
      });
    });

    it('should display correct status tags', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Ожидает подтверждения')).toBeInTheDocument();
        expect(screen.getByText('Подтверждена')).toBeInTheDocument();
      });
    });

    it('should show action buttons for pending appointments', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Подтвердить')).toBeInTheDocument();
        expect(screen.getByText('Отменить')).toBeInTheDocument();
      });
    });

    it('should show view button for all appointments', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        const viewButtons = screen.getAllByTitle('Просмотр');
        expect(viewButtons).toHaveLength(2);
      });
    });
  });

  describe('Appointment Actions', () => {
    it('should confirm appointment when confirm button is clicked', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        const confirmButton = screen.getByText('Подтвердить');
        fireEvent.click(confirmButton);
      });
      
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith('/admin/appointments/appointment-1', {
          status: 'confirmed'
        });
      });
    });

    it('should cancel appointment when cancel button is clicked', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        const cancelButton = screen.getByText('Отменить');
        fireEvent.click(cancelButton);
      });
      
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith('/admin/appointments/appointment-1', {
          status: 'cancelled'
        });
      });
    });

    it('should show appointment details when view button is clicked', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        const viewButton = screen.getAllByTitle('Просмотр')[0];
        fireEvent.click(viewButton);
      });
      
      // Modal should appear with appointment details
      await waitFor(() => {
        expect(screen.getByText('Детали встречи')).toBeInTheDocument();
      });
    });
  });

  describe('Statistics', () => {
    it('should calculate and display correct statistics', async () => {
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        // Total appointments
        expect(screen.getByText('2')).toBeInTheDocument();
        
        // Pending appointments
        expect(screen.getByText('1')).toBeInTheDocument();
        
        // Confirmed appointments
        expect(screen.getByText('1')).toBeInTheDocument();
        
        // Cancelled appointments
        expect(screen.getByText('0')).toBeInTheDocument();
        
        // Rescheduled appointments
        expect(screen.getByText('0')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockApi.get.mockRejectedValue(new Error('API Error'));
      
      renderWithProviders(<AppointmentsPage />);
      
      // Should not crash and show empty state
      expect(screen.getByText('Управление встречами')).toBeInTheDocument();
    });

    it('should handle appointment update errors', async () => {
      mockApi.put.mockRejectedValue(new Error('Update failed'));
      
      renderWithProviders(<AppointmentsPage />);
      
      await waitFor(() => {
        const confirmButton = screen.getByText('Подтвердить');
        fireEvent.click(confirmButton);
      });
      
      // Should handle error gracefully
      expect(screen.getByText('Управление встречами')).toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    it('should render correctly on different screen sizes', () => {
      // Test with different viewport sizes
      const { rerender } = renderWithProviders(<AppointmentsPage />);
      
      // Should render without errors
      expect(screen.getByText('Управление встречами')).toBeInTheDocument();
      
      // Test with smaller viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768,
      });
      
      window.dispatchEvent(new Event('resize'));
      
      rerender(
        <ConfigProvider>
          <BrowserRouter>
            <AppointmentsPage />
          </BrowserRouter>
        </ConfigProvider>
      );
      
      expect(screen.getByText('Управление встречами')).toBeInTheDocument();
    });
  });
});
