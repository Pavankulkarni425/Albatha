import cds from '@sap/cds'

export default class AdminService extends cds.ApplicationService {
  init() {
    const { DocumentRequirements } = this.entities

    /**
     * One rule per company code + payment type + document type.
     * Checked here so the admin gets a clear message instead of a database error.
     */
    this.before(['CREATE', 'UPDATE'], DocumentRequirements, async req => {
      const d = req.data
      if (!d.company_code || !d.paymentType_code || !d.docType_code) return   // partial update
      const duplicate = await SELECT.one.from(DocumentRequirements).columns('ID').where({
        company_code: d.company_code, paymentType_code: d.paymentType_code,
        docType_code: d.docType_code, ID: { '!=': d.ID ?? '' }
      })
      if (duplicate)
        req.reject(409, `A rule for company ${d.company_code}, payment type ${d.paymentType_code} and document ${d.docType_code} already exists`)
    })

    return super.init()
  }
}