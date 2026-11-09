import cds from '@sap/cds'
const LOG = cds.log('bank-transfer')

// CPI endpoint (iFlow) that forwards the payment to MBC — NOT built yet (placeholder path).
// Do not point this at /http/BTP/PaymentRequest: that is the inbound CREATE iFlow (→ CAP).
const CPI_PAYMENT_PATH = '/http/agmc/payments'

export default class BankTransferService extends cds.ApplicationService {
  init() {
    const { PaymentRequests } = cds.entities('com.agmc.paymentrequest')

    /**
     * Runs in the background from the outbox, after the final approval is committed.
     * Success → status SENT_TO_BANK with the bank reference.
     * Error   → thrown: the queue retries later (temporary errors) or stops (4xx from CPI).
     */
    this.on('sendPayment', async req => {
      const pr = await SELECT.one.from(PaymentRequests, req.data.ID)
        .columns(p => { p('*'), p.items(i => i('*')) })
      if (!pr) return LOG.warn(`Payment request ${req.data.ID} not found — nothing sent`)
      if (pr.status_code !== 'APPROVED')   // already sent, or changed meanwhile → never send twice
        return LOG.info(`${pr.btpPaymentRef}: status ${pr.status_code}, not sent again`)

      // btpPaymentRef is the unique payment ID: CPI/MBC must reject a second payment with the same value
      const payload = {
        btpPaymentRef: pr.btpPaymentRef, requestId: pr.requestId,
        paymentType: pr.paymentType_code, companyCode: pr.companyCode,
        vendorCode: pr.vendorCode, vendorName: pr.vendorName,
        paymentAmount: Number(pr.paymentAmount), currency: pr.currency_code,
        paymentDueDate: pr.paymentDueDate, paymentMethod: pr.paymentMethod_code,
        bankName: pr.bankName, iban: pr.iban, bankAccountNo: pr.bankAccountNo, swiftCode: pr.swiftCode,
        costCentre: pr.costCentre, glAccount: pr.glAccount,
        invoices: (pr.items || []).map(i => ({
          invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate,
          invoiceAmount: Number(i.invoiceAmount), currency: i.currency_code
        }))
      }

      let result
      try {
        const cpi = await cds.connect.to('cpi')
        result = await cpi.send({ method: 'POST', path: CPI_PAYMENT_PATH, data: payload })
      } catch (err) {
        const status = err.reason?.response?.status ?? err.statusCode
        const msg = err.reason?.response?.data?.error?.message || err.message
        const e = new Error(`CPI call failed for ${pr.btpPaymentRef}${status ? ` (HTTP ${status})` : ''}: ${msg}`)
        // 4xx = the data is wrong (e.g. invalid IBAN) → retrying will not help
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) e.unrecoverable = true
        throw e
      }

      await UPDATE(PaymentRequests, pr.ID).with({
        status_code:    'SENT_TO_BANK',
        bankPaymentRef: result?.bankPaymentRef ?? null,
        sentToBankAt:   new Date().toISOString()
      })
      LOG.info(`${pr.btpPaymentRef}: sent to bank via CPI (ref ${result?.bankPaymentRef ?? '-'})`)
    })

    return super.init()
  }
}
