/* global Promise */
sap.ui.define([
  "sap/ui/core/mvc/ControllerExtension",
  "sap/m/MessageBox"
], function (ControllerExtension, MessageBox) {
  "use strict";

  /**
   * Object Page extension:
   * - hides the standard Share button in the header toolbar
   *   (Fiori elements has no manifest setting for this, and its visibility is bound internally,
   *   so the binding is removed before the button is hidden)
   * - after a NEW payment request is saved (Create): success box with the generated BTP reference,
   *   OK navigates back to the list report. Saving changes of an existing request is unchanged.
   */
  return ControllerExtension.extend("com.fiori.paymentrequestlist.ext.controller.ObjectPageExt", {
    override: {
      onAfterRendering: function () {
        this._hideShare();
      },
      routing: {
        onAfterBinding: function () {
          this._hideShare();
        }
      },
      editFlow: {
        // Remember whether this save creates the request (draft without a saved version)
        onBeforeSave: function (mParameters) {
          var oContext = mParameters && mParameters.context;
          this._bCreating = false;
          var oDone = oContext ? oContext.requestProperty("HasActiveEntity") : Promise.resolve(true);
          return oDone.then(function (bHasActive) {
            this._bCreating = bHasActive === false;
          }.bind(this));
        },
        onAfterSave: function (mParameters) {
          var oContext = mParameters && mParameters.context;   // the saved request
          if (!this._bCreating || !oContext) {
            return;
          }
          this._bCreating = false;
          oContext.requestProperty("btpPaymentRef").then(function (sRef) {
            this._showCreated(sRef);
          }.bind(this));
        }
      }
    },

    _showCreated: function (sRef) {
      var oBundle = this.base.getView().getModel("i18n").getResourceBundle();
      var oExtensionAPI = this.base.getExtensionAPI();
      MessageBox.success(oBundle.getText("createdMessage", [sRef]), {
        title: oBundle.getText("createdTitle"),
        actions: [MessageBox.Action.OK],
        emphasizedAction: MessageBox.Action.OK,
        onClose: function () {
          oExtensionAPI.routing.navigateToRoute("PaymentRequestsList");
        }
      });
    },

    _hideShare: function () {
      var oShare = this.base.getView().byId("fe::Share");
      if (oShare && oShare.getVisible()) {
        oShare.unbindProperty("visible");
        oShare.setVisible(false);
      }
    }
  });
});
