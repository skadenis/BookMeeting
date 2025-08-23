import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from 'typeorm';
import { Schedule } from './Schedule';

@Entity({ name: 'slots' })
export class Slot {
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	@ManyToOne(() => Schedule, (schedule) => schedule.slots, { nullable: false })
	schedule!: Schedule;

	@Index()
	@Column({ type: 'varchar', length: 20 })
	start!: string; // HH:mm

	@Index()
	@Column({ type: 'varchar', length: 20 })
	end!: string; // HH:mm

	@Column({ type: 'boolean', default: true })
	available!: boolean;
}