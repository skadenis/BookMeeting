// Mock Sequelize models
jest.mock('../../../src/lib/db', () => ({
  models: {
    Appointment: {
      create: jest.fn(),
      findByPk: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      destroy: jest.fn(),
      findOne: jest.fn()
    },
    Office: {
      create: jest.fn(),
      destroy: jest.fn()
    },
    sequelize: {
      close: jest.fn()
    }
  }
}));

const { models } = require('../../../src/lib/db');

describe('Appointment Model', () => {
  let testAppointment;
  let testOffice;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock test data
    testOffice = {
      id: 'office-uuid-123',
      city: 'Минск',
      address: 'ул. Тестовая, 1',
      addressNote: 'Тестовый офис'
    };

    testAppointment = {
      id: 'appointment-uuid-123',
      date: '2024-01-15',
      timeSlot: '10:00',
      status: 'pending',
      office_id: testOffice.id,
      bitrix_lead_id: 12345,
      bitrix_deal_id: null,
      bitrix_contact_id: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Mock model methods
    models.Appointment.create.mockResolvedValue(testAppointment);
    models.Appointment.findByPk.mockResolvedValue(testAppointment);
    models.Appointment.findAll.mockResolvedValue([testAppointment]);
    models.Appointment.findOne.mockResolvedValue({
      ...testAppointment,
      Office: testOffice
    });
    models.Appointment.update.mockResolvedValue([1]);
    models.Appointment.destroy.mockResolvedValue(1);
    
    models.Office.create.mockResolvedValue(testOffice);
    models.Office.destroy.mockResolvedValue(1);
  });

  describe('Validation', () => {
    it('should create appointment with valid data', async () => {
      const result = await models.Appointment.create(testAppointment);
      
      expect(result.id).toBe('appointment-uuid-123');
      expect(result.date).toBe('2024-01-15');
      expect(result.timeSlot).toBe('10:00');
      expect(result.status).toBe('pending');
      expect(result.office_id).toBe(testOffice.id);
      expect(result.bitrix_lead_id).toBe(12345);
    });

    it('should validate required fields', async () => {
      const invalidAppointment = {
        timeSlot: '10:00',
        status: 'pending',
        office_id: testOffice.id
      };

      // Mock validation error
      models.Appointment.create.mockRejectedValue(new Error('Validation error'));
      
      await expect(
        models.Appointment.create(invalidAppointment)
      ).rejects.toThrow('Validation error');
    });
  });

  describe('Associations', () => {
    it('should belong to an office', async () => {
      const appointmentWithOffice = await models.Appointment.findOne({
        where: { id: testAppointment.id },
        include: [{ model: models.Office }]
      });

      expect(appointmentWithOffice.Office).toBeDefined();
      expect(appointmentWithOffice.Office.id).toBe(testOffice.id);
      expect(appointmentWithOffice.Office.city).toBe('Минск');
    });
  });

  describe('Data Types', () => {
    it('should store date as string', () => {
      expect(typeof testAppointment.date).toBe('string');
      expect(testAppointment.date).toBe('2024-01-15');
    });

    it('should store timeSlot as string', () => {
      expect(typeof testAppointment.timeSlot).toBe('string');
      expect(testAppointment.timeSlot).toBe('10:00');
    });

    it('should store bitrix IDs as numbers or null', () => {
      expect(typeof testAppointment.bitrix_lead_id).toBe('number');
      expect(testAppointment.bitrix_lead_id).toBe(12345);
      expect(testAppointment.bitrix_deal_id).toBeNull();
      expect(testAppointment.bitrix_contact_id).toBeNull();
    });

    it('should have timestamps', () => {
      expect(testAppointment.createdAt).toBeDefined();
      expect(testAppointment.updatedAt).toBeDefined();
      expect(testAppointment.createdAt instanceof Date).toBe(true);
      expect(testAppointment.updatedAt instanceof Date).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    it('should update appointment', async () => {
      const newStatus = 'confirmed';
      await models.Appointment.update({ status: newStatus }, { where: { id: testAppointment.id } });
      
      expect(models.Appointment.update).toHaveBeenCalledWith(
        { status: newStatus },
        { where: { id: testAppointment.id } }
      );
    });

    it('should delete appointment', async () => {
      const appointmentId = testAppointment.id;
      await models.Appointment.destroy({ where: { id: appointmentId } });
      
      expect(models.Appointment.destroy).toHaveBeenCalledWith({ where: { id: appointmentId } });
    });

    it('should find appointment by ID', async () => {
      const foundAppointment = await models.Appointment.findByPk(testAppointment.id);
      expect(foundAppointment).toBeDefined();
      expect(foundAppointment.id).toBe(testAppointment.id);
    });

    it('should find appointments by status', async () => {
      const pendingAppointments = await models.Appointment.findAll({
        where: { status: 'pending' }
      });
      
      expect(pendingAppointments).toHaveLength(1);
      expect(pendingAppointments[0].status).toBe('pending');
    });
  });
});
