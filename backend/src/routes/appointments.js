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
		// Исключение: для стадии "2" (Назначена встреча) нужно сначала перевести в IN_PROCESS,
		// иначе автоматизация Битрикса часто не срабатывает.
		if (String(currentStageId) === String(targetStageId) && String(targetStageId) !== '2') {
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

function resolveUserId(req) {
	try {
		const referer = req.headers.referer || req.headers.referrer;
		let refererUserId = null;
		if (referer) {
			const url = new URL(referer);
			const raw = url.searchParams.get('user_id')
				|| url.searchParams.get('USER_ID')
				|| url.searchParams.get('userId');
			const n = Number(raw);
			refererUserId = Number.isFinite(n) && n > 0 ? n : null;
		}
		return Number(req.bitrix?.userId || req.query.user_id || req.body.user_id || refererUserId || 0) || null;
	} catch {
		return Number(req.bitrix?.userId || req.query.user_id || req.body.user_id || 0) || null;
	}
}

function resolveLeadId(req) {
	try {
		const referer = req.headers.referer || req.headers.referrer;
		let refererLeadId = null;
		if (referer) {
			const url = new URL(referer);
			const raw = url.searchParams.get('lead_id')
				|| url.searchParams.get('LEAD_ID')
				|| url.searchParams.get('leadId');
			const n = Number(raw);
			refererLeadId = Number.isFinite(n) && n > 0 ? n : null;
		}
		return Number(req.bitrix?.leadId || req.query.lead_id || refererLeadId || 0) || null;
	} catch {
		return Number(req.bitrix?.leadId || req.query.lead_id || 0) || null;
	}
}

function normalizeDateString(value) {
	if (!value) return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
	const ruMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
	if (ruMatch) return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
	const parsed = new Date(raw);
	if (!Number.isNaN(parsed.getTime())) {
		return parsed.toISOString().slice(0, 10);
	}
	return null;
}

function dayDiffUTC(dateA, dateB) {
	const toUtcMs = (value) => {
		const parts = String(value || '').split('-');
		if (parts.length !== 3) return null;
		const [y, m, d] = parts.map(Number);
		if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
		return Date.UTC(y, m - 1, d);
	};
	const a = toUtcMs(dateA);
	const b = toUtcMs(dateB);
	if (a === null || b === null) return null;
	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	return Math.abs((a - b) / MS_PER_DAY);
}

router.get('/', [query('lead_id').optional().isInt()], async (req, res, next) => {
	try {
		const where = {};
		const resolvedLeadId = resolveLeadId(req);
		if (!resolvedLeadId) {
			return res.json({ data: [] });
		}
		where.bitrix_lead_id = resolvedLeadId;
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
	body('user_id').optional().isInt(),
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
		
		const shouldUpdateBitrix = process.env.NODE_ENV === 'production' && appointment.bitrix_lead_id;
		const resolvedUserId = shouldUpdateBitrix ? resolveUserId(req) : null;
		const officeBitrixId = office?.bitrixOfficeId ? Number(office.bitrixOfficeId) : null;
		const [startTime] = String(appointment.timeSlot || '').split('-');
		const dateParts = String(appointment.date || '').split('-'); // YYYY-MM-DD
		const dateRu = (dateParts.length === 3) ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : '';
		const reqUserIdFromQuery = req.query?.user_id;
		const reqUserIdFromBody = req.body?.user_id;
		const reqUserIdFromBitrix = req.bitrix?.userId;
		const reqReferer = req.headers?.referer || req.headers?.referrer;
		
		await invalidateSlotsCache(office_id, newDate);
		broadcastSlotsUpdated(office_id, newDate);
		broadcastAppointmentUpdated(appointment);
		res.status(201).json({ data: await models.Appointment.findByPk(appointment.id, { include: [{ model: models.Office }] }) });

		// Bitrix update is async to avoid slowing down booking
		if (shouldUpdateBitrix) {
			setImmediate(async () => {
				try {
					console.log('🔍 Проверяю условия для отправки в Bitrix при создании встречи:');
					console.log('  - bitrix_lead_id:', appointment.bitrix_lead_id);
					console.log('  - req.bitrix:', req.bitrix);
					console.log('  - req.bitrix.userId:', reqUserIdFromBitrix);
					
					const getLeadUrl = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.get`;
					const leadResponse = await axios.post(getLeadUrl, { id: Number(appointment.bitrix_lead_id) });
					const lead = leadResponse?.data?.result || {};
					const leadMeetingDateRaw = lead?.UF_CRM_1655460588 ?? null;
					const leadMeetingDate = normalizeDateString(leadMeetingDateRaw);
					const leadDayDiff = dayDiffUTC(leadMeetingDate, newDate);
					const isWithinOneDayMeeting = leadDayDiff !== null && leadDayDiff <= 1;

					// Проверяем и изменяем стадию лида при необходимости
					await ensureLeadStage(appointment.bitrix_lead_id, '2');

					const url = `${String(process.env.BITRIX_REST_URL).replace(/\/+$/, '')}/crm.lead.update`;
					const fields = {
						STATUS_ID: 2, // Статус "Назначена встреча"
						UF_CRM_1675255265: officeBitrixId || null,
						UF_CRM_1655460588: dateRu || null,
						UF_CRM_1657019494: startTime || null,
					};
					if (!isWithinOneDayMeeting && resolvedUserId) {
						fields.ASSIGNED_BY_ID = resolvedUserId;
					}
					const requestData = {
						id: Number(appointment.bitrix_lead_id),
						fields,
					};
					
					console.log('📤 Отправляю запрос в Bitrix при создании встречи:');
					console.log('  - URL:', url);
					console.log('  - user_id из req.bitrix.userId:', reqUserIdFromBitrix);
					console.log('  - user_id из query/body:', reqUserIdFromQuery, reqUserIdFromBody);
					console.log('  - user_id из referer:', reqReferer);
					console.log('  - дата встречи лида (сырое):', leadMeetingDateRaw);
					console.log('  - дата встречи лида (нормализовано):', leadMeetingDate);
					console.log('  - разница по дням:', leadDayDiff);
					console.log('  - обновляем ли ответственного (ASSIGNED_BY_ID):', !isWithinOneDayMeeting && !!resolvedUserId);
					if (!isWithinOneDayMeeting && resolvedUserId) {
						console.log('  - user_id → ASSIGNED_BY_ID:', resolvedUserId);
					} else if (isWithinOneDayMeeting) {
						console.log('  - ASSIGNED_BY_ID не меняется: встреча в пределах ±1 дня');
					} else {
						console.log('  - ASSIGNED_BY_ID не меняется: user_id не определён');
					}
					console.log('  - Полные данные запроса:', JSON.stringify(requestData, null, 2));
					
					const response = await axios.post(url, requestData);
					console.log('✅ Ответ от Bitrix при создании встречи:', response.status, response.data);
				} catch (e) {
					console.error('Bitrix lead update failed on appointment creation:', e?.response?.data || e?.message || e);
				}
			});
		} else if (appointment.bitrix_lead_id) {
			console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при создании встречи');
		}

	} catch (e) { next(e); }
});

router.put('/:id', [
	param('id').isString().notEmpty(),
	body('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
	body('date').optional().isISO8601(),
	body('time_slot').optional().isString().notEmpty(),
	body('office_id').optional().isString().notEmpty(),
	body('user_id').optional().isInt(),
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

		// Проверка ограничения на подтверждение встречи (только за 24 часа до начала)
		if (status === 'confirmed') {
			const appointmentDateTime = new Date(`${appointment.date}T${appointment.timeSlot.split('-')[0]}:00`);
			const now = new Date();
			const hoursUntilAppointment = (appointmentDateTime - now) / (1000 * 60 * 60);
			
			console.log('🔍 Проверка ограничения на подтверждение встречи:');
			console.log('  - Дата встречи:', appointment.date);
			console.log('  - Время начала:', appointment.timeSlot.split('-')[0]);
			console.log('  - Полная дата/время встречи:', appointmentDateTime.toISOString());
			console.log('  - Текущее время:', now.toISOString());
			console.log('  - Часов до встречи:', hoursUntilAppointment.toFixed(2));
			
			if (hoursUntilAppointment > 24) {
				console.log('❌ Отклонено: до встречи более 24 часов');
				return res.status(400).json({ 
					error: 'Appointment confirmation too early',
					message: 'Встречу можно подтвердить только за 24 часа до начала',
					hoursUntilAppointment: Math.round(hoursUntilAppointment * 100) / 100
				});
			}
			
			console.log('✅ Разрешено: до встречи менее 24 часов');
		}

		if (status) appointment.status = status;
		if (date) appointment.date = String(date).slice(0, 10);
		if (time_slot) appointment.timeSlot = time_slot;
		if (office_id) appointment.office_id = office_id;
		await appointment.save();
		const shouldUpdateConfirmed = status === 'confirmed' && appointment.bitrix_lead_id && process.env.NODE_ENV === 'production';
		const shouldUpdateCancelled = status === 'cancelled' && appointment.bitrix_lead_id && process.env.NODE_ENV === 'production';
		const resolvedUserId = shouldUpdateConfirmed ? resolveUserId(req) : null;
		const reqUserIdFromQuery = req.query?.user_id;
		const reqUserIdFromBody = req.body?.user_id;
		const reqUserIdFromBitrix = req.bitrix?.userId;
		const reqReferer = req.headers?.referer || req.headers?.referrer;

		await invalidateSlotsCache(oldOfficeId, oldDate);
		await invalidateSlotsCache(appointment.office_id, appointment.date);
		broadcastSlotsUpdated(oldOfficeId, oldDate);
		broadcastSlotsUpdated(appointment.office_id, appointment.date);
		broadcastAppointmentUpdated(appointment);

		res.json({ data: await models.Appointment.findByPk(id, { include: [{ model: models.Office }] }) });

		// Bitrix updates are async to keep response fast
		if (shouldUpdateConfirmed) {
			setImmediate(async () => {
				try {
					console.log('🔍 Проверяю условия для отправки в Bitrix:');
					console.log('  - status:', status);
					console.log('  - bitrix_lead_id:', appointment.bitrix_lead_id);
					console.log('  - req.bitrix:', req.bitrix);
					console.log('  - req.bitrix.userId:', reqUserIdFromBitrix);
					
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
							UF_CRM_1725483092: resolvedUserId,
							UF_CRM_1655460588: dateRu || null,
							UF_CRM_1657019494: startTime || null,
						},
					};
					
					console.log('📤 Отправляю запрос в Bitrix при подтверждении встречи:');
					console.log('  - URL:', url);
					console.log('  - user_id из req.bitrix.userId:', reqUserIdFromBitrix);
					console.log('  - user_id из query/body:', reqUserIdFromQuery, reqUserIdFromBody);
					console.log('  - user_id из referer:', reqReferer);
					console.log('  - user_id который отправляется в UF_CRM_1725483092:', resolvedUserId);
					console.log('  - Полные данные запроса:', JSON.stringify(requestData, null, 2));
					
					const response = await axios.post(url, requestData);
					console.log('✅ Ответ от Bitrix при подтверждении встречи:', response.status, response.data);
				} catch (e) {
					console.error('Bitrix lead update failed on confirmation:', e?.response?.data || e?.message || e);
				}
			});
		} else if (status === 'confirmed' && appointment.bitrix_lead_id) {
			console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при подтверждении встречи');
		}

		if (shouldUpdateCancelled) {
			setImmediate(async () => {
				try {
					// Отмена встречи: переводим лид в IN_PROCESS и очищаем дату/время в кастомных полях
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
			});
		} else if (status === 'cancelled' && appointment.bitrix_lead_id) {
			console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при отмене встречи');
		}

	} catch (e) { next(e); }
});

module.exports = router;