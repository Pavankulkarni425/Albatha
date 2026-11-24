using PaymentRequestService as service from '../../srv/payment-service';

// =====================================================================
//  Payment Requests — List Report + Object Page
// =====================================================================
annotate service.PaymentRequests with @(

    // "Edit" button only visible while the status is editable (PaymentStatuses.editable = true)
    UI.UpdateHidden : { $edmJson : { $Not : { $Path : 'status/editable' } } },

    // ---------- List Report table ----------
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : btpPaymentRef, @HTML5.CssDefaults : { width : '15%' } },
        { $Type : 'UI.DataField', Value : source, @HTML5.CssDefaults : { width : '6%' } },
        { $Type : 'UI.DataField', Value : vendorName, @HTML5.CssDefaults : { width : '22%' } },
        { $Type : 'UI.DataField', Value : paymentType_code, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : paymentAmount, @HTML5.CssDefaults : { width : '10%' } },
        // Payment due date removed (2026-11-18) — no longer entered in the app
        { $Type : 'UI.DataField', Value : bankName, @HTML5.CssDefaults : { width : '22%' } },
        { $Type : 'UI.DataField', Value : status_code, Criticality : status.criticality, @HTML5.CssDefaults : { width : '15%' } },
    ],

    // Default sort of the List Report: newest BTP reference first (without it, Postgres returns rows in
    // physical order — updated rows jump around, e.g. 000036 above 000001)
    UI.PresentationVariant : {
        SortOrder      : [ { Property : btpPaymentRef, Descending : true } ],
        Visualizations : [ '@UI.LineItem' ],
    },

    // ---------- List Report filter bar ----------
    UI.SelectionFields : [ status_code, paymentType_code, paymentMethod_code, source ],

    // ---------- Object Page header ----------
    UI.HeaderInfo : {
        TypeName       : '{i18n>PaymentRequest}',
        TypeNamePlural : '{i18n>PaymentRequests}',
        TypeImageUrl   : 'sap-icon://payment-approval',
        Title          : { $Type : 'UI.DataField', Value : btpPaymentRef },
        Description    : { $Type : 'UI.DataField', Value : vendorName },
    },

        // ---------- Object Page header: key figures ----------
    UI.DataPoint #Status : {
        $Type       : 'UI.DataPointType',
        Value       : status_code,
        Title       : '{i18n>status}',
        Criticality : status.criticality,
    },
    UI.DataPoint #Amount : {
        $Type : 'UI.DataPointType',
        Value : paymentAmount,
        Title : '{i18n>paymentAmount}',
    },
    UI.DataPoint #DueDate : {
        $Type : 'UI.DataPointType',
        Value : paymentDueDate,
        Title : '{i18n>paymentDueDate}',
        Criticality : dueCriticality,
    },
    // UI.FieldGroup #HeaderVendor : {
    //     $Type : 'UI.FieldGroupType',
    //     Data  : [
    //         { $Type : 'UI.DataField', Value : vendorCode },
    //         { $Type : 'UI.DataField', Value : requestId },
    //         { $Type : 'UI.DataField', Value : companyCode },
    //     ],
    // },
    UI.HeaderFacets : [
        { $Type : 'UI.ReferenceFacet', ID : 'HeaderStatus',  Target : '@UI.DataPoint#Status' },
        { $Type : 'UI.ReferenceFacet', ID : 'HeaderAmount',  Target : '@UI.DataPoint#Amount' },
        // Payment due date removed from the header (2026-11-18) — field kept in the data model for now
        //{ $Type : 'UI.ReferenceFacet', ID : 'HeaderDueDate', Target : '@UI.DataPoint#DueDate' },
        //{ $Type : 'UI.ReferenceFacet', ID : 'HeaderVendor',  Target : '@UI.FieldGroup#HeaderVendor', Label : 'Request' },
    ],

    // "Start Workflow" button in the Object Page header —
    // only visible while the status is editable (PaymentStatuses.editable = true)
    // Start Workflow is a custom header action (manifest.json → ext/CustomActions.js) so a success
    // box can confirm the start; it calls the same bound action. Standard button kept for reference:
    // UI.Identification : [
    //     {
    //         $Type  : 'UI.DataFieldForAction',
    //         Action : 'PaymentRequestService.startWorkflow',
    //         Label  : '{i18n>startWorkflow}',
    //         ![@UI.Hidden] : { $edmJson : { $Not : { $Path : 'status/editable' } } },
    //     },
    // ],

    // ---------- Object Page field groups ----------
    // "Payment Information" section: four columns (General / Payment / Supplier / Requestor).
    // The payment amount is shown in the header only; the payment due date is not shown any more.
    UI.FieldGroup #General : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Value : requestId },        // read-only
            { $Type : 'UI.DataField', Value : companyCode },
            { $Type : 'UI.DataField', Value : costCentre },       // optional
            { $Type : 'UI.DataField', Value : glAccount },        // optional
            { $Type : 'UI.DataField', Value : source },           // read-only
        ],
    },
    UI.FieldGroup #PaymentDetails : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Value : currency_code },
            { $Type : 'UI.DataField', Value : paymentType_code },
            { $Type : 'UI.DataField', Value : paymentMethod_code },
        ],
    },
    UI.FieldGroup #Supplier : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Value : vendorCode, Label : '{i18n>vendor}' },
            // App requests: select the bank account (shown as its bank name) → IBAN, account no, SWIFT follow.
            // KLD requests: the bank name sent by KLD.
            { $Type : 'UI.DataField', Value : bankAccount_ID, Label : '{i18n>bankName}',
              ![@UI.Hidden] : { $edmJson : { $Not : { $Path : 'isBTP' } } } },
            { $Type : 'UI.DataField', Value : bankName,
              ![@UI.Hidden] : { $edmJson : { $Path : 'isBTP' } } },
            { $Type : 'UI.DataField', Value : iban },
            { $Type : 'UI.DataField', Value : bankAccountNo },
            { $Type : 'UI.DataField', Value : swiftCode },
        ],
    },
    UI.FieldGroup #Requestor : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Value : requestorName },
            { $Type : 'UI.DataField', Value : requestorEmpId },
            { $Type : 'UI.DataField', Value : requestCreatedAt },
        ],
    },
    // APM phase (after "Approved & Sent to APM"): references and dates reported by APM via CPI
    UI.FieldGroup #Payment : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Value : apmLevelText, Label : '{i18n>apmLevelText}' },
            { $Type : 'UI.DataField', Value : paymentDocumentNo },
            { $Type : 'UI.DataField', Value : bankPaymentRef },
            { $Type : 'UI.DataField', Value : sentToBankAt },
            { $Type : 'UI.DataField', Value : settledOn },
        ],
    },
    // UI.FieldGroup #Workflow : {
    //     $Type : 'UI.FieldGroupType',
    //     Data  : [
    //         { $Type : 'UI.DataField', Value : approvalLevel },
    //         { $Type : 'UI.DataField', Value : currentApprover },
    //         { $Type : 'UI.DataField', Value : bpaWorkflowInstanceId },
    //         { $Type : 'UI.DataField', Value : workflowMessage },
    //     ],
    // },

    // ---------- Object Page sections ----------
    // Documents, attachments and history are hidden while a NEW request is being created
    // (draft without a saved version); they appear after the first Save and in Edit of a saved request.
    UI.Facets : [
        {
            $Type  : 'UI.CollectionFacet',
            ID     : 'GeneralSection',
            Label  : '{i18n>paymentInformation}',
            Facets : [
                { $Type : 'UI.ReferenceFacet', ID : 'General',        Label : '{i18n>generalDetails}',   Target : '@UI.FieldGroup#General' },
                { $Type : 'UI.ReferenceFacet', ID : 'PaymentDetails', Label : '{i18n>paymentDetails}',   Target : '@UI.FieldGroup#PaymentDetails' },
                { $Type : 'UI.ReferenceFacet', ID : 'Supplier',       Label : '{i18n>supplierDetails}',  Target : '@UI.FieldGroup#Supplier' },
                { $Type : 'UI.ReferenceFacet', ID : 'Requestor',      Label : '{i18n>requestorDetails}', Target : '@UI.FieldGroup#Requestor' },
                { $Type : 'UI.ReferenceFacet', ID : 'Payment',   Label : '{i18n>paymentProcessing}', Target : '@UI.FieldGroup#Payment',
                  ![@UI.Hidden] : { $edmJson : { $Not : { $Path : 'isPaymentPhase' } } } },
                //{ $Type : 'UI.ReferenceFacet', ID : 'Workflow',  Label : 'Workflow',     Target : '@UI.FieldGroup#Workflow' },
            ],
        },
        { $Type : 'UI.ReferenceFacet', ID : 'Invoices',    Label : '{i18n>items}',           Target : 'items/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'Checklist',   Label : '{i18n>documentChecklist}', Target : 'checklist/@UI.LineItem',
          ![@UI.Hidden] : { $edmJson : { $And : [ { $Not : { $Path : 'IsActiveEntity' } }, { $Not : { $Path : 'HasActiveEntity' } } ] } } },
        { $Type : 'UI.ReferenceFacet', ID : 'Attachments', Label : '{i18n>attachments}',     Target : 'attachments/@UI.LineItem',
          ![@UI.Hidden] : { $edmJson : { $And : [ { $Not : { $Path : 'IsActiveEntity' } }, { $Not : { $Path : 'HasActiveEntity' } } ] } } },
        { $Type : 'UI.ReferenceFacet', ID : 'History',     Label : '{i18n>approvalHistory}', Target : 'approvalHistory/@UI.PresentationVariant',  // = LineItem + sort by date (oldest first)
          ![@UI.Hidden] : { $edmJson : { $And : [ { $Not : { $Path : 'IsActiveEntity' } }, { $Not : { $Path : 'HasActiveEntity' } } ] } } },
    ],
);

