import { ConfigService } from '@nestjs/config';
import { BlnkClient } from './blnk.client';
import { AppError } from '../common/errors';

const config = {
  get: (key: string) => ({ blnkBaseUrl: 'http://blnk.test:5001', blnkApiKey: 'k' })[key as 'blnkBaseUrl' | 'blnkApiKey'],
} as unknown as ConfigService;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('BlnkClient', () => {
  let fetchMock: jest.Mock;
  let client: BlnkClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new BlnkClient(config);
  });

  it('POSTs identities with X-blnk-key and returns the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { identity_id: 'idt_1' }));
    const identity = await client.createIdentity({
      identity_type: 'individual',
      first_name: 'Ada',
      last_name: 'Obi',
      email_address: 'ada@x.com',
      phone_number: '+2348000000',
      dob: '2004-01-01',
    });
    expect(identity.identity_id).toBe('idt_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://blnk.test:5001/identities');
    expect(init.method).toBe('POST');
    expect(init.headers['X-blnk-key']).toBe('k');
  });

  it('maps 5xx to BLNK_UNAVAILABLE without retrying a write', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(client.createLedger('L')).rejects.toMatchObject({ code: 'BLNK_UNAVAILABLE', status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 4xx to BLNK_REQUEST_REJECTED with details', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'bad currency' }));
    await expect(client.createBalance('ldg_1', 'idt_1', 'XXX')).rejects.toMatchObject({
      code: 'BLNK_REQUEST_REJECTED',
      status: 422,
    });
  });

  it('does not retry a failed write on network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.createLedger('L')).rejects.toMatchObject({ code: 'BLNK_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries GETs up to 2 extra times on network error, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        jsonResponse(200, { balance_id: 'bln_1', balance: 0, credit_balance: 0, debit_balance: 0, currency: 'NGN', ledger_id: 'ldg_1' }),
      );
    const balance = await client.getBalance('bln_1');
    expect(balance.balance_id).toBe('bln_1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after exhausting GET retries', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.getBalance('bln_1')).rejects.toMatchObject({ code: 'BLNK_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ping resolves on any HTTP response and rejects on network failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 404 }));
    await expect(client.ping()).resolves.toBeUndefined();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.ping()).rejects.toBeInstanceOf(AppError);
  });
});
