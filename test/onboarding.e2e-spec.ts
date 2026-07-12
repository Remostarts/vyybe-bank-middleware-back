import request from 'supertest';
import { randomUUID } from 'node:crypto';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.E2E_API_KEY ?? 'dev-key-user-service';

function api() {
  return request(BASE);
}

describe('onboarding e2e (requires docker compose stack)', () => {
  const externalUserId = `e2e-${randomUUID()}`;
  const idemKey = randomUUID();
  const payload = {
    externalUserId,
    firstName: 'Ada',
    lastName: 'Obi',
    email: `${externalUserId}@example.com`,
    phoneNumber: '+2348012345678',
    dateOfBirth: '2004-01-01',
  };
  let customerId: string;
  let van: string;

  it('rejects requests without an api key', async () => {
    await api().post('/v1/customers').send(payload).expect(401);
  });

  it('onboards a customer end-to-end', async () => {
    const res = await api()
      .post('/v1/customers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idemKey)
      .send(payload)
      .expect(201);
    expect(res.body.customer.status).toBe('ACTIVE');
    expect(res.body.customer.blnkIdentityId).toMatch(/^idt_/);
    expect(res.body.account.blnkBalanceId).toMatch(/^bln_/);
    expect(res.body.account.virtualAccountNumber).toMatch(/^\d{10}$/);
    customerId = res.body.customer.id;
    van = res.body.account.virtualAccountNumber;
  });

  it('replays the identical response for the same Idempotency-Key', async () => {
    const res = await api()
      .post('/v1/customers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idemKey)
      .send(payload)
      .expect(201);
    expect(res.body.customer.id).toBe(customerId);
  });

  it('409s the same Idempotency-Key with a different payload', async () => {
    const res = await api()
      .post('/v1/customers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', idemKey)
      .send({ ...payload, firstName: 'Changed' })
      .expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('409s a duplicate external user with a fresh key', async () => {
    const res = await api()
      .post('/v1/customers')
      .set('x-api-key', API_KEY)
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(409);
    expect(res.body.error.code).toBe('CUSTOMER_ALREADY_EXISTS');
  });

  it('looks the customer up by external id', async () => {
    const res = await api()
      .get(`/v1/customers/by-external-id/${externalUserId}`)
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(res.body.customer.id).toBe(customerId);
    expect(res.body.accounts).toHaveLength(1);
  });

  it('reads the account by VAN with a zero live balance', async () => {
    const res = await api().get(`/v1/accounts/by-account-number/${van}`).set('x-api-key', API_KEY).expect(200);
    expect(res.body.balance).toMatchObject({ available: 0, currency: 'NGN', precision: 100 });
  });

  it('sets the KYC tier', async () => {
    const res = await api()
      .patch(`/v1/customers/${customerId}/kyc-tier`)
      .set('x-api-key', API_KEY)
      .send({ kycTier: 2 })
      .expect(200);
    expect(res.body.kycTier).toBe(2);
  });
});
