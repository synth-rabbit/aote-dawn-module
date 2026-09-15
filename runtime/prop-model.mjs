/** A placeable object. It has no Challenge rating, Limits or vehicle mechanics. */
export default class PropModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    return {
      description: new f.StringField({required: true, blank: true, initial: ""}),
      editMode: new f.BooleanField({initial: false}),
      // Mist Engine's scene display can inspect these on any Actor.
      floatingTagsAndStatuses: new f.ArrayField(new f.ObjectField(), {initial: []}),
    };
  }

  toPlainObject() { return this.toObject(); }
}
