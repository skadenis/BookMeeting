const dayjs = require('dayjs');
const axios = require('axios');
const { models, Op, Sequelize } = require('../lib/db');
const { businessToday, businessNowParts, slotStart } = require('../lib/time');
const { hasRecentLocalStatusChange } = require('./localStatusGuard');
const { recordAppointmentChange } = require('./appointmentHistory');
const {
  BITRIX_STATUS_MAPPING,
  BITRIX_TRANSIENT_STATUSES,
  decideFromLeadStatus,
  slotCovers,
  leadMeeting,
} = require('./leadRules');

// Фоновые изменения встреч раньше не попадали в журнал: из ~1 500 отмен за месяц
// без записи в appointment_history нельзя было понять, отменил ли встречу
// оператор или синхронизация по стадии лида. Теперь каждое изменение фоновой
// задачи пишется с источником и стадией Битрикса.
async function recordSyncChange(appointment, action, before, extra = {}) {
  await recordAppointmentChange({
    appointmentId: appointment.id,
    action,
    oldValue: before,
    newValue: { status: appointment.status, date: appointment.date, timeSlot: appointment.timeSlot, office_id: appointment.office_id, ...extra },
    actor: { type: 'system', id: null, source: extra.source || 'sync', ...(extra.bitrixUserId ? { bitrixUserId: extra.bitrixUserId } : {}) },
  });
}

// Карта стадий и правила «стадия лида → статус встречи» живут в leadRules.js:
// их читают опрос, события Битрикса и суточная сверка.

const { restUrl: getBitrixRestUrl, callBitrix } = require('../lib/bitrix');

const RETRY_DELAY_MS = () => Number(process.env.BITRIX_RETRY_DELAY_MS ?? 1000);

// Fetch STATUS_ID for many leads at once. Returns a Map(leadId -> STATUS_ID);
// leads whose batch request failed are simply absent from the map.
async function fetchLeadStatuses(leadIds) {
  const statusById = new Map();
  for (let i = 0; i < leadIds.length; i += 50) {
    const chunk = leadIds.slice(i, i + 50);
    try {
      // Две попытки на пачку: одиночный сбой сети раньше выбрасывал из
      // проверки сразу 50 встреч до следующего прогона.
      const data = await callBitrix('crm.lead.list', {
        filter: { ID: chunk.map(Number) },
        select: ['ID', 'STATUS_ID']
      }, { attempts: 2, retryDelayMs: RETRY_DELAY_MS() });
      for (const lead of data?.result || []) {
        statusById.set(Number(lead.ID), lead.STATUS_ID);
      }
    } catch (error) {
      console.error(`Service: error fetching lead batch ${i / 50 + 1}:`, error.message);
    }
  }
  return statusById;
}

// Применить решение leadRules к встрече: сохранить, записать в журнал,
// сбросить кеш сетки. Возвращает true, если встреча изменилась.
async function applyDecision(appointment, decision, trace) {
  if (!decision || decision.status === appointment.status) return false;
  const before = { status: appointment.status };
  await appointment.update({ status: decision.status });
  await recordSyncChange(appointment, decision.action, before, trace);
  try {
    const { invalidateSlotsCache } = require('./slotsService');
    const { broadcastSlotsUpdated } = require('../lib/ws');
    if (appointment.office_id && appointment.date) {
      await invalidateSlotsCache(appointment.office_id, appointment.date);
      broadcastSlotsUpdated(appointment.office_id, appointment.date);
    }
  } catch (e) {
    console.error('Service: не удалось сбросить кеш сетки', e?.message || e);
  }
  return true;
}

