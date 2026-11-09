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
    paymentDueDate        : Date;
    companyCode           : String(4)      @mandatory; // AGMC entity
    costCentre            : String(10);
    glAccount             : String(10);
    paymentMethod         : Association to PaymentMethods; // TT, CHQ ...
    bankName              : String(80);
    iban                  : String(34);
    bankAccountNo         : String(35);
    swiftCode             : String(11);
    requestorName         : String(80);
    requestorEmpId        : String(20);
    requestCreatedAt      : Timestamp; // Request creation timestamp

    // --- BTP generated ---
    btpPaymentRef         : String(25)     @readonly; // e.g. BTP-PR-2026-000001
    status                : Association to PaymentStatuses; // status_code, e.g. DOC_PENDING (set by the service)

    // --- Bank (reported back via CPI) ---
    bankPaymentRef        : String(35);  // payment reference from the bank / payment run
    sentToBankAt          : Timestamp;   // when the payment was transmitted
    settledOn             : Date;        // value date confirmed by the bank

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

entity PaymentMethods : CodeList {
    key code : String(5); // TT, CHQ, ACH ...
}

/**
 * Lifecycle statuses of a payment request (fixed by the application, loaded from CSV).
 * `editable` drives the document lock: Edit, uploads and Start Workflow are only
 * allowed in statuses where it is true.
 */
entity PaymentStatuses : CodeList {
    key code        : String(20); // NEW, DOC_PENDING, IN_APPROVAL, RETURN, APPROVED, ...
        criticality : Integer;    // 0 neutral, 1 red, 2 orange, 3 green
        editable    : Boolean;    // documents may be changed / workflow may (re)start
        sequence    : Integer;    // order in filters and the step bar
}

entity ApprovalHistory : cuid {
    parent                : Association to PaymentRequests;
    stepNo                : Integer; // 1, 2, 3 ...
    stepName              : String(60); // e.g. "Finance Manager Approval"
    approverId            : String(60); // user ID / email from BPA
    approverName          : String(120);
    decision              : String(20); // Approved / Return / Rejected
    comments              : String(1000);
    decisionAt            : Timestamp;
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