namespace com.agmc.paymentrequest;

using {
    cuid,
    managed,
    Currency,
    sap.common.CodeList
} from '@sap/cds/common';
//using { Attachments } from '@cap-js/attachments';
using { Attachments } from '@cap-js/sdm';

entity PaymentRequests : cuid, managed {
    // --- Request data ---
    requestId             : String(30)     @mandatory; // Payment Request ID
    vendorCode            : String(20)     @mandatory;
    vendorName            : String(120);
    paymentAmount         : Decimal(15, 2) @mandatory;
    currency              : Currency; // currency_code e.g. AED, USD
    paymentDueDate        : Date; // not entered in the app any more (2026-11-18) — kept for CPI; drop later if unused
    companyCode           : String(4)      @mandatory; // AGMC entity
    costCentre            : String(10);
    glAccount             : String(10);
    paymentMethod         : Association to PaymentMethods; // I, H, S (AGMC house bank in S/4)
    bankName              : String(80);
    iban                  : String(34);
    bankAccountNo         : String(35);
    swiftCode             : String(11);
    requestorName         : String(80);
    requestorEmpId        : String(20);
    requestCreatedAt      : Timestamp; // Request creation timestamp

    // --- BTP generated ---
    btpPaymentRef         : String(25)     @readonly; // e.g. BTP-PR-2026-000001
    source                : String(3) default 'KLD'; // KLD = created via the integration API (CPI), BTP = created in the Fiori app (set by the service)
    status                : Association to PaymentStatuses; // status_code, e.g. DOC_PENDING (set by the service)

    // --- Payment processing in APM (reported back via CPI, status ST-01 … ST-16) ---
    paymentDocumentNo     : String(35);  // payment document number from APM / EBS (e.g. at ST-01)
    bankPaymentRef        : String(35);  // bank reference of the transfer (e.g. at ST-11 / ST-13)
    sentToBankAt          : Timestamp;   // when the payment was sent to the bank (ST-11)
    settledOn             : Date;        // date the payment was cleared (ST-15)
    apmLevel              : Integer;     // current APM approval level n (ST-03 / ST-08), else empty
    apmLevels             : Integer;     // number of APM approval levels N (ST-03 / ST-08), else empty

    // --- Workflow (BPA) ---
    bpaWorkflowInstanceId : String(50);
    workflowMessage       : String(500); // last error from BPA, if any
    currentApprover       : String(120);
    approvalLevel         : Integer default 0; // last completed approval level

    // --- Children ---
    items                 : Composition of many PaymentRequestItems
                                on items.parent = $self;
    approvalHistory       : Composition of many ApprovalHistory
                                on approvalHistory.parent = $self;
    attachments           : Composition of many Attachments; // from @cap-js/attachments
}

entity PaymentRequestItems : cuid {
    parent        : Association to PaymentRequests;
    invoiceNumber : String(30) @mandatory;
    invoiceDate   : Date;
    invoiceAmount : Decimal(15, 2);
    currency      : Currency;
}

/**
 * S/4 payment methods (I = Dubai Islamic Bank, H = HSBC, S = Standard Chartered).
 * The method identifies the AGMC bank the payment is made from; the account itself is
 * determined in S/4 (house bank) — it is not maintained in BTP.
 */
entity PaymentMethods : CodeList {
    key code      : String(5);
        // LEGACY (unused since 2026-11-18): kept only because Postgres schema evolution cannot drop
        // elements. Not exposed in any service — do not use. Remove with a schema reset.
        houseBank : Association to HouseBanks;
}

/** LEGACY (unused since 2026-11-18, no data, not exposed) — see PaymentMethods.houseBank. */
@cds.autoexpose: false @cds.api.ignore
entity HouseBanks : CodeList {
    key code          : String(10);
        iban          : String(34);
        bankAccountNo : String(35);
        swiftCode     : String(11);
}


/**
 * Lifecycle statuses of a payment request (fixed by the application, loaded from CSV).
 * `editable` drives the document lock: Edit, uploads and Start Workflow are only
 * allowed in statuses where it is true.
 */
entity PaymentStatuses : CodeList {
    key code        : String(20); // DRAFT, READY, DOC_PENDING, IN_APPROVAL, RETURN, APPROVED, ...
        criticality : Integer;    // 0 neutral, 1 red, 2 orange, 3 green
        editable    : Boolean;    // documents may be changed / workflow may (re)start
        sequence    : Integer;    // order in filters and the step bar
}

/**
 * History of a payment request, one row per event:
 * - source BPA: approval decisions (Approved / Return) reported by the BPA workflow
 * - source APM: handover to APM (SENT_TO_APM) and every APM status message (ST-01 … ST-16) from CPI
 */
entity ApprovalHistory : cuid {
    parent                : Association to PaymentRequests;
    source                : String(3) default 'BPA'; // BPA | APM | REQ (requestor started the workflow, note in comments)
    stepNo                : Integer; // BPA: approval level 1, 2, 3 …; APM: approval level n (ST-03 / ST-08)
    stepName              : String(60); // BPA: e.g. "Finance Manager Approval"; APM: status name, e.g. "In tier 1 approval (level 2 of 3)"
    approverId            : String(60); // BPA: user ID / email
    approverName          : String(120); // BPA: approver; APM: "APM"
    decision              : String(20); // BPA: Approved / Return; APM: status code, e.g. ST-03
    comments              : String(1000); // BPA: approver comment; APM: message / rejection reason
    reference             : String(80); // APM: payment document number and/or bank reference sent with the message
    decisionAt            : Timestamp; // BPA: time of the decision; APM: time of the status in APM
    bpaTaskId             : String(50);
    bpaWorkflowInstanceId : String(50);
}

