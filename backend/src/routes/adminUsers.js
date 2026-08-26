const express = require('express')
const { body, validationResult } = require('express-validator')
const bcrypt = require('bcryptjs')
const { models } = require('../lib/db')
const { adminAuthMiddleware, requireRole } = require('../middleware/adminAuth')

const router = express.Router()

router.use(adminAuthMiddleware)

// Управление учётками — только для роли admin. Раньше роль вообще не
// проверялась: любой валидный токен, включая выданный роли viewer, мог
// заводить и удалять администраторов.
const canManageUsers = requireRole('admin')

router.get('/', async (req, res, next) => {
  try {
    const users = await models.User.findAll({ attributes: ['id','email','name','role','createdAt','updatedAt'] })
    res.json({ data: users })
  } catch (e) { next(e) }
})

router.post('/', canManageUsers,
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

router.put('/:id', canManageUsers,
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
      if (req.body.role) {
        // Понижение роли последнего админа так же лишает доступа, как удаление
        if (user.role === 'admin' && req.body.role !== 'admin') {
          const admins = await models.User.count({ where: { role: 'admin' } })
          if (admins <= 1) {
            return res.status(400).json({ error: 'Нельзя снять роль admin с последнего администратора' })
          }
        }
        updates.role = req.body.role
      }
      if (req.body.password) updates.passwordHash = await bcrypt.hash(req.body.password, 10)
      await user.update(updates)
      res.json({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    } catch (e) { next(e) }
  }
)

router.delete('/:id', canManageUsers, async (req, res, next) => {
  try {
    const user = await models.User.findByPk(req.params.id)
    if (!user) return res.status(404).json({ error: 'Not found' })

    // Раньше проверок не было: можно было удалить собственную учётку и
    // последнего администратора. Доступ к админке восстанавливался только
    // перезапуском контейнера, и то с паролем по умолчанию из seed.
    if (req.admin && String(req.admin.id) === String(user.id)) {
      return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись' })
    }
    if (user.role === 'admin') {
      const admins = await models.User.count({ where: { role: 'admin' } })
      if (admins <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего администратора' })
      }
    }

    await user.destroy()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

module.exports = router


