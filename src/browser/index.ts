/**
 * @papergiant/feedback/browser — the framework-free dialog mount (task
 * P7; design §3 "Dialog", "Host modals", "Form").
 *
 * Importing this module must never touch `document` or `window`; DOM
 * access only happens inside the functions it exports, when a host calls
 * them from a browser context.
 */

export { mountFeedback } from './dialog.js';
export { mountLauncher } from './launcher.js';

export type {
  FeedbackBuild,
  FeedbackController,
  FeedbackCopy,
  FeedbackEvent,
  FeedbackMountOptions,
  FeedbackTheme,
  IsHostModalOpen,
  LauncherHandle,
  MountLauncherOptions,
} from './types.js';

// The pure logic beneath `mountFeedback()`, exported so the unit tests the
// build plan calls for (payload assembly, the delivery state machine, the
// modal-layer decision function) can import and exercise it directly in
// jsdom — none of it touches the DOM at import time, and
// `queryOpenHostModalLayers` simply returns `[]` outside a browser. This is
// not part of the install-contract API in the design (`mountFeedback` and
// `mountLauncher` are); it is exported for testability and for a host that
// wants to build custom UI from the same primitives.
export { detectBrowser, gatherClientFacts, type ClientFacts, type UserAgentDataLike } from './client-facts.js';
export { assembleOutboundPayload, createEmptyDraft, type AssemblePayloadOptions, type FeedbackDraft } from './payload.js';
export {
  resolveDeliveryOutcome,
  nextDuplicateRisk,
  shouldRotateReportId,
  type DeliveryDisplayState,
  type DeliveryOutcome,
} from './delivery.js';
export {
  decideModalPlacement,
  queryOpenHostModalLayers,
  HOST_MODAL_LAYER_SELECTOR,
  HOST_MODAL_LAYER_SELECTOR_FALLBACK,
  type ModalPlacement,
} from './modal-layers.js';
export { DEFAULT_COPY, notSentMessage, resolveCopy } from './copy.js';
export { generateUUID, type RandomSource } from './uuid.js';
export {
  scheduleDeferredScrollRestore,
  type AnimationFrameScheduler,
  type ScrollRestoreHandle,
} from './scroll-restore.js';
