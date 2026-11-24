/**
 * Internal service (no HTTP endpoint): e-mail notifications.
 * Always called through the persistent queue (cds.queued), so a mail is only sent after the
 * triggering transaction has committed, and a failed send is retried without affecting the request.
 */
service NotificationService @(protocol: 'none') {
  action requestCreated(ID : UUID);
}