async function autoSyncStatuses() {
  console.log('Starting automatic status sync with Bitrix24 (service)...');

  // Only today's appointments: older ones are already settled in the CRM and
  // re-syncing them would overwrite decisions made there.
  const today = businessToday();
  const appointmentsToCheck = await models.Appointment.findAll({
    where: {
      bitrix_lead_id: { [Op.not]: null },
      date: today,
      status: { [Op.in]: ['pending', 'confirmed', 'rescheduled'] }
    },
    include: [{ model: models.Office, attributes: ['city', 'address'] }]
  });

  const leadIds = [...new Set(appointmentsToCheck.map(a => Number(a.bitrix_lead_id)))];
  console.log(`Service: checking ${leadIds.length} unique leads for ${today} in Bitrix24`);

  const statusById = await fetchLeadStatuses(leadIds);

  let updatedCount = 0;
  let noShowCount = 0;
  let skippedCount = 0;
  let guardedCount = 0;

  for (const appointment of appointmentsToCheck) {
    const leadId = Number(appointment.bitrix_lead_id);

    // Bitrix did not answer for this lead — leave the appointment alone.
    // Treating a network failure as "no status" used to cancel live bookings.
    if (!statusById.has(leadId)) {
      skippedCount++;
      continue;
    }

    const bitrixStatus = statusById.get(leadId);
    const newStatus = BITRIX_STATUS_MAPPING[bitrixStatus] || bitrixStatus;

    // Оператор только что менял статус вручную, а до Bitrix это ещё могло не
    // доехать. Не затираем его решение промежуточным состоянием CRM.
    if (await hasRecentLocalStatusChange(appointment.id)) {
      guardedCount++;
      continue;
    }

    // Транзитная стадия — просто ждём следующего прогона.
    if (BITRIX_TRANSIENT_STATUSES.has(bitrixStatus)) {
      skippedCount++;
      continue;
    }

    const decision = decideFromLeadStatus(appointment, bitrixStatus);
    if (!decision) continue;
    if (decision.status === 'cancelled') {
      console.log(`Service: лид ${leadId} в стадии ${bitrixStatus} — отменяю встречу ${appointment.id}`);
    }
    const changed = await applyDecision(appointment, decision, { source: 'bitrix_status_sync', bitrixStatus });
    if (!changed) continue;
    if (decision.status === 'no_show' && newStatus !== 'no_show') noShowCount++;
    else updatedCount++;
  }

  console.log(`Service status sync complete: ${updatedCount} updated, ${noShowCount} marked as no_show, ${skippedCount} skipped, ${guardedCount} protected (recent operator action)`);
  return {
    checked: appointmentsToCheck.length,
    updated: updatedCount,
    no_show: noShowCount,
    skipped: skippedCount
  };
}

async function autoExpireAppointments() {
  console.log('Starting automatic appointment expiration (service)...');
  // Настенное время бизнес-зоны: в БД лежат локальные "YYYY-MM-DD" и "HH:mm",
  // и сравнивать их с временем процесса (UTC) было некорректно.
  const cutoff = businessNowParts(new Date(Date.now() - 2 * 3600 * 1000));
  const cutoffTime = `${cutoff.date} ${cutoff.time}`;

  // sequelize.col() подставляет имя в SQL как есть и НЕ отображает атрибут
  // модели на field. Атрибут называется timeSlot, а колонка в БД — time_slot,
  // поэтому запрос уходил с "timeSlot" и падал с
  //   ERROR: column "timeSlot" does not exist
  // Ежечасное авто-истечение не отрабатывало ни разу, ошибка тонула в catch.
  //
  // Второй момент: для исторического короткого формата "HH:MM" (без дефиса)
  // SPLIT_PART(..., '-', 2) возвращает пустую строку, и сравнение
  // 'YYYY-MM-DD ' < cutoff было истиной с начала суток — встреча помечалась
  // неявкой ещё до своего начала. NULLIF + COALESCE берут в этом случае
  // само значение time_slot.
  const col = models.Appointment.sequelize.col.bind(models.Appointment.sequelize);
  const fn = models.Appointment.sequelize.fn.bind(models.Appointment.sequelize);
  const endTimeExpr = fn(
    'COALESCE',
    fn('NULLIF', fn('SPLIT_PART', col('time_slot'), '-', 2), ''),
    col('time_slot')
  );

  const expiredAppointments = await models.Appointment.findAll({
    where: {
      status: { [Op.in]: ['pending', 'confirmed'] },
      [Op.and]: [
        models.Appointment.sequelize.where(
          fn('CONCAT', col('date'), ' ', endTimeExpr),
          { [Op.lt]: cutoffTime }
        )
      ]
    }
  });

  let noShowCount = 0;
  for (const appointment of expiredAppointments) {
    const before = { status: appointment.status };
    await appointment.update({ status: 'no_show' });
    await recordSyncChange(appointment, 'expired_no_show', before, { source: 'auto_expire' });
    noShowCount++;
  }

  console.log(`Service: marked ${noShowCount} appointments as no_show`);
  return { checked: expiredAppointments.length, no_show: noShowCount };
}

