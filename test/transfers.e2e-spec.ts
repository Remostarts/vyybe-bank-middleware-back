import request from 'supertest';
import { randomUUID } from 'node:crypto';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.E2E_API_KEY ?? 'dev-key-user-service';

const api = () => request(BASE);
const idem = () => randomUUID();

async function onboard(tag: string) {
  const res = await api()
    .post('/v1/customers')
    .set('x-api-key', API_KEY)
    .set('Idempotency-Key', idem())
    .send({
      externalUserId: `tr-${tag}-${randomUUID()}`,
      firstName: 'Test', lastName: tag, email: `tr-${tag}-${randomUUID()}@example.com`,
      phoneNumber: '+2348000000000', dateOfBirth: '2000-01-01',
    })
    .expect(201);
  return res.body as { customer: { id: string }; account: { id: string; virtualAccountNumber: string } };
}

async function balanceOf(accountId: string): Promise<number> {
  const res = await api().get(`/v1/accounts/${accountId}`).set('x-api-key', API_KEY).expect(200);
  return res.body.balance.available;
}

// Blnk applies commit/void effects asynchronously via its worker, so the settled
// balance can briefly lag right after a 200 response. Poll instead of sleeping.
async function pollBalance(accountId: string, expected: number, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = await balanceOf(accountId);
  while (last !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    last = await balanceOf(accountId);
  }
  return last;
}

describe('transfers e2e (requires docker compose stack)', () => {
  let a: Awaited<ReturnType<typeof onboard>>;
  let b: Awaited<ReturnType<typeof onboard>>;

  beforeAll(async () => {
    a = await onboard('alice');
    b = await onboard('bob');
  });

  it('deposits fund an account via suspense', async () => {
    const res = await api()
      .post('/v1/deposits')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ toAccountNumber: a.account.virtualAccountNumber, amount: 300000, narration: 'seed' })
      .expect(201);
    expect(res.body.type).toBe('DEPOSIT');
    expect(res.body.status).toBe('APPLIED');
    expect(await balanceOf(a.account.id)).toBe(300000);
  });

  it('P2P transfer moves both balances and replays idempotently', async () => {
    const key = idem();
    const res = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', key)
      .send({ fromAccountId: a.account.id, toAccountId: b.account.id, amount: 50000, narration: 'lunch 🍕' })
      .expect(201);
    expect(res.body.status).toBe('APPLIED');
    expect(await balanceOf(a.account.id)).toBe(250000);
    expect(await balanceOf(b.account.id)).toBe(50000);

    const replay = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', key)
      .send({ fromAccountId: a.account.id, toAccountId: b.account.id, amount: 50000, narration: 'lunch 🍕' })
      .expect(201);
    expect(replay.body.id).toBe(res.body.id);
    expect(await balanceOf(a.account.id)).toBe(250000); // no double spend
  });

  it('history shows IN/OUT with counterparties', async () => {
    const res = await api().get(`/v1/accounts/${a.account.id}/transactions`).set('x-api-key', API_KEY).expect(200);
    const directions = res.body.items.map((i: { direction: string }) => i.direction);
    expect(directions).toContain('IN');   // deposit
    expect(directions).toContain('OUT');  // transfer to b
    const out = res.body.items.find((i: { direction: string }) => i.direction === 'OUT');
    expect(out.counterparty.accountNumber).toBe(b.account.virtualAccountNumber);
    const dep = res.body.items.find((i: { direction: string; counterparty: unknown }) => i.counterparty === null);
    expect(dep.direction).toBe('IN'); // deposits have no counterparty
  });

  it('rejects insufficient funds within tier limits', async () => {
    // b holds 50,000 kobo; 400,000 is within tier-0 per-tx (500,000) but over balance
    const res = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ fromAccountId: b.account.id, toAccountId: a.account.id, amount: 400000 })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('rejects an over-limit transfer (tier 0 per-transaction)', async () => {
    const res = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ fromAccountId: a.account.id, toAccountId: b.account.id, amount: 600000 })
      .expect(422);
    expect(res.body.error.code).toBe('LIMIT_EXCEEDED');
    expect(res.body.error.details.window).toBe('per_transaction');
  });

  it('rejects same-account transfers', async () => {
    await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ fromAccountId: a.account.id, toAccountId: a.account.id, amount: 1000 })
      .expect(400);
  });

  it('hold → commit settles the funds', async () => {
    const hold = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ fromAccountId: a.account.id, toAccountId: b.account.id, amount: 20000, hold: true })
      .expect(201);
    expect(hold.body.status).toBe('INFLIGHT');
    expect(await balanceOf(a.account.id)).toBe(250000); // settled balance unchanged during hold

    const committed = await api()
      .post(`/v1/transfers/${hold.body.id}/commit`)
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .expect(200);
    expect(committed.body.status).toBe('COMMITTED');
    expect(await pollBalance(a.account.id, 230000)).toBe(230000);
    expect(await pollBalance(b.account.id, 70000)).toBe(70000);
  });

  it('hold → void releases the funds', async () => {
    const hold = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ fromAccountId: a.account.id, toAccountId: b.account.id, amount: 20000, hold: true })
      .expect(201);
    await api()
      .post(`/v1/transfers/${hold.body.id}/void`)
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .expect(200);
    expect(await pollBalance(a.account.id, 230000)).toBe(230000); // unchanged
    const after = await api().get(`/v1/transfers/${hold.body.id}`).set('x-api-key', API_KEY).expect(200);
    expect(after.body.status).toBe('VOIDED');
  });

  it('double-commit is rejected with INVALID_TRANSFER_STATE', async () => {
    const hold = await api()
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .send({ fromAccountId: a.account.id, toAccountId: b.account.id, amount: 1000, hold: true })
      .expect(201);
    await api().post(`/v1/transfers/${hold.body.id}/commit`).set('x-api-key', API_KEY).set('Idempotency-Key', idem()).expect(200);
    const again = await api()
      .post(`/v1/transfers/${hold.body.id}/commit`)
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idem())
      .expect(409);
    expect(again.body.error.code).toBe('INVALID_TRANSFER_STATE');
  });
});
