import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import { Office } from './Office';

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'rescheduled';

@Entity({ name: 'appointments' })
export class Appointment {
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	@ManyToOne(() => Office, (office) => office.appointments, { nullable: false })
	office!: Office;

	@Index()
	@Column({ type: 'bigint', nullable: true })
	bitrix_lead_id!: number | null;

	@Index()
	@Column({ type: 'bigint', nullable: true })
	bitrix_deal_id!: number | null;

	@Index()
	@Column({ type: 'bigint', nullable: true })
	bitrix_contact_id!: number | null;

	@Column({ type: 'date' })
	date!: string;

	@Column({ name: 'time_slot', type: 'varchar', length: 20 })
	timeSlot!: string;

	@Index()
	@Column({ type: 'varchar', length: 20 })
	status!: AppointmentStatus;

	@Column({ name: 'created_by', type: 'bigint' })
	createdBy!: number;

	@CreateDateColumn({ name: 'created_at' })
	createdAt!: Date;
}