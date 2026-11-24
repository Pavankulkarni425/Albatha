import cds from '@sap/cds'

/**
 * Payment processing in APM after the BPA approval.
 *
 * Flow:  APPROVED → SENT_TO_APM (outbox handed the request to CPI) → ST-01 … ST-16 (reported by CPI)
 * The APM statuses are normal rows of the PaymentStatuses code list (db/data/...-PaymentStatuses.csv);
 * their `sequence` defines the order. Every message is also written to ApprovalHistory (source APM).
 *
 * Rules (applyApmStatus):
 * - only ST-01 … ST-16, and only once the request is APPROVED or later
 * - forward only (by sequence); a message that arrives late is kept in the history but does not
 *   move the status back
 * - rejections (ST-04, ST-09, ST-14) apply at any point of the APM phase
 * - final statuses (rejections, ST-16 Closed): nothing changes any more, messages are only logged
 * - the same message twice (CPI retry) is recognised and not stored again
 * - ST-03 / ST-08 carry the approval level n of N
 */

export const SENT_TO_APM = 'SENT_TO_APM'
export const REJECTIONS = new Set(['ST-04', 'ST-09', 'ST-14'])
export const CLOSED = 'ST-16'
export const FINAL = new Set([...REJECTIONS, CLOSED])
export const LEVELLED = new Set(['ST-03', 'ST-08'])   // statuses with approval level n of N
export const SENT_TO_BANK = 'ST-11'
export const SETTLED = 'ST-15'
/** Statuses from which APM messages are accepted (besides the ST codes themselves). */
const APM_ENTRY = new Set(['APPROVED', SENT_TO_APM])

export const isApmCode = code => /^ST-\d{2}$/.test(code ?? '')
export const isApmPhase = code => APM_ENTRY.has(code) || isApmCode(code)

const db = () => cds.entities('com.agmc.paymentrequest')
const cut = (s, n) => (s == null ? null : String(s).slice(0, n))

/**
 * Status name for display, with the approval level filled in:
 * "In tier 1 approval (level n of N)" + 2/3 → "In tier 1 approval (level 2 of 3)".
 * Without a level the placeholder is removed; a levelled status without placeholder gets it appended.
 */
export function statusText(name, level, levels) {
  const base = String(name ?? '').replace(/\s*\(level n of N\)/i, '')
  if (!level) return base
  return `${base} (level ${level}${levels ? ` of ${levels}` : ''})`
}

/**
 * Applies one APM status message to a payment request.
 * @param {object} msg { btpPaymentRef, status, statusAt, level, levels, paymentDocumentNo, bankReference, message }
 * @returns {Promise<{ error?: { status: number, message: string }, status?: string, applied?: boolean, duplicate?: boolean }>}
 */
export async function applyApmStatus(msg) {
  const { PaymentRequests, PaymentStatuses, ApprovalHistory } = db()
  const { btpPaymentRef, status } = msg

  // --- validate the message ---
  if (!btpPaymentRef) return { error: { status: 400, message: 'btpPaymentRef is required' } }
  if (!isApmCode(status)) return { error: { status: 400, message: `Status '${status ?? ''}' is not an APM status. Use ST-01 … ST-16` } }
  const statusAt = new Date(msg.statusAt)
  if (!msg.statusAt || isNaN(statusAt)) return { error: { status: 400, message: 'statusAt is required (date/time of the status in APM, ISO 8601)' } }
  for (const f of ['level', 'levels'])
    if (msg[f] != null && !(Number.isInteger(msg[f]) && msg[f] > 0))
      return { error: { status: 400, message: `${f} must be a positive whole number` } }

  const next = await SELECT.one.from(PaymentStatuses, status).columns('code', 'name', 'sequence')
  if (!next) return { error: { status: 400, message: `Unknown status '${status}'` } }

  const pr = await SELECT.one.from(PaymentRequests)
    .columns('ID', 'status_code', 'paymentDocumentNo', 'bankPaymentRef', 'sentToBankAt', 'settledOn')
    .where({ btpPaymentRef })
  if (!pr) return { error: { status: 404, message: `Payment request ${btpPaymentRef} not found` } }
  if (!isApmPhase(pr.status_code))
    return { error: { status: 409, message: `Payment request ${btpPaymentRef} is not approved yet (status ${pr.status_code})` } }

  const at = statusAt.toISOString()
  const level = LEVELLED.has(status) ? msg.level ?? null : null
  const levels = LEVELLED.has(status) ? msg.levels ?? null : null

  // --- same message again (CPI retry): answer OK, store nothing ---
  const same = await SELECT.from(ApprovalHistory).columns('stepNo', 'decisionAt')
    .where({ parent_ID: pr.ID, source: 'APM', decision: status })
  if (same.some(h => new Date(h.decisionAt).toISOString() === at && (h.stepNo ?? null) === level))
    return { status: pr.status_code, applied: false, duplicate: true }

  // --- does the message change the current status? ---
  const current = await SELECT.one.from(PaymentStatuses, pr.status_code).columns('code', 'sequence')
  let applied
  if (FINAL.has(pr.status_code)) applied = false                       // rejected / closed: final
  else if (REJECTIONS.has(status)) applied = true                       // rejection: any time
  else if (status === pr.status_code) applied = LEVELLED.has(status)    // next approval level
  else applied = next.sequence > (current?.sequence ?? 0)               // forward only

  // --- field changes ---
  const changes = {}
  if (applied) {
    changes.status_code = status
    changes.apmLevel = level
    changes.apmLevels = levels
  }
  // references and dates are kept even from late messages (they are facts, not a status change)
  if (msg.paymentDocumentNo) changes.paymentDocumentNo = cut(msg.paymentDocumentNo, 35)
  if (msg.bankReference) changes.bankPaymentRef = cut(msg.bankReference, 35)
  if (status === SENT_TO_BANK && !pr.sentToBankAt) changes.sentToBankAt = at
  if (status === SETTLED && !pr.settledOn) changes.settledOn = at.slice(0, 10)
  if (Object.keys(changes).length) await UPDATE(PaymentRequests, pr.ID).with(changes)

  // --- history row (always, also when the status does not change) ---
  const reference = [msg.paymentDocumentNo && `Payment doc ${msg.paymentDocumentNo}`,
    msg.bankReference && `Bank ref ${msg.bankReference}`].filter(Boolean).join(' / ')
  await INSERT.into(ApprovalHistory).entries({
    parent_ID: pr.ID, source: 'APM', stepNo: level,
    stepName: cut(statusText(next.name, level, levels), 60),
    approverName: 'APM', decision: status,
    comments: cut([msg.message, !applied && `Not applied: status stays ${pr.status_code}`]
      .filter(Boolean).join(' — '), 1000) || null,
    reference: cut(reference, 80) || null,
    decisionAt: at
  })

  return { status: applied ? status : pr.status_code, applied }
}

/** History row + status when the approved request was handed over to APM (via CPI). */
export async function markSentToApm(ID, reference) {
  const { PaymentRequests, ApprovalHistory } = db()
  await UPDATE(PaymentRequests, ID).with({ status_code: SENT_TO_APM })
  await INSERT.into(ApprovalHistory).entries({
    parent_ID: ID, source: 'APM', stepName: 'Approved & Sent to APM', approverName: 'CPI',
    decision: SENT_TO_APM, reference: cut(reference, 80) || null, decisionAt: new Date().toISOString()
  })
}
