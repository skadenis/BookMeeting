// Правила «стадия лида → статус встречи» — одни на опрос, события и сверку.
const { decideFromLeadStatus, slotCovers, leadMeeting, mapLeadStatus } = require('../../../src/services/leadRules');
const { parseBusinessDateTime } = require('../../../src/lib/time');

// Фиксированное «сейчас»: 25.09.2026 12:00 по Минску
const NOW = parseBusinessDateTime('2026-09-25', '12:00').getTime();
const appt = (overrides = {}) => ({ id: 'a1', date: '2026-09-25', timeSlot: '15:00-15:30', status: 'pending', ...overrides });

describe('mapLeadStatus', () => {
  it.each([
    ['2', 'pending'], ['37', 'confirmed'], ['3', 'no_show'], ['4', 'completed'], ['CONVERTED', 'completed'],
    ['38', null], ['39', null], ['40', null], ['JUNK', null],
  ])('%s → %s', (stage, expected) => {
    expect(mapLeadStatus(stage)).toBe(expected);
  });
});

describe('decideFromLeadStatus: активная встреча', () => {
  it('3 «Не пришёл» → неявка', () => {
    expect(decideFromLeadStatus(appt({ timeSlot: '11:30-12:00' }), '3', NOW)).toEqual({ status: 'no_show', action: 'sync_no_show' });
  });

  it('4 «Находится в офисе» → пришёл', () => {
    expect(decideFromLeadStatus(appt(), '4', NOW)).toEqual({ status: 'completed', action: 'sync_completed' });
  });

  it('CONVERTED → пришёл', () => {
    expect(decideFromLeadStatus(appt(), 'CONVERTED', NOW)).toEqual({ status: 'completed', action: 'sync_completed' });
  });

  it('37 → подтверждена', () => {
    expect(decideFromLeadStatus(appt(), '37', NOW)).toEqual({ status: 'confirmed', action: 'sync_confirmed' });
  });

  it('та же стадия — ничего не менять', () => {
    expect(decideFromLeadStatus(appt(), '2', NOW)).toBeNull();
  });

  it('транзитная IN_PROCESS (перезапись слота шахматкой) — не отмена', () => {
    expect(decideFromLeadStatus(appt(), 'IN_PROCESS', NOW)).toBeNull();
  });

  it('стадия неизвестна (Битрикс не ответил) — ничего не менять', () => {
    expect(decideFromLeadStatus(appt(), undefined, NOW)).toBeNull();
  });

  it('лид ушёл со стадий встречи до её конца — отмена', () => {
    expect(decideFromLeadStatus(appt(), '40', NOW)).toEqual({ status: 'cancelled', action: 'sync_cancelled' });
  });

  it('встреча началась, лид уже в «НДЗ 1» (агент поставил 3, робот сразу увёл дальше) — неявка, а не отмена', () => {
    // 12:00 — встреча 11:30-12:30 идёт; опрос не застал стадию 3
    expect(decideFromLeadStatus(appt({ timeSlot: '11:30-12:30' }), '1', NOW)).toEqual({ status: 'no_show', action: 'sync_no_show' });
    expect(decideFromLeadStatus(appt({ timeSlot: '12:00-12:30' }), 'PROCESSED', NOW)).toEqual({ status: 'no_show', action: 'sync_no_show' });
  });

  it('клиент отказался до начала встречи («Перезвонить») — отмена', () => {
    expect(decideFromLeadStatus(appt({ timeSlot: '12:30-13:00' }), 'PROCESSED', NOW)).toEqual({ status: 'cancelled', action: 'sync_cancelled' });
    expect(decideFromLeadStatus(appt({ date: '2026-09-27' }), '36', NOW)).toEqual({ status: 'cancelled', action: 'sync_cancelled' });
  });

  it('стадия 3 у лида при встрече, которая ещё не началась, — хвост прошлой встречи, не трогать', () => {
    expect(decideFromLeadStatus(appt({ date: '2026-09-27' }), '3', NOW)).toBeNull();
  });

  it('лид ушёл со стадий встречи после её конца (прогрев после неявки) — неявка, а не отмена', () => {
    expect(decideFromLeadStatus(appt({ timeSlot: '10:00-10:30' }), '35', NOW)).toEqual({ status: 'no_show', action: 'sync_no_show' });
  });

  it('лид всё ещё «назначена», а встреча кончилась больше 2 часов назад — неявка', () => {
    expect(decideFromLeadStatus(appt({ timeSlot: '09:00-09:30' }), '2', NOW)).toEqual({ status: 'no_show', action: 'sync_no_show' });
  });
});

