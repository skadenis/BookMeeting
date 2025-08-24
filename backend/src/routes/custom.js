const { Router } = require('express');
const { models, Op } = require('../lib/db');
const { invalidateSlotsCache } = require('../services/slotsService');

const router = Router();

// Working capacity and day management endpoint
router.get('/manage', async (req, res) => {
  console.log('CUSTOM/MANAGE called with:', JSON.stringify(req.query));
  try {
    // Handle capacity update
    if (req.query.slot_id && req.query.capacity) {
      const slot = await models.Slot.findByPk(req.query.slot_id);
      if (slot) {
        const oldCapacity = slot.capacity;
        slot.capacity = Number(req.query.capacity);
        await slot.save();
        
        // Mark schedule as customized
        const schedule = await models.Schedule.findByPk(slot.schedule_id);
        if (schedule) {
          schedule.isCustomized = true;
          schedule.customizedAt = new Date();
          await schedule.save();
          await invalidateSlotsCache(schedule.office_id, schedule.date);
        }
        
        console.log('SUCCESS: Updated slot capacity from', oldCapacity, 'to', slot.capacity);
        return res.json({ success: true, capacity: slot.capacity, message: 'Capacity updated' });
      }
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    // Handle day operations
    if (req.query.action && req.query.office_id && req.query.date) {
      const { action, office_id, date } = req.query;
      console.log('DAY ACTION:', action, 'for office', office_id, 'date', date);
      
      switch (action) {
        case 'close_day':
          const schedule = await models.Schedule.findOne({ where: { office_id, date } });
          if (schedule) {
            schedule.isWorkingDay = false;
            schedule.isCustomized = true;
            schedule.customizedAt = new Date();
            await schedule.save();
            await invalidateSlotsCache(office_id, date);
            console.log('SUCCESS: Closed day');
            return res.json({ success: true, message: 'Day closed' });
          }
          return res.status(404).json({ error: 'Schedule not found' });
          
        case 'close_early':
          if (req.query.close_after) {
            const schedule = await models.Schedule.findOne({ where: { office_id, date } });
            if (schedule) {
              const deleted = await models.Slot.destroy({ 
                where: { 
                  schedule_id: schedule.id,
                  start: { [Op.gte]: req.query.close_after }
                }
              });
              schedule.isCustomized = true;
              schedule.customizedAt = new Date();
              await schedule.save();
              await invalidateSlotsCache(office_id, date);
              console.log('SUCCESS: Closed early after', req.query.close_after, 'deleted', deleted, 'slots');
              return res.json({ success: true, message: `Closed early after ${req.query.close_after}`, deleted });
            }
          }
          return res.status(400).json({ error: 'Missing close_after parameter' });
          
        case 'open_late':
          if (req.query.open_from) {
            const schedule = await models.Schedule.findOne({ where: { office_id, date } });
            if (schedule) {
              const deleted = await models.Slot.destroy({ 
                where: { 
                  schedule_id: schedule.id,
                  end: { [Op.lte]: req.query.open_from }
                }
              });
              schedule.isCustomized = true;
              schedule.customizedAt = new Date();
              await schedule.save();
              await invalidateSlotsCache(office_id, date);
              console.log('SUCCESS: Opened late from', req.query.open_from, 'deleted', deleted, 'slots');
              return res.json({ success: true, message: `Opened late from ${req.query.open_from}`, deleted });
            }
          }
          return res.status(400).json({ error: 'Missing open_from parameter' });
      }
      
      return res.status(400).json({ error: 'Unknown action' });
    }
    
    res.status(400).json({ error: 'Missing required parameters' });
  } catch (e) {
    console.error('Error in custom/manage:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
