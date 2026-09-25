// Выгрузка встреч для платформы: ключ, окно дат, итог встречи по журналу.
jest.mock('../../../src/lib/db', () => ({
  models: {
    Office: { findAll: jest.fn() },
    Appointment: { findAll: jest.fn() },
    AppointmentHistory: { findAll: jest.fn() },
    Schedule: { findAll: jest.fn() },
    Slot: {},
  },
  Op: { between: Symbol('between'), not: Symbol('not'), in: Symbol('in') },
}));

const express = require('express');
const request = require('supertest');
const { models } = require('../../../src/lib/db');
const router = require('../../../src/routes/export');
const { summarizeHistory } = router;

const app = express();
app.use('/api/export', router);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPORT_TOKEN = 'k'.repeat(32);
  models.Office.findAll.mockResolvedValue([{ id: 'o1', city: 'Минск', bitrixOfficeId: '774' }]);
  models.Appointment.findAll.mockResolvedValue([{
    id: 'a1', bitrix_lead_id: '555', office_id: 'o1', date: '2026-09-20', timeSlot: '10:00-10:30',
    status: 'no_show', createdBy: '295', createdAt: new Date('2026-09-19T08:00:00Z'),
  }]);
  models.AppointmentHistory.findAll.mockResolvedValue([
    { appointment_id: 'a1', action: 'created', newValue: {}, createdAt: new Date('2026-09-19T08:00:00Z') },
    { appointment_id: 'a1', action: 'sync_no_show', newValue: { bitrixStatus: '3' }, createdAt: new Date('2026-09-20T07:05:00Z') },
  ]);
  models.Schedule.findAll.mockResolvedValue([
    { office_id: 'o1', date: '2026-09-20', isWorkingDay: true, Slots: [{ capacity: 4, available: true }, { capacity: 4, available: false }] },
  ]);
});

const auth = () => ({ Authorization: `Bearer ${'k'.repeat(32)}` });

it('без ключа в окружении выгрузки нет вовсе', async () => {
  delete process.env.EXPORT_TOKEN;
  const res = await request(app).get('/api/export/appointments?from=2026-09-01&to=2026-09-30').set(auth());
  expect(res.status).toBe(404);
});

it('чужой ключ — 401', async () => {
  const res = await request(app).get('/api/export/appointments?from=2026-09-01&to=2026-09-30').set({ Authorization: 'Bearer wrong' });
  expect(res.status).toBe(401);
});

it('окно больше квартала не отдаётся', async () => {
  const res = await request(app).get('/api/export/appointments?from=2026-01-01&to=2026-09-30').set(auth());
  expect(res.status).toBe(400);
});

it('отдаёт только идентификаторы, итог встречи и вместимость открытых слотов', async () => {
  const res = await request(app).get('/api/export/appointments?from=2026-09-01&to=2026-09-30').set(auth());

  expect(res.status).toBe(200);
  expect(res.body.data.appointments).toEqual([{
    id: 'a1', leadId: 555, officeBitrixId: 774, officeCity: 'Минск', date: '2026-09-20', timeSlot: '10:00-10:30',
    status: 'no_show', bookedBy: 295, createdAt: '2026-09-19T08:00:00.000Z', source: 'widget', overbooked: false,
    closedBy: 'bitrix_status', closedAt: '2026-09-20T07:05:00.000Z', closingBitrixStatus: '3',
  }]);
  expect(res.body.data.capacity).toEqual([{ officeBitrixId: 774, date: '2026-09-20', workingDay: true, slots: 1, capacity: 4 }]);
});

describe('summarizeHistory', () => {
  it('встреча из CRM в полный слот', () => {
    expect(summarizeHistory([{ action: 'created_from_crm_overbooked', createdAt: '2026-09-01T00:00:00Z' }]))
      .toEqual(expect.objectContaining({ source: 'crm', overbooked: true, closedBy: null }));
  });

  it('последнее закрывающее событие побеждает: отмена оператором после перезаписи', () => {
    const s = summarizeHistory([
      { action: 'created', createdAt: '2026-09-01T00:00:00Z' },
      { action: 'status_cancelled', createdAt: '2026-09-02T00:00:00Z' },
    ]);
    expect(s.closedBy).toBe('operator');
  });

  it('старые записи без журнала — источник неизвестен', () => {
    expect(summarizeHistory([])).toEqual({ source: null, overbooked: false, closedBy: null, closedAt: null, closingBitrixStatus: null });
  });
});
