const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');

const { models, Op, Sequelize } = require('../lib/db');
const axios = require('axios');
const { invalidateSlotsCache } = require('../services/slotsService');
const { broadcastSlotsUpdated, broadcastAppointmentUpdated } = require('../lib/ws');

const router = Router();

// Вспомогательная функция для проверки и изменения стадии лида в Битриксе
async function ensureLeadStage(leadId, targetStageId, currentStageId = null) {
	try {
		// Если текущая стадия не передана, получаем её из Битрикса
		if (!currentStageId) {
			const getLeadUrl = `${process.env.BITRIX_REST_URL}/crm.lead.get`;
			const getLeadResponse = await axios.post(getLeadUrl, { id: Number(leadId) });
			currentStageId = getLeadResponse.data.result.STATUS_ID;
		}

		console.log(`🔍 Проверяю стадию лида ${leadId}: текущая = ${currentStageId}, целевая = ${targetStageId}`);

		// Если лид уже в целевой стадии, ничего не делаем
		if (String(currentStageId) === String(targetStageId)) {
			console.log(`✅ Лид ${leadId} уже в целевой стадии ${targetStageId}`);
			return;
		}

		// Если лид в стадии "2" и мы хотим назначить встречу, переводим в "IN_PROCESS"
		if (String(currentStageId) === '2' && String(targetStageId) === '2') {
			console.log(`🔄 Перевожу лид ${leadId} из стадии "2" в "IN_PROCESS" перед назначением встречи`);
			
			const updateStageUrl = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.update`;
			await axios.post(updateStageUrl, {
				id: Number(leadId),
				fields: { STATUS_ID: 'IN_PROCESS' }
			});
			
			console.log(`✅ Лид ${leadId} переведен в стадию "IN_PROCESS"`);
		}

		// Если лид в стадии "2" и мы хотим подтвердить встречу, переводим в "IN_PROCESS"
		if (String(currentStageId) === '2' && String(targetStageId) === '37') {
			console.log(`🔄 Перевожу лид ${leadId} из стадии "2" в "IN_PROCESS" перед подтверждением встречи`);
			
			const updateStageUrl = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.update`;
			await axios.post(updateStageUrl, {
				id: Number(leadId),
				fields: { STATUS_ID: 'IN_PROCESS' }
			});
			
			console.log(`✅ Лид ${leadId} переведен в стадию "IN_PROCESS"`);
		}

	} catch (e) {
		console.error(`❌ Ошибка при проверке/изменении стадии лида ${leadId}:`, e?.response?.data || e?.message || e);
		throw e;
	}
}

router.get('/', [query('lead_id').optional().isInt()], async (req, res, next) => {
	try {
		const where = {};
		if (req.query.lead_id) where.bitrix_lead_id = Number(req.query.lead_id);
		// Показываем встречи начиная с понедельника текущей недели (PostgreSQL)
		where.date = { [Op.gte]: Sequelize.literal("DATE_TRUNC('week', CURRENT_DATE)") };
		where.status = ['pending','confirmed'];
		const items = await models.Appointment.findAll({
			where,
			include: [{ model: models.Office }],
			order: [['createdAt', 'DESC']],
		});
		res.json({ data: items });
	} catch (e) { next(e); }
});

