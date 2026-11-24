import cds from '@sap/cds'
import nodemailer from 'nodemailer'
import { getDestination } from '@sap-cloud-sdk/connectivity'
import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
const LOG = cds.log('notification')

// Settings: cds.requires.notificationMail in package.json (override per space via env vars,
// e.g. cds_requires_notificationMail_to in mta.yaml / .mtaext)
//   transport   – 'smtp' (default): destination of type MAIL, sent with nodemailer
//                 'graph': HTTP destination to https://graph.microsoft.com (OAuth2ClientCredentials,
//                 scope https://graph.microsoft.com/.default) — Microsoft 365 with MFA / no SMTP AUTH
//   destination – name of that BTP destination
//   from        – sender; for 'graph' this must be the mailbox the Entra app may send as
//   to / cc     – recipient(s), comma-separated string or array
//   kind 'log'  – development: the mail is only written to the log, nothing is sent
const settings = () => cds.env.requires.notificationMail ?? {}

// Mail texts — change wording here. {ref} = BTP reference, e.g. BTP-PR-2026-000028
const TEXTS = {
  docsMissing: {
    subject: 'Action required: Payment request #{ref}',
    heading: 'Please upload the mandatory documents',
    intro:   'Payment request #{ref} has been created. The approval workflow can only be started once the following mandatory documents are uploaded:'
  },
  ready: {
    subject: 'Payment request {ref} created – ready to start approval',
    heading: 'Payment request created',
    intro:   'Payment request {ref} has been created and all mandatory documents are available. You can now start the approval workflow.'
  },
  button: 'Open payment request'
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fill = (t, ref) => t.replaceAll('{ref}', ref)

/** Deep link to the request's object page in the Fiori app (APP_BASE_URL is set in mta.yaml). */
const appLink = ID => {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
  return base ? `${base}/index.html#/PaymentRequests(ID=${ID},IsActiveEntity=true)` : null
}

/** SMTP transport from the BTP MAIL destination (mail.smtp.* properties + mail.user / mail.password). */
async function transportFor(destinationName) {
  const dest = await getDestination({ destinationName })
  if (!dest) throw new Error(`Destination ${destinationName} not found`)
  const p = dest.originalProperties ?? {}
  const port = Number(p['mail.smtp.port'] ?? 587)
  return nodemailer.createTransport({
    host: p['mail.smtp.host'],
    port,
    secure: port === 465 || p['mail.smtp.ssl.enable'] === 'true',   // 465: TLS from the start
    requireTLS: p['mail.smtp.starttls.enable'] === 'true',           // 587: upgrade via STARTTLS
    // MAIL destinations keep the login in mail.user / mail.password (not User / Password)
    auth: { user: p['mail.user'] ?? dest.username, pass: p['mail.password'] ?? dest.password }
  })
}

const list = v => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map(a => a.trim()).filter(Boolean)
const address = from => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim()   // "Name <a@b>" → "a@b"

/** Send via Microsoft Graph: POST /v1.0/users/{sender}/sendMail (HTTP 202, no body). */
async function sendViaGraph(cfg, { subject, html }) {
  const sender = address(cfg.from)
  const recipients = l => list(l).map(a => ({ emailAddress: { address: a } }))
  await executeHttpRequest({ destinationName: cfg.destination }, {
    method: 'post',
    url: `/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: recipients(cfg.to),
        ccRecipients: recipients(cfg.cc)
      },
      saveToSentItems: true
    }
  }, { fetchCsrf: false })
  return `graph:${sender}`
}

/** Send via SMTP (BTP MAIL destination + nodemailer). */
async function sendViaSmtp(cfg, { subject, text, html }) {
  const transport = await transportFor(cfg.destination)
  const info = await transport.sendMail({ from: cfg.from, to: list(cfg.to), cc: list(cfg.cc), subject, text, html })
  return info.messageId
}

export default class NotificationService extends cds.ApplicationService {
  init() {
    const { PaymentRequests, PaymentStatuses } = cds.entities('com.agmc.paymentrequest')

    this.on('requestCreated', async req => {
      const pr = await SELECT.one.from(PaymentRequests, req.data.ID)
      if (!pr) return LOG.warn(`Payment request ${req.data.ID} not found — no mail sent`)
      const status = await SELECT.one.from(PaymentStatuses, pr.status_code).columns('name')
      const paymentSrv = await cds.connect.to('PaymentRequestService')
      const missing = await paymentSrv.missingDocuments(pr.ID)   // same rule as "Start Workflow"

      const t = missing.length ? TEXTS.docsMissing : TEXTS.ready
      const ref = pr.btpPaymentRef
      const subject = fill(t.subject, ref)
      const link = appLink(pr.ID)
      const amount = `${Number(pr.paymentAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${pr.currency_code ?? ''}`
      const rows = [
        ['BTP reference', ref],
        ['Request ID', pr.requestId],
        //['Created via', pr.source === 'BTP' ? 'BTP, Fiori app' : 'KLD (via CPI)'],
        ['Created by', pr.source === 'BTP' ? pr.createdBy : pr.requestorName],
        ['Vendor', `${pr.vendorCode}${pr.vendorName ? ' – ' + pr.vendorName : ''}`],
        ['Amount', amount],
        //['Company code', pr.companyCode],
        //['Due date', pr.paymentDueDate],   // no longer entered in the app (2026-11-18)
        ['Status', status?.name ?? pr.status_code]
      ]

      const text = [
        t.heading, '', fill(t.intro, ref),
        ...missing.map(m => `  - ${m.name}`), '',
        ...rows.map(([k, v]) => `${k}: ${v ?? '-'}`), '',
        link ? `${TEXTS.button}: ${link}` : ''
      ].join('\n')

      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px">
<h2 style="font-size:18px;margin:0 0 12px">${esc(t.heading)}</h2>
<p>${esc(fill(t.intro, ref))}</p>
${missing.length ? `<ul>${missing.map(m => `<li><b>${esc(m.name)}</b></li>`).join('')}</ul>` : ''}
${link ? `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#0a6ed1;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;display:inline-block">${esc(TEXTS.button)}</a></p>` : ''}
<p style="font-weight:bold;font-size:15px;margin:24px 0 8px">Payment Request Details:</p>
<table width="560" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;margin-left:16px;width:560px;max-width:100%">
${rows.map(([k, v], i) => {
  const bg = i % 2 === 0 ? '#f0f0f0' : '#ffffff'   // zebra stripes via bgcolor — nth-child is not supported by mail clients
  return `<tr bgcolor="${bg}" style="background:${bg}"><td width="35%" style="padding:8px 10px;font-weight:bold;color:#222;vertical-align:top">${esc(k)}</td><td style="padding:8px 10px;color:#222;word-break:break-word;overflow-wrap:break-word">${esc(v ?? '-')}</td></tr>`
}).join('\n')}
</table>
${link ? `<p style="font-size:12px;color:#666;margin-top:20px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>` : ''}
</div>`

      const cfg = settings()
      if (cfg.kind === 'log' || !cfg.destination)
        return LOG.info(`[mail not sent – ${cfg.kind === 'log' ? 'dev mode' : 'no destination'}] to ${cfg.to}: ${subject}\n${text}`)
      if (!cfg.to) return LOG.warn(`${ref}: no recipient configured — no mail sent`)

      const send = cfg.transport === 'graph' ? sendViaGraph : sendViaSmtp
      const id = await send(cfg, { subject, text, html })   // throws → queue retries
      LOG.info(`${ref}: creation mail sent to ${list(cfg.to).join(', ')} (${id})`)
    })

    return super.init()
  }
}
