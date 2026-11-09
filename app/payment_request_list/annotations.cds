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
        { $Type : 'UI.DataField', Value : vendorName, @HTML5.CssDefaults : { width : '18%' } },
        { $Type : 'UI.DataField', Value : paymentType_code, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : paymentAmount, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : paymentDueDate, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : bankName, @HTML5.CssDefaults : { width : '23%' } },
        { $Type : 'UI.DataField', Value : status_code, Criticality : status.criticality, @HTML5.CssDefaults : { width : '15%' } },
    ],

    // ---------- List Report filter bar ----------
    UI.SelectionFields : [ status_code, paymentType_code, paymentDueDate, paymentMethod_code ],

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
        { $Type : 'UI.ReferenceFacet', ID : 'HeaderDueDate', Target : '@UI.DataPoint#DueDate' },
        //{ $Type : 'UI.ReferenceFacet', ID : 'HeaderVendor',  Target : '@UI.FieldGroup#HeaderVendor', Label : 'Request' },
    ],

    // "Start Workflow" button in the Object Page header —
    // only visible while the status is editable (PaymentStatuses.editable = true)
    UI.Identification : [
        {
            $Type  : 'UI.DataFieldForAction',
            Action : 'PaymentRequestService.startWorkflow',
            Label  : '{i18n>startWorkflow}',
            ![@UI.Hidden] : { $edmJson : { $Not : { $Path : 'status/editable' } } },
        },
    ],

    // ---------- Object Page field groups ----------
    UI.FieldGroup #General : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            //{ $Type : 'UI.DataField', Value : btpPaymentRef },
            { $Type : 'UI.DataField', Value : requestId },
            { $Type : 'UI.DataField', Value : paymentType_code },
            //{ $Type : 'UI.DataField', Value : status },
            { $Type : 'UI.DataField', Value : vendorCode, Label: 'Vendor'},
            //{ $Type : 'UI.DataField', Value : vendorName },
            //{ $Type : 'UI.DataField', Value : paymentAmount },
            //{ $Type : 'UI.DataField', Value : paymentDueDate },
            { $Type : 'UI.DataField', Value : paymentMethod_code },
            { $Type : 'UI.DataField', Value : companyCode },
            { $Type : 'UI.DataField', Value : costCentre },
            { $Type : 'UI.DataField', Value : glAccount },
        ],
    },
    UI.FieldGroup #Bank : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Value : bankName },
            { $Type : 'UI.DataField', Value : iban },
            { $Type : 'UI.DataField', Value : bankAccountNo },
            { $Type : 'UI.DataField', Value : swiftCode },
            // { $Type : 'UI.DataField', Value : bankPaymentRef },
            // { $Type : 'UI.DataField', Value : sentToBankAt },
            // { $Type : 'UI.DataField', Value : settledOn },
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
    UI.Facets : [
        {
            $Type  : 'UI.CollectionFacet',
            ID     : 'GeneralSection',
            Label  : 'General Information',
            Facets : [
                { $Type : 'UI.ReferenceFacet', ID : 'General',   Label : 'Payment',      Target : '@UI.FieldGroup#General' },
                { $Type : 'UI.ReferenceFacet', ID : 'Bank',      Label : 'Bank Details', Target : '@UI.FieldGroup#Bank' },
                { $Type : 'UI.ReferenceFacet', ID : 'Requestor', Label : 'Requestor',    Target : '@UI.FieldGroup#Requestor' },
                //{ $Type : 'UI.ReferenceFacet', ID : 'Workflow',  Label : 'Workflow',     Target : '@UI.FieldGroup#Workflow' },
            ],
        },
        { $Type : 'UI.ReferenceFacet', ID : 'Invoices',    Label : '{i18n>items}',           Target : 'items/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'Checklist',   Label : '{i18n>documentChecklist}', Target : 'checklist/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'Attachments', Label : '{i18n>attachments}',     Target : 'attachments/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'History',     Label : '{i18n>approvalHistory}', Target : 'approvalHistory/@UI.LineItem' },
    ],
);

// ---------- Invoices table ----------
annotate service.PaymentRequestItems with @(
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : invoiceNumber, @HTML5.CssDefaults : { width : '40%' } },
        { $Type : 'UI.DataField', Value : invoiceDate, @HTML5.CssDefaults : { width : '20%' } },
        { $Type : 'UI.DataField', Value : invoiceAmount, @HTML5.CssDefaults : { width : '40%' } },
    ],
);

// ---------- Approval History table ----------
annotate service.ApprovalHistory with @(
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : stepNo, @HTML5.CssDefaults : { width : '5%' } },
        { $Type : 'UI.DataField', Value : stepName, @HTML5.CssDefaults : { width : '20%' } },
        { $Type : 'UI.DataField', Value : approverName, @HTML5.CssDefaults : { width : '20%' } },
        { $Type : 'UI.DataField', Value : decision, @HTML5.CssDefaults : { width : '10%' } },
        { $Type : 'UI.DataField', Value : comments, @HTML5.CssDefaults : { width : '35%' } },
        { $Type : 'UI.DataField', Value : decisionAt, @HTML5.CssDefaults : { width : '10%' } },
    ],
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
    // "Telegraphic Transfer (TT)" on List Report, Object Page and filter dropdown
    paymentMethod @Common : {
        Text                     : paymentMethod.name,
        TextArrangement          : #TextFirst,
        ValueListWithFixedValues : true,
    };
};

// Dropdown entries also read "Telegraphic Transfer (TT)"
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

// After "Start Workflow" the status changes -> refresh it so the button hides immediately.
// Disabled in edit mode: the workflow runs on the saved request, not on the draft.
annotate service.PaymentRequests actions {
    startWorkflow @(Core.OperationAvailable : { $edmJson : { $Path : 'in/IsActiveEntity' } })
                  @(Common.SideEffects : {
        TargetProperties : [ 'in/status_code', 'in/bpaWorkflowInstanceId', 'in/workflowMessage' ],
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
