import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1751000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        external_user_id text NOT NULL UNIQUE,
        blnk_identity_id text UNIQUE,
        first_name text NOT NULL,
        last_name text NOT NULL,
        email text NOT NULL,
        phone_number text NOT NULL,
        date_of_birth date NOT NULL,
        kyc_tier int NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'PENDING',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES customers(id),
        blnk_balance_id text UNIQUE,
        ledger_key text NOT NULL DEFAULT 'CUSTOMER_MAIN',
        virtual_account_number char(10) NOT NULL UNIQUE,
        currency text NOT NULL DEFAULT 'NGN',
        account_type text NOT NULL DEFAULT 'MAIN',
        status text NOT NULL DEFAULT 'PENDING',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_accounts_customer_id ON accounts(customer_id)`);
    await q.query(`
      CREATE TABLE idempotency_keys (
        key text PRIMARY KEY,
        endpoint text NOT NULL,
        request_hash text NOT NULL,
        response_status int,
        response_body jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE ledger_config (
        ledger_key text PRIMARY KEY,
        blnk_ledger_id text NOT NULL,
        name text NOT NULL,
        currency text NOT NULL
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE ledger_config`);
    await q.query(`DROP TABLE idempotency_keys`);
    await q.query(`DROP TABLE accounts`);
    await q.query(`DROP TABLE customers`);
  }
}
