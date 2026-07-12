// Public barrel for @push-to/node.

export { PushTo } from './lib/pushto';
export type { PushToClientOptions } from './lib/http-client';

export {
  PushToError,
  InvalidTokenError,
  InsufficientPermissionsError,
  NotFoundError,
  ValidationError,
  InvalidIdempotencyKeyError,
  IdempotencyConflictError,
  MonthlyQuotaExceededError,
  RateLimitError,
  GatewayTimeoutError,
} from './lib/errors';
export type { PushToErrorDetail, PushToErrorOptions } from './lib/errors';

export type {
  PageParams,
  PageResult,
  IdempotencyOptions,
  RateLimitInfo,
  PushToWarning,
  SendResult,
  BatchItemResult,
  BatchResult,
  TargetSelector,
  Target,
  InlineCopy,
  TemplateRef,
  NotificationContent,
  Override,
  TopicDefaultSubscription,
  TopicState,
  ContactPropertyValueType,
  ContactPropertyValue,
  WebhookEventType,
  WebhookStatus,
  EventStatus,
  StatusHistogram,
  SendStats,
} from './lib/types';

export { Notifications } from './resources/notifications';
export type {
  NotificationTarget,
  SendNotificationInput,
  NotificationSendData,
  NotificationListItem,
} from './resources/notifications';

export { Broadcasts } from './resources/broadcasts';
export type {
  BroadcastSendInput,
  CreateBroadcastInput,
  BroadcastSendData,
  BroadcastCreateData,
  BroadcastListItem,
} from './resources/broadcasts';

export { BroadcastPresets } from './resources/broadcast-presets';
export type {
  BroadcastDefinition,
  CreatePresetInput,
  UpdatePresetInput,
  BroadcastPreset,
} from './resources/broadcast-presets';

export { Contacts } from './resources/contacts';
export type {
  Contact,
  ContactTopicSummary,
  ContactWithSummary,
  UpsertContactInput,
  PatchContactInput,
} from './resources/contacts';

export { ContactProperties } from './resources/contact-properties';
export type {
  ContactPropertyDefinition,
  CreateContactPropertyDefinitionInput,
  UpdateContactPropertyDefinitionInput,
} from './resources/contact-properties';

export { Audiences } from './resources/audiences';
export type {
  Audience,
  CreateAudienceInput,
  UpdateAudienceInput,
  AudienceUserLink,
  AudienceBatchLinkResult,
} from './resources/audiences';

export { Topics } from './resources/topics';
export type { Topic, CreateTopicInput, UpdateTopicInput } from './resources/topics';

export { Templates } from './resources/templates';
export type { Template, CreateTemplateInput, UpdateTemplateInput } from './resources/templates';

export { Webhooks } from './resources/webhooks';
export type {
  Webhook,
  WebhookWithSecret,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
} from './resources/webhooks';

export { Accounts } from './resources/accounts';
export type { CreateAccountInput, CreateAccountResult } from './resources/accounts';

export { Subscriptions } from './resources/subscriptions';
export type { SubscriptionListItem } from './resources/subscriptions';

export { Keys } from './resources/keys';
export type { TenantKeyView } from './resources/keys';

export { VapidKeys } from './resources/vapid-keys';
export type { VapidPublicKey } from './resources/vapid-keys';