// ---------- Invoices table ----------
annotate service.PaymentRequestItems with @(
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : invoiceNumber, @HTML5.CssDefaults : { width : '40%' } },
        { $Type : 'UI.DataField', Value : invoiceDate, @HTML5.CssDefaults : { width : '20%' } },
        // shown as "123.00 AED"; in edit mode with its own currency input (@Measures.ISOCurrency in db/labels.cds)
        { $Type : 'UI.DataField', Value : invoiceAmount, @HTML5.CssDefaults : { width : '40%' } },
    ],
) {
    // Editable only in app requests (CPI invoices stay read-only)
    invoiceNumber @Common.FieldControl : parent.fcMandatory;
    invoiceDate   @Common.FieldControl : parent.fcMandatory;   // "Invoice Due Date", required on create
    invoiceAmount @Common.FieldControl : parent.fcMandatory;
    // currency: read-only, always the request currency (set by the server)
};

// ---------- Approval History table ----------
// One timeline per request: BPA approval decisions + handover to APM + APM status messages (source column)
annotate service.ApprovalHistory with @(
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : decisionAt, @HTML5.CssDefaults : { width : '13%' } },
        { $Type : 'UI.DataField', Value : source, @HTML5.CssDefaults : { width : '6%' } },
        { $Type : 'UI.DataField', Value : stepName, @HTML5.CssDefaults : { width : '20%' } },
        { $Type : 'UI.DataField', Value : decision, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : approverName, @HTML5.CssDefaults : { width : '13%' } },
        { $Type : 'UI.DataField', Value : comments, @HTML5.CssDefaults : { width : '22%' } },
        { $Type : 'UI.DataField', Value : reference, @HTML5.CssDefaults : { width : '16%' } },
    ],
    // oldest first: approval → handover → APM steps
    UI.PresentationVariant : {
        SortOrder      : [ { Property : decisionAt, Descending : false } ],
        Visualizations : [ '@UI.LineItem' ],
    },
);

