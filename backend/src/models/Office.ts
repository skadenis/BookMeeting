import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Appointment } from './Appointment';
import { Schedule } from './Schedule';

@Entity({ name: 'offices' })
export class Office {
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	@Column({ type: 'varchar', length: 120 })
	city!: string;

	@Column({ type: 'varchar', length: 200, nullable: false })
	address!: string;

	@OneToMany(() => Appointment, (appointment) => appointment.office)
	appointments!: Appointment[];

	@OneToMany(() => Schedule, (schedule) => schedule.office)
	schedules!: Schedule[];
}