/**
 * Internal service (no HTTP endpoint): sends an approved payment request to CPI → MBC.
 * Always called through the persistent queue (cds.queued), so the call is stored in
 * cds.outbox.Messages in the same transaction as the approval and retried on failure.
 */
service BankTransferService @(protocol: 'none') {
  action sendPayment(ID : UUID);
}
