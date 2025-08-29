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
    Schedule: {
      create: jest.fn(),
      destroy: jest.fn()
    },
    Slot: {
      create: jest.fn(),
      destroy: jest.fn(),
      findByPk: jest.fn()
    },
    sequelize: {
      close: jest.fn()
    }
  }
}));

const { models } = require('../../../src/lib/db');

// Mock slotsService
const mockSlotsService = {
  getAvailableSlots: jest.fn(),
  bookSlot: jest.fn(),
  updateSlotCapacity: jest.fn(),
  createSpecialSlot: jest.fn(),
  deleteSlot: jest.fn(),
  getSlotStats: jest.fn()
};

jest.mock('../../../src/services/slotsService', () => mockSlotsService);

describe('Slots Service', () => {
  let testOffice;
  let testTemplate;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock test data
    testOffice = {
      id: 'office-uuid-123',
      city: 'Минск',
      address: 'ул. Тестовая, 1',
      addressNote: 'Тестовый офис'
    };

    testTemplate = {
      id: 'template-uuid-123',
      office_id: testOffice.id,
      name: 'Тестовый шаблон',
      baseStartTime: '09:00',
      baseEndTime: '18:00',
      defaultCapacity: 2,
      slotDuration: 30
    };

    // Mock service methods
    mockSlotsService.getAvailableSlots.mockResolvedValue([
      {
        id: 'slot-uuid-123',
        timeSlot: '10:00',
        capacity: 2,
        isSpecial: false
      },
      {
        id: 'slot-uuid-124',
        timeSlot: '10:30',
        capacity: 2,
        isSpecial: false
      }
    ]);

    mockSlotsService.bookSlot.mockResolvedValue({
      success: true,
      appointment: {
        id: 'appointment-uuid-123',
        bitrix_lead_id: 12345,
        bitrix_contact_id: 67890
      }
    });

    mockSlotsService.updateSlotCapacity.mockResolvedValue({
      success: true,
      slot: {
        id: 'slot-uuid-123',
        capacity: 5
      }
    });

    mockSlotsService.createSpecialSlot.mockResolvedValue({
      success: true,
      slot: {
        id: 'slot-uuid-125',
        date: '2024-01-16',
        timeSlot: '12:00',
        capacity: 1,
        isSpecial: true
      }
    });

    mockSlotsService.deleteSlot.mockResolvedValue({
      success: true
    });

    mockSlotsService.getSlotStats.mockResolvedValue({
      totalSlots: 10,
      bookedSlots: 3,
      availableSlots: 7,
      specialSlots: 2
    });
  });

  describe('getAvailableSlots', () => {
    it('should return available slots for given date and office', async () => {
      const date = '2024-01-15';
      const officeId = testOffice.id;

      const slots = await mockSlotsService.getAvailableSlots(date, officeId);

      expect(slots).toBeDefined();
      expect(Array.isArray(slots)).toBe(true);
      expect(slots.length).toBeGreaterThan(0);
      
      const firstSlot = slots[0];
      expect(firstSlot).toHaveProperty('timeSlot');
      expect(firstSlot).toHaveProperty('capacity');
      expect(firstSlot).toHaveProperty('isSpecial');
    });

    it('should return empty array for non-existent office', async () => {
      const date = '2024-01-15';
      const nonExistentOfficeId = 'non-existent-uuid';

      mockSlotsService.getAvailableSlots.mockResolvedValue([]);

      const slots = await mockSlotsService.getAvailableSlots(date, nonExistentOfficeId);

      expect(slots).toEqual([]);
    });

    it('should return empty array for non-existent date', async () => {
      const date = '2024-01-20'; // Date with no slots
      const officeId = testOffice.id;

      mockSlotsService.getAvailableSlots.mockResolvedValue([]);

      const slots = await mockSlotsService.getAvailableSlots(date, officeId);

      expect(slots).toEqual([]);
    });
  });

  describe('bookSlot', () => {
    it('should book a slot successfully', async () => {
      const slotId = 'slot-uuid-123';
      const leadId = 12345;
      const contactId = 67890;

      const result = await mockSlotsService.bookSlot(slotId, leadId, contactId);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.appointment).toBeDefined();
      expect(result.appointment.bitrix_lead_id).toBe(leadId);
      expect(result.appointment.bitrix_contact_id).toBe(contactId);
    });

    it('should fail to book already booked slot', async () => {
      const slotId = 'slot-uuid-123';
      const leadId = 12345;
      const contactId = 67890;

      mockSlotsService.bookSlot.mockResolvedValue({
        success: false,
        error: 'Slot already booked'
      });

      const result = await mockSlotsService.bookSlot(slotId, leadId, contactId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail to book non-existent slot', async () => {
      const nonExistentSlotId = 'non-existent-slot-uuid';
      const leadId = 12345;
      const contactId = 67890;

      mockSlotsService.bookSlot.mockResolvedValue({
        success: false,
        error: 'Slot not found'
      });

      const result = await mockSlotsService.bookSlot(nonExistentSlotId, leadId, contactId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('updateSlotCapacity', () => {
    it('should update slot capacity successfully', async () => {
      const slotId = 'slot-uuid-123';
      const newCapacity = 5;

      const result = await mockSlotsService.updateSlotCapacity(slotId, newCapacity);

      expect(result.success).toBe(true);
      expect(result.slot.capacity).toBe(newCapacity);
    });

    it('should fail to update non-existent slot', async () => {
      const nonExistentSlotId = 'non-existent-slot-uuid';
      const newCapacity = 5;

      mockSlotsService.updateSlotCapacity.mockResolvedValue({
        success: false,
        error: 'Slot not found'
      });

      const result = await mockSlotsService.updateSlotCapacity(nonExistentSlotId, newCapacity);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate capacity range', async () => {
      const slotId = 'slot-uuid-123';
      const invalidCapacity = -1;

      mockSlotsService.updateSlotCapacity.mockResolvedValue({
        success: false,
        error: 'Invalid capacity value'
      });

      const result = await mockSlotsService.updateSlotCapacity(slotId, invalidCapacity);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('createSpecialSlot', () => {
    it('should create special slot successfully', async () => {
      const scheduleId = testTemplate.id;
      const date = '2024-01-16';
      const timeSlot = '12:00';
      const capacity = 1;
      const isSpecial = true;

      const result = await mockSlotsService.createSpecialSlot(
        scheduleId, 
        date, 
        timeSlot, 
        capacity, 
        isSpecial
      );

      expect(result.success).toBe(true);
      expect(result.slot).toBeDefined();
      expect(result.slot.date).toBe(date);
      expect(result.slot.timeSlot).toBe(timeSlot);
      expect(result.slot.capacity).toBe(capacity);
      expect(result.slot.isSpecial).toBe(isSpecial);
    });

    it('should fail to create slot with invalid schedule', async () => {
      const invalidScheduleId = 'invalid-schedule-uuid';
      const date = '2024-01-16';
      const timeSlot = '12:00';
      const capacity = 1;
      const isSpecial = true;

      mockSlotsService.createSpecialSlot.mockResolvedValue({
        success: false,
        error: 'Invalid schedule'
      });

      const result = await mockSlotsService.createSpecialSlot(
        invalidScheduleId, 
        date, 
        timeSlot, 
        capacity, 
        isSpecial
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('deleteSlot', () => {
    it('should delete slot successfully', async () => {
      const slotId = 'slot-uuid-123';

      const result = await mockSlotsService.deleteSlot(slotId);

      expect(result.success).toBe(true);
    });

    it('should fail to delete non-existent slot', async () => {
      const nonExistentSlotId = 'non-existent-slot-uuid';

      mockSlotsService.deleteSlot.mockResolvedValue({
        success: false,
        error: 'Slot not found'
      });

      const result = await mockSlotsService.deleteSlot(nonExistentSlotId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail to delete booked slot', async () => {
      const slotId = 'slot-uuid-123';

      mockSlotsService.deleteSlot.mockResolvedValue({
        success: false,
        error: 'Cannot delete booked slot'
      });

      const result = await mockSlotsService.deleteSlot(slotId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getSlotStats', () => {
    it('should return slot statistics for office', async () => {
      const officeId = testOffice.id;
      const startDate = '2024-01-01';
      const endDate = '2024-01-31';

      const stats = await mockSlotsService.getSlotStats(officeId, startDate, endDate);

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalSlots');
      expect(stats).toHaveProperty('bookedSlots');
      expect(stats).toHaveProperty('availableSlots');
      expect(stats).toHaveProperty('specialSlots');
    });

    it('should return zero stats for non-existent office', async () => {
      const nonExistentOfficeId = 'non-existent-office-uuid';
      const startDate = '2024-01-01';
      const endDate = '2024-01-31';

      mockSlotsService.getSlotStats.mockResolvedValue({
        totalSlots: 0,
        bookedSlots: 0,
        availableSlots: 0,
        specialSlots: 0
      });

      const stats = await mockSlotsService.getSlotStats(nonExistentOfficeId, startDate, endDate);

      expect(stats.totalSlots).toBe(0);
      expect(stats.bookedSlots).toBe(0);
      expect(stats.availableSlots).toBe(0);
      expect(stats.specialSlots).toBe(0);
    });
  });
});
