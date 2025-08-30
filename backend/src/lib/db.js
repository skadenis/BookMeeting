const { Sequelize, DataTypes, Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();

const sequelize = new Sequelize(
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

const Office = sequelize.define('Office', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },

	city: { type: DataTypes.STRING(120), allowNull: false },
	address: { type: DataTypes.STRING(120), allowNull: false },
	addressNote: { type: DataTypes.TEXT, allowNull: true, field: 'address_note' },
	// Bitrix office identifier (optional)
	bitrixOfficeId: { type: DataTypes.BIGINT, allowNull: true, field: 'bitrix_office_id' },
}, { tableName: 'offices', timestamps: false });

const Schedule = sequelize.define('Schedule', {
	id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
	date: { type: DataTypes.DATEONLY, allowNull: false },
	isWorkingDay: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_working_day' },
	isCustomized: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_customized' },
	customizedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'customized_by' },
	customizedAt: { type: DataTypes.DATE, allowNull: true, field: 'customized_at' },
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
	description: { type: DataTypes.TEXT, allowNull: true },
	office_id: { type: DataTypes.UUID, allowNull: true, field: 'office_id' },
	// Базовые настройки
	baseStartTime: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '09:00', field: 'base_start_time' },
	baseEndTime: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '18:00', field: 'base_end_time' },
	slotDuration: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30, field: 'slot_duration' }, // в минутах
	defaultCapacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'default_capacity' },
	// Дневные профили
	weekdays: { type: DataTypes.JSON, allowNull: false }, // {"1":{start,end,capacity,specialSlots:[{start,end,capacity,type}]}, ...}
	isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_default' },
}, { tableName: 'templates', timestamps: false });

// Users (admins)
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  email: { type: DataTypes.STRING(140), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  passwordHash: { type: DataTypes.STRING(120), allowNull: false, field: 'password_hash' },
  role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'admin' },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'created_at' },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'updated_at' },
}, { tableName: 'users' });

// Settings
const Setting = sequelize.define('Setting', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  value: { type: DataTypes.JSON, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'created_at' },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'updated_at' },
}, { tableName: 'settings' });

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

async function seedDefaultAdminIfEmpty() {
  const count = await User.count();
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const name = process.env.ADMIN_NAME || 'Admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, name, passwordHash, role: 'admin' });
  console.log('Seeded default admin user:', email);
}

module.exports = { sequelize, Sequelize, DataTypes, Op, models: { Office, Schedule, Slot, Appointment, AppointmentHistory, Template, User, Setting }, seedDefaultAdminIfEmpty };
