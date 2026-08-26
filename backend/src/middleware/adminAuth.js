const jwt = require('jsonwebtoken')

// Секрет обязателен в проде: раньше при незаданной переменной молча
// использовался 'dev-secret', и подписать админский токен мог кто угодно.
function adminJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET
  if (!secret || secret === 'change-me-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_JWT_SECRET не задан или оставлен значением по умолчанию')
    }
    return secret || 'dev-secret'
  }
  return secret
}

function signAdminJwt(payload) {
  return jwt.sign(payload, adminJwtSecret(), { expiresIn: process.env.ADMIN_JWT_TTL || '12h' })
}

function adminAuthMiddleware(req, res, next) {
  // Токен принимается только заголовком. Приём через ?token= отправлял
  // семидневный админский JWT в access-логи nginx, в историю браузера и в
  // заголовок Referer при любом переходе на внешний сайт.
  const auth = req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, adminJwtSecret())
    req.admin = payload
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

// Роли в модели User были (admin/editor/viewer) и валидировались при создании,
// но ни один маршрут их не проверял — «viewer» мог заводить и удалять админов.
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 }

function requireRole(minRole) {
  const required = ROLE_RANK[minRole]
  if (!required) throw new Error(`Неизвестная роль: ${minRole}`)
  return function roleGuard(req, res, next) {
    const role = req.admin && req.admin.role
    const rank = ROLE_RANK[role] || 0
    if (rank < required) {
      return res.status(403).json({ error: 'Forbidden', details: `Требуется роль не ниже «${minRole}»` })
    }
    return next()
  }
}

module.exports = { signAdminJwt, adminAuthMiddleware, requireRole, ROLE_RANK }
