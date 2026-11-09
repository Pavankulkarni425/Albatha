sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"com/fiori/paymentrequestlist/test/integration/pages/PaymentRequestsList.gen",
	"com/fiori/paymentrequestlist/test/integration/pages/PaymentRequestsObjectPage.gen"
], function (JourneyRunner, PaymentRequestsListGenerated, PaymentRequestsObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('com/fiori/paymentrequestlist') + '/test/flp.html#app-preview',
        pages: {
			onThePaymentRequestsListGenerated: PaymentRequestsListGenerated,
			onThePaymentRequestsObjectPageGenerated: PaymentRequestsObjectPageGenerated
        },
        async: true
    });

    return runner;
});

