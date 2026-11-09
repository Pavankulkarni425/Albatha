import cds from '@sap/cds'

const FORMAT_LABELS = { pdf: 'PDF', jpg: 'JPG', png: 'PNG', xlsx: 'Excel' }

/** 'pdf,jpg,png' -> ['pdf','jpg','png'] (empty -> []) */
export const parseFormats = formats =>
  String(formats ?? '').split(',').map(f => f.trim().toLowerCase()).filter(Boolean)

/** File extension of a file name, normalised ('JPEG' -> 'jpg') */
export const extensionOf = filename => {
  const name = String(filename ?? '')
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return ext === 'jpeg' ? 'jpg' : ext
}

/** Human-readable upload rule of a document type, e.g. 'PDF, JPG, PNG · max 10 MB' */
export const describeFileRules = ({ allowedFormats, maxSizeMB }) => {
  const formats = parseFormats(allowedFormats).map(f => FORMAT_LABELS[f] ?? f.toUpperCase()).join(', ')
  return [formats, maxSizeMB ? `max ${maxSizeMB} MB` : ''].filter(Boolean).join(' · ')
}

/**
 * Document requirements for one payment request, from the DocumentRequirements matrix
 * (company code + payment type).
 *
 * @param {{ companyCode: string, paymentType_code: string }} request
 * @returns {Promise<{ configured: boolean, rules: Array<{
 *   docType_code: string, docTypeName: string, level_code: string, levelName: string,
 *   blocking: boolean, conditionNote: string, sortOrder: number, fileRules: string }> }>}
 *   configured = false when no rule exists for this company + payment type
 *   (the caller must then not treat the request as "nothing required").
 */
export async function getDocumentRequirements({ companyCode, paymentType_code }) {
  const { DocumentRequirements } = cds.entities('com.agmc.paymentrequest')
  if (!companyCode || !paymentType_code) return { configured: false, rules: [] }

  const rows = await SELECT.from(DocumentRequirements)
    .columns(r => {
      r.docType_code, r.level_code, r.conditionNote, r.sortOrder,
      r.docType(d => { d.name, d.allowedFormats, d.maxSizeMB }), r.level(l => { l.name, l.blocking })
    })
    .where({ company_code: companyCode, paymentType_code })
    .orderBy('sortOrder')

  return {
    configured: rows.length > 0,
    rules: rows.map(r => ({
      docType_code: r.docType_code,
      docTypeName:  r.docType?.name ?? r.docType_code,
      fileRules:    describeFileRules(r.docType ?? {}),
      level_code:   r.level_code,
      levelName:    r.level?.name ?? r.level_code,
      blocking:     !!r.level?.blocking,
      conditionNote: r.conditionNote,
      sortOrder:    r.sortOrder
    }))
  }
}