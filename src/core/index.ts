/**
 * @papergiant/feedback/core — the feedback/v1 schema, validation,
 * neutralisation and ticket renderer (task P2).
 *
 * This module must never touch the DOM, network or filesystem at import
 * time; every export here is a pure function or a constant.
 */

/** The feedback ticket schema version this package currently renders. */
export const SCHEMA = 'feedback/v1' as const;

export type {
  FeedbackClient,
  FeedbackHostConfig,
  FeedbackIdentity,
  FeedbackKind,
  FeedbackPayload,
  ValidatedFeedbackPayload,
} from './types.js';
export { assertHostAreas } from './types.js';

export { KINDS, LIMITS } from './constants.js';

export type {
  ValidatePayloadOptions,
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
} from './validate.js';
export { validatePayload } from './validate.js';

export { neutralise } from './neutralise.js';
export { fence } from './fence.js';

export type { RenderTicketOptions, Ticket } from './ticket.js';
export { FeedbackTicketTooLargeError, MAX_BODY_LENGTH, renderTicket } from './ticket.js';

export type { FeedbackResponse, NotSentCode } from './response.js';
export { NOT_SENT_CODES, parseFeedbackResponse } from './response.js';
