const express = require('express')
const { body, validationResult } = require('express-validator')
const bcrypt = require('bcryptjs')
const { models } = require('../lib/db')
const { signAdminJwt, adminAuthMiddleware } = require('../middleware/adminAuth')

const router = express.Router()

router.post('/login',
  body('email').isEmail(),
  body('password').isString().isLength({ min: 3 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
      const { email, password } = req.body
      const user = await models.User.findOne({ where: { email } })
      if (!user) return res.status(401).json({ error: 'Invalid credentials' })
      const ok = await bcrypt.compare(password, user.passwordHash)
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
      const token = signAdminJwt({ id: user.id, email: user.email, role: user.role, name: user.name })
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
    } catch (e) { next(e) }
  }
)

module.exports = router

// Current admin user info
router.get('/me', adminAuthMiddleware, async (req, res) => {
  try {
    const { id, email, role, name } = req.admin || {}
    return res.json({ user: { id, email, role, name } })
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
})
