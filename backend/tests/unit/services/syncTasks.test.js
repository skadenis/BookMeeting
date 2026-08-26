jest.mock('../../../src/lib/db', () => ({
  models: {
    Appointment: { findAll: jest.fn() },
    Office: {}
  },
  Op: { not: Symbol('not'), in: Symbol('in') },
  Sequelize: {}
}));

jest.mock('axios');

const axios = require('axios');
const { models } = require('../../../src/lib/db');
const { autoSyncStatuses } = require('../../../src/services/syncTasks');

const today = require('dayjs')().format('YYYY-MM-DD');

function makeAppointment(overrides = {}) {
  return {
    id: 'a1',
    bitrix_lead_id: 12345,
    date: today,
    timeSlot: '23:00-23:30', // late enough that isPastDue is false during the test run
    status: 'pending',
    update: jest.fn(function (fields) { Object.assign(this, fields); return Promise.resolve(this); }),
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BITRIX_REST_URL = 'https://example.invalid/rest/1/token';
});

describe('autoSyncStatuses', () => {
  it('leaves appointments untouched when Bitrix does not answer', async () => {
    const appointment = makeAppointment();
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockRejectedValue(new Error('timeout of 15000ms exceeded'));

    const result = await autoSyncStatuses();

    expect(appointment.update).not.toHaveBeenCalled();
    expect(appointment.status).toBe('pending');
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('leaves appointments untouched when Bitrix omits the lead from the batch', async () => {
    const appointment = makeAppointment();
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [] } });

    const result = await autoSyncStatuses();

    expect(appointment.update).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('applies the Bitrix status when the lead is returned', async () => {
    const appointment = makeAppointment({ status: 'pending' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: '37' }] } });

    const result = await autoSyncStatuses();

    expect(appointment.update).toHaveBeenCalledWith({ status: 'confirmed' });
    expect(result.updated).toBe(1);
  });

  // Тест закреплял отмену встречи при стадии IN_PROCESS. Но в эту стадию лид
  // переводит само приложение: ensureLeadStage сначала ставит IN_PROCESS и
  // только потом целевую стадию. Синхронизация видела промежуточное состояние,
  // считала, что лид ушёл со стадий встречи, и отменяла живую запись —
  // встреча пропадала из виджета. IN_PROCESS означает «ещё не доехало».
  it('leaves the appointment alone on a transient Bitrix stage', async () => {
    const appointment = makeAppointment({ status: 'pending' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: 'IN_PROCESS' }] } });

    const result = await autoSyncStatuses();

    expect(appointment.update).not.toHaveBeenCalled();
    expect(appointment.status).toBe('pending');
    expect(result.skipped).toBe(1);
  });

  it('cancels when the lead really left the meeting stages in Bitrix', async () => {
    const appointment = makeAppointment({ status: 'pending' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: 'JUNK' }] } });

    await autoSyncStatuses();

    expect(appointment.update).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('fetches every lead in one batched call instead of one call per lead', async () => {
    const appointments = Array.from({ length: 30 }, (_, i) =>
      makeAppointment({ id: `a${i}`, bitrix_lead_id: 1000 + i })
    );
    models.Appointment.findAll.mockResolvedValue(appointments);
    axios.post.mockResolvedValue({ data: { result: [] } });

    await autoSyncStatuses();

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('crm.lead.list');
  });

  it('only looks at today\'s appointments', async () => {
    models.Appointment.findAll.mockResolvedValue([]);
    axios.post.mockResolvedValue({ data: { result: [] } });

    await autoSyncStatuses();

    expect(models.Appointment.findAll.mock.calls[0][0].where.date).toBe(today);
  });
});
