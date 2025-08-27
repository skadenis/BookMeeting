const { WebSocketServer } = require('ws');

let wss = null;

function initWebsocket(server) {
	wss = new WebSocketServer({ server, path: '/api/ws' });
	wss.on('connection', (ws) => {
		ws.on('message', () => {
			// Currently read-only channel; ignore client messages
		});
	});
	return wss;
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

module.exports = { initWebsocket, broadcastSlotsUpdated, broadcastAppointmentUpdated, broadcastTimeTick };


