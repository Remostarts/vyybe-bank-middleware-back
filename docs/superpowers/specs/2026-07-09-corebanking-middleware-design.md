# VyyBe Core-Banking Middleware — Design Spec

**Date:** 2026-07-09
**Status:** Approved
**Scope:** First slice — customer onboarding and account creation against a self-hosted Blnk ledger.

## 1. Purpose

An internal middleware service that other VyyBe services call for core-banking operations. It wraps a self-hosted [Blnk](https://docs.blnkfinance.com/) ledger (deployed and managed by us as a separate service) and owns the mapping between VyyBe users and Blnk's financial primitives.

This slice covers:

- Onboarding a customer: create a Blnk identity, create a main account (Blnk balance), assign a virtual account number.
- Looking up customers, accounts, and live balances.
- Setting a customer's KYC tier.

Out of scope for this slice (later iterations): transfers/transactions, savings pots, KYC-tier limit enforcement, webhooks, real NUBAN issuance via a partner.

## 2. Stack & Deployment

- **Framework:** NestJS (TypeScript), REST, OpenAPI docs generated from decorators, served at `/docs`.
- **Database:** PostgreSQL (middleware-owned, separate from Blnk's). TypeORM with explicit migrations (no auto-sync).
- **Blnk:** self-hosted stack (Blnk server :5001 + its Postgres, Redis, Typesense), authenticated with the `X-blnk-key` header.
- **Local/dev:** one `docker-compose.yml` running the middleware, its Postgres, and the full Blnk stack. Dockerfile for the middleware.

## 3. Architecture

```
other services ──x-api-key──▶ Middleware (NestJS :3000)
                                 │  ├── CustomersModule  (onboarding state machine, lookups)
                                 │  ├── AccountsModule   (accounts, VAN generation, balance reads)
                                 │  ├── BlnkModule       (typed HTTP client — only Blnk touchpoint)
                                 │  ├── AuthModule       (x-api-key guard)
                                 │  ├── HealthModule     (liveness + Blnk readiness)
                                 │  └── Postgres         (mappings, onboarding state, idempotency)
                                 ▼
                              Blnk server (:5001)
```

- **BlnkModule** is the only code that talks to Blnk. Typed client for identities, ledgers, balances; timeouts, bounded retries, and error translation. Other modules depend on its interface, never raw HTTP.
- **CustomersModule** orchestrates onboarding as a resumable state machine (see §6).
- **AccountsModule** creates accounts (main account during onboarding; separate endpoint for additional accounts), generates virtual account numbers, and reads live balances from Blnk.
- At startup the service bootstraps the required Blnk ledger(s) and caches their IDs in `ledger_config`.

## 4. Ledger Structure

Pattern: **few ledgers, one per product line; one Blnk balance per customer account**, each balance linked to the customer's Blnk identity. (Blnk is agnostic; Modern Treasury and general fintech ledger guidance recommend product-line ledgers, reserving discrete ledgers for hard segregation boundaries. Ledger-per-customer was considered and rejected — identities already give per-customer views.)

```
Ledger "Customer Main Accounts" (NGN)   ← created in this slice (bootstrapped at startup)
Ledger "Customer Savings"               ← later (savings pots)
Ledger "Internal Accounts"              ← later (fees/suspense, when transfers land)
```

Ledger IDs live in the `ledger_config` table so adding a ledger later is data, not code.

## 5. Data Model (middleware Postgres)

Blnk is the financial source of truth. The middleware DB stores mappings, onboarding state, and idempotency — never balances.

### `customers`

| column | type / notes |
|---|---|
| `id` | UUID PK — middleware customer ID returned to callers |
| `external_user_id` | unique — the VyyBe user_id from the user service |
| `blnk_identity_id` | unique, nullable until created (`idt_...`) |
| `first_name`, `last_name`, `email`, `phone_number`, `date_of_birth` | passed through to the Blnk identity |
| `kyc_tier` | int, default 0 (Blnk doesn't model tiers) |
| `status` | enum: `PENDING` → `IDENTITY_CREATED` → `ACTIVE`, or `FAILED` |
| `created_at`, `updated_at` | |

### `accounts`

| column | type / notes |
|---|---|
| `id` | UUID PK — middleware account ID |
| `customer_id` | FK → customers |
| `blnk_balance_id` | unique (`bln_...`) |
| `ledger_key` | string enum: `CUSTOMER_MAIN` for now |
| `virtual_account_number` | char(10), unique, NUBAN-style with check digit |
| `currency` | `NGN` |
| `account_type` | `MAIN` (`SAVINGS` later) |
| `status` | `ACTIVE`, `FROZEN`, `CLOSED` |
| `created_at`, `updated_at` | |

### `idempotency_keys`

`key` (PK — caller's `Idempotency-Key` header), `endpoint`, `request_hash`, `response_status`, `response_body` (JSONB), `created_at`. Same key + same payload → replay stored response. Same key + different payload → `409`.

### `ledger_config`

`ledger_key` (PK), `blnk_ledger_id`, `name`, `currency`. Seeded at bootstrap.

## 6. Onboarding Flow (resumable, idempotent)

`POST /v1/customers` runs synchronously:

1. Validate; reject if `external_user_id` already `ACTIVE` (`409`).
2. Upsert customer row, status `PENDING`.
3. Create Blnk identity → store `blnk_identity_id`, status `IDENTITY_CREATED`.
4. Create Blnk balance in the `CUSTOMER_MAIN` ledger, linked to the identity → insert `accounts` row.
5. Generate virtual account number (unique constraint; regenerate on collision, bounded retries).
6. Mark customer `ACTIVE`; store response against the idempotency key; return `201`.

If any step fails, the row keeps its checkpoint status and the API returns `502 ONBOARDING_INCOMPLETE`. A retry with the same `Idempotency-Key` resumes from the checkpoint: existing `blnk_identity_id` → skip step 3; existing account row → skip step 4. No duplicate identities/balances, no orphans. A customer is visible as onboarded only when `ACTIVE`.

## 7. API Contract (v1)

All endpoints require `x-api-key`. Mutating endpoints require `Idempotency-Key`.

| endpoint | behavior |
|---|---|
| `POST /v1/customers` | Onboard: body has `external_user_id`, `first_name`, `last_name`, `email`, `phone_number`, `date_of_birth`, optional `metadata`. Returns `201` with customer + main account (incl. `virtual_account_number`). `409` if already onboarded. |
| `GET /v1/customers/:id` | Customer + accounts, by middleware ID. |
| `GET /v1/customers/by-external-id/:externalUserId` | Same, by VyyBe user ID (primary lookup for other services). |
| `PATCH /v1/customers/:id/kyc-tier` | Set tier 0–3; updates local row and mirrors into Blnk identity metadata. |
| `POST /v1/customers/:id/accounts` | Create an additional account (this slice: `MAIN`-type NGN; body extensible). |
| `GET /v1/accounts/:id` | Account details + live Blnk balance (`balance`, `credit_balance`, `debit_balance`, `inflight_balance` in kobo, `precision: 100`). |
| `GET /v1/accounts/by-account-number/:van` | Same, by virtual account number. |
| `GET /health`, `GET /health/ready` | Liveness; readiness includes a Blnk ping. |

**Money:** always integer minor units (kobo) with `currency` and `precision` alongside. No floats.

**Errors:** uniform shape `{ "error": { "code": "...", "message": "...", "details": {} } }`. Codes include `CUSTOMER_ALREADY_EXISTS`, `CUSTOMER_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `ONBOARDING_INCOMPLETE`, `BLNK_UNAVAILABLE`, `VALIDATION_ERROR`.

## 8. Resilience & Error Handling

- **Blnk client:** 5s timeout per call. Automatic retry (2 attempts, exponential backoff) only for GETs on network errors/timeouts. Writes are never blindly retried at the HTTP layer — retry safety comes from the onboarding state machine.
- **Error translation:** Blnk 4xx → middleware 4xx with translated code; Blnk 5xx/unreachable → `502 BLNK_UNAVAILABLE`. Blnk internals never leak to callers.
- **Virtual account numbers:** 9 digits (configurable prefix + random serial) + NUBAN check digit. DB unique constraint; regenerate on collision with bounded retries. Middleware-only for now; real partner NUBANs later are an additive change.

## 9. Auth & Config

- **Auth:** static API keys per calling service via `x-api-key`, validated against `SERVICE_API_KEYS` (comma-separated `name:key` pairs). Guard applied globally except `/health*` and `/docs`.
- **Env vars (validated at startup, fail-fast):** `DATABASE_URL`, `BLNK_BASE_URL`, `BLNK_API_KEY`, `SERVICE_API_KEYS`, `PORT`, `VAN_PREFIX`.

## 10. Testing

- **Unit:** NUBAN check-digit generator; idempotency logic (replay, payload-mismatch 409); onboarding state-machine transitions with the Blnk client mocked (including resume-from-`IDENTITY_CREATED`).
- **Integration:** full onboarding against a real Blnk instance (docker compose / testcontainers): happy path; resume after induced failure between identity and balance steps; duplicate `external_user_id`; idempotent replay; balance read-through.
- **Contract:** OpenAPI spec generated and served at `/docs`.

## 11. Future Iterations (context, not scope)

P2P transfers (Blnk transactions + inflight), savings pots (`Customer Savings` ledger), KYC-tier limit enforcement, Blnk webhooks for async events, partner-issued NUBANs, Redis cache/rate-limiting if load demands.