// ---------- Attachments table (upload in Edit mode) ----------
annotate service.PaymentRequests.attachments with @(
    UI.LineItem : [
        // widths add up to 100% so the table uses the full width
        { $Type : 'UI.DataField', Value : content,      @HTML5.CssDefaults : { width : '35%' } },
        { $Type : 'UI.DataField', Value : docType_code, Label : '{i18n>docType}', @HTML5.CssDefaults : { width : '25%' } },
        { $Type : 'UI.DataField', Value : createdAt,    @HTML5.CssDefaults : { width : '15%' } },
        //{ $Type : 'UI.DataField', Value : createdBy,    @HTML5.CssDefaults : { width : '15%' } },
        { $Type : 'UI.DataField', Value : note,         @HTML5.CssDefaults : { width : '25%' } },
    ],
) {
    // Document type dropdown (Invoice, Bank Letter, ...)
    docType @Common : {
        Text                     : docType.name,
        TextArrangement          : #TextOnly,
        ValueListWithFixedValues : true,
    };
};

// ---------- Mandatory document checklist (Uploaded / Pending) ----------
annotate service.DocumentChecklist with @(
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : docTypeName,   Label : '{i18n>docType}', @HTML5.CssDefaults : { width : '20%' } },
        { $Type : 'UI.DataField', Value : level,         Label : '{i18n>requirementLevel}', @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : status,        Label : '{i18n>status}', Criticality : criticality, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : fileRules,     Label : '{i18n>fileRules}', @HTML5.CssDefaults : { width : '15%' } },
        { $Type : 'UI.DataField', Value : fileName,      Label : '{i18n>fileName}', @HTML5.CssDefaults : { width : '25%' } },
        { $Type : 'UI.DataField', Value : conditionNote, Label : '{i18n>conditionNote}', @HTML5.CssDefaults : { width : '20%' } },
    ],
);

