import cds from '@sap/cds'
import { getDocumentRequirements } from './lib/document-rules.js'
const LOG = cds.log('integration')

// Status codes (see db/data/...-PaymentStatuses.csv)
const STATUS = {
  NEW: 'NEW', DOC_PENDING: 'DOC_PENDING', IN_APPROVAL: 'IN_APPROVAL', RETURN: 'RETURN',
  APPROVED: 'APPROVED', SENT_TO_BANK: 'SENT_TO_BANK', SETTLED: 'SETTLED', REJECTED: 'REJECTED'
}

// Path of the Fiori app's OData service (PaymentRequestService) — used for the document links
const PAYMENT_SRV_PATH = '/odata/v4/payment-request'

// Allowed bank-side transitions: new status ← required current status
const PAYMENT_TRANSITIONS = {
  [STATUS.SENT_TO_BANK]: STATUS.APPROVED,
  [STATUS.SETTLED]:      STATUS.SENT_TO_BANK
}

export default class IntegrationService extends cds.ApplicationService {
  init() {
    const { PaymentRequests } = this.entities
    const { ApprovalHistory, PaymentTypes, CompanyCodes } = cds.entities('com.agmc.paymentrequest')
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

      // Same request sent twice (e.g. a CPI retry): ...
      // Same request sent twice (e.g. a CPI retry): answer with a clear 409, not a database error.
      // The message includes the existing BTP reference so CPI can link it.
      const existing = await SELECT.one.from(PaymentRequests).columns('btpPaymentRef')
        .where({ requestId: req.data.requestId })
      if (existing)
        return req.reject(409, `Request ${req.data.requestId} already exists as ${existing.btpPaymentRef}`)
      const prefix = `BTP-PR-${new Date().getFullYear()}-`
      const last = await SELECT.one.from(PaymentRequests)
        .columns`max(btpPaymentRef) as maxRef`
        .where`btpPaymentRef like ${prefix + '%'}`
      const next = last?.maxRef ? parseInt(last.maxRef.slice(prefix.length)) + 1 : 1
      req.data.btpPaymentRef = prefix + String(next).padStart(6, '0')

      // Status is always set by CAP, whatever the caller sends
      const { configured, rules } = await getDocumentRequirements({ companyCode, paymentType_code })
      const needsDocuments = !configured || rules.some(r => r.blocking)
      req.data.status_code = needsDocuments ? STATUS.DOC_PENDING : STATUS.NEW
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

      // Status rules — 'Sent Back' is still accepted from older BPA versions
      let status_code
      switch (d.decision) {
        case 'Approved':  status_code = d.isFinalStep ? STATUS.APPROVED : STATUS.IN_APPROVAL; break
        case 'Return':
        case 'Sent Back': status_code = STATUS.RETURN; break     // requester fixes documents and restarts
        case 'Rejected':  status_code = STATUS.REJECTED; break
        default: return req.error(400, `Unknown decision '${d.decision}'. Use Approved, Return or Rejected`)
      }

      await INSERT.into(ApprovalHistory).entries({
        parent_ID: pr.ID, stepNo: d.stepNo, stepName: d.stepName,
        approverId: d.approverId, approverName: d.approverName,
        decision: d.decision === 'Sent Back' ? 'Return' : d.decision, comments: d.comments, bpaTaskId: d.bpaTaskId,
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
     * CPI → CAP: payment progress reported by the payment system.
     * Approved → Sent to Bank → Settled, nothing else.
     */
    this.on('updatePaymentStatus', async req => {
      const d = req.data
      const required = PAYMENT_TRANSITIONS[d.status]
      if (!required)
        return req.error(400, `Status '${d.status}' cannot be set here. Use SENT_TO_BANK or SETTLED`)

      const pr = await SELECT.one.from(PaymentRequests).columns('ID', 'status_code')
        .where({ btpPaymentRef: d.btpPaymentRef })
      if (!pr) return req.error(404, `Payment request ${d.btpPaymentRef} not found`)
      if (pr.status_code !== required)
        return req.error(409, `${d.status} is only possible from ${required} (current status ${pr.status_code})`)

      const changes = { status_code: d.status }
      if (d.bankPaymentRef) changes.bankPaymentRef = d.bankPaymentRef
      if (d.status === STATUS.SENT_TO_BANK)
        changes.sentToBankAt = d.statusDate ? new Date(d.statusDate).toISOString() : new Date().toISOString()
      if (d.status === STATUS.SETTLED)
        changes.settledOn = d.statusDate ?? new Date().toISOString().slice(0, 10)

      await UPDATE(PaymentRequests, pr.ID).with(changes)
      LOG.info(`${d.btpPaymentRef}: ${pr.status_code} → ${d.status}`)
      return d.status
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
        .columns('ID', 'companyCode', 'paymentType_code').where({ btpPaymentRef })
      if (!pr) return req.reject(404, `Payment request ${btpPaymentRef} not found`)

      const Attachments = cds.entities('com.agmc.paymentrequest')['PaymentRequests.attachments']
      const [files, { rules }] = await Promise.all([
        SELECT.from(Attachments)
          .columns(a => { a.ID, a.filename, a.mimeType, a.createdAt, a.createdBy, a.docType_code, a.docType(d => d.name) })
          .where({ up__ID: pr.ID }),
        getDocumentRequirements(pr)
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