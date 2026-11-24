import cds from '@sap/cds'
import { getDocumentRequirements, describeFileRules } from './document-rules.js'
import { REJECTIONS } from './apm-status.js'
import { isVendorAccount } from './vendor-bank.js'

/**
 * Business rules for creating payment requests, shared by
 * IntegrationService (source KLD) and PaymentRequestService (source BTP, created in the Fiori app).
 */

export const SOURCE = { KLD: 'KLD', BTP: 'BTP' }

/**
 * Requests created in the Fiori app: bank details are entered by a user, so a bank letter
 * confirming the vendor's account is always mandatory (in addition to the matrix).
 */
export const BANK_LETTER = 'BANK_LETTER'

const db = () => cds.entities('com.agmc.paymentrequest')

/** Number range object of the BTP payment reference (one counter per year). */
const PAYMENT_REQUEST_RANGE = 'PAYMENT_REQUEST'

/**
 * Next BTP reference, e.g. BTP-PR-2026-000042, from the number range table (like SAP NRIV, unbuffered).
 * Must run in the transaction that saves the request (it does: called from the CREATE handlers):
 * 1. make sure the year's counter row exists (UPSERT with keys only never changes an existing row)
 * 2. lock it (SELECT … FOR UPDATE) — concurrent saves wait here until this transaction ends
 * 3. first use of the year: start after the highest reference already stored (e.g. from the time
 *    before the number range existed), then increment and write back
 * A failed save rolls the counter back as well, so numbers stay gap-free.
 */
export async function nextPaymentRef() {
  const { PaymentRequests, NumberRanges } = db()
  const year = new Date().getFullYear()
  const prefix = `BTP-PR-${year}-`
  const key = { rangeObject: PAYMENT_REQUEST_RANGE, rangeYear: year }

  await UPSERT.into(NumberRanges).entries(key)
  const range = await SELECT.one.from(NumberRanges).where(key).forUpdate()
  let last = range?.lastNumber
  if (last == null) {
    const highest = await SELECT.one.from(PaymentRequests)
      .columns`max(btpPaymentRef) as maxRef`
      .where`btpPaymentRef like ${prefix + '%'}`
    last = highest?.maxRef ? parseInt(highest.maxRef.slice(prefix.length)) : 0
  }
  const next = last + 1
  await UPDATE(NumberRanges).set({ lastNumber: next }).where(key)
  return prefix + String(next).padStart(6, '0')
}

/**
 * Document requirements of a request: the matrix (company code + payment type),
 * plus the bank letter as a mandatory document for requests created in the Fiori app.
 * Same return shape as getDocumentRequirements.
 */
export async function requirementsFor({ companyCode, paymentType_code, source }) {
  const result = await getDocumentRequirements({ companyCode, paymentType_code })
  if (source !== SOURCE.BTP || result.rules.some(r => r.docType_code === BANK_LETTER)) return result
  const { DocumentTypes } = db()
  const type = await SELECT.one.from(DocumentTypes, BANK_LETTER).columns('name', 'allowedFormats', 'maxSizeMB')
  result.rules.push({
    docType_code: BANK_LETTER,
    docTypeName:  type?.name ?? 'Vendor Bank Letter',
    fileRules:    describeFileRules(type ?? {}),
    level_code:   'MANDATORY',
    levelName:    'Mandatory',
    blocking:     true,
    conditionNote: 'Required for requests created in BTP (bank details entered manually)',
    sortOrder:    9000
  })
  return result
}

/**
 * Status of a newly saved request: 'Document Pending' when mandatory documents are
 * configured (none can be attached yet) or no rules exist, otherwise 'Ready'.
 */
export async function initialStatus(request) {
  const { configured, rules } = await requirementsFor(request)
  return !configured || rules.some(r => r.blocking) ? 'DOC_PENDING' : 'READY'
}

/** IBAN format (2 letters, 2 check digits, 11–30 alphanumerics; AE = 23 chars) and mod-97 checksum. */
export function isValidIban(value) {
  const iban = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  if (iban.startsWith('AE') && iban.length !== 23) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const c of rearranged) rest = (rest * (c >= 'A' ? 100 : 10) + parseInt(c, 36)) % 97
  return rest === 1
}

