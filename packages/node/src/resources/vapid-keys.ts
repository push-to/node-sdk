// pushto.vapidKeys — included for completeness; primarily a browser concern.

import type { HttpClient } from '../lib/http-client';

export interface VapidPublicKey {
  publicVapidKey: string;
}

export class VapidKeys {
  constructor(private readonly client: HttpClient) {}

  /**
   * `GET /vapid-keys` — one of the two documented carve-outs from the
   * standard envelope: the response is the BARE `{ publicVapidKey }`, not
   * wrapped in `{ data }` (Response Envelope doc). Do not add a `.data`
   * unwrap here.
   */
  async getPublic(): Promise<VapidPublicKey> {
    const { json } = await this.client.request<VapidPublicKey>('GET', '/vapid-keys');
    return json;
  }
}
