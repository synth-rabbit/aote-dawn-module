import PropModel from "./prop-model.mjs";

export class PropSheet extends foundry.appv1.sheets.ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aote-prop"], width: 480, height: 560,
      template: "modules/aote-dawn/runtime/prop-sheet.hbs",
    });
  }

  async getData(options) {
    const data = await super.getData(options);
    data.system = this.actor.system;
    return data;
  }

  async _updateObject(event, formData) {
    // A new picture also updates the default token while those pictures match.
    // Deliberately customized token art stays under the Narrator's control.
    if (formData.img && this.actor.prototypeToken.texture.src === this.actor.img) {
      formData["prototypeToken.texture.src"] = formData.img;
    }
    return super._updateObject(event, formData);
  }
}

Hooks.once("init", () => {
  CONFIG.Actor.dataModels["aote-dawn.prop"] = PropModel;
  foundry.documents.collections.Actors.registerSheet("aote-dawn", PropSheet, {
    types: ["aote-dawn.prop"], makeDefault: true, label: "AOTE.PropSheet",
  });
});
