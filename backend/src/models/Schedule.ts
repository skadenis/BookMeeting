import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';
import { Office } from './Office';
import { Slot } from './Slot';

@Entity({ name: 'schedules' })
export class Schedule {
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	@ManyToOne(() => Office, (office) => office.schedules, { nullable: false })
	office!: Office;

	@Column({ type: 'date' })
	date!: string;

	@Column({ type: 'boolean', default: true })
	isWorkingDay!: boolean;

	@OneToMany(() => Slot, (slot) => slot.schedule)
	slots!: Slot[];
}