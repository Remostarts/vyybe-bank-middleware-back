import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/errors';
import { BlnkBalance, BlnkIdentity, BlnkLedger, CreateBlnkIdentityRequest } from './blnk.types';

const TIMEOUT_MS = 5_000;
const GET_MAX_ATTEMPTS = 3; // 1 try + 2 retries
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class BlnkClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('blnkBaseUrl') as string;
    this.apiKey = config.get<string>('blnkApiKey') as string;
  }

  createIdentity(req: CreateBlnkIdentityRequest): Promise<BlnkIdentity> {
    return this.request<BlnkIdentity>('POST', '/identities', req);
  }

  updateIdentity(identityId: string, req: CreateBlnkIdentityRequest): Promise<BlnkIdentity> {
    return this.request<BlnkIdentity>('PUT', `/identities/${identityId}`, req);
  }

  createLedger(name: string): Promise<BlnkLedger> {
    return this.request<BlnkLedger>('POST', '/ledgers', { name });
  }

  createBalance(ledgerId: string, identityId: string, currency: string): Promise<BlnkBalance> {
    return this.request<BlnkBalance>('POST', '/balances', {
      ledger_id: ledgerId,
      identity_id: identityId,
      currency,
    });
  }

  getBalance(balanceId: string): Promise<BlnkBalance> {
    return this.request<BlnkBalance>('GET', `/balances/${balanceId}`);
  }

  /** Reachability probe: any HTTP response counts as reachable. */
  async ping(): Promise<void> {
    try {
      await this.fetchOnce('GET', '/');
    } catch {
      throw new AppError('BLNK_UNAVAILABLE', 'Blnk is unreachable', 502);
    }
  }

  private async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const maxAttempts = method === 'GET' ? GET_MAX_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchOnce(method, path, body);
      } catch {
        // network error or timeout — the only case we retry, and only for GETs
        if (attempt < maxAttempts) {
          await sleep(200 * 2 ** (attempt - 1));
          continue;
        }
        throw new AppError('BLNK_UNAVAILABLE', 'Blnk is unreachable', 502);
      }
      if (res.status >= 500) throw new AppError('BLNK_UNAVAILABLE', `Blnk returned ${res.status}`, 502);
      if (res.status >= 400) {
        const text = await res.text();
        throw new AppError('BLNK_REQUEST_REJECTED', `Blnk rejected the request (${res.status})`, 422, {
          blnkStatus: res.status,
          blnkBody: safeParse(text),
        });
      }
      return (await res.json()) as T;
    }
  }

  private async fetchOnce(method: string, path: string, body?: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(this.baseUrl + path, {
        method,
        headers: { 'X-blnk-key': this.apiKey, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}
