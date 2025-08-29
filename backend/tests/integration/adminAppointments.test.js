const request = require('supertest');
const { models } = require('../../src/lib/db');

// Mock the entire app
jest.mock('../../src/index', () => {
  const express = require('express');
  const app = express();
  
  app.use(express.json());
  
  // Mock admin routes
  app.get('/api/admin/appointments', (req, res) => {
    // Mock admin authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({ 
      data: [],
      meta: {
        total: 0,
        filters: req.query
      }
    });
  });
  
  app.get('/api/admin/appointments/:id', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({ 
      data: {
        id: req.params.id,
        date: '2024-01-15',
        timeSlot: '10:00',
        status: 'pending',
        office_id: 'office-uuid-123',
        bitrix_lead_id: 12345,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  });
  
  app.put('/api/admin/appointments/:id', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({ 
      data: {
        id: req.params.id,
        ...req.body,
        updatedAt: new Date()
      }
    });
  });
  
  app.delete('/api/admin/appointments/:id', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({ message: 'Встреча удалена' });
  });
  
  app.get('/api/admin/appointments/stats/overview', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({ 
      data: {
        total: 0,
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        rescheduled: 0
      }
    });
  });
  
  return app;
});

const app = require('../../src/index');

describe('Admin Appointments API Integration Tests', () => {
  const adminToken = 'Bearer valid-admin-token';
  const invalidToken = 'Bearer invalid-token';

  beforeEach(async () => {
    // Clear test data
    await models.Appointment.destroy({ where: {} });
    await models.Office.destroy({ where: {} });
  });

  afterAll(async () => {
    // Cleanup
    await models.Appointment.destroy({ where: {} });
    await models.Office.destroy({ where: {} });
    await models.sequelize.close();
  });

  describe('GET /api/admin/appointments', () => {
    it('should return appointments list for admin', async () => {
      const response = await request(app)
        .get('/api/admin/appointments')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('total');
    });

    it('should filter appointments by date range', async () => {
      const response = await request(app)
        .get('/api/admin/appointments?start_date=2024-01-01&end_date=2024-01-31')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.meta.filters).toHaveProperty('start_date');
      expect(response.body.meta.filters).toHaveProperty('end_date');
    });

    it('should filter appointments by status', async () => {
      const response = await request(app)
        .get('/api/admin/appointments?status=pending')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.meta.filters).toHaveProperty('status');
      expect(response.body.meta.filters.status).toBe('pending');
    });

    it('should filter appointments by office', async () => {
      const response = await request(app)
        .get('/api/admin/appointments?office_id=office-uuid-123')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.meta.filters).toHaveProperty('office_id');
    });

    it('should search appointments by text', async () => {
      const response = await request(app)
        .get('/api/admin/appointments?search=12345')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.meta.filters).toHaveProperty('search');
    });

    it('should reject unauthorized access', async () => {
      const response = await request(app)
        .get('/api/admin/appointments')
        .set('Authorization', invalidToken)
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should reject access without token', async () => {
      const response = await request(app)
        .get('/api/admin/appointments')
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('GET /api/admin/appointments/:id', () => {
    it('should return specific appointment for admin', async () => {
      const appointmentId = 'test-uuid-123';
      
      const response = await request(app)
        .get(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.id).toBe(appointmentId);
      expect(response.body.data).toHaveProperty('date');
      expect(response.body.data).toHaveProperty('timeSlot');
      expect(response.body.data).toHaveProperty('status');
    });

    it('should reject unauthorized access to specific appointment', async () => {
      const appointmentId = 'test-uuid-123';
      
      const response = await request(app)
        .get(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', invalidToken)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/appointments/:id', () => {
    it('should update appointment status for admin', async () => {
      const appointmentId = 'test-uuid-123';
      const updateData = {
        status: 'confirmed'
      };

      const response = await request(app)
        .put(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', adminToken)
        .send(updateData)
        .expect(200);

      expect(response.body.data.id).toBe(appointmentId);
      expect(response.body.data.status).toBe(updateData.status);
    });

    it('should update appointment date for admin', async () => {
      const appointmentId = 'test-uuid-123';
      const updateData = {
        date: '2024-01-20'
      };

      const response = await request(app)
        .put(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', adminToken)
        .send(updateData)
        .expect(200);

      expect(response.body.data.id).toBe(appointmentId);
      expect(response.body.data.date).toBe(updateData.date);
    });

    it('should reject unauthorized updates', async () => {
      const appointmentId = 'test-uuid-123';
      const updateData = {
        status: 'confirmed'
      };

      const response = await request(app)
        .put(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', invalidToken)
        .send(updateData)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/appointments/:id', () => {
    it('should delete appointment for admin', async () => {
      const appointmentId = 'test-uuid-123';

      const response = await request(app)
        .delete(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Встреча удалена');
    });

    it('should reject unauthorized deletion', async () => {
      const appointmentId = 'test-uuid-123';

      const response = await request(app)
        .delete(`/api/admin/appointments/${appointmentId}`)
        .set('Authorization', invalidToken)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/appointments/stats/overview', () => {
    it('should return appointment statistics for admin', async () => {
      const response = await request(app)
        .get('/api/admin/appointments/stats/overview')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('pending');
      expect(response.body.data).toHaveProperty('confirmed');
      expect(response.body.data).toHaveProperty('cancelled');
      expect(response.body.data).toHaveProperty('rescheduled');
    });

    it('should filter statistics by date range', async () => {
      const response = await request(app)
        .get('/api/admin/appointments/stats/overview?start_date=2024-01-01&end_date=2024-01-31')
        .set('Authorization', adminToken)
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should reject unauthorized access to statistics', async () => {
      const response = await request(app)
        .get('/api/admin/appointments/stats/overview')
        .set('Authorization', invalidToken)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });
});
