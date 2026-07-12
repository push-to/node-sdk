// pushto.accounts — reseller provisioning (Phase 4 Increment D). Requires a
// `reseller` key; an under-scoped key gets a typed `InsufficientPermissionsError` (403).

import type { HttpClient } from '../lib/http-client';
import { unwrapData } from '../lib/response';

export interface CreateAccountInput {
  name?: string;
  email: string;
}

export interface CreateAccountResult {
  customerId: string;
  /** Minted ONCE — Unkey cannot return plaintext after creation. */
  keys: {
    sdkKey: string;
    adminKey: string;
    sendingKey: string;
  };
}

export class Accounts {
  constructor(private readonly client: HttpClient) {}

  /** `POST /v2/accounts` — mints an isolated sub-tenant + key set. */
  async create(input: CreateAccountInput): Promise<CreateAccountResult> {
    const { json } = await this.client.request<{ data: CreateAccountResult }>(
      'POST',
      '/v2/accounts',
      { body: input },
    );
    return unwrapData<CreateAccountResult>(json);
  }
}
