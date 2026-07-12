// The PushTo client: constructs the internal HttpClient and wires up every
// resource namespace (Contract §2-§3).

import { HttpClient, type PushToClientOptions } from './http-client';
import { Accounts } from '../resources/accounts';
import { Audiences } from '../resources/audiences';
import { Broadcasts } from '../resources/broadcasts';
import { Contacts } from '../resources/contacts';
import { Keys } from '../resources/keys';
import { Notifications } from '../resources/notifications';
import { Subscriptions } from '../resources/subscriptions';
import { Templates } from '../resources/templates';
import { Topics } from '../resources/topics';
import { VapidKeys } from '../resources/vapid-keys';
import { Webhooks } from '../resources/webhooks';

export type { PushToClientOptions };

export class PushTo {
  readonly notifications: Notifications;
  readonly broadcasts: Broadcasts;
  readonly contacts: Contacts;
  readonly audiences: Audiences;
  readonly topics: Topics;
  readonly templates: Templates;
  readonly webhooks: Webhooks;
  readonly accounts: Accounts;
  readonly subscriptions: Subscriptions;
  readonly keys: Keys;
  readonly vapidKeys: VapidKeys;

  /**
   * @param apiKey - Sent as `Authorization: Bearer <apiKey>`. The SDK never
   *   inspects the key tier — the edge enforces admin/`sending`/`reseller`
   *   and returns `InsufficientPermissionsError` (403) when a route requires
   *   more than the key carries.
   * @param options - See {@link PushToClientOptions}.
   */
  constructor(apiKey: string, options: PushToClientOptions = {}) {
    const client = new HttpClient(apiKey, options);

    this.notifications = new Notifications(client);
    this.broadcasts = new Broadcasts(client);
    this.contacts = new Contacts(client);
    this.audiences = new Audiences(client);
    this.topics = new Topics(client);
    this.templates = new Templates(client);
    this.webhooks = new Webhooks(client);
    this.accounts = new Accounts(client);
    this.subscriptions = new Subscriptions(client);
    this.keys = new Keys(client);
    this.vapidKeys = new VapidKeys(client);
  }
}