async function dedupeAppointments({ dryRun = false } = {}) {
  console.log('Starting appointment dedupe (service)...');
  const all = await models.Appointment.findAll({
    where: { bitrix_lead_id: { [Op.not]: null } },
    order: [['createdAt','ASC']]
  });
  const keyMap = new Map();
  const toDelete = [];
  for (const a of all) {
    const key = `${a.bitrix_lead_id}__${a.office_id}__${a.date}__${a.timeSlot}`;
    if (!keyMap.has(key)) keyMap.set(key, a); else toDelete.push(a);
  }
  if (!dryRun) {
    for (const d of toDelete) await d.destroy();
  }
  return { duplicates: toDelete.length, dry_run: !!dryRun };
}

async function fetchAndAnalyzeBitrixLeads() {
  console.log('Service: Starting Bitrix24 leads fetch & analyze...');
  const allLeads = [];
  let start = 0;
  let pageCount = 0;

  // Fetch via crm.lead.list paging
  // SELECT fields reflect route logic
  while (true) {
    console.log(`Service: Fetching leads page ${pageCount + 1}, start: ${start}`);
    // Ключи ДОЛЖНЫ быть в нижнем регистре: Bitrix REST игнорирует SELECT/FILTER,
    // и фильтр по стадиям не применялся — выгружались все лиды подряд, а затем
    // каждый из них становился кандидатом на создание встречи.
    // В fetchLeadStatuses и checkNoShowLeads в этом же файле регистр верный.
    const response = await axios.post(getBitrixRestUrl('crm.lead.list'), {
      select: [
        'ID', 'UF_CRM_1675255265', 'UF_CRM_1725445029', 'UF_CRM_1725483092',
        'UF_CRM_1655460588', 'UF_CRM_1657019494', 'STATUS_ID'
      ],
      filter: { STATUS_ID: [2, 37] },
      start
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });

    const data = response.data;
    const part = data?.result || [];
    console.log(`Service: received ${part.length} leads`);
    if (part.length === 0) break;
    allLeads.push(...part);
    pageCount++;
    if (data.next) start = data.next; else break;
    if (pageCount > 100) { console.warn('Service: too many pages, stopping'); break; }
  }

  console.log(`Service: total leads fetched: ${allLeads.length}`);

  // Раньше выбирались ВСЕ встречи без фильтра, а Map оставлял последнюю
  // попавшуюся на лид. Если у лида была встреча месяц назад, новая запись из
  // CRM не создавалась — вместо этого прошлой встрече переписывали дату и
  // время, то есть завершённая встреча «переезжала» в будущее.
  // Берём только активные встречи от сегодняшнего дня.
  const existingAppointments = await models.Appointment.findAll({
    attributes: ['id', 'bitrix_lead_id', 'status', 'date', 'timeSlot'],
    where: {
      bitrix_lead_id: { [Op.not]: null },
      status: { [Op.in]: ['pending', 'confirmed', 'rescheduled'] },
      date: { [Op.gte]: businessToday() }
    },
    order: [['date', 'ASC']]
  });
  const existingLeadMap = new Map();
  existingAppointments.forEach(app => {
    // Ключ приводим к строке: bitrix_lead_id — BIGINT, Sequelize отдаёт его
    // строкой, а lead.ID из Bitrix тоже строка, но полагаться на это нельзя
    if (app.bitrix_lead_id) existingLeadMap.set(String(app.bitrix_lead_id), app);
  });

  const toCreate = [];
  const toUpdate = [];
  allLeads.forEach(lead => {
    try {
      const existingAppointment = existingLeadMap.get(String(lead.ID));
      const bitrixStatus = BITRIX_STATUS_MAPPING[lead.STATUS_ID] || 'pending';
      const meeting = leadMeeting(lead);
      if (!meeting) {
        // Лид на стадии встречи, но дата или время не заполнены — создавать
        // или переписывать по нему нечего.
        return;
      }
      const leadDate = meeting.date;
      const leadTimeStart = meeting.time;

      // Встречи с прошедшей датой не заводим: лид, застрявший в стадии
      // «Назначена встреча» со старой датой, превращался бы в вечный цикл
      // autoExpireAppointments (ставит no_show) ↔ checkNoShowLeads
      // (восстанавливает по стадии Bitrix).
      if (leadDate < businessToday()) {
        return;
      }

      const row = {
        ID: String(lead.ID),
        STATUS_ID: lead.STATUS_ID,
        UF_CRM_1675255265: lead.UF_CRM_1675255265,
        UF_CRM_1725445029: lead.UF_CRM_1725445029,
        UF_CRM_1725483092: lead.UF_CRM_1725483092,
        UF_CRM_1655460588: lead.UF_CRM_1655460588,
        UF_CRM_1657019494: lead.UF_CRM_1657019494,
        bitrix_lead_id: lead.ID,
        office_id: lead.UF_CRM_1675255265,
        date: leadDate,
        timeSlot: leadTimeStart,
        status: bitrixStatus
      };

      if (!existingAppointment) {
        toCreate.push(row);
      } else {
        // В лиде Bitrix хранится только время начала («15:00»), а слот в
        // приложении — интервал («15:00-15:30»). Сравниваем «слот покрывает
        // время лида»: сравнение сырых строк считало каждую встречу
        // «изменившейся», а время вне сетки (15:05) привязывается к слоту
        // 15:00-15:30 и тоже не должно переписываться каждые 5 минут.
        const needsUpdate = (
          existingAppointment.status !== bitrixStatus ||
          existingAppointment.date !== leadDate ||
          !slotCovers(existingAppointment.timeSlot, leadTimeStart)
        );
        if (needsUpdate) {
          toUpdate.push({
            id: existingAppointment.id,
            ...row,
            currentStatus: existingAppointment.status,
            currentDate: existingAppointment.date,
            currentTime: existingAppointment.timeSlot
          });
        }
      }
    } catch (error) {
      console.error('Service: error processing lead', lead?.ID, error);
    }
  });

  const groupedToCreate = toCreate.reduce((acc, lead) => {
    const officeId = lead.office_id || 'unknown';
    if (!acc[officeId]) acc[officeId] = [];
    acc[officeId].push(lead);
    return acc;
  }, {});

  const groupedToUpdate = toUpdate.reduce((acc, lead) => {
    const officeId = lead.office_id || 'unknown';
    if (!acc[officeId]) acc[officeId] = [];
    acc[officeId].push(lead);
    return acc;
  }, {});

  const createList = Object.entries(groupedToCreate).map(([officeId, leads]) => ({ officeId, leads, count: leads.length, actionType: 'create' }));
  const updateList = Object.entries(groupedToUpdate).map(([officeId, leads]) => ({ officeId, leads, count: leads.length, actionType: 'update' }));

  console.log(`Service: analyze complete: ${createList.length} office groups to create, ${updateList.length} to update`);
  console.log(`Service: detailed analysis - toCreate: ${toCreate.length} leads, toUpdate: ${toUpdate.length} leads`);
  if (toCreate.length > 0) {
    console.log(`Service: leads to create:`, toCreate.map(l => ({ bitrix_lead_id: l.bitrix_lead_id, office_id: l.office_id, date: l.date, timeSlot: l.timeSlot })));
  }
  if (toUpdate.length > 0) {
    console.log(`Service: leads to update:`, toUpdate.map(l => ({ id: l.id, bitrix_lead_id: l.bitrix_lead_id, office_id: l.office_id, date: l.date, timeSlot: l.timeSlot })));
  }
  return {
    totalBitrixLeads: allLeads.length,
    toCreate: createList,
    toUpdate: updateList,
    createCount: toCreate.length,
    updateCount: toUpdate.length,
    allLeads
  };
}

