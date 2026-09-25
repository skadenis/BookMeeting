// Приём событий Битрикса: токен, формат стандартного вебхука, склейка ID в
// окне, фильтр лидов по нашей базе без запроса в Битрикс, один запрос на пачку.
jest.mock('axios');
jest.mock('../../../src/lib/db', () => ({
  models: { Appointment: { findAll: jest.fn() } },
  Op: { in: Symbol('in'), gte: Symbol('gte') },
}));
jest.mock('../../../src/services/reconcile', () => ({
  applyLeadState: jest.fn().mockResolvedValue({ ok: true }),
  applyOfficeDeal: jest.fn().mockResolvedValue({ ok: true }),
}));

const express = require('express');
const request = require('supertest');
const axios = require('axios');
const { models } = require('../../../src/lib/db');
const { applyLeadState, applyOfficeDeal } = require('../../../src/services/reconcile');
const events = require('../../../src/services/bitrixEvents');
const router = require('../../../src/routes/bitrixEvents');

const app = express();
app.use('/api/bitrix-events', router);

const leadEvent = (id, token = 'hook-secret', event = 'ONCRMLEADUPDATE') =>
  request(app).post('/api/bitrix-events').type('form')
    .send(`event=${event}&data[FIELDS][ID]=${id}&auth[application_token]=${token}&auth[domain]=crm.example.by`);
const dealEvent = (id) => leadEvent(id, 'hook-secret', 'ONCRMDEALADD');
const methodCalls = (m) => axios.post.mock.calls.filter(([url]) => url.endsWith(`/${m}`));

beforeEach(() => {
  jest.clearAllMocks();
  events.reset();
  process.env.BITRIX_EVENTS_TOKEN = 'hook-secret';
  process.env.BITRIX_REST_URL = 'https://example.invalid/rest/15/x';
  models.Appointment.findAll.mockResolvedValue([]);
  axios.post.mockResolvedValue({ data: { result: [] } });
});

describe('приём', () => {
  it('без настроенного токена приём выключен', async () => {
    delete process.env.BITRIX_EVENTS_TOKEN;
    expect((await leadEvent(1)).status).toBe(503);
  });

  it('чужой application_token — 401 и ничего не копится', async () => {
    expect((await leadEvent(1, 'wrong')).status).toBe(401);
    expect(events.getStats().pendingLeads).toBe(0);
  });

  it('старый формат ?token=&lead_id= больше не принимается', async () => {
    const res = await request(app).post('/api/bitrix-events?token=hook-secret&lead_id=5');
    expect(res.status).toBe(401);
  });

  it('событие принимается сразу (202), в Битрикс в этот момент не ходим', async () => {
    const res = await leadEvent(366226);
    expect(res.status).toBe(202);
    expect(axios.post).not.toHaveBeenCalled();
    expect(events.getStats().pendingLeads).toBe(1);
  });

  it('ненужное событие — 200 без обработки', async () => {
    const res = await leadEvent(5, 'hook-secret', 'ONCRMLEADDELETE');
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });
});

describe('склейка и фильтр', () => {
  it('повторы одного лида в окне — один ID', async () => {
    for (let i = 0; i < 7; i++) await leadEvent(77);
    await leadEvent(78);
    expect(events.getStats()).toEqual(expect.objectContaining({ received: 8, pendingLeads: 2 }));
  });

  it('лиды без незакрытой встречи в шахматке отсеиваются одним запросом в нашу базу, без Битрикса', async () => {
    for (const id of [1, 2, 3, 4]) await leadEvent(id);
    models.Appointment.findAll.mockResolvedValue([]);

    await events.flush();

    expect(models.Appointment.findAll).toHaveBeenCalledTimes(1);
    expect(methodCalls('crm.lead.list')).toHaveLength(0);
    expect(events.getStats().leadsFiltered).toBe(4);
  });

  it('оставшиеся лиды — один crm.lead.list с ID in [...] и только нужными полями', async () => {
    for (const id of [10, 11, 12, 13, 10, 11]) await leadEvent(id);
    models.Appointment.findAll.mockResolvedValue([{ bitrix_lead_id: '11' }, { bitrix_lead_id: '13' }]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '11', STATUS_ID: '3' }, { ID: '13', STATUS_ID: '4' }] } });

    await events.flush();

    const calls = methodCalls('crm.lead.list');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].filter.ID.sort()).toEqual([11, 13]);
    expect(calls[0][1].select).toEqual(events.LEAD_FIELDS);
    expect(applyLeadState).toHaveBeenCalledTimes(2);
    expect(applyLeadState).toHaveBeenCalledWith({ ID: '11', STATUS_ID: '3' }, expect.objectContaining({ source: 'bitrix_event' }));
  });

  it('больше 50 лидов — пачки по 50', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => 1000 + i);
    for (const id of ids) events.enqueue('lead', id);
    models.Appointment.findAll.mockResolvedValue(ids.map((id) => ({ bitrix_lead_id: String(id) })));

    await events.flush();

    expect(methodCalls('crm.lead.list').map(([, p]) => p.filter.ID.length)).toEqual([50, 50, 20]);
  });

  it('сделки — один crm.deal.list по воронке «Офис» на окно, дальше сопоставление со встречами', async () => {
    for (const id of [501, 502, 501]) await dealEvent(id);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '501', LEAD_ID: '77', CONTACT_ID: '9', DATE_CREATE: '2026-09-25T11:00:00+03:00', CATEGORY_ID: '0' }] } });

    await events.flush();

    const calls = methodCalls('crm.deal.list');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].filter).toEqual({ ID: [501, 502], CATEGORY_ID: 0 });
    expect(calls[0][1].select).toEqual(['ID', 'LEAD_ID', 'CONTACT_ID', 'DATE_CREATE', 'CATEGORY_ID']);
    expect(applyOfficeDeal).toHaveBeenCalledTimes(1);
  });

  it('сбой чтения — ID переходят в следующее окно, после трёх неудач списываются', async () => {
    await leadEvent(91);
    models.Appointment.findAll.mockResolvedValue([{ bitrix_lead_id: '91' }]);
    axios.post.mockRejectedValue(new Error('timeout'));

    await events.flush();
    expect(events.getStats().pendingLeads).toBe(1);
    await events.flush();
    await events.flush();

    expect(events.getStats()).toEqual(expect.objectContaining({ pendingLeads: 0, failed: 1 }));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('BITRIX_EVENT_BATCH_FAILED'));
  });
});
