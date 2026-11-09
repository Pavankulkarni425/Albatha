using com.agmc.paymentrequest as db from '../db/schema';

/**
 * Configuration API for business administrators:
 * maintain the document requirement matrix (company code + payment type → documents).
 * Restrict to an admin role when roles are introduced.
 */
service AdminService @(path: '/admin') {
  @odata.draft.enabled
  entity DocumentRequirements as projection on db.DocumentRequirements;

  @readonly entity CompanyCodes      as projection on db.CompanyCodes;
  @readonly entity PaymentTypes      as projection on db.PaymentTypes;
  @readonly entity DocumentTypes     as projection on db.DocumentTypes;
  @readonly entity RequirementLevels as projection on db.RequirementLevels;
}