module.exports = {
  autoSyncStatuses,
  autoExpireAppointments,
  dedupeAppointments,
  fetchAndAnalyzeBitrixLeads,
  checkNoShowLeads
};

// Bitrix отдаёт только время начала («15:00»), а расписание и виджет живут
// интервалами («15:00-15:30»). Ищем в расписании офиса слот с таким началом и
// достраиваем интервал. Время вне сетки («15:05», «20:20» — 25 встреч за
// 02–24.09) привязываем к слоту, который его покрывает: раньше такие встречи
// пропускались, и сетка показывала свободное место, которого нет.
async function resolveFullTimeSlot(officeId, date, rawTimeSlot) {
  const normalized = String(rawTimeSlot || '').replace(/\s+/g, '');
  if (normalized.includes('-')) return normalized;
  const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
  if (!schedule) return normalized;
  const padded = normalized.padStart(5, '0');
  const exact = await models.Slot.findOne({ where: { schedule_id: schedule.id, start: padded } });
  if (exact) return `${exact.start}-${exact.end}`;
  const all = await models.Slot.findAll({ where: { schedule_id: schedule.id } });
  const covering = (all || []).find((sl) => slotCovers(`${sl.start}-${sl.end}`, padded));
  return covering ? `${covering.start}-${covering.end}` : normalized;
}

