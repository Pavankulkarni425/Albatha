import cds from '@sap/cds'

/**
 * Fills vendor and bank details of a payment request from the vendor master
 * (db.Vendors / db.VendorBankAccounts).
 *
 * The request keeps its own copy of bankName, iban, bankAccountNo and swiftCode
 * (snapshot for the CPI payload and history); this module only decides what to copy.
 *
 * Bank depends on the vendor: the bank value help lists only the selected vendor's accounts,
 * and changing the vendor keeps the bank account only if it belongs to the new vendor
 * (otherwise the vendor's default account is taken, or the bank fields are cleared).
 */

const BANK_FIELDS = ['bankName', 'iban', 'bankAccountNo', 'swiftCode']
const db = () => cds.entities('com.agmc.paymentrequest')

/** Bank accounts of a vendor, default account first. */
export async function accountsOf(vendorCode) {
  if (!vendorCode) return []
  const { VendorBankAccounts } = db()
  return SELECT.from(VendorBankAccounts)
    .columns(...BANK_FIELDS, 'isDefault')
    .where({ vendor_code: vendorCode })
    .orderBy('isDefault desc', 'bankName')
}

/**
 * Vendor selected/changed: vendor name (unknown vendor → empty name) and the bank account:
 * the current account stays if it belongs to the new vendor, else the vendor's default account
 * (only one account → that one), else the bank fields are cleared.
 * @param {string|null} vendorCode new vendor
 * @param {string|null} [currentBankAccountID] bank account currently in the draft
 * @returns {Promise<object>} fields to merge into the draft
 */
export async function onVendorChange(vendorCode, currentBankAccountID) {
  const { Vendors, VendorBankAccounts } = db()
  const vendor = vendorCode && await SELECT.one.from(Vendors, vendorCode).columns('name')
  const result = { vendorName: vendor?.name ?? null }
  if (!vendor) return { ...result, ...await onBankChange({ bankAccount_ID: null }) }

  const current = currentBankAccountID &&
    await SELECT.one.from(VendorBankAccounts, currentBankAccountID).columns('vendor_code')
  if (current?.vendor_code === vendorCode) return result   // still a valid account of this vendor

  const accounts = await SELECT.from(VendorBankAccounts).columns('ID', 'isDefault').where({ vendor_code: vendorCode })
  const pick = accounts.find(a => a.isDefault) ?? (accounts.length === 1 ? accounts[0] : null)
  return { ...result, bankAccount_ID: pick?.ID ?? null, ...await onBankChange({ bankAccount_ID: pick?.ID ?? null }) }
}

/**
 * Bank account selected in the draft (value help on Bank Name = bankAccount_ID).
 * Bank name, IBAN, account no and SWIFT are read-only for the user and always copied
 * from that account; no account (cleared or unknown) → all bank fields are cleared.
 * @param {{ bankAccount_ID?: string|null }} change fields of the PATCH
 * @returns {Promise<object>} fields to merge into the draft
 */
export async function onBankChange({ bankAccount_ID }) {
  const { VendorBankAccounts } = db()
  const account = bankAccount_ID &&
    await SELECT.one.from(VendorBankAccounts, bankAccount_ID).columns(...BANK_FIELDS)
  if (!account) return { bankAccount_ID: null, bankName: null, iban: null, bankAccountNo: null, swiftCode: null }
  return { ...account }
}

/**
 * For the Save validation of BTP-created requests:
 * true if the selected bank account belongs to the selected vendor.
 */
export async function isVendorAccount(vendorCode, bankAccountID) {
  const { VendorBankAccounts } = db()
  const account = await SELECT.one.from(VendorBankAccounts, bankAccountID).columns('vendor_code')
  return account?.vendor_code === vendorCode
}
