import type { WorkingModel } from "./model";

/**
 * Serialize the full working model (including phase, sections, objections,
 * readinessHistory) to a JSON string.
 */
export function serialize(model: WorkingModel): string {
  return JSON.stringify(model);
}

/**
 * Deserialize a previously serialized working model.
 * Round-trip guarantee: deserialize(serialize(m)) deep-equals m.
 */
export function deserialize(text: string): WorkingModel {
  return JSON.parse(text) as WorkingModel;
}
