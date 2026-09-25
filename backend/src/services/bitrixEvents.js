// Очередь событий Битрикса.
//
// Битрикс шлёт событие на каждое изменение лида, в том числе на изменения,
// которые делает сама шахматка (2 → IN_PROCESS → 2). Обрабатывать их по одному
// в момент прихода нельзя: ответ Битриксу должен уйти сразу, а вебхук, через
// который шахматка читает CRM, общий с платформой.
//
// Поэтому: событие кладётся в очередь по ключу «тип:ID» (дубли схлопываются),
// обработчик берёт их по одному с паузой между вызовами Битрикса, а сбой
// повторяется с нарастающей паузой. Если событие всё-таки потерялось — его
// подберёт опрос раз в 5 минут и суточная сверка. Обработка идемпотентна:
// читается текущее состояние лида/сделки, а не содержимое события.

const { reconcileLead, reconcileOfficeDeal } = require('./reconcile');

const MIN_INTERVAL_MS = () => Number(process.env.BITRIX_EVENTS_MIN_INTERVAL_MS ?? 300);
const RETRY_BASE_MS = () => Number(process.env.BITRIX_EVENTS_RETRY_MS ?? 5000);
const MAX_ATTEMPTS = 3;
const MAX_QUEUE = 5000;

const handlers = {
	lead: (id, job) => reconcileLead(id, { source: 'bitrix_event', event: job.event }),
	deal: (id, job) => reconcileOfficeDeal(id, { source: 'bitrix_event', event: job.event }),
};

const queue = new Map();
const stats = { received: 0, processed: 0, failed: 0, dropped: 0, retried: 0, lastEventAt: null, lastError: null };
let draining = false;
let paused = false;

function enqueue(type, id, { event = null } = {}) {
	if (!handlers[type]) throw new Error(`unknown event type ${type}`);
	const key = `${type}:${Number(id)}`;
	stats.received++;
	stats.lastEventAt = new Date().toISOString();
	if (!queue.has(key)) {
		if (queue.size >= MAX_QUEUE) {
			// Лавина событий (массовая правка лидов) — не держим бесконечную
			// очередь в памяти: потерянное подберёт опрос и сверка.
			stats.dropped++;
			return { queued: false, reason: 'queue_full' };
		}
		queue.set(key, { type, id: Number(id), event, attempts: 0 });
	}
	setImmediate(drain);
	return { queued: true, key };
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

async function drain() {
	if (draining || paused) return;
	draining = true;
	try {
		while (queue.size > 0 && !paused) {
			const [key, job] = queue.entries().next().value;
			queue.delete(key);
			try {
				await handlers[job.type](job.id, job);
				stats.processed++;
			} catch (e) {
				job.attempts++;
				stats.lastError = `${key}: ${e?.message || e}`;
				if (job.attempts < MAX_ATTEMPTS) {
					stats.retried++;
					const t = setTimeout(() => {
						if (!queue.has(key)) queue.set(key, job);
						drain();
					}, RETRY_BASE_MS() * job.attempts);
					t.unref?.();
				} else {
					stats.failed++;
					console.error(`BITRIX_EVENT_FAILED ${key} после ${job.attempts} попыток: ${e?.message || e}`);
				}
			}
			if (queue.size > 0) await sleep(MIN_INTERVAL_MS());
		}
	} finally {
		draining = false;
	}
}

// Дождаться, пока очередь опустеет (для тестов и остановки процесса)
async function idle(timeoutMs = 5000) {
	const until = Date.now() + timeoutMs;
	while ((draining || queue.size > 0) && Date.now() < until) await sleep(10);
}

function getStats() {
	return { ...stats, queued: queue.size, draining };
}

function pause() { paused = true; }
function resume() { paused = false; setImmediate(drain); }
function reset() { queue.clear(); Object.assign(stats, { received: 0, processed: 0, failed: 0, dropped: 0, retried: 0, lastEventAt: null, lastError: null }); }

module.exports = { enqueue, getStats, idle, pause, resume, reset, handlers };
