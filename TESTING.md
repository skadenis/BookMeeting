# Testing Guide for BookMeeting

Этот документ описывает систему тестирования проекта BookMeeting, включая backend и frontend тесты.

## 🏗️ Архитектура тестирования

Проект использует многоуровневый подход к тестированию:

- **Unit тесты** - тестирование отдельных функций и компонентов
- **Integration тесты** - тестирование взаимодействия между компонентами
- **E2E тесты** - тестирование полного пользовательского сценария (планируется)

## 🧪 Backend Testing

### Технологии
- **Jest** - основной тестовый фреймворк
- **Supertest** - тестирование HTTP endpoints
- **Sequelize** - тестирование моделей и баз данных

### Структура тестов
```
backend/tests/
├── setup.js                    # Глобальная настройка тестов
├── unit/                       # Unit тесты
│   ├── middleware/            # Тесты middleware
│   ├── models/                # Тесты моделей
│   └── services/              # Тесты сервисов
└── integration/               # Integration тесты
    ├── appointments.test.js    # Тесты API встреч
    └── adminAppointments.test.js # Тесты админки встреч
```

### Запуск backend тестов

```bash
# Все тесты
npm test

# Тесты в watch режиме
npm run test:watch

# Тесты с покрытием
npm run test:coverage

# Только unit тесты
npm run test:unit

# Только integration тесты
npm run test:integration

# Тесты для CI/CD
npm run test:ci
```

### Примеры backend тестов

#### Тест middleware
```javascript
describe('Admin Auth Middleware', () => {
  it('should authenticate with valid Bearer token', () => {
    const payload = { id: 'admin-123', email: 'admin@test.com' };
    const token = signAdminJwt(payload);
    
    mockReq.header.mockReturnValue(`Bearer ${token}`);
    
    adminAuthMiddleware(mockReq, mockRes, mockNext);
    
    expect(mockReq.admin).toBeDefined();
    expect(mockNext).toHaveBeenCalled();
  });
});
```

#### Тест API endpoint
```javascript
describe('GET /api/admin/appointments', () => {
  it('should return appointments list for admin', async () => {
    const response = await request(app)
      .get('/api/admin/appointments')
      .set('Authorization', adminToken)
      .expect(200);

    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('meta');
  });
});
```

## 🎨 Frontend Testing

### Технологии
- **Jest** - основной тестовый фреймворк
- **React Testing Library** - тестирование React компонентов
- **jsdom** - DOM окружение для тестов

### Структура тестов
```
frontend/src/tests/
├── setup.js                    # Глобальная настройка тестов
└── components/                 # Тесты компонентов
    ├── AppointmentsPage.test.jsx
    └── Layout.test.jsx
```

### Запуск frontend тестов

```bash
# Все тесты
npm test

# Тесты в watch режиме
npm run test:watch

# Тесты с покрытием
npm run test:coverage

# Тесты для CI/CD
npm run test:ci

# Интерактивный режим
npm run test:ui
```

### Примеры frontend тестов

#### Тест компонента
```javascript
describe('AppointmentsPage', () => {
  it('should render appointments page title', () => {
    renderWithProviders(<AppointmentsPage />);
    
    expect(screen.getByText('Управление встречами')).toBeInTheDocument();
  });

  it('should load appointments on mount', async () => {
    renderWithProviders(<AppointmentsPage />);
    
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/admin/appointments');
    });
  });
});
```

## 🔧 Настройка тестов

### Environment Variables
Тесты используют специальные переменные окружения:

```bash
# Backend тесты
NODE_ENV=test
DB_HOST=localhost
DB_PORT=5433
DB_NAME=meetings_test
REDIS_HOST=localhost
REDIS_PORT=6380

# Frontend тесты
NODE_ENV=test
```

### Mocking
Проект использует обширное мокирование для изоляции тестов:

- **API calls** - мокируются HTTP запросы
- **Database** - используется тестовая база данных
- **External services** - мокируются Bitrix API
- **Browser APIs** - мокируются localStorage, fetch, etc.

### Test Utilities
Доступны глобальные утилиты для тестов:

