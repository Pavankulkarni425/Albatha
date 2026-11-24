import cds from '@sap/cds'
import { nextPaymentRef, initialStatus, requirementsFor, dueDateErrors, bankDetailErrors, SOURCE } from './lib/payment-request-rules.js'
import { applyApmStatus } from './lib/apm-status.js'
const LOG = cds.log('integration')

// Status codes (see db/data/...-PaymentStatuses.csv); APM statuses ST-01 … ST-16: srv/lib/apm-status.js
const STATUS = {
  DRAFT: 'DRAFT', READY: 'READY', DOC_PENDING: 'DOC_PENDING', IN_APPROVAL: 'IN_APPROVAL', RETURN: 'RETURN',
  APPROVED: 'APPROVED'
}

// Path of the Fiori app's OData service (PaymentRequestService) — used for the document links
const PAYMENT_SRV_PATH = '/odata/v4/payment-request'

export default class IntegrationService extends cds.ApplicationService {
  init() {
    const { PaymentRequests } = this.entities
    const { ApprovalHistory, PaymentTypes, CompanyCodes, PaymentMethods } = cds.entities('com.agmc.paymentrequest')
    /**
     * CPI → CAP: create payment request.
     * Generates the BTP reference. Status: 'Document Pending' when mandatory documents are
     * configured (none can be attached yet), otherwise 'Ready'. The workflow is NOT started here —
     * the user starts it from the business API after uploading the mandatory documents.
     */
    this.before('CREATE', PaymentRequests, async req => {
      // Company code and payment type must be known values (they drive the document rules)
      const { companyCode, paymentType_code } = req.data
      if (!paymentType_code)
        return req.reject(400, 'paymentType_code is required (VENDOR_PAYMENT or VENDOR_ADVANCE)', 'paymentType_code')
      if (!await SELECT.one.from(PaymentTypes, paymentType_code).columns('code'))
        return req.reject(400, `Unknown payment type '${paymentType_code}' (allowed: VENDOR_PAYMENT, VENDOR_ADVANCE)`, 'paymentType_code')
      if (companyCode && !await SELECT.one.from(CompanyCodes, companyCode).columns('code'))
        return req.reject(400, `Unknown company code '${companyCode}'`, 'companyCode')

      // Payment method: S/4 method I / H / S (identifies the AGMC bank; the account is determined in S/4)
      const { paymentMethod_code } = req.data
      if (!paymentMethod_code)
        return req.reject(400, 'paymentMethod_code is required (I, H or S)', 'paymentMethod_code')
      if (!await SELECT.one.from(PaymentMethods, paymentMethod_code).columns('code')) {
        const known = (await SELECT.from(PaymentMethods).columns('code').orderBy('code')).map(m => m.code).join(', ')
        return req.reject(400, `Unknown payment method '${paymentMethod_code}' (allowed: ${known})`, 'paymentMethod_code')
      }
      // Vendor bank details: every method is a bank transfer
      const bankErrors = bankDetailErrors(req.data)
      if (bankErrors.length)
        return req.reject(400, bankErrors.map(e => e.message).join('; '), bankErrors[0].target)

      // Header amount = sum of the invoices (same rule as the Fiori app). Rejected rather than corrected:
      // the amount must never silently differ from what the source system sent.
      // Without invoices (e.g. a vendor advance paid before the invoice exists) the header amount stands.
      const items = req.data.items ?? []
      // Invoice due dates: mandatory and not in the past (today = UAE date), same rule as the Fiori app
      const dateErrors = dueDateErrors(items)
      if (dateErrors.length)
        return req.reject(400, dateErrors.map(e => e.message).join('; '), 'items')
      if (items.length) {
        const total = items.reduce((s, i) => s + Number(i.invoiceAmount || 0), 0)
        if (Math.abs(total - Number(req.data.paymentAmount)) > 0.005)
          return req.reject(400, `paymentAmount ${req.data.paymentAmount} does not match the invoice total ${total.toFixed(2)} — the payment amount must be the sum of the invoice amounts`, 'paymentAmount')
      }

      // Same request sent twice (e.g. a CPI retry): ...
      // Same request sent twice (e.g. a CPI retry): answer with a clear 409, not a database error.
      // The message includes the existing BTP reference so CPI can link it.
      const existing = await SELECT.one.from(PaymentRequests).columns('btpPaymentRef')
        .where({ requestId: req.data.requestId })
      if (existing)
        return req.reject(409, `Request ${req.data.requestId} already exists as ${existing.btpPaymentRef}`)
      req.data.btpPaymentRef = await nextPaymentRef()
      req.data.source = SOURCE.KLD   // whatever the caller sends

      // Status is always set by CAP, whatever the caller sends
      req.data.status_code = await initialStatus({ companyCode, paymentType_code, source: SOURCE.KLD })
    })

    // Request created via CPI: queue the creation mail (sent after commit, retried on failure)
    this.after('CREATE', PaymentRequests, async (pr, req) => {
      const ID = pr?.ID ?? req.data.ID
      if (ID) await cds.queued(await cds.connect.to('NotificationService')).send('requestCreated', { ID })
    })

    // Request data is not changed via this API after creation
    this.before(['UPDATE', 'DELETE'], PaymentRequests, req =>
      req.reject(405, 'Payment requests cannot be changed or deleted'))

    /**
     * BPA → CAP: called on EVERY workflow action (approve / reject / send back).
     * Writes approval history and updates status in one transaction.
     */
    this.on('updateWorkflowStatus', async req => {
      const d = req.data
      const pr = await SELECT.one.from(PaymentRequests)
        .columns('ID', 'status_code', 'bpaWorkflowInstanceId')
        .where({ btpPaymentRef: d.btpPaymentRef })
      if (!pr) return req.error(404, `Payment request ${d.btpPaymentRef} not found`)
      if (pr.status_code !== STATUS.IN_APPROVAL)
        return req.error(409, `Payment request ${d.btpPaymentRef} is not in approval (status ${pr.status_code})`)

      // Status rules. BPA has no final rejection: a rejecting decision sends the request back (Return).
      // 'Rejected' is still accepted from older BPA versions and handled as Return.
      let status_code
      switch (d.decision) {
        case 'Approved':  status_code = d.isFinalStep ? STATUS.APPROVED : STATUS.IN_APPROVAL; break
        case 'Return': status_code = STATUS.RETURN; break     // requester fixes documents and restarts:
        case 'Rejected':  status_code = STATUS.RETURN; break     // requester fixes documents and restarts
        default: return req.error(400, `Unknown decision '${d.decision}'. Use Approved or Return`)
      }

      await INSERT.into(ApprovalHistory).entries({
        parent_ID: pr.ID, source: 'BPA', stepNo: d.stepNo, stepName: d.stepName,
        approverId: d.approverId, approverName: d.approverName,
        decision: d.decision === 'Approved' ? 'Approved' : 'Return', comments: d.comments, bpaTaskId: d.bpaTaskId,
        bpaWorkflowInstanceId: pr.bpaWorkflowInstanceId,
        decisionAt: new Date().toISOString()
      })

      await UPDATE(PaymentRequests, pr.ID).with({
        status_code,
        approvalLevel: d.decision === 'Approved' ? d.stepNo : undefined,
        currentApprover: null
      })

      // Final approval: queue the bank transfer. The message is written to cds.outbox.Messages
      // in THIS transaction (together with history + status) and sent to CPI after commit,
      // in the background — BPA gets its answer without waiting for CPI/MBC.
      if (status_code === STATUS.APPROVED) {
        const bank = cds.queued(await cds.connect.to('BankTransferService'))
        await bank.send('sendPayment', { ID: pr.ID })
      }

      LOG.info(`${d.btpPaymentRef}: step ${d.stepNo} ${d.decision} → ${status_code}`)
      return status_code
    })

    /**
     * CPI → CAP: payment processing status from APM (ST-01 … ST-16).
     * Rules (forward only, rejections, final statuses, duplicates, history): srv/lib/apm-status.js
     */
    this.on('updatePaymentStatus', async req => {
      const result = await applyApmStatus(req.data)
      if (result.error) return req.error(result.error.status, result.error.message)
      const d = req.data
      LOG.info(`${d.btpPaymentRef}: APM ${d.status}${d.level ? ` (level ${d.level}/${d.levels ?? '?'})` : ''} → status ${result.status}` +
        (result.duplicate ? ' (duplicate, ignored)' : result.applied ? '' : ' (kept in history only)'))
      return result.status
    })

        /**
     * BPA → CAP: list of all saved documents of a payment request, with document type,
     * requirement level (from the matrix) and a link to open the file.
     * Only saved (active) attachments are returned, never drafts.
     */
    this.on('getAttachedDocuments', async req => {
      const { btpPaymentRef } = req.data
      if (!btpPaymentRef) return req.reject(400, 'btpPaymentRef is required', 'btpPaymentRef')

      const pr = await SELECT.one.from(PaymentRequests)
        .columns('ID', 'companyCode', 'paymentType_code', 'source').where({ btpPaymentRef })
      if (!pr) return req.reject(404, `Payment request ${btpPaymentRef} not found`)

      const Attachments = cds.entities('com.agmc.paymentrequest')['PaymentRequests.attachments']
      const [files, { rules }] = await Promise.all([
        SELECT.from(Attachments)
          .columns(a => { a.ID, a.filename, a.mimeType, a.createdAt, a.createdBy, a.docType_code, a.docType(d => d.name) })
          .where({ up__ID: pr.ID }),
        requirementsFor(pr)
      ])

      // Sort like the checklist: matrix order first, documents outside the matrix at the end
      const ruleOf = new Map(rules.map(r => [r.docType_code, r]))
      const sortKey = f => ruleOf.get(f.docType_code)?.sortOrder ?? 9999
      files.sort((a, b) => sortKey(a) - sortKey(b) || String(a.filename).localeCompare(b.filename))

      const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
      const documents = files.map(f => ({
        attachmentId: f.ID,
        docType:      f.docType_code ?? null,
        docTypeName:  f.docType?.name ?? f.docType_code ?? 'Not classified',
        requirement:  ruleOf.get(f.docType_code)?.levelName ?? 'Additional',
        fileName:     f.filename,
        mimeType:     f.mimeType,
        uploadedBy:   f.createdBy,
        uploadedAt:   f.createdAt,
        viewUrl: base
          ? `${base}${PAYMENT_SRV_PATH}/PaymentRequests(ID=${pr.ID},IsActiveEntity=true)/attachments(up__ID=${pr.ID},ID=${f.ID},IsActiveEntity=true)/content`
          : null
      }))

      return {
        btpPaymentRef,
        count: documents.length,
        summary: documents.map((d, i) => `${i + 1}. ${d.docTypeName} (${d.requirement}): ${d.fileName}`).join('\n'),
        documents
      }
    })

    return super.init()
  }
}