/**
 * Vendor bank details sent by CPI: all payment methods (I / H / S) are bank transfers,
 * so bank name, IBAN and SWIFT code are always required. The IBAN check digits are NOT
 * checked here: the vendor IBAN comes from the S/4 vendor master (app requests: isValidIban).
 */
export function bankDetailErrors(pr) {
  const errors = []
  if (!pr.bankName) errors.push({ message: 'bankName is required', target: 'bankName' })
  if (!pr.iban) errors.push({ message: 'iban is required', target: 'iban' })
  if (!pr.swiftCode) errors.push({ message: 'swiftCode is required', target: 'swiftCode' })
  return errors
}

/** Today's date in the UAE (YYYY-MM-DD) — AGMC's business day; the server itself runs in UTC. */
export function todayUAE() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
}

/**
 * Invoice due dates (CPI and app requests): every invoice needs one, and it must not be before today (UAE).
 * @param {Array} items invoices
 * @param {{ savedDates?: Map<string,string>, targetOf?: Function }} options
 *   savedDates: invoice ID → due date already saved. An unchanged saved date is not checked against
 *   today again, so a request edited after its due date passed (e.g. documents added after a Return)
 *   can still be saved. New invoices and changed dates are always checked.
 * @returns {Array<{ message: string, target?: string }>}
 */
export function dueDateErrors(items, { savedDates = new Map(), targetOf = () => undefined } = {}) {
  const today = todayUAE()
  const errors = []
  for (const i of items ?? []) {
    const label = `Invoice ${i.invoiceNumber ?? ''}`.trim()
    const date = i.invoiceDate ? String(i.invoiceDate).slice(0, 10) : ''
    if (!date) errors.push({ message: `${label} needs an invoice due date`, target: targetOf(i) })
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)))
      errors.push({ message: `${label}: invoice due date '${i.invoiceDate}' is not a valid date (YYYY-MM-DD)`, target: targetOf(i) })
    else if (date < today && savedDates.get(i.ID) !== date)
      errors.push({ message: `${label}: invoice due date ${date} is in the past — it must be today (${today}) or later`, target: targetOf(i) })
  }
  return errors
}

/**
 * Validates a complete payment request before it is saved.
 * @param {object} pr header incl. items (draft data on activation)
 * @param {{ source: string }} options BTP-only rules: vendor + bank from the master
 * @returns {Promise<Array<{ message: string, target?: string }>>} empty when valid
 */
