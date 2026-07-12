// pushto.keys — read-only ops.

import type { HttpClient } from '../lib/http-client';
import { unwrapData } from '../lib/response';

export interface TenantKeyView {
  role: 'admin' | 'sdk' | 'sending';
  start: string;
  createdAt: string;
  enabled: boolean;
  lastVerifiedAt?: string;
}

export class Keys {
  constructor(private readonly client: HttpClient) {}

  /** `GET /keys` — masked Unkey metadata for this tenant's keys. Never `keyId`/plaintext. */
  async list(): Promise<TenantKeyView[]> {
    const { json } = await this.client.request<{ data: TenantKeyView[] }>('GET', '/keys');
    return unwrapData<TenantKeyView[]>(json);
  }
}
