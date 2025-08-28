import { DataTypes, Sequelize } from 'sequelize'

export function defineUserModel(sequelize: Sequelize) {
  const User = sequelize.define('User', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    email: { type: DataTypes.STRING(140), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    passwordHash: { type: DataTypes.STRING(120), allowNull: false, field: 'password_hash' },
    role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'admin' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'), field: 'updated_at' },
  }, { tableName: 'users' })
  return User
}


