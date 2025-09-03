const dayjs = require('dayjs');
const axios = require('axios');
const { models, Op, Sequelize } = require('../lib/db');

// Map Bitrix24 statuses to local statuses
const BITRIX_STATUS_MAPPING = {
  '2': 'pending',
  '37': 'confirmed',
  '38': 'completed',
  '39': 'no_show',
  '40': 'cancelled',
  'CONVERTED': 'completed'
};

function getBitrixRestUrl(method) {
  const base = String(process.env.BITRIX_REST_URL).replace(/\/+$/, '');
  const path = String(method || '').replace(/^\/+/, '');
  return `${base}/${path}`;
}

async function autoSyncStatuses() {
  console.log('Starting automatic status sync with Bitrix24 (service)...');

  const appointmentsToCheck = await models.Appointment.findAll({
    where: {
      bitrix_lead_id: { [Op.not]: null },
      status: { [Op.in]: ['pending', 'confirmed', 'rescheduled'] }
    },
    include: [{ model: models.Office, attributes: ['city', 'address'] }]
  });

  const leadIds = [...new Set(appointmentsToCheck.map(a => a.bitrix_lead_id))];
  console.log(`Service: checking ${leadIds.length} unique leads in Bitrix24`);

  const leadStatusMap = {};
  for (const id of leadIds) {
    try {
      const response = await axios.post(getBitrixRestUrl('crm.lead.get'), { id: Number(id) }, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      });
      const statusId = response?.data?.result?.STATUS_ID;
      leadStatusMap[id] = BITRIX_STATUS_MAPPING[statusId] || (statusId ?? null);
    } catch (error) {
      console.error(`Service: error fetching lead ${id}:`, error.message);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  let updatedCount = 0;
  let noShowCount = 0;

  for (const appointment of appointmentsToCheck) {
    const leadId = appointment.bitrix_lead_id;
    const newStatus = leadStatusMap[leadId];

    const endPart = appointment.timeSlot && String(appointment.timeSlot).includes('-')
      ? String(appointment.timeSlot).split('-')[1]
      : '23:59';
    const appointmentDateTime = dayjs(`${appointment.date} ${endPart}`);
    const isPastDue = appointmentDateTime.isBefore(dayjs().subtract(2, 'hours'));

    if (newStatus && ['pending','confirmed','completed','no_show','cancelled','rescheduled'].includes(newStatus) && newStatus !== appointment.status) {
      await appointment.update({ status: newStatus });
      updatedCount++;
    } else if (newStatus && !['pending','confirmed','completed','no_show','cancelled','rescheduled'].includes(newStatus)) {
      await appointment.update({ status: 'cancelled' });
      updatedCount++;
    } else if (newStatus === undefined || newStatus === null) {
      await appointment.update({ status: 'cancelled' });
      updatedCount++;
    } else if (isPastDue && ['pending', 'confirmed', 'rescheduled'].includes(appointment.status)) {
      await appointment.update({ status: 'no_show' });
      noShowCount++;
    }
  }

  console.log(`Service status sync complete: ${updatedCount} updated, ${noShowCount} marked as no_show`);
  return {
    checked: appointmentsToCheck.length,
    updated: updatedCount,
    no_show: noShowCount
  };
}

async function autoExpireAppointments() {
  console.log('Starting automatic appointment expiration (service)...');
  const cutoffTime = dayjs().subtract(2, 'hours');

  const expiredAppointments = await models.Appointment.findAll({
    where: {
      status: { [Op.in]: ['pending', 'confirmed'] },
      [Op.and]: [
        models.Appointment.sequelize.where(
          models.Appointment.sequelize.fn(
            'CONCAT',
            models.Appointment.sequelize.col('date'),
            ' ',
            models.Appointment.sequelize.fn('SPLIT_PART', models.Appointment.sequelize.col('timeSlot'), '-', 2)
          ),
          { [Op.lt]: cutoffTime.format('YYYY-MM-DD HH:mm') }
        )
      ]
    }
  });

  let noShowCount = 0;
  for (const appointment of expiredAppointments) {
    await appointment.update({ status: 'no_show' });
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
    const response = await axios.post(getBitrixRestUrl('crm.lead.list'), {
      SELECT: [
        'ID', 'UF_CRM_1675255265', 'UF_CRM_1725445029', 'UF_CRM_1725483092',
        'UF_CRM_1655460588', 'UF_CRM_1657019494', 'STATUS_ID'
      ],
      FILTER: { STATUS_ID: [2, 37] },
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

  const existingAppointments = await models.Appointment.findAll({
    attributes: ['id', 'bitrix_lead_id', 'status', 'date', 'timeSlot']
  });
  const existingLeadMap = new Map();
  existingAppointments.forEach(app => {
    if (app.bitrix_lead_id) existingLeadMap.set(app.bitrix_lead_id, app);
  });

  const toCreate = [];
  const toUpdate = [];
  allLeads.forEach(lead => {
    try {
      const existingAppointment = existingLeadMap.get(lead.ID);
      const bitrixStatus = BITRIX_STATUS_MAPPING[lead.STATUS_ID] || 'pending';
      const leadDateRaw = String(lead.UF_CRM_1655460588 || '');
      const leadDate = leadDateRaw.includes('T')
        ? leadDateRaw.slice(0, 10)
        : dayjs(leadDateRaw).format('YYYY-MM-DD');

      if (!existingAppointment) {
        toCreate.push({
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
          timeSlot: lead.UF_CRM_1657019494,
          status: bitrixStatus
        });
      } else {
        const needsUpdate = (
          existingAppointment.status !== bitrixStatus ||
          existingAppointment.date !== leadDate ||
          existingAppointment.timeSlot !== lead.UF_CRM_1657019494
        );
        if (needsUpdate) {
          toUpdate.push({
            id: existingAppointment.id,
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
            timeSlot: lead.UF_CRM_1657019494,
            status: bitrixStatus,
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

// Create or update appointments in DB based on Bitrix leads
async function syncMissingAppointments({ applyUpdates = true } = {}) {
  const analysis = await fetchAndAnalyzeBitrixLeads();

  // Lazy imports to avoid circular deps at module load
  const { invalidateSlotsCache } = require('./slotsService');
  const { broadcastSlotsUpdated } = require('../lib/ws');

  let created = 0;
  let updated = 0;
  const invalidOfficeRefs = [];

  // Helper: resolve local office UUID by provided office ref (uuid or Bitrix numeric)
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

  // Create new ones
  console.log(`Service: Starting bulk creation of ${analysis.toCreate?.reduce((sum, group) => sum + (group.leads?.length || 0), 0) || 0} appointments`);
  for (const group of (analysis.toCreate || [])) {
    console.log(`Service: Processing group for office ${group.officeId} with ${group.leads?.length || 0} leads`);
    for (const lead of group.leads || []) {
      try {
        const localOfficeId = await resolveOfficeId(lead.office_id);
        if (!localOfficeId) {
          invalidOfficeRefs.push({ officeRef: lead.office_id, bitrix_lead_id: lead.bitrix_lead_id });
          continue;
        }
        const exists = await models.Appointment.findOne({
          where: {
            bitrix_lead_id: lead.bitrix_lead_id,
            office_id: localOfficeId,
            date: lead.date,
            timeSlot: lead.timeSlot
          }
        });
        if (exists) {
          // Keep for potential update step below
          continue;
        }
        await models.Appointment.create({
          bitrix_lead_id: lead.bitrix_lead_id,
          office_id: localOfficeId,
          date: lead.date,
          timeSlot: lead.timeSlot,
          status: lead.status || 'pending',
          createdBy: 0
        });
        await invalidateSlotsCache(localOfficeId, lead.date);
        broadcastSlotsUpdated(localOfficeId, lead.date);
        console.log(`Service: Created appointment for lead ${lead.bitrix_lead_id}, invalidated cache for office ${localOfficeId}, date ${lead.date}`);
        created++;
      } catch (e) {
        console.error('Service: failed to create appointment from lead', lead?.bitrix_lead_id, e?.message || e);
      }
    }
  }

  // Apply updates to existing appointments if requested
  if (applyUpdates) {
    for (const group of (analysis.toUpdate || [])) {
      for (const lead of group.leads || []) {
        try {
          const appt = await models.Appointment.findByPk(lead.id);
          if (!appt) continue;
          const prev = { office_id: appt.office_id, date: appt.date };
          if (lead.status !== undefined) appt.status = lead.status;
          if (lead.date !== undefined) appt.date = lead.date;
          if (lead.timeSlot !== undefined) appt.timeSlot = lead.timeSlot;
          // Re-resolve office in case Bitrix office changed
          const localOfficeId = await resolveOfficeId(lead.office_id);
          if (localOfficeId) appt.office_id = localOfficeId;
          await appt.save();
          // Invalidate caches for old and new dates
          if (prev.office_id && prev.date) {
            await invalidateSlotsCache(prev.office_id, prev.date);
            broadcastSlotsUpdated(prev.office_id, prev.date);
          }
          if (appt.office_id && appt.date) {
            await invalidateSlotsCache(appt.office_id, appt.date);
            broadcastSlotsUpdated(appt.office_id, appt.date);
          }
          console.log(`Service: Updated appointment ${lead.id} for lead ${lead.bitrix_lead_id}, invalidated cache for office ${appt.office_id}, date ${appt.date}`);
          updated++;
        } catch (e) {
          console.error('Service: failed to update appointment from lead', lead?.id, e?.message || e);
        }
      }
    }
  }

  return {
    created,
    updated,
    invalidOfficeRefs
  };
}

module.exports.syncMissingAppointments = syncMissingAppointments;

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
    attributes: ['id', 'bitrix_lead_id', 'date', 'timeSlot', 'office_id']
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
    // Получаем актуальные статусы лидов из Bitrix24
    const response = await axios.post(getBitrixRestUrl('crm.lead.list'), {
      filter: {
        ID: leadIds,
        '>DATE_CREATE': dayjs().subtract(daysBack + 1, 'day').format('YYYY-MM-DD')
      },
      select: ['ID', 'STATUS_ID', 'UF_CRM_1655460588', 'UF_CRM_1657019494']
    }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
    
    const leads = response.data?.result || [];
    console.log(`Service: Retrieved ${leads.length} leads from Bitrix24`);
    
    const leadMap = new Map();
    leads.forEach(lead => {
      leadMap.set(lead.ID, lead);
    });
    
    // Проверяем каждый appointment со статусом "не пришел"
    for (const appointment of noShowAppointments) {
      try {
        checked++;
        const lead = leadMap.get(appointment.bitrix_lead_id);
        
        if (!lead) {
          console.log(`Service: Lead ${appointment.bitrix_lead_id} not found in Bitrix24, skipping`);
          continue;
        }
        
        const bitrixStatus = BITRIX_STATUS_MAPPING[lead.STATUS_ID] || 'pending';
        
        // Если статус в Bitrix24 активный (не отменен и не "не пришел"), восстанавливаем appointment
        if (['pending', 'confirmed', 'completed', 'rescheduled'].includes(bitrixStatus)) {
          console.log(`Service: Restoring appointment ${appointment.id} for lead ${appointment.bitrix_lead_id} from no_show to ${bitrixStatus}`);
          
          appointment.status = bitrixStatus;
          await appointment.save();
          
          // Инвалидируем кеш
          const { invalidateSlotsCache } = require('./slotsService');
          const { broadcastSlotsUpdated } = require('../lib/ws');
          
          await invalidateSlotsCache(appointment.office_id, appointment.date);
          broadcastSlotsUpdated(appointment.office_id, appointment.date);
          
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


