using com.agmc.paymentrequest as db from '../db/schema';

/**
 * Technical API (no UI): CPI creates requests,
 * BPA reports every workflow action back.
 */
service IntegrationService @(path: '/integration') {
  entity PaymentRequests     as projection on db.PaymentRequests excluding { attachments, approvalHistory, paymentFrom };
  entity PaymentRequestItems as projection on db.PaymentRequestItems;
  @readonly entity PaymentMethods as projection on db.PaymentMethods excluding { houseBank };   // I / H / S

  /** BPA → CAP: one call per approval decision. Returns the new status code. */
  action updateWorkflowStatus(
    btpPaymentRef : String, stepNo : Integer, stepName : String,
    approverId : String, approverName : String,
    decision : String,          // Approved | Return | Rejected
    comments : String, bpaTaskId : String, isFinalStep : Boolean
  ) returns String;

  /**
   * CPI → CAP: payment processing status from APM (ST-01 … ST-16), one call per APM message.
   * Mandatory: btpPaymentRef, status, statusAt. Returns the request's status code after the call
   * (unchanged if the message arrived late or the request is already rejected / closed).
   * Contract for CPI: docs/cpi/updatePaymentStatus.openapi.json
   */
  action updatePaymentStatus(
    btpPaymentRef     : String,     // e.g. BTP-PR-2026-000022
    status            : String,     // ST-01 … ST-16
    statusAt          : Timestamp,  // date/time of the status in APM (ISO 8601)
    level             : Integer,    // ST-03 / ST-08: current approval level n
    levels            : Integer,    // ST-03 / ST-08: number of approval levels N
    paymentDocumentNo : String,     // payment document number from APM / EBS
    bankReference     : String,     // bank reference of the transfer
    message           : String      // APM message, e.g. rejection reason
  ) returns String;

    /** One attached document, as shown to the approver in BPA. */
  type AttachedDocument {
    attachmentId : UUID;
    docType      : String(20);    // e.g. INVOICE
    docTypeName  : String(111);   // e.g. Tax Invoice
    requirement  : String(20);    // Mandatory | Conditional | Optional | Additional
    fileName     : String(255);
    mimeType     : String(100);
    uploadedBy   : String(255);
    uploadedAt   : Timestamp;
    viewUrl      : String(1000);  // opens the file through the app router (login required)
  }

  /** Result of getAttachedDocuments. */
  type DocumentList {
    btpPaymentRef : String(30);
    count         : Integer;
    summary       : String(5000); // one line per document, for simple text fields in BPA forms
    documents     : many AttachedDocument;
  }

  /** BPA → CAP: all saved documents of a payment request with their document type. Read-only. */
  action getAttachedDocuments(btpPaymentRef : String) returns DocumentList;
}