// Локальный UUID офиса по ссылке из лида (UUID или числовой ID офиса Битрикса)
async function resolveOfficeId(officeRef) {
  if (!officeRef) return null;
  const ref = String(officeRef);
  const uuidLike = /^[0-9a-fA-F-]{36}$/i.test(ref);
  if (uuidLike) {
    const office = await models.Office.findByPk(ref);
    if (office) return office.id;
  }
  const numeric = Number(ref);
  if (Number.isFinite(numeric)) {
    const office = await models.Office.findOne({ where: { bitrixOfficeId: numeric } });
    if (office) return office.id;
  }
  return null;
}

function notifySlots(officeId, date) {
  const { invalidateSlotsCache } = require('./slotsService');
  const { broadcastSlotsUpdated } = require('../lib/ws');
  return Promise.resolve(invalidateSlotsCache(officeId, date))
    .then(() => broadcastSlotsUpdated(officeId, date))
    .catch((e) => console.error('Service: не удалось сбросить кеш сетки', e?.message || e));
}

/**
 * Завести встречу, назначенную в Битриксе мимо сетки.
 * lead: { bitrix_lead_id, office_id (ссылка из лида), date, timeSlot, status, STATUS_ID }
 * Возвращает { created, appointment } | { skipped: reason } | { exists } | { invalidOffice }.
 */
async function createAppointmentFromLead(lead, trace = {}) {
  const { assertSlotBookable, BookingError } = require('./bookingGuard');
  const { recordBypass } = require('./bypassLog');
  const bypass = {
    leadId: lead.bitrix_lead_id, officeRef: lead.office_id, date: lead.date, time: slotStart(lead.timeSlot),
    bitrixStatus: lead.STATUS_ID, bitrixUserId: trace.bitrixUserId, source: trace.source || 'leads_sync',
  };
  const localOfficeId = await resolveOfficeId(lead.office_id);
  if (!localOfficeId) {
    await recordBypass({ ...bypass, outcome: 'no_office' });
    return { invalidOffice: true };
  }
  const fullTimeSlot = await resolveFullTimeSlot(localOfficeId, lead.date, lead.timeSlot);
  const exists = await models.Appointment.findOne({
    where: {
      bitrix_lead_id: lead.bitrix_lead_id,
      office_id: localOfficeId,
      date: lead.date,
      timeSlot: { [Op.in]: [fullTimeSlot, slotStart(fullTimeSlot)] }
    }
  });
  if (exists) return { exists: true, appointment: exists };

  // Прошедшие даты и горизонт записи здесь не ограничиваем: CRM может
  // легитимно прислать запись задним числом.
  //
  // Полный слот НЕ повод пропускать встречу. Встреча, назначенная в
  // Битриксе мимо шахматки, уже существует (стадия 2 + дата/время лида —
  // канонический факт), и клиент придёт независимо от того, покажет ли
  // её сетка. Раньше такие лиды пропускались (84 лида с 02.09 по 25.09):
  // сетка показывала свободные места, которых нет, и операторы
  // дописывали в переполненный слот ещё людей. Теперь встреча заводится,
  // слот честно показывает «мест нет», перебор виден в логе.
  // День без расписания по-прежнему пропускается: такую запись не к чему
  // привязать, и она мешала бы применению шаблона
  // (scheduleRewrite.findOrphanedAppointments).
  let overbooked = false;
  try {
    await assertSlotBookable({
      officeId: localOfficeId,
      date: lead.date,
      timeSlot: fullTimeSlot,
      allowPast: true,
      enforceHorizon: false
    });
  } catch (guardError) {
    if (guardError instanceof BookingError && guardError.reason === 'slot_full') {
      overbooked = true;
      console.warn(`OVERBOOKED_FROM_CRM lead=${lead.bitrix_lead_id} office=${localOfficeId} ${lead.date} ${fullTimeSlot}: встреча назначена в Битриксе в полный слот`);
    } else if (guardError instanceof BookingError) {
      console.warn(`Service: пропускаю лид ${lead.bitrix_lead_id} — ${guardError.reason}: ${guardError.message}`);
      await recordBypass({ ...bypass, outcome: guardError.reason });
      return { skipped: guardError.reason };
    } else {
      throw guardError;
    }
  }

  const createdAppt = await models.Appointment.create({
    bitrix_lead_id: lead.bitrix_lead_id,
    office_id: localOfficeId,
    date: lead.date,
    timeSlot: fullTimeSlot,
    status: lead.status || 'pending',
    createdBy: 0
  });
  await recordSyncChange(createdAppt, overbooked ? 'created_from_crm_overbooked' : 'created_from_crm', null, {
    source: 'leads_sync', bitrixStatus: lead.STATUS_ID, ...trace,
  });
  await recordBypass({ ...bypass, outcome: overbooked ? 'overbooked' : 'created', appointmentId: createdAppt.id });
  await notifySlots(localOfficeId, lead.date);
  console.log(`Service: Created appointment for lead ${lead.bitrix_lead_id}, invalidated cache for office ${localOfficeId}, date ${lead.date}`);
  return { created: true, overbooked, appointment: createdAppt };
}

