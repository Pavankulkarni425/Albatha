sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (ControllerExtension) {
  "use strict";

  /**
   * Object Page extension: hides the standard Share button in the header toolbar.
   * Fiori elements has no manifest setting for this, and its visibility is bound internally,
   * so the binding is removed before the button is hidden.
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
      }
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
