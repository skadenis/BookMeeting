// Приём событий Битрикса: токен, форматы, очередь (схлопывание дублей, повторы).
jest.mock('../../../src/services/reconcile', () => ({
  reconcileLead: jest.fn().mockResolvedValue({ ok: true }),
  reconcileOfficeDeal: jest.fn().mockResolvedValue({ ok: true }),
}));

const express = require('express');
const request = require('supertest');
const { reconcileLead, reconcileOfficeDeal } = require('../../../src/services/reconcile');
const events = require('../../../src/services/bitrixEvents');
const router = require('../../../src/routes/bitrixEvents');

const app = express();
app.use(express.json());
app.use('/api/bitrix-events', router);

beforeEach(() => {
  jest.clearAllMocks();
  events.reset();
  events.resume();
  process.env.BITRIX_EVENTS_TOKEN = 'hook-secret';
});

describe('авторизация', () => {
  it('без настроенного токена приём выключен', async () => {
    delete process.env.BITRIX_EVENTS_TOKEN;
    const res = await request(app).post('/api/bitrix-events').send({ lead_id: 1, token: 'x' });
    expect(res.status).toBe(503);
  });

  it('чужой токен — 401, в CRM не ходим', async () => {
    const res = await request(app).post('/api/bitrix-events?token=wrong&lead_id=1');
    expect(res.status).toBe(401);
    await events.idle();
    expect(reconcileLead).not.toHaveBeenCalled();
  });

  it('стандартное событие Битрикса: form-urlencoded, auth[application_token]', async () => {
    const res = await request(app)
      .post('/api/bitrix-events')
      .type('form')
      .send('event=ONCRMLEADUPDATE&data[FIELDS][ID]=366226&auth[application_token]=hook-secret&auth[domain]=crm.example.by');
    expect(res.status).toBe(202);
    await events.idle();
    expect(reconcileLead).toHaveBeenCalledWith(366226, expect.objectContaining({ event: 'ONCRMLEADUPDATE' }));
  });

  it('робот / свой обработчик портала: ?token=&deal_id=', async () => {
    const res = await request(app).get('/api/bitrix-events?token=hook-secret&deal_id=4242');
    expect(res.status).toBe(202);
    await events.idle();
    expect(reconcileOfficeDeal).toHaveBeenCalledWith(4242, expect.objectContaining({ event: 'ROBOT' }));
  });

  it('ненужное событие принимается без обработки (Битрикс не должен считать адрес сломанным)', async () => {
    const res = await request(app).post('/api/bitrix-events').type('form')
      .send('event=ONCRMLEADDELETE&auth[application_token]=hook-secret');
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });
});

describe('очередь', () => {
  it('дубли одного лида схлопываются, пока не обработаны', async () => {
    events.pause();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/bitrix-events?token=hook-secret&lead_id=77');
    }
    await request(app).post('/api/bitrix-events?token=hook-secret&lead_id=78');
    expect(events.getStats().queued).toBe(2);
    events.resume();
    await events.idle();
    expect(reconcileLead).toHaveBeenCalledTimes(2);
  });

  it('сбой обработки повторяется, и событие не теряется', async () => {
    reconcileLead.mockRejectedValueOnce(new Error('Bitrix timeout')).mockResolvedValueOnce({ ok: true });
    await request(app).post('/api/bitrix-events?token=hook-secret&lead_id=91');
    await events.idle();
    await new Promise((r) => setTimeout(r, 50));
    await events.idle();
    expect(reconcileLead).toHaveBeenCalledTimes(2);
    expect(events.getStats()).toEqual(expect.objectContaining({ processed: 1, retried: 1, failed: 0 }));
  });

  it('после трёх неудач событие списывается с маркером BITRIX_EVENT_FAILED (дальше — опрос и сверка)', async () => {
    reconcileLead.mockRejectedValue(new Error('down'));
    await request(app).post('/api/bitrix-events?token=hook-secret&lead_id=92');
    for (let i = 0; i < 10 && events.getStats().failed === 0; i++) {
      await new Promise((r) => setTimeout(r, 30));
      await events.idle();
    }
    expect(reconcileLead).toHaveBeenCalledTimes(3);
    expect(events.getStats().failed).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('BITRIX_EVENT_FAILED lead:92'));
    reconcileLead.mockReset();
  });
});