// Refresh the checklist whenever attachments are added, changed or removed
annotate service.PaymentRequests with @(
    Common.SideEffects #Attachments : {
        SourceEntities : [ attachments ],
        TargetEntities : [ checklist ],
    },
);

// Show "Description (Code)" for coded fields
annotate service.PaymentRequests with {
    vendorCode    @Common : { Text : vendorName,         TextArrangement : #TextFirst };
    // "Dubai Islamic Bank (DIB) (I)" on List Report, Object Page and filter dropdown
    paymentMethod @Common : {
        Text                     : paymentMethod.name,
        TextArrangement          : #TextFirst,
        ValueListWithFixedValues : true,
    };
};

// ---------- Vendor + bank value helps (for new requests) ----------
// 1. Vendor: select from the vendor master → vendor name is filled.
// 2. Bank: lists only the bank accounts of the selected vendor (vendorCode → vendor_code filter).
//    The field is the bank account itself (bankAccount_ID, shown as its bank name),
//    so one selection = one change; the server copies bank name, IBAN, account no and SWIFT
//    (read-only fields) from that account (payment-service.js) and the side effect shows them at once.
annotate service.PaymentRequests with {
    vendorCode @Common.ValueList : {
        Label          : '{i18n>vendor}',
        CollectionPath : 'Vendors',
        Parameters     : [
            { $Type : 'Common.ValueListParameterInOut', LocalDataProperty : vendorCode, ValueListProperty : 'code' },
            { $Type : 'Common.ValueListParameterOut',   LocalDataProperty : vendorName, ValueListProperty : 'name' },
        ],
    };
    bankAccount @title : '{i18n>bankName}'
                @Common : { Text : bankName, TextArrangement : #TextOnly }
                @Common.ValueList : {
        Label          : '{i18n>vendorBankAccounts}',
        CollectionPath : 'VendorBankAccounts',
        Parameters     : [
            // Only the accounts of the selected vendor
            { $Type : 'Common.ValueListParameterIn', LocalDataProperty : vendorCode, ValueListProperty : 'vendor_code' },
            { $Type : 'Common.ValueListParameterInOut', LocalDataProperty : bankAccount_ID, ValueListProperty : 'ID' },
            { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'iban' },
            { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'bankAccountNo' },
            { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'swiftCode' },
            { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'vendor_code' },
            { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'currency_code' },
        ],
    };
};

// Refresh the fields the server fills — one side effect per field the user changes
annotate service.PaymentRequests with @(
    Common.SideEffects #Vendor : {
        SourceProperties : [ vendorCode ],
        // vendor change can also replace/clear the bank account (see onVendorChange)
        TargetProperties : [ 'vendorName', 'bankAccount_ID', 'bankName', 'iban', 'bankAccountNo', 'swiftCode' ],
    },
    Common.SideEffects #BankAccount : {
        SourceProperties : [ bankAccount_ID ],
        TargetProperties : [ 'bankName', 'iban', 'bankAccountNo', 'swiftCode' ],
    },
);