```javascript
// Backend
global.testUtils.createTestAppointment()
global.testUtils.createTestOffice()
global.testUtils.createTestAdminToken()

// Frontend
global.testUtils.createMockAppointment()
global.testUtils.createMockOffice()
global.testUtils.mockApiResponse()
global.testUtils.waitFor()
```

## 📊 Покрытие кода

### Backend покрытие
- **Models** - 100% покрытие валидации и ассоциаций
- **Middleware** - 100% покрытие аутентификации
- **Services** - 100% покрытие бизнес-логики
- **Routes** - 100% покрытие API endpoints

### Frontend покрытие
- **Components** - 100% покрытие рендеринга
- **User interactions** - 100% покрытие событий
- **API integration** - 100% покрытие запросов
- **Error handling** - 100% покрытие обработки ошибок

## 🚀 CI/CD Integration

Тесты автоматически запускаются в CI/CD pipeline:

```yaml
# .github/workflows/test.yml
- name: Run Backend Tests
  run: |
    cd backend
    npm run test:ci

- name: Run Frontend Tests
  run: |
    cd frontend
    npm run test:ci
```

## 🐛 Debugging тестов

### Backend debugging
```bash
# Запуск с подробным логированием
DEBUG=* npm test

# Запуск конкретного теста
npm test -- --testNamePattern="Admin Auth Middleware"

# Запуск с отладчиком
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Frontend debugging
```bash
# Запуск с подробным логированием
npm test -- --verbose

# Запуск конкретного теста
npm test -- --testNamePattern="AppointmentsPage"

# Запуск в watch режиме с отладчиком
npm run test:watch -- --verbose
```

## 📝 Написание новых тестов

### Backend тесты
1. Создайте файл в соответствующей папке (`unit/` или `integration/`)
2. Импортируйте тестируемый модуль
3. Напишите тесты с описательными названиями
4. Используйте `beforeEach` и `afterEach` для setup/cleanup
5. Мокируйте внешние зависимости

### Frontend тесты
1. Создайте файл в `tests/components/`
2. Импортируйте компонент и тестовые утилиты
3. Используйте `renderWithProviders` для рендеринга
4. Тестируйте пользовательские взаимодействия
5. Проверяйте состояние и API вызовы

### Пример нового теста
```javascript
describe('New Feature', () => {
  it('should work correctly', async () => {
    // Arrange
    const mockData = testUtils.createMockData();
    
    // Act
    renderWithProviders(<NewComponent data={mockData} />);
    
    // Assert
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

## 🎯 Best Practices

### Общие принципы
- **AAA Pattern** - Arrange, Act, Assert
- **Descriptive names** - названия тестов должны описывать поведение
- **Single responsibility** - каждый тест проверяет одну вещь
- **Clean setup** - используйте `beforeEach` для подготовки данных

### Backend специфика
- **Database isolation** - каждый тест использует чистую БД
- **Mock external services** - не делайте реальные HTTP запросы
- **Test edge cases** - проверяйте граничные условия
- **Validate responses** - проверяйте структуру и типы данных

### Frontend специфика
- **User-centric testing** - тестируйте как пользователь
- **Accessibility testing** - проверяйте доступность
- **Responsive testing** - тестируйте на разных размерах экрана
- **Error boundary testing** - проверяйте обработку ошибок

## 🔍 Troubleshooting

### Частые проблемы

#### Backend тесты падают
```bash
# Проверьте подключение к тестовой БД
npm run test:unit

# Проверьте переменные окружения
echo $NODE_ENV
echo $DB_HOST
```

#### Frontend тесты падают
```bash
# Очистите кеш Jest
npm test -- --clearCache

# Проверьте зависимости
npm install

# Проверьте Babel конфигурацию
node -c babel.config.js
```

#### Тесты медленные
```bash
# Запустите только измененные тесты
npm run test:watch

# Используйте параллельное выполнение
npm test -- --maxWorkers=4
```

## 📚 Дополнительные ресурсы

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

## 🤝 Contributing

При добавлении новых функций обязательно пишите тесты:

1. **Backend** - тесты для новых API endpoints, моделей, сервисов
2. **Frontend** - тесты для новых компонентов и страниц
3. **Integration** - тесты для взаимодействия между компонентами

Покрытие кода должно оставаться не менее 90%.
