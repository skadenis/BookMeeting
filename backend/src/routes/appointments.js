const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');

const { sequelize, models, Op, Sequelize } = require('../lib/db');
const axios = require('axios');
const { assertSlotBookable, BookingError } = require('../services/bookingGuard');
const { recordAppointmentChange, snapshot } = require('../services/appointmentHistory');
const { restUrl } = require('../lib/bitrix');
const { invalidateSlotsCache } = require('../services/slotsService');
const { broadcastSlotsUpdated, broadcastAppointmentUpdated } = require('../lib/ws');
const { CONFIRM_WINDOW_HOURS, evaluateConfirmWindow } = require('../lib/confirmWindow');
const { BUSINESS_TZ } = require('../lib/time');
const { markLocalStatusChange, clearLocalStatusChange } = require('../services/localStatusGuard');

const router = Router();

// Bitrix REST can hang for minutes under load; without a cap these calls never settle
const BITRIX_READ_TIMEOUT_MS = 10000;
const BITRIX_WRITE_TIMEOUT_MS = 20000;

// Bitrix updates run detached from the response, so a transient failure would otherwise
// silently leave the lead on the old stage. Retry before giving up.
async function postToBitrixWithRetry(url, data, { attempts = 3, timeout = BITRIX_WRITE_TIMEOUT_MS } = {}) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await axios.post(url, data, { timeout });
		} catch (e) {
			lastError = e;
			console.error(`Bitrix call failed (attempt ${attempt}/${attempts}) ${url}:`, e?.response?.data || e?.message || e);
			if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
		}
	}
	throw lastError;
}

