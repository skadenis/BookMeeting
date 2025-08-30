import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../lib/db';

interface SettingAttributes {
  id: string;
  key: string;
  value: any;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SettingCreationAttributes extends Optional<SettingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

class Setting extends Model<SettingAttributes, SettingCreationAttributes> implements SettingAttributes {
  public id!: string;
  public key!: string;
  public value!: any;
  public description?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Setting.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Setting',
    tableName: 'settings',
    timestamps: true,
  }
);

export default Setting;