/**
 * Переписать встречу по лиду (дата/время/офис/статус из CRM).
 * Возвращает true, если встреча изменилась.
 */
async function updateAppointmentFromLead(appt, lead, trace = {}) {
  // Оператор только что менял встречу в виджете, а до Bitrix это ещё
  // могло не доехать — не затираем его решение состоянием CRM
  // (та же защита, что в autoSyncStatuses).
  if (await hasRecentLocalStatusChange(appt.id)) return false;
  const prev = { office_id: appt.office_id, date: appt.date };
  const before = { status: appt.status, date: appt.date, timeSlot: appt.timeSlot, office_id: appt.office_id };
  if (lead.status !== undefined) appt.status = lead.status;
  if (lead.date !== undefined) appt.date = lead.date;
  // Re-resolve office in case Bitrix office changed
  const localOfficeId = await resolveOfficeId(lead.office_id);
  if (localOfficeId) appt.office_id = localOfficeId;
  if (lead.timeSlot !== undefined && !(appt.date === before.date && appt.office_id === before.office_id && slotCovers(appt.timeSlot, slotStart(lead.timeSlot)))) {
    const resolved = await resolveFullTimeSlot(appt.office_id, appt.date, lead.timeSlot);
    // Если слот в расписании не нашёлся, не деградируем полный
    // интервал до короткого «HH:MM» при неизменном начале.
    if (resolved.includes('-') || slotStart(resolved) !== slotStart(appt.timeSlot)) {
      appt.timeSlot = resolved;
    }
  }
  const changed = before.status !== appt.status || before.date !== appt.date
    || before.timeSlot !== appt.timeSlot || String(before.office_id) !== String(appt.office_id);
  if (!changed) return false;
  await appt.save();
  await recordSyncChange(appt, 'updated_from_crm', before, { source: 'leads_sync', bitrixStatus: lead.STATUS_ID, ...trace });
  if (prev.office_id && prev.date) await notifySlots(prev.office_id, prev.date);
  if (appt.office_id && appt.date) await notifySlots(appt.office_id, appt.date);
  console.log(`Service: Updated appointment ${appt.id} for lead ${lead.bitrix_lead_id}, invalidated cache for office ${appt.office_id}, date ${appt.date}`);
  return true;
}

// Create or update appointments in DB based on Bitrix leads
async function syncMissingAppointments({ applyUpdates = true } = {}) {
  const analysis = await fetchAndAnalyzeBitrixLeads();

  let created = 0;
  let updated = 0;
  const invalidOfficeRefs = [];
  const skipped = [];

  console.log(`Service: Starting bulk creation of ${analysis.toCreate?.reduce((sum, group) => sum + (group.leads?.length || 0), 0) || 0} appointments`);
  for (const group of (analysis.toCreate || [])) {
    for (const lead of group.leads || []) {
      try {
        const result = await createAppointmentFromLead(lead);
        if (result.invalidOffice) invalidOfficeRefs.push({ officeRef: lead.office_id, bitrix_lead_id: lead.bitrix_lead_id });
        else if (result.skipped) skipped.push({ bitrix_lead_id: lead.bitrix_lead_id, date: lead.date, timeSlot: lead.timeSlot, reason: result.skipped });
        else if (result.created) created++;
      } catch (e) {
        console.error('Service: failed to create appointment from lead', lead?.bitrix_lead_id, e?.message || e);
      }
    }
  }

  if (applyUpdates) {
    for (const group of (analysis.toUpdate || [])) {
      for (const lead of group.leads || []) {
        try {
          const appt = await models.Appointment.findByPk(lead.id);
          if (!appt) continue;
          if (await updateAppointmentFromLead(appt, lead)) updated++;
        } catch (e) {
          console.error('Service: failed to update appointment from lead', lead?.id, e?.message || e);
        }
      }
    }
  }

  return {
    created,
    updated,
    invalidOfficeRefs,
    skipped
  };
}