// Вспомогательная функция для проверки и изменения стадии лида в Битриксе
async function ensureLeadStage(leadId, targetStageId, currentStageId = null) {
	try {
		// Если текущая стадия не передана, получаем её из Битрикса
		if (!currentStageId) {
			const getLeadResponse = await axios.post(restUrl('crm.lead.get'), { id: Number(leadId) }, { timeout: BITRIX_READ_TIMEOUT_MS });
			// Раньше здесь было getLeadResponse.data.result.STATUS_ID без защиты:
			// при ответе Bitrix вида {error: ...} поля result нет и обращение падало.
			currentStageId = getLeadResponse?.data?.result?.STATUS_ID || null;
			if (!currentStageId) {
				console.warn(`ensureLeadStage: Bitrix не вернул стадию лида ${leadId}, пропускаю перевод`);
				return;
			}
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
			
			const updateStageUrl = restUrl('crm.lead.update');
			await postToBitrixWithRetry(updateStageUrl, {
				id: Number(leadId),
				fields: { STATUS_ID: 'IN_PROCESS' }
			});
			
			console.log(`✅ Лид ${leadId} переведен в стадию "IN_PROCESS"`);
		}

		// Если лид в стадии "2" и мы хотим подтвердить встречу, переводим в "IN_PROCESS"
		if (String(currentStageId) === '2' && String(targetStageId) === '37') {
			console.log(`🔄 Перевожу лид ${leadId} из стадии "2" в "IN_PROCESS" перед подтверждением встречи`);
			
			const updateStageUrl = restUrl('crm.lead.update');
			await postToBitrixWithRetry(updateStageUrl, {
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

// Источники лида по убыванию доверия. Виджет исторически передаёт lead_id
// в теле POST и не передаёт его в PUT вовсе, поэтому тело остаётся допустимым
// источником — иначе запись и подтверждение перестают работать.
//
// Ограничение, о котором стоит помнить: общий секрет виджета один на всех
// операторов, поэтому криптографически привязать вызывающего к конкретному
// лиду нечем. Проверка ниже даёт две вещи: (1) несовпадение явного контекста и
// тела отсекается, (2) в PUT лид сверяется с лидом самой встречи, так что
// перебор чужих UUID больше не работает.
function leadFromReferer(req) {
	try {
		const referer = req.headers.referer || req.headers.referrer;
		if (!referer) return null;
		const url = new URL(referer);
		const raw = url.searchParams.get('lead_id')
			|| url.searchParams.get('LEAD_ID')
			|| url.searchParams.get('leadId');
		const n = Number(raw);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

// Лид из проверенного/явного контекста запроса (без тела)
function contextLeadId(req) {
	const n = Number(req.bitrix?.leadId || req.query?.lead_id || leadFromReferer(req) || 0);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveLeadId(req) {
	const fromContext = contextLeadId(req);
	if (fromContext) return fromContext;
	const fromBody = Number(req.body?.lead_id);
	return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : null;
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
		const { office_id, date, time_slot, deal_id, contact_id } = req.body;

		// Лид берётся из проверенного контекста запроса, а не только из тела.
		// Раньше произвольный lead_id из body позволял отменить чужие активные
		// встречи (см. блок отмены ниже) и записать клиента на чужой лид.
		const lead_id = resolveLeadId(req);
		if (!lead_id) {
			return res.status(400).json({ error: 'lead_id is required', message: 'Не удалось определить лид для записи' });
		}
		const fromContext = contextLeadId(req);
		const bodyLeadId = Number(req.body.lead_id);
		if (fromContext && Number.isFinite(bodyLeadId) && bodyLeadId > 0 && bodyLeadId !== fromContext) {
			return res.status(403).json({ error: 'Lead mismatch', message: 'lead_id не совпадает с контекстом запроса' });
		}

		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });

		const newDate = String(date).slice(0, 10);

		// Проверка слота и создание записи — в одной транзакции с блокировкой
		// строки слота. Раньше проверок не было вовсе, и даже после их появления
		// без транзакции два одновременных бронирования прочитали бы одну и ту же
		// занятость и оба прошли бы.
		let appointment;
		const cancelledBefore = [];
		try {
			appointment = await sequelize.transaction(async (tx) => {
				await assertSlotBookable({
					officeId: office_id,
					date: newDate,
					timeSlot: time_slot,
					transaction: tx,
				});

				// Один лид — одна активная запись: отменяем прежние активные и создаём новую
				const activeAppointments = await models.Appointment.findAll({
					where: {
						bitrix_lead_id: lead_id,
						status: ['pending','confirmed'],
						date: { [Op.gte]: Sequelize.literal("DATE_TRUNC('week', CURRENT_DATE)") },
					},
					include: [{ model: models.Office }],
					order: [['createdAt', 'DESC']],
					transaction: tx,
				});
				for (const appt of activeAppointments) {
					const before = snapshot(appt);
					appt.status = 'cancelled';
					await appt.save({ transaction: tx });
					await recordAppointmentChange({
						appointmentId: appt.id,
						action: 'cancelled_by_rebooking',
						oldValue: before,
						newValue: snapshot(appt),
						req,
						transaction: tx,
					});
					cancelledBefore.push({
						officeId: appt.office_id || (appt.Office && appt.Office.id),
						date: appt.date,
						appt,
					});
				}

				const created = await models.Appointment.create({
					office_id,
					bitrix_lead_id: lead_id,
					bitrix_deal_id: deal_id ?? null,
					bitrix_contact_id: contact_id ?? null,
					date: newDate,
					timeSlot: time_slot,
					status: 'pending',
					createdBy: (req.bitrix && req.bitrix.userId) || 0,
				}, { transaction: tx });

				await recordAppointmentChange({
					appointmentId: created.id,
					action: 'created',
					oldValue: null,
					newValue: snapshot(created),
					req,
					transaction: tx,
				});

				return created;
			});
		} catch (e) {
			if (e instanceof BookingError) {
				return res.status(e.status).json({ error: 'Slot not bookable', reason: e.reason, message: e.message });
			}
			throw e;
		}

		// Оповещения — только после успешного коммита транзакции
		for (const c of cancelledBefore) {
			await invalidateSlotsCache(c.officeId, c.date);
			broadcastSlotsUpdated(c.officeId, c.date);
			broadcastAppointmentUpdated(c.appt);
		}

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
					
					const getLeadUrl = restUrl('crm.lead.get');
					const leadResponse = await axios.post(getLeadUrl, { id: Number(appointment.bitrix_lead_id) }, { timeout: BITRIX_READ_TIMEOUT_MS });
					const lead = leadResponse?.data?.result || {};
					const leadMeetingDateRaw = lead?.UF_CRM_1655460588 ?? null;
					const leadMeetingDate = normalizeDateString(leadMeetingDateRaw);
					const leadDayDiff = dayDiffUTC(leadMeetingDate, newDate);
					const isWithinOneDayMeeting = leadDayDiff !== null && leadDayDiff <= 1;

					// Проверяем и изменяем стадию лида при необходимости
					// (стадию берём из уже загруженного лида, чтобы не делать второй запрос в Битрикс)
					await ensureLeadStage(appointment.bitrix_lead_id, '2', lead?.STATUS_ID || null);

					const url = restUrl('crm.lead.update');
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
					
					const response = await postToBitrixWithRetry(url, requestData);
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

		// Проверка принадлежности встречи. Раньше её не было вообще: любой
		// вызывающий мог изменить или отменить чужую запись, зная только UUID.
		const callerLeadId = resolveLeadId(req);
		if (!callerLeadId || Number(appointment.bitrix_lead_id) !== Number(callerLeadId)) {
			// 404, а не 403: иначе ответ подтверждает существование чужой записи
			return res.status(404).json({ error: 'Not found' });
		}

		const { status, date, time_slot, office_id } = req.body;
		const before = snapshot(appointment);
		const oldDate = appointment.date;
		const oldOfficeId = appointment.office_id || (appointment.Office && appointment.Office.id);

		// Проверка окна подтверждения. Правило и разбор времени вынесены в
		// lib/confirmWindow + lib/time: раньше время встречи парсилось без указания
		// зоны, контейнер живёт в UTC, и сервер считал, что до встречи на 3 часа
		// больше — реальный порог подтверждения был 21 час вместо 24.
		if (status === 'confirmed') {
			const verdict = evaluateConfirmWindow(appointment);

			console.log('🔍 Проверка окна подтверждения встречи:');
			console.log('  - Дата встречи:', appointment.date, appointment.timeSlot);
			console.log('  - Бизнес-зона:', BUSINESS_TZ);
			console.log('  - Часов до встречи:', verdict.hoursUntil === null ? 'н/д' : verdict.hoursUntil.toFixed(2));
			console.log('  - Вердикт:', verdict.reason);

			if (!verdict.allowed) {
				const messages = {
					too_early: `Подтвердить встречу можно не раньше чем за ${CONFIRM_WINDOW_HOURS} часа до начала`,
					finished: 'Встреча уже завершилась — подтвердить её нельзя',
					invalid_time: 'Не удалось определить время встречи',
				};
				return res.status(400).json({
					error: 'Appointment confirmation not allowed',
					reason: verdict.reason,
					message: messages[verdict.reason] || 'Подтвердить встречу сейчас нельзя',
					hoursUntilAppointment: verdict.hoursUntil === null ? null : Math.round(verdict.hoursUntil * 100) / 100,
					opensAt: verdict.opensAt ? verdict.opensAt.toISOString() : null,
				});
			}
		}

		const nextDate = date ? String(date).slice(0, 10) : appointment.date;
		const nextTimeSlot = time_slot || appointment.timeSlot;
		const nextOfficeId = office_id || appointment.office_id;
		const isReschedule = nextDate !== appointment.date
			|| nextTimeSlot !== appointment.timeSlot
			|| String(nextOfficeId) !== String(appointment.office_id);

		// Перенос — это тоже занятие места, и он должен проходить ту же проверку,
		// что и создание. Раньше новые дата/время присваивались напрямую, и
		// перенос был вторым способом переполнить слот в обход интерфейса.
		try {
			await sequelize.transaction(async (tx) => {
				if (isReschedule && appointment.status !== 'cancelled' && status !== 'cancelled') {
					await assertSlotBookable({
						officeId: nextOfficeId,
						date: nextDate,
						timeSlot: nextTimeSlot,
						excludeAppointmentId: appointment.id,
						transaction: tx,
					});
				}

				if (status) appointment.status = status;
				appointment.date = nextDate;
				appointment.timeSlot = nextTimeSlot;
				appointment.office_id = nextOfficeId;
				await appointment.save({ transaction: tx });

				await recordAppointmentChange({
					appointmentId: appointment.id,
					action: isReschedule ? 'rescheduled' : `status_${appointment.status}`,
					oldValue: before,
					newValue: snapshot(appointment),
					req,
					transaction: tx,
				});
			});
		} catch (e) {
			if (e instanceof BookingError) {
				return res.status(e.status).json({ error: 'Slot not bookable', reason: e.reason, message: e.message });
			}
			throw e;
		}

		// Помечаем решение оператора, чтобы пятиминутная синхронизация с Bitrix
		// не откатила его, пока стадия лида ещё не доехала до CRM.
		if (status) await markLocalStatusChange(appointment.id, status);
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

					const url = restUrl('crm.lead.update');
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
					
					const response = await postToBitrixWithRetry(url, requestData);
					console.log('✅ Ответ от Bitrix при подтверждении встречи:', response.status, response.data);
					// Стадия доехала — расхождения больше нет, снимаем защиту от синхронизации
					await clearLocalStatusChange(appointment.id);
				} catch (e) {
					// Локально встреча подтверждена, в Bitrix — нет. Расхождение
					// молча переживало ретраи и всплывало откатом статуса, поэтому
					// логируем отдельным маркером для алертов.
					console.error(
						`⛔ BITRIX_SYNC_FAILED confirm appointment=${appointment.id} lead=${appointment.bitrix_lead_id}:`,
						e?.response?.data || e?.message || e
					);
				}
			});
		} else if (status === 'confirmed' && appointment.bitrix_lead_id) {
			console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при подтверждении встречи');
		}

		if (shouldUpdateCancelled) {
			setImmediate(async () => {
				try {
					// Отмена встречи: переводим лид в IN_PROCESS и очищаем дату/время в кастомных полях
					const url = restUrl('crm.lead.update');
					const requestData = {
						id: Number(appointment.bitrix_lead_id),
						fields: {
							STATUS_ID: 'IN_PROCESS',
							UF_CRM_1655460588: null, // дата встречи -> null
							UF_CRM_1657019494: null  // время встречи -> null
						}
					};
					console.log('📤 Отправляю запрос в Bitrix при отмене встречи:', JSON.stringify(requestData));
					const r = await postToBitrixWithRetry(url, requestData);
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