/**
 * Document categories for attachments, with the accepted formats and max size per type.
 * Which types are required is defined in DocumentRequirements (per company code + payment type).
 */
entity DocumentTypes : CodeList {
    key code           : String(20); // INVOICE, PO, GRN, OTHER ...
        allowedFormats : String(50);  // comma-separated file extensions, e.g. 'pdf,jpg,png' (empty = all upload types)
        maxSizeMB      : Integer;     // maximum size of one file of this type (empty = largest limit of all types; at most 50)
}

/**
 * Add a document type to every attachment (file, mimeType, filename, note,
 * createdAt/By etc. already come from the @cap-js/attachments aspect).
 */
extend Attachments with {
    docType : Association to DocumentTypes;
    fileSize : Integer; // bytes, set by the service on upload (used for the 50 MB package limit)
}

annotate PaymentRequests with @assert.unique: {requestId: [requestId]};

/**
 * DMS calls for attachments use the SDM technical user (client credentials),
 * so business users do not need the SDM_User role.
 */
 
// Attachment settings:
// - DMS calls use the SDM technical user (client credentials) -> users need no SDM_User role
// - only PDF, JPG, PNG, XLSX content types are accepted
// - maximum size per document: 50 MB here = technical ceiling (same as the package limit).
//   The real limits come from the code list (DocumentTypes.allowedFormats / maxSizeMB) and are
//   checked in payment-service.js, so raising a type's maxSizeMB needs no change here (up to 50 MB).
annotate PaymentRequests.attachments with @SDM.useClientCredential: true {
    content @Core.AcceptableMediaTypes: [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
    @Validation.Maximum: '50MB';
};


// =====================================================================
//  Document requirements per company code + payment type
// =====================================================================

/** Company codes (entities). For now only AGMC. */
entity CompanyCodes : CodeList {
    key code : String(4);   // 1000 (= AGMC)
}

/** Payment types. */
entity PaymentTypes : CodeList {
    key code : String(20);  // VENDOR_PAYMENT, VENDOR_ADVANCE
}

/** How strictly a document is required. */
entity RequirementLevels : CodeList {
    key code        : String(12);  // MANDATORY, CONDITIONAL, OPTIONAL
        blocking    : Boolean;     // true = Start Workflow is blocked while missing
        criticality : Integer;     // colour in the checklist
}

/**
 * Configuration matrix: which document is needed for which company code + payment type.
 * One row per combination. Maintained by business admins (not shipped as deploy CSV).
 */
entity DocumentRequirements : cuid, managed {
    company       : Association to CompanyCodes      @mandatory;
    paymentType   : Association to PaymentTypes      @mandatory;
    docType       : Association to DocumentTypes     @mandatory;
    level         : Association to RequirementLevels @mandatory;
    conditionNote : String(255);   // when a CONDITIONAL document applies, e.g. "New vendor or bank change"
    sortOrder     : Integer;       // order in the checklist
}

annotate DocumentRequirements with @assert.unique: { rule: [ company, paymentType, docType ] };

// --- Links from the payment request (new fields only, no type change of existing columns) ---
extend PaymentRequests with {
    paymentType : Association to PaymentTypes;                               // new column paymentType_code
    company     : Association to CompanyCodes on company.code = companyCode; // no new column: reuses companyCode
}

// =====================================================================
//  Vendor master + vendor bank accounts (value help for new payment requests)
// =====================================================================

/**
 * Vendors that can be paid. Local master data for now (seeded from db/data, maintained via /admin);
 * can later be replaced by an S/4 business partner value help with the same UI.
 */
entity Vendors : managed {
    key code         : String(20);   // same as PaymentRequests.vendorCode, e.g. V1001
        name         : String(120);
        bankAccounts : Composition of many VendorBankAccounts on bankAccounts.vendor = $self;
}

/**
 * Bank accounts of a vendor. Selecting one in a payment request copies bankName, iban,
 * bankAccountNo and swiftCode into the request (a snapshot: later master changes do not
 * change existing requests).
 */
entity VendorBankAccounts : cuid, managed {
    vendor        : Association to Vendors @mandatory;
    bankName      : String(80)             @mandatory;
    iban          : String(34);
    bankAccountNo : String(35);
    swiftCode     : String(11);
    currency      : Currency;               // account currency (informational in the value help)
    isDefault     : Boolean default false;  // filled automatically when the vendor is selected
}

annotate VendorBankAccounts with @assert.unique: { iban: [ vendor, iban ] };

// Vendor master of a request (no new column: reuses vendorCode)
extend PaymentRequests with {
    vendor      : Association to Vendors on vendor.code = vendorCode;
    // Bank account picked in the value help (app requests); the server copies its bank fields into the request
    bankAccount : Association to VendorBankAccounts;   // new column bankAccount_ID
    // LEGACY (unused since 2026-11-18): Postgres schema evolution cannot drop elements — not exposed, do not use
    paymentFrom : Association to HouseBanks;
}


// =====================================================================
//  Number ranges (like SAP number range objects / NRIV, unbuffered)
// =====================================================================

/**
 * Last assigned number per number range object and year. Read with a row lock (SELECT … FOR UPDATE)
 * in the same transaction that saves the document, so numbers are unique under concurrent saves and
 * gap-free (a failed save rolls the counter back too). Rows are created by the service, never by CSV:
 * the deployer would overwrite the counter on every deploy.
 */
entity NumberRanges {
    key rangeObject : String(30); // e.g. PAYMENT_REQUEST
    key rangeYear   : Integer;    // numbering restarts every year
        lastNumber  : Integer;    // last number assigned (empty = not initialised yet)
}
