using com.agmc.paymentrequest as db from '../db/schema';

/**
 * Technical API (no UI): CPI creates requests,
 * BPA reports every workflow action back.
 */
service IntegrationService @(path: '/integration') {
  entity PaymentRequests     as projection on db.PaymentRequests excluding { attachments, approvalHistory };
  entity PaymentRequestItems as projection on db.PaymentRequestItems;

  /** BPA → CAP: one call per approval decision. Returns the new status code. */
  action updateWorkflowStatus(
    btpPaymentRef : String, stepNo : Integer, stepName : String,
    approverId : String, approverName : String,
    decision : String,          // Approved | Return | Rejected
    comments : String, bpaTaskId : String, isFinalStep : Boolean
  ) returns String;

  /** CPI → CAP: payment progress after approval. Returns the new status code. */
  action updatePaymentStatus(
    btpPaymentRef  : String,
    status         : String,    // SENT_TO_BANK | SETTLED
    bankPaymentRef : String,    // payment reference from the bank / payment run
    statusDate     : Date       // date sent (SENT_TO_BANK) or value date (SETTLED)
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