import cds from '@sap/cds'
import express from 'express'

/**
 * Local mock of the BPA "Start workflow instance" API:
 *   POST /workflow/rest/v1/workflow-instances
 * Active only outside production. Lets us test the CAP → BPA call without a BPA tenant.
 * Tip: send vendorCode "FAIL" (context.vendorcode) to simulate a BPA error and test the retry flow.
 */
cds.on('bootstrap', app => {
  if (process.env.NODE_ENV === 'production') return

  app.post('/mock-bpa/workflow/rest/v1/workflow-instances', express.json(), (req, res) => {
    const { definitionId, context } = req.body
    console.log('\n[MOCK BPA] Workflow start received:\n', JSON.stringify(req.body, null, 2))

    if (!definitionId || !context?.bTP_PRN_ID)
      return res.status(400).json({ error: { message: 'definitionId and context.bTP_PRN_ID are required' } })

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
   * Local mock of the CPI iFlow that forwards an approved payment to MBC:
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

    res.status(200).json({
      btpPaymentRef: p.btpPaymentRef,
      bankPaymentRef: `MBC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(calls).padStart(2, '0')}${Math.floor(Math.random() * 1e4)}`,
      status: 'TRANSMITTED'
    })
  })
})

export default cds.server