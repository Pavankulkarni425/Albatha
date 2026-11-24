using com.agmc.paymentrequest as db from '../db/schema';

/**
 * Configuration API for business administrators:
 * maintain the document requirement matrix (company code + payment type → documents).
 * Restrict to an admin role when roles are introduced.
 */
service AdminService @(path: '/admin') {
  @odata.draft.enabled
  entity DocumentRequirements as projection on db.DocumentRequirements;

  // Vendor master with bank accounts (edit the vendor, accounts are maintained as its items)
  @odata.draft.enabled
  entity Vendors as projection on db.Vendors;

  // S/4 payment methods I / H / S (the AGMC bank account is determined in S/4)
  entity PaymentMethods as projection on db.PaymentMethods excluding { houseBank };

  @readonly entity CompanyCodes      as projection on db.CompanyCodes;
  @readonly entity PaymentTypes      as projection on db.PaymentTypes;
  @readonly entity DocumentTypes     as projection on db.DocumentTypes;
  @readonly entity RequirementLevels as projection on db.RequirementLevels;
}