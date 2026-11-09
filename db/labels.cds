using com.agmc.paymentrequest as db from './schema';
//using { Attachments } from '@cap-js/attachments';
using { Attachments } from '@cap-js/sdm';

/**
 * Field labels and entity names — texts come from _i18n/i18n*.properties.
 * Annotating the db entities means every service that exposes them inherits the labels.
 */

annotate db.PaymentRequests with @title: '{i18n>PaymentRequest}' {
    ID                    @title: '{i18n>PaymentRequest}' @UI.Hidden;
    requestId             @title: '{i18n>requestId}';
    vendorCode            @title: '{i18n>vendorCode}';
    vendorName            @title: '{i18n>vendorName}';
    paymentAmount         @title: '{i18n>paymentAmount}' @Measures.ISOCurrency: currency_code;
    currency              @title: '{i18n>currency}';
    paymentDueDate        @title: '{i18n>paymentDueDate}';
    companyCode           @title: '{i18n>companyCode}';
    costCentre            @title: '{i18n>costCentre}';
    glAccount             @title: '{i18n>glAccount}';
    paymentMethod         @title: '{i18n>paymentMethod}';
    bankName              @title: '{i18n>bankName}';
    iban                  @title: '{i18n>iban}';
    bankAccountNo         @title: '{i18n>bankAccountNo}';
    swiftCode             @title: '{i18n>swiftCode}';
    requestorName         @title: '{i18n>requestorName}';
    requestorEmpId        @title: '{i18n>requestorEmpId}';
    requestCreatedAt      @title: '{i18n>requestCreatedAt}';
    btpPaymentRef         @title: '{i18n>btpPaymentRef}';
    status                @title: '{i18n>status}';
    bpaWorkflowInstanceId @title: '{i18n>bpaWorkflowInstanceId}';
    workflowMessage       @title: '{i18n>workflowMessage}';
    currentApprover       @title: '{i18n>currentApprover}';
    approvalLevel         @title: '{i18n>approvalLevel}';
    items                 @title: '{i18n>items}';
    approvalHistory       @title: '{i18n>approvalHistory}';
    attachments           @title: '{i18n>attachments}';
};

annotate db.PaymentRequestItems with @title: '{i18n>PaymentRequestItem}' {
    ID            @UI.Hidden;
    parent        @UI.Hidden;
    invoiceNumber @title: '{i18n>invoiceNumber}';
    invoiceDate   @title: '{i18n>invoiceDate}';
    invoiceAmount @title: '{i18n>invoiceAmount}' @Measures.ISOCurrency: currency_code;
    currency      @title: '{i18n>currency}';
};

annotate db.ApprovalHistory with @title: '{i18n>ApprovalHistoryItem}' {
    ID                    @UI.Hidden;
    parent                @UI.Hidden;
    stepNo                @title: '{i18n>stepNo}';
    stepName              @title: '{i18n>stepName}';
    approverId            @title: '{i18n>approverId}';
    approverName          @title: '{i18n>approverName}';
    decision              @title: '{i18n>decision}';
    comments              @title: '{i18n>comments}';
    decisionAt            @title: '{i18n>decisionAt}';
    bpaTaskId             @title: '{i18n>bpaTaskId}';
    bpaWorkflowInstanceId @title: '{i18n>bpaWorkflowInstanceId}';
};

annotate db.PaymentMethods with @title: '{i18n>PaymentMethod}';
annotate db.DocumentTypes  with @title: '{i18n>DocumentType}';

// Attachments is the plugin's aspect (extended with docType in schema.cds)
annotate Attachments with {
    docType @title: '{i18n>docType}';
};