const { WebSocketServer } = require('ws');

let wss = null;
let heartbeatTimer = null;

// nginx закрывает соединение, если по нему ничего не приходило proxy_read_timeout.
// Единственным трафиком был time.tick раз в 60 секунд — ровно на границе таймаута,
// поэтому соединения регулярно отваливались, а клиент не переподключался и переставал
// получать и время, и обновления слотов. Пинг держит канал заведомо живым.
const HEARTBEAT_MS = 25_000;

function initWebsocket(server) {
	wss = new WebSocketServer({ server, path: '/api/ws' });
	wss.on('connection', (ws) => {
		ws.isAlive = true;
		ws.on('pong', () => { ws.isAlive = true; });
		ws.on('message', () => {
			// Currently read-only channel; ignore client messages
		});
	});

	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			// Не ответил на прошлый ping — соединение мертво, освобождаем ресурсы
			if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
			ws.isAlive = false;
			try { ws.ping(); } catch {}
		}
	}, HEARTBEAT_MS);
	heartbeat.unref?.();
	wss.on('close', () => clearInterval(heartbeat));
	heartbeatTimer = heartbeat;

	return wss;
}

// Закрытие при остановке процесса: раньше сокеты оставались открытыми, и
// server.close() ждал их бесконечно.
function closeWebsocket() {
	if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
	if (!wss) return;
	for (const client of wss.clients) {
		try { client.close(1001, 'Server shutting down'); } catch {}
	}
	try { wss.close(); } catch {}
	wss = null;
}

function safeBroadcast(message) {
	if (!wss) return;
	const payload = JSON.stringify(message);
	for (const client of wss.clients) {
		try { client.send(payload); } catch {}
	}
}

function broadcastSlotsUpdated(officeId, date) {
	safeBroadcast({ type: 'slots.updated', office_id: String(officeId), date: String(date).slice(0,10) });
}

function broadcastAppointmentUpdated(appt) {
	safeBroadcast({ 
		type: 'appointment.updated', 
		appointment: {
			id: appt?.id,
			lead_id: appt?.bitrix_lead_id || appt?.lead_id || null,
			status: appt?.status,
			date: appt?.date,
			timeSlot: appt?.timeSlot,
			office_id: appt?.office_id
		}
	});
}

function broadcastTimeTick() {
	safeBroadcast({ type: 'time.tick', now: new Date().toISOString() });
}

module.exports = { initWebsocket, closeWebsocket, broadcastSlotsUpdated, broadcastAppointmentUpdated, broadcastTimeTick };