export async function validateRequest(pr, { source = pr.source } = {}) {
  const { PaymentTypes, CompanyCodes, PaymentMethods, Vendors, PaymentRequestItems } = db()
  const errors = []
  const err = (message, target) => errors.push({ message, target })
  const items = pr.items ?? []

  // Mandatory fields (cost centre, GL account and payment due date are optional)
  const MANDATORY = {
    vendorCode: 'Vendor', paymentType_code: 'Payment type', companyCode: 'Company code',
    currency_code: 'Currency', paymentMethod_code: 'Payment method',
    requestorEmpId: 'Requestor employee ID'
  }
  for (const [field, label] of Object.entries(MANDATORY))
    if (pr[field] == null || pr[field] === '') err(`${label} is required`, field)

  // Code lists
  if (pr.paymentType_code && !await SELECT.one.from(PaymentTypes, pr.paymentType_code).columns('code'))
    err(`Unknown payment type '${pr.paymentType_code}'`, 'paymentType_code')
  if (pr.companyCode && !await SELECT.one.from(CompanyCodes, pr.companyCode).columns('code'))
    err(`Unknown company code '${pr.companyCode}'`, 'companyCode')
  if (pr.paymentMethod_code && !await SELECT.one.from(PaymentMethods, pr.paymentMethod_code).columns('code'))
    err(`Unknown payment method '${pr.paymentMethod_code}'`, 'paymentMethod_code')

  // Invoices: at least one, each with number, due date (app requests) + positive amount in the request currency, sum = amount
  if (!items.length) err('Add at least one invoice', 'items')
  const numbers = new Set()
  items.forEach(i => {
    const at = `items(ID=${i.ID},IsActiveEntity=false)`
    if (!i.invoiceNumber) err('Invoice number is required', `${at}/invoiceNumber`)
    else if (numbers.has(i.invoiceNumber)) err(`Invoice ${i.invoiceNumber} is listed twice`, `${at}/invoiceNumber`)
    else numbers.add(i.invoiceNumber)
    if (!(Number(i.invoiceAmount) > 0)) err(`Invoice ${i.invoiceNumber ?? ''} needs an amount greater than 0`, `${at}/invoiceAmount`)
    if (i.currency_code && pr.currency_code && i.currency_code !== pr.currency_code)
      err(`Invoice ${i.invoiceNumber ?? ''} is in ${i.currency_code}, the request in ${pr.currency_code} — all invoices must use the request currency`, `${at}/currency_code`)
  })
  // Due dates: required, not in the past (unchanged dates of already saved invoices are not re-checked)
  const saved = pr.ID && items.length
    ? await SELECT.from(PaymentRequestItems).columns('ID', 'invoiceDate').where({ parent_ID: pr.ID })
    : []
  dueDateErrors(items, {
    savedDates: new Map(saved.map(s => [s.ID, s.invoiceDate])),
    targetOf: i => `items(ID=${i.ID},IsActiveEntity=false)/invoiceDate`
  }).forEach(e => errors.push(e))
  const total = items.reduce((s, i) => s + Number(i.invoiceAmount || 0), 0)
  if (items.length && !(Number(pr.paymentAmount) > 0)) err('Payment amount must be greater than 0', 'paymentAmount')
  else if (items.length && Math.abs(total - Number(pr.paymentAmount)) > 0.005)
    err(`Payment amount ${pr.paymentAmount} does not match the invoice total ${total.toFixed(2)}`, 'paymentAmount')

  // Bank details
  if (source === SOURCE.BTP) {
    // App requests: bank account always mandatory (any payment method). Bank name, IBAN, account no
    // and SWIFT are read-only copies of the selected account, so missing ones are fixed in the master.
    if (!pr.bankAccount_ID) err('Bank is required — select the bank account under Bank Name', 'bankAccount_ID')
    else {
      const BANK_FIELDS = { bankName: 'bank name', iban: 'IBAN', bankAccountNo: 'account number', swiftCode: 'SWIFT code' }
      const missing = Object.entries(BANK_FIELDS).filter(([f]) => !pr[f]).map(([, label]) => label)
      if (missing.length)
        err(`The selected bank account has no ${missing.join(', ')} — complete it in the vendor master or select another account`, 'bankAccount_ID')
      else if (!isValidIban(pr.iban)) err(`IBAN ${pr.iban} of the selected bank account is not valid (format or check digits)`, 'bankAccount_ID')
    }
  } else bankDetailErrors(pr).forEach(e => errors.push(e))

  if (source === SOURCE.BTP) {
    // (Payment due date is no longer entered in the app, so it is not checked any more.)
    // Vendor from the vendor master
    if (pr.vendorCode && !await SELECT.one.from(Vendors, pr.vendorCode).columns('code'))
      err(`Vendor ${pr.vendorCode} is not in the vendor master`, 'vendorCode')
    // Bank account must belong to the vendor (bank value help is filtered by vendor)
    else if (pr.vendorCode && pr.bankAccount_ID && !await isVendorAccount(pr.vendorCode, pr.bankAccount_ID))
      err(`The bank account is not a bank account of vendor ${pr.vendorCode} — select it from the value help`, 'bankAccount_ID')
  }

  // Same vendor invoice already in another request (requests rejected in APM do not count — they are
  // final, the requester creates a new request for the same invoice)
  if (pr.vendorCode && numbers.size) {
    const dup = await SELECT.from(PaymentRequestItems)
      .columns(i => { i.invoiceNumber, i.parent(p => p.btpPaymentRef) })
      .where({ invoiceNumber: { in: [...numbers] }, 'parent.vendorCode': pr.vendorCode,
        'parent.ID': { '!=': pr.ID }, 'parent.status_code': { 'not in': [...REJECTIONS] } })
    for (const d of dup)
      err(`Invoice ${d.invoiceNumber} of vendor ${pr.vendorCode} is already in payment request ${d.parent?.btpPaymentRef}`, 'items')
  }

  return errors
}
