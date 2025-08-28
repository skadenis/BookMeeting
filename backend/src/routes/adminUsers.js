const express = require('express')
const { body, validationResult } = require('express-validator')
const bcrypt = require('bcryptjs')
const { models } = require('../lib/db')
const { adminAuthMiddleware } = require('../middleware/adminAuth')

const router = express.Router()

router.use(adminAuthMiddleware)

router.get('/', async (req, res, next) => {
  try {
    const users = await models.User.findAll({ attributes: ['id','email','name','role','createdAt','updatedAt'] })
    res.json({ data: users })
  } catch (e) { next(e) }
})

router.post('/',
  body('email').isEmail(),
  body('name').isString().isLength({ min: 1 }),
  body('password').isString().isLength({ min: 3 }),
  body('role').optional().isIn(['admin','editor','viewer']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
      const { email, name, password, role } = req.body
      const exists = await models.User.findOne({ where: { email } })
      if (exists) return res.status(409).json({ error: 'Email already exists' })
      const passwordHash = await bcrypt.hash(password, 10)
      const user = await models.User.create({ email, name, passwordHash, role: role || 'admin' })
      res.status(201).json({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    } catch (e) { next(e) }
  }
)

router.put('/:id',
  body('name').optional().isString().isLength({ min: 1 }),
  body('password').optional().isString().isLength({ min: 3 }),
  body('role').optional().isIn(['admin','editor','viewer']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
      const user = await models.User.findByPk(req.params.id)
      if (!user) return res.status(404).json({ error: 'Not found' })
      const updates = {}
      if (req.body.name) updates.name = req.body.name
      if (req.body.role) updates.role = req.body.role
      if (req.body.password) updates.passwordHash = await bcrypt.hash(req.body.password, 10)
      await user.update(updates)
      res.json({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    } catch (e) { next(e) }
  }
)

router.delete('/:id', async (req, res, next) => {
  try {
    const user = await models.User.findByPk(req.params.id)
    if (!user) return res.status(404).json({ error: 'Not found' })
    await user.destroy()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

module.exports = router


