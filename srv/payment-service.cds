using com.agmc.paymentrequest as db from '../db/schema';

/**
 * Business API for the Fiori app:
 * view requests, upload attachments (draft), start the workflow,
 * and create new requests in the app (source BTP, role PaymentRequester).
 * Requests from KLD (source KLD, via CPI): header and invoices stay read-only, only documents change.
 */
service PaymentRequestService {
  @odata.draft.enabled
  // Create and Delete buttons hidden in the app (2026-11-23); the server rules for create/delete stay in place.
  // A static DeleteHidden is needed so the list table can use selection mode None (manifest).
  // Before: @UI.DeleteHidden: { $edmJson: { $Not: { $Path: 'deletable' } } }
  @UI.CreateHidden: true
  @UI.DeleteHidden: true
  @restrict: [
    // everyone logged in: view, edit documents, start the workflow
    { grant: ['READ', 'UPDATE', 'startWorkflow', 'startWorkflowCheck'], to: 'authenticated-user' },
    // creating and deleting requests in the app
    // TEMPORARY (2026-11-12): open to every logged-in user because no BTP admin is available to assign
    // the role collection AGMC_PaymentRequest_Requester. REVERT to `to: 'PaymentRequester'` once assigned.
    { grant: ['CREATE', 'DELETE'], to: 'authenticated-user' }
  ]
  entity PaymentRequests as projection on db.PaymentRequests{
    *,
    checklist : Association to many DocumentChecklist on checklist.request_ID = $self.ID,
    // red when the due date has passed and the payment has not gone to the bank yet
    case
      when paymentDueDate < cast($now as Date)
       // not once the payment has gone to the bank, was rejected in APM or is finished
       and status.code not in ('ST-04', 'ST-09', 'ST-11', 'ST-12', 'ST-13', 'ST-14', 'ST-15', 'ST-16') then 1
      else 0
    end as dueCriticality : Integer,
    // App requests are editable, KLD requests read-only (Common.FieldControl: 7 mandatory, 3 optional, 1 read-only).
    // Drafts store these values; new drafts get them in the NEW handler (payment-service.js).
    case when source = 'BTP' then true else false end as isBTP : Boolean,
    case when source = 'BTP' then 7 else 1 end as fcMandatory : Integer,
    case when source = 'BTP' then 3 else 1 end as fcOptional : Integer,
    case
      when source = 'BTP' and status.code in ('DRAFT', 'READY', 'DOC_PENDING') and bpaWorkflowInstanceId is null then true
      else false
    end as deletable : Boolean,
    // APM phase (after the handover to APM): shows the "Payment Processing" section
    case when status.code = 'SENT_TO_APM' or status.code like 'ST-%' then true else false end as isPaymentPhase : Boolean,
    // APM approval level of ST-03 / ST-08, e.g. "2 of 3"
    case
      when apmLevel is not null and apmLevels is not null
        then cast(apmLevel as String) || ' of ' || cast(apmLevels as String)
      when apmLevel is not null then cast(apmLevel as String)
    end as apmLevelText : String(20)
  } actions {
    /** Runs all Start Workflow checks without changing anything (the app opens the comment pop-up only if ok). */
    function startWorkflowCheck() returns { ok : Boolean; messages : array of String };
    /** Starts the approval workflow; `note` = optional comment of the requestor for the approvers. */
    action startWorkflow(note : String(1000) @UI.MultiLineText) returns PaymentRequests;
  };
  // Invoices: changed only inside the draft of an app request (guarded in payment-service.js)
  entity PaymentRequestItems as projection on db.PaymentRequestItems;
  @readonly entity ApprovalHistory     as projection on db.ApprovalHistory;
  @readonly entity PaymentMethods      as projection on db.PaymentMethods excluding { houseBank };
  @readonly entity PaymentStatuses     as projection on db.PaymentStatuses;
  @readonly entity PaymentTypes        as projection on db.PaymentTypes;
  @readonly entity CompanyCodes        as projection on db.CompanyCodes;
  @readonly entity DocumentTypes       as projection on db.DocumentTypes;
  // Value helps: vendor, then the vendor's bank accounts (fills bank name, IBAN, account no, SWIFT)
  @readonly entity Vendors             as projection on db.Vendors;
  @readonly entity VendorBankAccounts  as projection on db.VendorBankAccounts;
  // Distinct sources of the stored requests — only for the filter dropdown.
  // redirection.target false: associations to PaymentRequests (items.parent etc.) keep pointing to PaymentRequests
  @readonly @cds.redirection.target: false
  entity Sources as select from db.PaymentRequests distinct {
    key source as code
  };
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
 * System fields: never changed by the user (CAP ignores any attempt to change them).
 * Request fields are editable for app requests (source BTP) and read-only for KLD requests,
 * via Common.FieldControl in app/payment_request_list/annotations.cds and the PATCH guard in payment-service.js.
 */
annotate PaymentRequestService.PaymentRequests with {
  requestId @readonly;  btpPaymentRef @readonly;  source @readonly;
  status @readonly;     requestCreatedAt @readonly;
  vendorName @readonly;       // from the vendor master
  // Required fields of app requests are checked together on Save (validateRequest in srv/lib/payment-request-rules.js),
  // so all missing fields are reported at once — CAP's own @mandatory check would stop at the first one.
  // The integration API (CPI) keeps @mandatory from db/schema.cds.
  vendorCode @mandatory: false;  companyCode @mandatory: false;
  bankName @readonly; iban @readonly; bankAccountNo @readonly; swiftCode @readonly;  // copied from the selected bank account (bankAccount_ID)
  // LEGACY paymentFrom: kept only for the draft table (Postgres cannot drop columns) — hidden from the API
  paymentFrom @cds.api.ignore @readonly;
  paymentAmount @readonly;    // sum of the invoices
  bpaWorkflowInstanceId @readonly; workflowMessage @readonly;
  currentApprover @readonly; approvalLevel @readonly;
  bankPaymentRef @readonly; sentToBankAt @readonly; settledOn @readonly;   // from APM via CPI
  paymentDocumentNo @readonly; apmLevel @readonly; apmLevels @readonly;
  isPaymentPhase @readonly; apmLevelText @readonly;
  isBTP @readonly; fcMandatory @readonly; fcOptional @readonly; deletable @readonly;
};
annotate PaymentRequestService.PaymentRequestItems with {
  currency @readonly;                // always the request currency (set by the server)
  invoiceNumber @mandatory: false;   // checked on Save together with the other fields (validateRequest)
};
