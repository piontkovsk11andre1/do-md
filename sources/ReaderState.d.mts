import type {
  CursorSnapshot,
  SlotMetadata,
  RegionMetadata,
  QueryRegionMetadata,
} from "./types.d.mts";
import type { BindingMode } from "./RuntimeContracts.d.mts";
import type { IterationState } from "./Reader/IterationState.mjs";
import type { DoMdError } from "./DoMdError.mjs";
export interface ReaderState<T> {
  cursor: CursorSnapshot;
  optionalMode: boolean;
  errors: DoMdError[];
  context: T;
  bindings: Map<string, BindingMode>;
  slotMap: SlotMetadata[];
  regionMap: RegionMetadata[];
  queryMap: QueryRegionMetadata[];
  matchedBinds: number;
  usedAsArray: boolean;
  iteration: IterationState;
}
