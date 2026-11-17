import { createCustomEqual } from "fast-equals";

// YAML retention compares data, not property descriptors. Preserve constructor
// distinctions, cycles, NaN and signed zero without depending on node:util.
const equal = createCustomEqual({
  circular: true,
  createInternalComparator: (compare) => (left, right, _keyA, _keyB, _parentA, _parentB, state) =>
    typeof left === "number" && typeof right === "number"
      ? Object.is(left, right)
      : compare(left, right, state),
});

/** Compare supported YAML data for deciding whether an original raw block can be retained. */
export function equalData(left, right) {
  return typeof left === "number" && typeof right === "number"
    ? Object.is(left, right)
    : equal(left, right);
}
