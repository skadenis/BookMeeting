const jwt = require('jsonwebtoken')

function signAdminJwt(payload) {
  const secret = process.env.ADMIN_JWT_SECRET || 'dev-secret'
  return jwt.sign(payload, secret, { expiresIn: '7d' })
}

function adminAuthMiddleware(req, res, next) {
  const auth = req.header('Authorization') || ''
  let token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
  // Also allow token via query string (not named 'auth')
  if (!token) {
    token = req.query.admin_token || req.query.adminToken || req.query.token || null
  }
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const secret = process.env.ADMIN_JWT_SECRET || 'dev-secret'
    const payload = jwt.verify(token, secret)
    req.admin = payload
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

module.exports = { signAdminJwt, adminAuthMiddleware }


