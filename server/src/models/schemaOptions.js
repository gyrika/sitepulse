// Shapes documents for API responses: `id` instead of `_id`, and internal fields removed.
export function toJsonOptions(hiddenFields = []) {
  return {
    virtuals: false,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      for (const field of hiddenFields) delete ret[field];
      return ret;
    },
  };
}
