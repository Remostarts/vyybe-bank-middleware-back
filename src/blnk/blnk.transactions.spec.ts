import { ConfigService } from '@nestjs/config';
import { BlnkClient } from './blnk.client';

const config = {
  get: (key: string) => ({ blnkBaseUrl: 'http://blnk.test:5001', blnkApiKey: 'k' })[key as 'blnkBaseUrl' | 'blnkApiKey'],
} as unknown as ConfigService;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('BlnkClient transactions', () => {
  let fetchMock: jest.Mock;
  let client: BlnkClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new BlnkClient(config);
  });

  it('POSTs /transactions with the full body and returns the parsed transaction', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { transaction_id: 'txn_1', status: 'APPLIED', reference: 'ref-1' }));
    const tx = await client.createTransaction({
      precise_amount: 25000, currency: 'NGN', precision: 100, reference: 'ref-1',
      source: 'bln_a', destination: 'bln_b', skip_queue: true,
    });
    expect(tx.transaction_id).toBe('txn_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://blnk.test:5001/transactions');
    expect(JSON.parse(init.body)).toMatchObject({ precise_amount: 25000, reference: 'ref-1', skip_queue: true });
  });

  it('does not retry transaction writes on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      client.createTransaction({ precise_amount: 1, currency: 'NGN', precision: 100, reference: 'r', source: 's', destination: 'd' }),
    ).rejects.toMatchObject({ code: 'BLNK_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('PUTs inflight status to /transactions/inflight/:txID', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { transaction_id: 'txn_1', status: 'APPLIED', reference: 'ref-1' }));
    await client.updateInflight('txn_1', 'commit');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://blnk.test:5001/transactions/inflight/txn_1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ status: 'commit' });
  });

  it('getTransactionByReference returns the transaction when found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { transaction_id: 'txn_1', status: 'APPLIED', reference: 'ref-1' }));
    const tx = await client.getTransactionByReference('ref-1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://blnk.test:5001/transactions/reference/ref-1');
    expect(tx?.transaction_id).toBe('txn_1');
  });

  it('getTransactionByReference returns null on Blnk 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'transaction not found' }));
    await expect(client.getTransactionByReference('missing')).resolves.toBeNull();
  });

  it('createInternalBalance POSTs /balances without an identity_id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { balance_id: 'bln_int', balance: 0, credit_balance: 0, debit_balance: 0, currency: 'NGN', ledger_id: 'ldg_i' }),
    );
    const b = await client.createInternalBalance('ldg_i', 'NGN');
    expect(b.balance_id).toBe('bln_int');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ledger_id: 'ldg_i', currency: 'NGN' });
  });
});
