import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import updateLocale from 'dayjs/plugin/updateLocale';
import AppointmentsPage from '../../modules/admin/AppointmentsPage';

// Прежняя версия этого набора не проходила ни разу:
//  1. Самодельный мок dayjs не реализовывал add(), и компонент падал прямо
//     в инициализаторе состояния на dayjs().add(1, 'month') — все 23 теста.
//  2. Ожидания были написаны под более старую разметку («Управление
//     встречами», колонка «Действия», плейсхолдер «Поиск по лиду, сделке...»),
//     которой в компоненте давно нет.
// Здесь используется настоящий dayjs и проверяется фактическое поведение.

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
  },
}));

const mockApi = require('../../api/client').default;

dayjs.extend(updateLocale);
dayjs.locale('ru');
dayjs.updateLocale('ru', { weekStart: 1 });

const OFFICE = { id: 'office-1', city: 'Минск', address: 'ул. Тестовая, 1', addressNote: null };

const APPOINTMENTS = [
  {
    id: 'appointment-1',
    date: '2024-01-15',
    timeSlot: '10:00-10:30',
    status: 'pending',
    office_id: OFFICE.id,
    Office: OFFICE,
    bitrix_lead_id: 12345,
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'appointment-2',
    date: '2024-01-16',
    timeSlot: '11:00-11:30',
    status: 'confirmed',
    office_id: OFFICE.id,
    Office: OFFICE,
    bitrix_lead_id: 12346,
    createdAt: '2024-01-15T11:00:00Z',
  },
];

const STATS = {
  total: 2, pending: 1, confirmed: 1, cancelled: 0,
  rescheduled: 0, completed: 0, no_show: 0, expired: 0,
};

function mockEndpoints({ appointments = APPOINTMENTS, total = appointments.length } = {}) {
  mockApi.get.mockImplementation((url) => {
    if (url === '/admin/appointments') {
      return Promise.resolve({ data: { data: appointments, meta: { total, page: 1, pageSize: 20 } } });
    }
    if (url === '/admin/appointments/stats/overview') {
      return Promise.resolve({ data: { data: STATS } });
    }
    if (url === '/admin/offices') {
      return Promise.resolve({ data: { data: [OFFICE] } });
    }
    return Promise.resolve({ data: { data: [] } });
  });
  mockApi.put.mockResolvedValue({ data: { data: {} } });
}

const renderPage = () => render(
  <ConfigProvider>
    <BrowserRouter>
      <AppointmentsPage />
    </BrowserRouter>
  </ConfigProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockEndpoints();
});

describe('AppointmentsPage', () => {
  describe('Разметка', () => {
    it('показывает заголовок страницы', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Встречи')).toBeInTheDocument();
      });
    });

    it('показывает карточки ключевой статистики', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Записано')).toBeInTheDocument();
      });
      expect(screen.getByText('Подтверждено')).toBeInTheDocument();
    });

    it('показывает фильтры', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Период')).toBeInTheDocument();
      });
      // «Статус» встречается и как подпись фильтра, и как заголовок колонки
      expect(screen.getAllByText('Статус').length).toBeGreaterThan(0);
      expect(screen.getByText('Поиск')).toBeInTheDocument();
      expect(screen.getByText('Сбросить')).toBeInTheDocument();
    });

    it('рендерит таблицу встреч', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
    });
  });

  describe('Загрузка данных', () => {
    it('запрашивает встречи, статистику и офисы при монтировании', async () => {
      renderPage();
      await waitFor(() => {
        const urls = mockApi.get.mock.calls.map((c) => c[0]);
        expect(urls).toContain('/admin/appointments');
        expect(urls).toContain('/admin/appointments/stats/overview');
        expect(urls).toContain('/admin/offices');
      });
    });

    it('передаёт границы периода в запрос', async () => {
      renderPage();
      await waitFor(() => {
        const call = mockApi.get.mock.calls.find((c) => c[0] === '/admin/appointments');
        expect(call).toBeDefined();
        expect(call[1].params).toHaveProperty('start_date');
        expect(call[1].params).toHaveProperty('end_date');
      });
    });

    it('отображает данные встреч в таблице', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('15.01.2024')).toBeInTheDocument();
      });
      expect(screen.getByText('16.01.2024')).toBeInTheDocument();
      expect(screen.getByText('10:00-10:30')).toBeInTheDocument();
      expect(screen.getAllByText('Минск').length).toBeGreaterThan(0);
    });

    it('показывает подписи статусов', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Ожидает подтверждения')).toBeInTheDocument();
      });
      expect(screen.getByText('Подтверждена')).toBeInTheDocument();
    });
  });

  describe('Пагинация', () => {
    // Компонент повторно фильтровал уже отфильтрованную сервером страницу
    // по датам, статусу, офису и поиску, но total брал серверный. Над таблицей
    // оставалось «1–20 из 340», а строк было видно три.
    it('показывает все строки, пришедшие с сервера, и серверный total', async () => {
      const outOfRange = {
        ...APPOINTMENTS[0],
        id: 'appointment-3',
        date: '2030-12-31',
        bitrix_lead_id: 99999,
      };
      mockEndpoints({ appointments: [...APPOINTMENTS, outOfRange], total: 340 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('31.12.2030')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      const bodyRows = within(table).getAllByRole('row').slice(1);
      expect(bodyRows).toHaveLength(3);
      expect(screen.getByText(/из 340 встреч/)).toBeInTheDocument();
    });
  });

  describe('Обработка ошибок', () => {
    it('не падает, когда запрос встреч завершился ошибкой', async () => {
      mockApi.get.mockRejectedValue(new Error('Network error'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Встречи')).toBeInTheDocument();
      });
    });

    it('не падает на пустом ответе', async () => {
      mockEndpoints({ appointments: [], total: 0 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
    });
  });
});