module.exports.syncMissingAppointments = syncMissingAppointments;
module.exports.createAppointmentFromLead = createAppointmentFromLead;
module.exports.updateAppointmentFromLead = updateAppointmentFromLead;
module.exports.resolveOfficeId = resolveOfficeId;
module.exports.applyDecision = applyDecision;
module.exports.fetchLeadStatuses = fetchLeadStatuses;
module.exports.recordSyncChange = recordSyncChange;

// Backfill function removed - no longer automatically updating Bitrix office fields

// Проверка лидов со статусом "не пришел" за последние дни и восстановление статуса
async function checkNoShowLeads({ daysBack = 3 } = {}) {
  console.log(`Service: Starting no-show leads check for last ${daysBack} days...`);
  
  const startDate = dayjs().subtract(daysBack, 'day').format('YYYY-MM-DD');
  const endDate = dayjs().format('YYYY-MM-DD');
  
  console.log(`Service: Checking period from ${startDate} to ${endDate}`);
  
  // Получаем встречи со статусом "не пришел" за последние дни
  const noShowAppointments = await models.Appointment.findAll({
    where: {
      status: 'no_show',
      date: {
        [Op.between]: [startDate, endDate]
      },
      bitrix_lead_id: {
        [Op.not]: null
      }
    },
    attributes: ['id', 'bitrix_lead_id', 'date', 'timeSlot', 'office_id', 'status']
  });
  
  console.log(`Service: Found ${noShowAppointments.length} no-show appointments to check`);
  
  if (noShowAppointments.length === 0) {
    return { checked: 0, restored: 0, errors: 0 };
  }
  
  let checked = 0;
  let restored = 0;
  let errors = 0;
  
  // Группируем по bitrix_lead_id для массовой проверки
  const leadIds = [...new Set(noShowAppointments.map(apt => apt.bitrix_lead_id))];
  
  try {
    // Актуальные статусы лидов — пачками по 50 (fetchLeadStatuses).
    // Раньше был один crm.lead.list на все ID без постраничного чтения (Битрикс
    // отдаёт не больше 50 строк) и с фильтром '>DATE_CREATE' за последние дни:
    // лид создаётся задолго до встречи, поэтому почти все лиды отсекались, и
    // пришедший клиент, помеченный неявкой, так и оставался неявкой.
    const statusById = await fetchLeadStatuses(leadIds.map(Number));
    console.log(`Service: Retrieved ${statusById.size} leads from Bitrix24`);

    // Проверяем каждый appointment со статусом "не пришел"
    for (const appointment of noShowAppointments) {
      try {
        checked++;
        const leadStatus = statusById.get(Number(appointment.bitrix_lead_id));

        if (leadStatus === undefined) {
          console.log(`Service: Lead ${appointment.bitrix_lead_id} not found in Bitrix24, skipping`);
          continue;
        }

        // Правило одно на все пути (leadRules.decideFromLeadStatus): прошедшую
        // неявку возвращает только приход (4 / CONVERTED), будущую — стадии
        // встречи 2/37. Лид в «Перезвонить» или НДЗ — не повод возвращать
        // неявку в активные. Раньше две задачи тянули запись в разные стороны:
        // autoExpireAppointments ставила no_show, этот прогон возвращал pending.
        const decision = decideFromLeadStatus(appointment, leadStatus);
        if (decision && await applyDecision(appointment, decision, { source: 'no_show_check', bitrixStatus: leadStatus })) {
          console.log(`Service: Restoring appointment ${appointment.id} for lead ${appointment.bitrix_lead_id} from no_show to ${decision.status}`);
          restored++;
        }
      } catch (error) {
        console.error(`Service: Error checking no-show appointment ${appointment.id}:`, error.message);
        errors++;
      }
    }
    
  } catch (error) {
    console.error('Service: Error fetching leads from Bitrix24:', error.message);
    errors++;
  }
  
  console.log(`Service: No-show leads check complete: ${checked} checked, ${restored} restored, ${errors} errors`);
  
  return { checked, restored, errors };
}


