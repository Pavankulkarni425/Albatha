import cds from '@sap/cds'
import express from 'express'

/**
 * Local mock of the BPA "Start workflow instance" API:
 *   POST /workflow/rest/v1/workflow-instances
 * Active only outside production. Lets us test the CAP → BPA call without a BPA tenant.
 * Tip: send vendorCode "FAIL" (context.vendorcode) to simulate a BPA error and test the retry flow.
 */
/**
 * One-off data migrations of status codes (all environments, idempotent). The CSV deployer only upserts
 * code-list rows, so requests still in an old status are moved and the old row is removed:
 * - NEW → READY (2026-11-12, renamed)
 * - SENT_TO_BANK → ST-11, SETTLED → ST-15 (2026-11-13, replaced by the APM statuses)
 * - REJECTED → RETURN (2026-11-13, BPA has no final rejection)
 * Can be deleted once every database has been migrated.
 */
const STATUS_MIGRATIONS = { NEW: 'READY', SENT_TO_BANK: 'ST-11', SETTLED: 'ST-15', REJECTED: 'RETURN' }
cds.on('served', async () => {
  const LOG = cds.log('migration')
  const { PaymentRequests, PaymentStatuses } = cds.entities('com.agmc.paymentrequest')
  const drafts = cds.model.definitions['PaymentRequestService.PaymentRequests.drafts']
  for (const [from, to] of Object.entries(STATUS_MIGRATIONS)) {
    try {
      const moved = await UPDATE(PaymentRequests).set({ status_code: to }).where({ status_code: from })
      if (drafts) await UPDATE(drafts).set({ status_code: to }).where({ status_code: from })
      await DELETE.from(PaymentStatuses).where({ code: from })
      if (moved) LOG.info(`${moved} payment request(s) moved from status ${from} to ${to}`)
    } catch (err) {
      LOG.error(`Status migration ${from} → ${to} failed:`, err.message)
    }
  }
  // Source CPI → KLD (2026-11-23): requests from the integration API are shown with their source system KLD
  try {
    const moved = await UPDATE(PaymentRequests).set({ source: 'KLD' }).where({ source: 'CPI' })
    if (drafts) await UPDATE(drafts).set({ source: 'KLD' }).where({ source: 'CPI' })
    if (moved) LOG.info(`${moved} payment request(s) moved from source CPI to KLD`)
  } catch (err) {
    LOG.error('Source migration CPI → KLD failed:', err.message)
  }
})

cds.on('bootstrap', app => {
  if (process.env.NODE_ENV === 'production') return

  /**
   * Switch the mocked user (development only, see srv/lib/dev-auth.js):
   *   /dev-login?user=bob    → all following requests run as bob
   *   /dev-login             → shows the current user and the known users
   * Needed in Business Application Studio, where the browser's login dialog does not appear.
   */
  app.get('/dev-login', (req, res) => {
    const users = Object.keys(cds.env.requires.auth?.users ?? {})
    const user = req.query.user
    if (user && !users.includes(user)) return res.status(400).send(`Unknown user '${user}'. Known: ${users.join(', ')}`)
    if (user) res.cookie('mock-user', user, { httpOnly: true, sameSite: 'lax', path: '/' })
    const current = user ?? /(?:^|;\s*)mock-user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'alice'
    res.type('html').send(`<p>Mock user: <b>${current}</b></p>
      <p>Switch: ${users.map(u => `<a href="?user=${u}">${u}</a>`).join(' · ')}</p>
      <p><a href="/com.fiori.paymentrequestlist/index.html?sap-ui-xx-viewCache=false">Open the app</a></p>`)
  })

  app.post('/mock-bpa/workflow/rest/v1/workflow-instances', express.json(), (req, res) => {
    const { definitionId, context } = req.body
    console.log('\n[MOCK BPA] Workflow start received:\n', JSON.stringify(req.body, null, 2))

    // reference key of the BPA trigger: btpPaymentRef (older trigger versions: bTP_PRN_ID)
    if (!definitionId || !(context?.btpPaymentRef ?? context?.bTP_PRN_ID))
      return res.status(400).json({ error: { message: 'definitionId and context.btpPaymentRef are required' } })

    if (context.vendorcode === 'FAIL')
      return res.status(500).json({ error: { message: 'Simulated BPA failure' } })

    // Same shape as the real BPA response (relevant fields)
    res.status(201).json({
      id: cds.utils.uuid(),
      definitionId,
      status: 'RUNNING',
      startedAt: new Date().toISOString()
    })
  })

  /**
   * Local mock of the CPI iFlow that forwards an approved payment to APM:
   *   POST /http/agmc/payments
   * Test vendor codes:
   *   CPIDOWN   → HTTP 503 on the first 2 calls, then success (tests the outbox retry)
   *   CPIREJECT → HTTP 400 always (tests the unrecoverable error: no retries)
   */
  const cpiCalls = new Map()   // btpPaymentRef → number of calls
  app.post('/mock-cpi/http/agmc/payments', express.json(), (req, res) => {
    const p = req.body
    const calls = (cpiCalls.get(p.btpPaymentRef) ?? 0) + 1
    cpiCalls.set(p.btpPaymentRef, calls)
    console.log(`\n[MOCK CPI] Payment received (call ${calls}):\n`, JSON.stringify(p, null, 2))

    if (!p.btpPaymentRef || !p.paymentAmount)
      return res.status(400).json({ error: { message: 'btpPaymentRef and paymentAmount are required' } })
    if (p.vendorCode === 'CPIREJECT')
      return res.status(400).json({ error: { message: 'Simulated MBC rejection: invalid IBAN' } })
    if (p.vendorCode === 'CPIDOWN' && calls <= 2)
      return res.status(503).json({ error: { message: 'Simulated CPI outage' } })

    // CPI only confirms receipt; APM reports progress later via /integration/updatePaymentStatus
    res.status(200).json({
      btpPaymentRef: p.btpPaymentRef,
      messageId: `CPI-${Date.now()}`,
      status: 'RECEIVED'
    })
  })
})

export default cds.server