import cds from '@sap/cds'

/**
 * DEVELOPMENT ONLY — mocked login that works in SAP Business Application Studio.
 *
 * The BAS port forwarding does not show the browser's basic-auth dialog, so the standard
 * mocked auth only answers 401 ("Unauthorized"). This middleware takes the user from:
 *   1. the Authorization: Basic header (test.http, Postman) — password not checked, or
 *   2. the cookie 'mock-user', set by opening /dev-login?user=bob (see server.js), or
 *   3. the default user alice.
 * Users and roles: cds.requires.auth.users in package.json ([development]).
 * Activated only by package.json "[development]".auth.impl; production uses XSUAA.
 */
export const DEFAULT_USER = 'alice'
export const COOKIE = 'mock-user'

export default function devAuth(options) {
  if (process.env.NODE_ENV === 'production')
    throw new Error('srv/lib/dev-auth.js must not be used in production')
  const users = options.users ?? {}

  return function dev_auth(req, res, next) {
    const basic = req.headers.authorization?.match(/^basic\s+(.+)$/i)
    const cookie = /(?:^|;\s*)mock-user=([^;]+)/.exec(req.headers.cookie ?? '')
    const id = basic ? Buffer.from(basic[1], 'base64').toString().split(':')[0]
      : cookie ? decodeURIComponent(cookie[1]) : DEFAULT_USER
    const u = users[id]
    if (!u) return res.status(401).send(`Unknown mock user '${id}'. Known: ${Object.keys(users).join(', ')}`)
    const user = new cds.User({ id, roles: u.roles ?? [], attr: u.attr ?? {} })
    cds.context.user = req.user = user
    next()
  }
}
