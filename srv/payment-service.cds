using com.agmc.paymentrequest as db from '../db/schema';

/**
 * Business API for the Fiori app:
 * view requests, upload attachments (draft), start the workflow.
 * Payment request data comes from CPI and cannot be created/deleted/changed here.
 */
service PaymentRequestService {
  @odata.draft.enabled
  @Capabilities.InsertRestrictions.Insertable: false
  @Capabilities.DeleteRestrictions.Deletable: false  
  entity PaymentRequests as projection on db.PaymentRequests{
    *,
    checklist : Association to many DocumentChecklist on checklist.request_ID = $self.ID,
    // red when the due date has passed and the payment has not gone to the bank yet
    case
      when paymentDueDate < cast($now as Date)
       and status.code not in ('SENT_TO_BANK', 'SETTLED', 'REJECTED') then 1
      else 0
    end as dueCriticality : Integer
  } actions {
    action startWorkflow() returns PaymentRequests;
  };
  @readonly entity PaymentRequestItems as projection on db.PaymentRequestItems;
  @readonly entity ApprovalHistory     as projection on db.ApprovalHistory;
  @readonly entity PaymentMethods      as projection on db.PaymentMethods;
  @readonly entity PaymentStatuses     as projection on db.PaymentStatuses;
  @readonly entity PaymentTypes        as projection on db.PaymentTypes;
  @readonly entity CompanyCodes        as projection on db.CompanyCodes;
  @readonly entity DocumentTypes       as projection on db.DocumentTypes;
  /**
   * Document checklist per payment request, from the requirement matrix
   * (company code + payment type). Computed at runtime — not stored.
   * In edit mode it reflects the draft.
   */
  @readonly @cds.persistence.skip
  entity DocumentChecklist {
    key request_ID    : UUID;
    key docType_code  : String(20);
        docTypeName   : String(111);
        fileRules     : String(60);    // accepted formats + max size, e.g. 'PDF, JPG, PNG · max 10 MB'
        level         : String(20);    // Mandatory | Conditional | Optional
        conditionNote : String(255);   // when a conditional document applies
        status        : String(20);    // Uploaded | Pending | If applicable | Optional
        criticality   : Integer;       // 3 green, 2 orange, 0 neutral (for the UI)
        fileName      : String(1000);  // all files of this type, comma-separated, in upload order
        sortOrder     : Integer;
  }
}

/**
 * In edit mode users may ONLY change attachments.
 * All request and workflow fields are read-only (CAP ignores any attempt to change them).
 */
annotate PaymentRequestService.PaymentRequests with {
  requestId @readonly;  vendorCode @readonly;  vendorName @readonly;
  paymentAmount @readonly; currency @readonly;    paymentDueDate @readonly;
  companyCode @readonly;   costCentre @readonly;  glAccount @readonly;
  paymentMethod @readonly; bankName @readonly;    iban @readonly;
  bankAccountNo @readonly; swiftCode @readonly;   requestorName @readonly;
  requestorEmpId @readonly; requestCreatedAt @readonly; btpPaymentRef @readonly;
  status @readonly; bpaWorkflowInstanceId @readonly; workflowMessage @readonly;
  currentApprover @readonly; approvalLevel @readonly;
  bankPaymentRef @readonly; sentToBankAt @readonly; settledOn @readonly;
  paymentType @readonly;
};