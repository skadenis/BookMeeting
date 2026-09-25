// POST /appointments: очередь записей одного лида, повторная запись в тот же
// слот и защита свежей записи от пятиминутной синхронизации.
jest.mock('../../../src/lib/db', () => {
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  return {
    sequelize: {
      transaction: jest.fn(async (fn) => fn(tx)),
      query: jest.fn().mockResolvedValue([[], null]),
    },
    models: {
      Office: { findByPk: jest.fn() },
      Appointment: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), findByPk: jest.fn() },
    },
    Op: { in: Symbol('in'), gte: Symbol('gte') },
    Sequelize: { literal: (s) => s },
  };
});
jest.mock('axios');
jest.mock('../../../src/services/bookingGuard', () => ({
  assertSlotBookable: jest.fn().mockResolvedValue({}),
  BookingError: class BookingError extends Error {},
}));
jest.mock('../../../src/services/appointmentHistory', () => ({
  recordAppointmentChange: jest.fn().mockResolvedValue(null),
  snapshot: (a) => ({ status: a.status }),
}));
jest.mock('../../../src/services/slotsService', () => ({ invalidateSlotsCache: jest.fn() }));
jest.mock('../../../src/lib/ws', () => ({ broadcastSlotsUpdated: jest.fn(), broadcastAppointmentUpdated: jest.fn() }));
jest.mock('../../../src/services/localStatusGuard', () => ({
  markLocalStatusChange: jest.fn().mockResolvedValue(undefined),
  clearLocalStatusChange: jest.fn().mockResolvedValue(undefined),
}));

const express = require('express');
const request = require('supertest');
const { sequelize, models } = require('../../../src/lib/db');
const { assertSlotBookable } = require('../../../src/services/bookingGuard');
const { markLocalStatusChange } = require('../../../src/services/localStatusGuard');
const router = require('../../../src/routes/appointments');

const app = express();
app.use(express.json());
app.use('/appointments', router);

const body = { office_id: 'o1', date: '2030-01-10', time_slot: '10:00-10:30', lead_id: 777 };

beforeEach(() => {
  jest.clearAllMocks();
  models.Office.findByPk.mockResolvedValue({ id: 'o1', bitrixOfficeId: 774 });
  models.Appointment.findAll.mockResolvedValue([]);
  models.Appointment.findOne.mockResolvedValue(null);
  models.Appointment.create.mockImplementation(async (f) => ({ id: 'new', ...f }));
  models.Appointment.findByPk.mockImplementation(async (id) => ({ id }));
});

it('берёт блокировку лида до проверки слота — две записи одного лида идут по очереди', async () => {
  const res = await request(app).post('/appointments').send(body);

  expect(res.status).toBe(201);
  const [sql, opts] = sequelize.query.mock.calls[0];
  expect(sql).toContain('pg_advisory_xact_lock');
  expect(opts.replacements).toEqual({ key: '777' });
  expect(sequelize.query.mock.invocationCallOrder[0]).toBeLessThan(assertSlotBookable.mock.invocationCallOrder[0]);
});

it('повторная запись в тот же слот возвращает существующую встречу и ничего не отменяет', async () => {
  models.Appointment.findOne.mockResolvedValue({ id: 'existing', status: 'pending' });

  const res = await request(app).post('/appointments').send(body);

  expect(res.status).toBe(200);
  expect(res.body.meta).toEqual({ alreadyBooked: true });
  expect(res.body.data.id).toBe('existing');
  expect(models.Appointment.create).not.toHaveBeenCalled();
  expect(models.Appointment.findAll).not.toHaveBeenCalled();
  expect(assertSlotBookable).not.toHaveBeenCalled();
});

it('новая запись защищена от отката синхронизацией, пока Битрикс не принял дату', async () => {
  await request(app).post('/appointments').send(body);

  expect(markLocalStatusChange).toHaveBeenCalledWith('new', 'pending');
});
