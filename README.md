# VyyBe Core-Banking Middleware

Internal middleware that other VyyBe services call for core-banking operations.
Wraps a self-hosted [Blnk](https://docs.blnkfinance.com/) ledger: customers map to
Blnk identities, accounts map to Blnk balances in the `Customer Main Accounts`
ledger. Blnk is the financial source of truth; this service owns onboarding
state, virtual account numbers, KYC tiers and idempotency.

## Quick start

```bash
docker compose up -d --build          # middleware :3000, Blnk :5001
DATABASE_URL=postgres://vyybe:vyybe@localhost:5434/vyybe_corebanking npm run migration:run
curl -s localhost:3000/health/ready
```

## API

Auth: send `x-api-key`. Mutations also require `Idempotency-Key`.
Interactive docs: http://localhost:3000/docs

| Method | Path | Purpose |
|---|---|---|
| POST | /v1/customers | Onboard: Blnk identity + main NGN account + virtual account number |
| GET | /v1/customers/:id | Customer + accounts |
| GET | /v1/customers/by-external-id/:externalUserId | Same, by VyyBe user id |
| PATCH | /v1/customers/:id/kyc-tier | Set KYC tier 0–3 |
| POST | /v1/customers/:id/accounts | Additional account |
| GET | /v1/accounts/:id | Account + live balance (kobo, precision 100) |
| GET | /v1/accounts/by-account-number/:van | Same, by account number |
| GET | /health, /health/ready | Liveness / readiness |

Failed onboarding returns `502 ONBOARDING_INCOMPLETE`; retry with the SAME
`Idempotency-Key` — the flow resumes from its checkpoint and never duplicates
Blnk records.

## Development

```bash
npm install
npm test                # unit tests (no infra needed)
docker compose up -d    # full stack
npm run test:e2e        # e2e against the running stack
```
