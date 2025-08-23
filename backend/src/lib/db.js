const { Sequelize, DataTypes, Op } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

let sequelize;
if (String(process.env.USE_SQLITE) === 'true') {
	sequelize = new Sequelize({
		dialect: 'sqlite',
		storage: process.env.SQLITE_PATH || ':memory:',
		logging: false,
	});
} else {
	sequelize = new Sequelize(
		process.env.DB_NAME || 'meetings',
		process.env.DB_USERNAME || 'meetings',
		process.env.DB_PASSWORD || 'meetings',
		{
			host: process.env.DB_HOST || 'localhost',
			port: Number(process.env.DB_PORT || 5432),
			dialect: 'postgres',
			logging: false,
		}
	);
}

const Office = sequelize.define('Office', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	name: { type: DataTypes.STRING(120), allowNull: false },
	city: { type: DataTypes.STRING(120), allowNull: false },
	address: { type: DataTypes.STRING(120), allowNull: false },
}, { tableName: 'offices', timestamps: false });

const Schedule = sequelize.define('Schedule', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	date: { type: DataTypes.DATEONLY, allowNull: false },
	isWorkingDay: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_working_day' },
}, { tableName: 'schedules', timestamps: false });

const Slot = sequelize.define('Slot', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	start: { type: DataTypes.STRING(20), allowNull: false },
	end: { type: DataTypes.STRING(20), allowNull: false },
	available: { type: DataTypes.BOOLEAN, defaultValue: true },
	capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, { tableName: 'slots', timestamps: false });

const Appointment = sequelize.define('Appointment', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	bitrix_lead_id: { type: DataTypes.BIGINT, allowNull: true },
	bitrix_deal_id: { type: DataTypes.BIGINT, allowNull: true },
	bitrix_contact_id: { type: DataTypes.BIGINT, allowNull: true },
	date: { type: DataTypes.DATEONLY, allowNull: false },
	timeSlot: { type: DataTypes.STRING(20), allowNull: false, field: 'time_slot' },
	status: { type: DataTypes.STRING(20), allowNull: false },
	createdBy: { type: DataTypes.BIGINT, allowNull: false, field: 'created_by' },
	createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'created_at' },
}, { tableName: 'appointments', updatedAt: false });

const AppointmentHistory = sequelize.define('AppointmentHistory', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	action: { type: DataTypes.STRING(40), allowNull: false },
	oldValue: { type: DataTypes.JSON, allowNull: true, field: 'old_value' },
	newValue: { type: DataTypes.JSON, allowNull: true, field: 'new_value' },
	changedBy: { type: DataTypes.BIGINT, allowNull: false, field: 'changed_by' },
	createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'created_at' },
}, { tableName: 'appointment_history', updatedAt: false });

const Template = sequelize.define('Template', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	name: { type: DataTypes.STRING(120), allowNull: false },
	weekdays: { type: DataTypes.JSON, allowNull: false }, // {"1":[{start,end,capacity}], ...}
	isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_default' },
}, { tableName: 'templates', timestamps: false });

// Associations
Office.hasMany(Schedule, { foreignKey: { name: 'office_id', allowNull: false } });
Schedule.belongsTo(Office, { foreignKey: { name: 'office_id', allowNull: false } });

Schedule.hasMany(Slot, { foreignKey: { name: 'schedule_id', allowNull: false } });
Slot.belongsTo(Schedule, { foreignKey: { name: 'schedule_id', allowNull: false } });

Office.hasMany(Appointment, { foreignKey: { name: 'office_id', allowNull: false } });
Appointment.belongsTo(Office, { foreignKey: { name: 'office_id', allowNull: false } });

Appointment.hasMany(AppointmentHistory, { foreignKey: { name: 'appointment_id', allowNull: false } });
AppointmentHistory.belongsTo(Appointment, { foreignKey: { name: 'appointment_id', allowNull: false } });

Office.hasMany(Template, { foreignKey: { name: 'office_id', allowNull: true } });
Template.belongsTo(Office, { foreignKey: { name: 'office_id', allowNull: true } });

module.exports = { sequelize, Sequelize, DataTypes, Op, models: { Office, Schedule, Slot, Appointment, AppointmentHistory, Template } };