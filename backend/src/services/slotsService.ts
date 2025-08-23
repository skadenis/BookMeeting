import { AppDataSource, redisClient } from '../index';
import { Office } from '../models/Office';
import { Schedule } from '../models/Schedule';
import { Slot } from '../models/Slot';
import { Appointment } from '../models/Appointment';

export interface AvailableSlot {
	id: string;
	start: string;
	end: string;
}

export async function getAvailableSlots(officeId: string, date: string): Promise<AvailableSlot[]> {
	const cacheKey = `slots:${officeId}:${date}`;
	const cached = await redisClient.get(cacheKey);
	if (cached) {
		return JSON.parse(cached);
	}

	const scheduleRepo = AppDataSource.getRepository(Schedule);
	const slotRepo = AppDataSource.getRepository(Slot);
	const appointmentRepo = AppDataSource.getRepository(Appointment);
	const officeRepo = AppDataSource.getRepository(Office);

	const office = await officeRepo.findOne({ where: { id: officeId } });
	if (!office) return [];

	const schedule = await scheduleRepo.findOne({ where: { office: { id: officeId }, date }, relations: ['office'] });
	if (!schedule || !schedule.isWorkingDay) return [];

	const slots = await slotRepo.find({ where: { schedule: { id: schedule.id }, available: true } });

	const appointments = await appointmentRepo.find({ where: { office: { id: officeId }, date, status: 'confirmed' } });
	const busyByTime = new Set(appointments.map((a) => a.timeSlot));

	const available = slots
		.filter((s) => !busyByTime.has(`${s.start}-${s.end}`))
		.map((s) => ({ id: s.id, start: s.start, end: s.end }));

	await redisClient.set(cacheKey, JSON.stringify(available), { EX: 30 });
	return available;
}

export async function invalidateSlotsCache(officeId: string, date: string) {
	const cacheKey = `slots:${officeId}:${date}`;
	await redisClient.del(cacheKey);
}