/**
 * The door proof, re-exported beside the affordance registry it proves.
 *
 * The one implementation lives at `../gates/doors` — this file adds no
 * logic of its own. It exists because the registry (`./affordances`) and
 * its checks read the proof from here, next to what it proves, while the
 * gate's own render code reads the same functions from `../gates/doors`.
 * One definition, two import paths a reader might reasonably reach for.
 */
export {
  missingDoors,
  missingPages,
  verifiedDoors,
  builtSurfaceText,
  type Door,
} from "../gates/doors";
