// Повторы вызовов Битрикса: что повторяем, что нет.
jest.mock('axios');
const axios = require('axios');
const { callBitrix } = require('../../../src/lib/bitrix');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BITRIX_REST_URL = 'https://example.invalid/rest/15/token';
});

const httpError = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

it('повторяет сбой сети и отдаёт результат со второй попытки', async () => {
  axios.post
    .mockRejectedValueOnce(new Error('socket hang up'))
    .mockResolvedValueOnce({ data: { result: { ID: '1' } } });

  const data = await callBitrix('crm.lead.get', { id: 1 }, { attempts: 3, retryDelayMs: 0 });

  expect(data.result.ID).toBe('1');
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(axios.post.mock.calls[0][0]).toBe('https://example.invalid/rest/15/token/crm.lead.get');
});

it('повторяет 503 и QUERY_LIMIT_EXCEEDED — вебхук общий с платформой', async () => {
  axios.post
    .mockRejectedValueOnce(httpError(503, { error: 'QUERY_LIMIT_EXCEEDED' }))
    .mockResolvedValueOnce({ data: { error: 'QUERY_LIMIT_EXCEEDED' } })
    .mockResolvedValueOnce({ data: { result: [] } });

  await expect(callBitrix('crm.lead.list', {}, { attempts: 3, retryDelayMs: 0 })).resolves.toEqual({ result: [] });
  expect(axios.post).toHaveBeenCalledTimes(3);
});

it('не повторяет отказ Битрикса по существу (400, неверный ID)', async () => {
  axios.post.mockRejectedValue(httpError(400, { error: 'ERROR_CORE' }));

  await expect(callBitrix('crm.lead.get', { id: 0 }, { attempts: 3, retryDelayMs: 0 })).rejects.toThrow('HTTP 400');
  expect(axios.post).toHaveBeenCalledTimes(1);
});

it('ответ 200 с полем error — это ошибка, а не пустой результат', async () => {
  axios.post.mockResolvedValue({ data: { error: 'NOT_FOUND', error_description: 'Not found' } });

  await expect(callBitrix('crm.lead.get', { id: 5 }, { attempts: 2, retryDelayMs: 0 })).rejects.toThrow('NOT_FOUND');
  expect(axios.post).toHaveBeenCalledTimes(1);
});

it('сдаётся после исчерпания попыток', async () => {
  axios.post.mockRejectedValue(new Error('timeout'));

  await expect(callBitrix('crm.lead.get', { id: 5 }, { attempts: 3, retryDelayMs: 0 })).rejects.toThrow('timeout');
  expect(axios.post).toHaveBeenCalledTimes(3);
});
