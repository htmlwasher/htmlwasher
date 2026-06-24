// htmlwasher — TypeScript port of Trafilatura with page-type-aware
// extraction and an ONNX page-type classifier.
//
// SCAFFOLD ONLY — no extraction, classifier, or training logic lives here yet.
// The implementation is built in phases per the build brief at
// @/prompts/2026-6-24-init/prompt.md (start with Phase 1 onward).
//
// TODO(@/prompts/2026-6-24-init/prompt.md Phase 1+): implement the public
// extract() entry point, the PageTypeClassifier interface, the per-page-type
// profiles, and confidence reporting. See SPEC.md for the intended API surface.

/**
 * Package version. Placeholder export so the scaffold builds and exposes a
 * stable identifier before the port lands.
 */
export const VERSION = "0.0.0-alpha.0";