router.post('/', [
	body('office_id').isString().notEmpty(),
	body('date').isISO8601(),
	body('time_slot').isString().notEmpty(),
	body('lead_id').optional().isInt(),
	body('deal_id').optional().isInt(),
	body('contact_id').optional().isInt(),
], async (req, res, next) => {
	try {
		console.log('🔍 Создание встречи - входящие параметры:');
		console.log('  - req.query:', req.query);
		console.log('  - req.query.user_id:', req.query.user_id);
		console.log('  - req.bitrix:', req.bitrix);
		console.log('  - req.bitrix.userId:', req.bitrix?.userId);
		console.log('  - req.body:', req.body);
		
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { office_id, date, time_slot, lead_id, deal_id, contact_id } = req.body;
		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });

		const newDate = String(date).slice(0, 10);

		// Один лид — одна активная запись: отменяем все активные (pending/confirmed) и создаем новую
		if (lead_id) {
			const activeAppointments = await models.Appointment.findAll({
				where: {
					bitrix_lead_id: lead_id,
					status: ['pending','confirmed'],
					date: { [Op.gte]: Sequelize.literal("DATE_TRUNC('week', CURRENT_DATE)") },
				},
				include: [{ model: models.Office }],
				order: [['createdAt', 'DESC']],
			});
			for (const appt of activeAppointments) {
				const oldOfficeId = appt.office_id || (appt.Office && appt.Office.id);
				const oldDate = appt.date;
				appt.status = 'cancelled';
				await appt.save();
				await invalidateSlotsCache(oldOfficeId, oldDate);
				broadcastSlotsUpdated(oldOfficeId, oldDate);
				broadcastAppointmentUpdated(appt);
			}
		}

		const appointment = await models.Appointment.create({
			office_id,
			bitrix_lead_id: lead_id ?? null,
			bitrix_deal_id: deal_id ?? null,
			bitrix_contact_id: contact_id ?? null,
			date: newDate,
			timeSlot: time_slot,
			status: 'pending',
			createdBy: (req.bitrix && req.bitrix.userId) || 0,
		});
		
		// If appointment created with lead_id — push updates to Bitrix lead (только на проде)
		if (process.env.NODE_ENV === 'production' && appointment.bitrix_lead_id) {
			try {
				console.log('🔍 Проверяю условия для отправки в Bitrix при создании встречи:');
				console.log('  - bitrix_lead_id:', appointment.bitrix_lead_id);
				console.log('  - req.bitrix:', req.bitrix);
				console.log('  - req.bitrix.userId:', req.bitrix?.userId);
				
				// Проверяем и изменяем стадию лида при необходимости
				await ensureLeadStage(appointment.bitrix_lead_id, '2');

				// Resolve office Bitrix ID
				let officeBitrixId = null;
				if (office.bitrixOfficeId) {
					officeBitrixId = office.bitrixOfficeId;
				}

				const [startTime] = String(appointment.timeSlot || '').split('-');
				const dateParts = String(appointment.date || '').split('-'); // YYYY-MM-DD
				const dateRu = (dateParts.length === 3) ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : '';

				const url = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.update`;
				const requestData = {
					id: Number(appointment.bitrix_lead_id),
					fields: {
						STATUS_ID: 2, // Статус "Назначена встреча"
						UF_CRM_1675255265: officeBitrixId ? Number(officeBitrixId) : null,
						UF_CRM_1725483092: Number(req.bitrix?.userId || 0) || null,
						UF_CRM_1655460588: dateRu || null,
						UF_CRM_1657019494: startTime || null,
					},
				};
				
				console.log('📤 Отправляю запрос в Bitrix при создании встречи:');
				console.log('  - URL:', url);
				console.log('  - user_id из req.bitrix.userId:', req.bitrix?.userId);
				console.log('  - user_id который отправляется в UF_CRM_1725483092:', Number(req.bitrix?.userId || 0) || null);
				console.log('  - Полные данные запроса:', JSON.stringify(requestData, null, 2));
				
				const response = await axios.post(url, requestData);
				console.log('✅ Ответ от Bitrix при создании встречи:', response.status, response.data);
			} catch (e) {
				console.error('Bitrix lead update failed on appointment creation:', e?.response?.data || e?.message || e);
			}
		} else if (appointment.bitrix_lead_id) {
			console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при создании встречи');
		}
		
		await invalidateSlotsCache(office_id, newDate);
		broadcastSlotsUpdated(office_id, newDate);
		broadcastAppointmentUpdated(appointment);
		res.status(201).json({ data: await models.Appointment.findByPk(appointment.id, { include: [{ model: models.Office }] }) });

	} catch (e) { next(e); }
});

router.put('/:id', [
	param('id').isString().notEmpty(),
	body('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
	body('date').optional().isISO8601(),
	body('time_slot').optional().isString().notEmpty(),
	body('office_id').optional().isString().notEmpty(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const id = req.params.id;
		const appointment = await models.Appointment.findByPk(id, { include: [{ model: models.Office }] });
		if (!appointment) return res.status(404).json({ error: 'Not found' });

		const { status, date, time_slot, office_id } = req.body;
		const oldDate = appointment.date;
		const oldOfficeId = appointment.office_id || (appointment.Office && appointment.Office.id);

		if (status) appointment.status = status;
		if (date) appointment.date = String(date).slice(0, 10);
		if (time_slot) appointment.timeSlot = time_slot;
		if (office_id) appointment.office_id = office_id;
		await appointment.save();

		// If appointment confirmed — push updates to Bitrix lead
		try {
			console.log('🔍 Проверяю условия для отправки в Bitrix:');
			console.log('  - status:', status);
			console.log('  - bitrix_lead_id:', appointment.bitrix_lead_id);
			console.log('  - req.bitrix:', req.bitrix);
			console.log('  - req.bitrix.userId:', req.bitrix?.userId);
			
			if (status === 'confirmed' && appointment.bitrix_lead_id && process.env.NODE_ENV === 'production') {
				// Проверяем и изменяем стадию лида при необходимости
				await ensureLeadStage(appointment.bitrix_lead_id, '37');

				// Resolve office Bitrix ID
				let officeBitrixId = null;
				if (appointment.Office && appointment.Office.bitrixOfficeId) {
					officeBitrixId = appointment.Office.bitrixOfficeId;
				} else if (appointment.office_id) {
					const off = await models.Office.findByPk(appointment.office_id);
					officeBitrixId = off ? (off.bitrixOfficeId || null) : null;
				}

				const [startTime] = String(appointment.timeSlot || '').split('-');
				const dateParts = String(appointment.date || '').split('-'); // YYYY-MM-DD
				const dateRu = (dateParts.length === 3) ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : '';

				const url = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.update`;
				const requestData = {
					id: Number(appointment.bitrix_lead_id),
					fields: {
						STATUS_ID: 37, // Статус "Встреча подтверждена"
						UF_CRM_1675255265: officeBitrixId ? Number(officeBitrixId) : null,
						UF_CRM_1725483092: Number(req.bitrix?.userId || 0) || null,
						UF_CRM_1655460588: dateRu || null,
						UF_CRM_1657019494: startTime || null,
					},
				};
				
				console.log('📤 Отправляю запрос в Bitrix при подтверждении встречи:');
				console.log('  - URL:', url);
				console.log('  - user_id из req.bitrix.userId:', req.bitrix?.userId);
				console.log('  - user_id который отправляется в UF_CRM_1725483092:', Number(req.bitrix?.userId || 0) || null);
				console.log('  - Полные данные запроса:', JSON.stringify(requestData, null, 2));
				
				const response = await axios.post(url, requestData);
				console.log('✅ Ответ от Bitrix при подтверждении встречи:', response.status, response.data);
			} else if (status === 'confirmed' && appointment.bitrix_lead_id) {
				console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при подтверждении встречи');
			} else if (status === 'cancelled' && appointment.bitrix_lead_id && process.env.NODE_ENV === 'production') {
				// Отмена встречи: переводим лид в IN_PROCESS и очищаем дату/время в кастомных полях
				try {
					const url = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.update`;
					const requestData = {
						id: Number(appointment.bitrix_lead_id),
						fields: {
							STATUS_ID: 'IN_PROCESS',
							UF_CRM_1655460588: null, // дата встречи -> null
							UF_CRM_1657019494: null  // время встречи -> null
						}
					};
					console.log('📤 Отправляю запрос в Bitrix при отмене встречи:', JSON.stringify(requestData));
					const r = await axios.post(url, requestData);
					console.log('✅ Ответ от Bitrix при отмене встречи:', r.status, r.data);
				} catch (e) {
					console.error('Bitrix lead update failed on cancellation:', e?.response?.data || e?.message || e);
				}
			} else if (status === 'cancelled' && appointment.bitrix_lead_id) {
				console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при отмене встречи');
			}
		} catch (e) {
			console.error('Bitrix lead update failed:', e?.response?.data || e?.message || e);
		}

		await invalidateSlotsCache(oldOfficeId, oldDate);
		await invalidateSlotsCache(appointment.office_id, appointment.date);
		broadcastSlotsUpdated(oldOfficeId, oldDate);
		broadcastSlotsUpdated(appointment.office_id, appointment.date);
		broadcastAppointmentUpdated(appointment);

		res.json({ data: await models.Appointment.findByPk(id, { include: [{ model: models.Office }] }) });

	} catch (e) { next(e); }
});

module.exports = router;