sap.ui.define([
  "sap/m/MessageBox",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/Label",
  "sap/m/TextArea",
  "sap/m/VBox",
  "sap/m/Bar",
  "sap/m/Title"
], function (MessageBox, Dialog, Button, Label, TextArea, VBox, Bar, Title) {
  "use strict";

  /**
   * Custom header actions of the Object Page (registered in manifest.json).
   * Handlers run with `this` = Fiori elements ExtensionAPI.
   */
  return {
    /**
     * Start Workflow in two steps:
     * 1. All checks on the server (function startWorkflowCheck — changes nothing). Failed → error box, no pop-up.
     * 2. Pop-up "Comments for approvers" (optional) with one button, Send, and an "X" (top right) to close. Send calls the bound action
     *    startWorkflow(note) through Fiori elements (busy indicator, errors and side effects stay standard).
     *    Success → pop-up closes + success box. Error → pop-up stays open, the typed comment is kept.
     * @param {sap.ui.model.odata.v4.Context} oContext the payment request
     */
    onStartWorkflow: function (oContext) {
      var oExtensionAPI = this;
      var oBundle = oExtensionAPI.getModel("i18n").getResourceBundle();
      var sRef = oContext.getProperty("btpPaymentRef");

      var oCheck = oContext.getModel().bindContext("PaymentRequestService.startWorkflowCheck(...)", oContext);
      return oCheck.invoke().then(function () {
        var oResult = oCheck.getBoundContext().getObject() || {};
        if (!oResult.ok) {
          MessageBox.error((oResult.messages || []).join("\n") || oBundle.getText("startWorkflowCheckFailed"), {
            title: oBundle.getText("startWorkflowNotPossible")
          });
          return;
        }
        openCommentDialog(oExtensionAPI, oContext, oBundle, sRef);
      }).catch(function (oError) {
        MessageBox.error(oError.message || oBundle.getText("startWorkflowCheckFailed"));
      });
    }
  };

  function openCommentDialog(oExtensionAPI, oContext, oBundle, sRef) {
    var oText = new TextArea({
      width: "100%",
      rows: 5,
      maxLength: 1000,
      showExceededText: true,
      growing: true,
      growingMaxLines: 12,
      placeholder: oBundle.getText("approverNotePlaceholder")
    });
    var oDialog = new Dialog({
      // header with the title and an "X" (top right) that just closes the pop-up — nothing is started
      customHeader: new Bar({
        contentMiddle: new Title({ text: oBundle.getText("startWorkflowDialogTitle", [sRef]), level: "H2" }),
        contentRight: new Button({
          icon: "sap-icon://decline",
          type: "Reject",   // red (standard SAP "negative" button style)
          tooltip: oBundle.getText("close"),
          press: function () {
            oDialog.close();
          }
        })
      }),
      initialFocus: oText,   // cursor in the comment field, not on the "X"
      contentWidth: "36rem",
      resizable: true,
      draggable: true,
      content: new VBox({
        items: [new Label({ text: oBundle.getText("approverNoteLabel"), labelFor: oText }), oText]
      }).addStyleClass("sapUiSmallMargin"),
      // only one button (Send); "X" in the header or Esc closes the pop-up without starting anything
      beginButton: new Button({
        text: oBundle.getText("send"),
        type: "Emphasized",
        press: function () {
          oDialog.setBusy(true);
          oExtensionAPI.editFlow.invokeAction("PaymentRequestService.startWorkflow", {
            contexts: oContext,
            label: oBundle.getText("startWorkflow"),
            parameterValues: [{ name: "note", value: oText.getValue().trim() }],
            skipParameterDialog: true
          }).then(function () {
            oDialog.close();
            MessageBox.success(oBundle.getText("workflowStartedMessage", [sRef]), {
              title: oBundle.getText("workflowStartedTitle")
            });
          }).catch(function () {
            // error already shown by Fiori elements; keep the pop-up and the typed comment
            oDialog.setBusy(false);
          });
        }
      }),
      afterClose: function () {
        oDialog.destroy();
      }
    });
    oExtensionAPI.addDependent(oDialog);
    oDialog.open();
  }
});