describe('decideFromLeadStatus: неявка', () => {
  it('опоздавшего клиента приняли — пришёл', () => {
    expect(decideFromLeadStatus(appt({ status: 'no_show', timeSlot: '10:00-10:30' }), 'CONVERTED', NOW))
      .toEqual({ status: 'completed', action: 'restored_completed' });
  });

  it('вчерашняя неявка, клиент пришёл сегодня по новой записи (лид CONVERTED) — вчера остаётся неявкой', () => {
    expect(decideFromLeadStatus(appt({ status: 'no_show', date: '2026-09-24', timeSlot: '10:00-10:30' }), 'CONVERTED', NOW)).toBeNull();
    expect(decideFromLeadStatus(appt({ status: 'no_show', date: '2026-09-22', timeSlot: '10:00-10:30' }), '4', NOW)).toBeNull();
  });

  it('прошедшая неявка при стадии 2 остаётся неявкой (нет качелей с авто-истечением)', () => {
    expect(decideFromLeadStatus(appt({ status: 'no_show', timeSlot: '10:00-10:30' }), '2', NOW)).toBeNull();
  });

  it('будущая встреча, ошибочно помеченная неявкой, возвращается по стадии 37', () => {
    expect(decideFromLeadStatus(appt({ status: 'no_show' }), '37', NOW)).toEqual({ status: 'confirmed', action: 'restored_confirmed' });
  });

  it('«Перезвонить» не возвращает неявку в активные', () => {
    expect(decideFromLeadStatus(appt({ status: 'no_show' }), 'PROCESSED', NOW)).toBeNull();
  });
});

describe('decideFromLeadStatus: закрытые встречи по стадии не трогаются', () => {
  it.each(['cancelled', 'completed'])('%s', (status) => {
    expect(decideFromLeadStatus(appt({ status }), '3', NOW)).toBeNull();
    expect(decideFromLeadStatus(appt({ status }), 'CONVERTED', NOW)).toBeNull();
  });
});

describe('slotCovers', () => {
  it.each([
    ['15:00-15:30', '15:00', true],
    ['15:00-15:30', '15:05', true],
    ['15:00-15:30', '15:30', false],
    ['15:00-15:30', '14:59', false],
    ['15:00', '15:00', true],
    ['15:00', '15:05', false],
  ])('%s покрывает %s: %s', (slot, time, expected) => {
    expect(slotCovers(slot, time)).toBe(expected);
  });
});

describe('leadMeeting', () => {
  it('дата ISO с зоной и время начала', () => {
    expect(leadMeeting({ UF_CRM_1655460588: '2026-09-26T03:00:00+03:00', UF_CRM_1657019494: '9:30', UF_CRM_1675255265: '774' }))
      .toEqual({ date: '2026-09-26', time: '09:30', officeRef: '774' });
  });

  it('дата ДД.ММ.ГГГГ', () => {
    expect(leadMeeting({ UF_CRM_1655460588: '26.09.2026', UF_CRM_1657019494: '15:00' }).date).toBe('2026-09-26');
  });

  it('без даты или времени встречи нет', () => {
    expect(leadMeeting({ UF_CRM_1655460588: '', UF_CRM_1657019494: '15:00' })).toBeNull();
    expect(leadMeeting({ UF_CRM_1655460588: '2026-09-26', UF_CRM_1657019494: '' })).toBeNull();
  });
});