annotate service.Vendors with {
    code @title : '{i18n>vendorCode}' @Common : { Text : name, TextArrangement : #TextFirst };
    name @title : '{i18n>vendorName}';
};

annotate service.VendorBankAccounts with {
    bankName      @title : '{i18n>bankName}';
    iban          @title : '{i18n>iban}';
    bankAccountNo @title : '{i18n>bankAccountNo}';
    swiftCode     @title : '{i18n>swiftCode}';
    isDefault     @title : '{i18n>isDefault}';
    vendor        @title : '{i18n>vendorCode}';
    ID            @title : '{i18n>bankName}' @Common : { Text : bankName, TextArrangement : #TextOnly };
};

// Dropdown entries also read "Dubai Islamic Bank (DIB) (I)"
annotate service.PaymentMethods with {
    code @Common : { Text : name, TextArrangement : #TextFirst };
};

// ---------- Status: show the name ("Document Pending"), dropdown in the filter ----------
annotate service.PaymentRequests with {
    status         @title : '{i18n>status}'
                   @Common : {
                       Text                     : status.name,
                       TextArrangement          : #TextOnly,
                       ValueListWithFixedValues : true,
                   };
    bankPaymentRef @title : '{i18n>bankPaymentRef}';
    sentToBankAt   @title : '{i18n>sentToBankAt}';
    settledOn      @title : '{i18n>settledOn}';
};

// Statuses in the dropdown in lifecycle order
annotate service.PaymentStatuses with @UI.PresentationVariant : {
    SortOrder : [ { Property : sequence, Descending : false } ],
};

// Status dropdown in the filter bar: description only ("Document Pending"), no code column
annotate service.PaymentStatuses with {
    code @Common : { Text : name, TextArrangement : #TextOnly };
};

// After "Start Workflow" the status changes -> refresh it so the Start Workflow and Delete buttons hide immediately.
// Disabled in edit mode: the workflow runs on the saved request, not on the draft.
annotate service.PaymentRequests actions {
    startWorkflow @(Core.OperationAvailable : { $edmJson : { $Path : 'in/IsActiveEntity' } })
                  @(Common.SideEffects : {
        // deletable: the Delete button hides once the workflow has started
        TargetProperties : [ 'in/status_code', 'in/bpaWorkflowInstanceId', 'in/workflowMessage', 'in/deletable' ],
        TargetEntities   : [ in.status ],
    });
};

// ---------- Payment type and company: show names ----------
annotate service.PaymentRequests with {
    paymentType @title : '{i18n>paymentType}'
                @Common : {
                    Text                     : paymentType.name,
                    TextArrangement          : #TextOnly,
                    ValueListWithFixedValues : true,
                };
    companyCode @Common : { Text : company.name, TextArrangement : #TextFirst };   // "AGMC (1000)"
};


// =====================================================================
//  Create in the app (source BTP): editable fields, invoices, amount
// =====================================================================

// App requests: fields editable (7 mandatory, 3 optional); KLD requests: read-only (1).
// Values come from the computed fcMandatory / fcOptional in srv/payment-service.cds.
annotate service.PaymentRequests with {
    vendorCode         @Common.FieldControl : fcMandatory;
    paymentType        @Common.FieldControl : fcMandatory;
    companyCode        @Common.FieldControl : fcMandatory;
    currency           @Common.FieldControl : fcMandatory;
    paymentMethod      @Common.FieldControl : fcMandatory;
    paymentDueDate     @Common.FieldControl : fcOptional;    // not shown in the app any more
    requestorEmpId     @Common.FieldControl : fcMandatory;
    costCentre         @Common.FieldControl : fcOptional;    // optional
    glAccount          @Common.FieldControl : fcOptional;    // optional
    // Bank: selected as bank account; bankName, iban, bankAccountNo, swiftCode are read-only copies of it
    bankAccount        @Common.FieldControl : fcMandatory;   // bank details mandatory for app requests
    requestorName      @Common.FieldControl : fcOptional;
    source             @title : '{i18n>source}';
    // Company code dropdown ("AGMC (1000)")
    companyCode        @Common.ValueListWithFixedValues : true
                       @Common.ValueList : {
                           CollectionPath : 'CompanyCodes',
                           Parameters     : [
                               { $Type : 'Common.ValueListParameterInOut', LocalDataProperty : companyCode, ValueListProperty : 'code' },
                               { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'name' },
                           ],
                       };
};

annotate service.CompanyCodes with {
    code @Common : { Text : name, TextArrangement : #TextFirst };
};

// Source filter: dropdown with the sources of the stored requests (KLD, BTP)
annotate service.PaymentRequests with {
    source @Common.ValueListWithFixedValues : true
           @Common.ValueList : {
               CollectionPath : 'Sources',
               Parameters     : [
                   { $Type : 'Common.ValueListParameterInOut', LocalDataProperty : source, ValueListProperty : 'code' },
               ],
           };
};
annotate service.Sources with {
    code @title : '{i18n>source}';
};

// Payment type dropdown (filter bar + edit): description only ("Vendor Payment"), no code column
annotate service.PaymentTypes with {
    code @Common : { Text : name, TextArrangement : #TextOnly };
};

annotate service.PaymentRequests with @(
    // Invoices: add / delete rows only in app requests
    Capabilities.NavigationRestrictions : {
        RestrictedProperties : [
            {
                NavigationProperty : items,
                InsertRestrictions : { Insertable : isBTP },
                DeleteRestrictions : { Deletable : isBTP },
            },
            // Hides the "Editing Status" filter in the List Report (SAP docs: "Disabling the Editing Status Filter").
            // Must stay in this one NavigationRestrictions — a second annotation of the term would replace the invoice rules above.
            {
                NavigationProperty : DraftAdministrativeData,
                FilterRestrictions : { Filterable : false },
            },
        ],
    },
    // The payment amount is recalculated on the server when invoices change
    Common.SideEffects #InvoiceTotal : {
        SourceEntities   : [ items ],
        TargetProperties : [ 'paymentAmount' ],
    },
    // The invoices take over the request currency when it changes
    Common.SideEffects #Currency : {
        SourceProperties : [ currency_code ],
        TargetEntities   : [ items ],
    },
);
