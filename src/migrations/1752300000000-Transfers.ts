import { MigrationInterface, QueryRunner } from 'typeorm';

export class Transfers1752300000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE transfers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL,
        from_account_id uuid REFERENCES accounts(id),
        to_account_id uuid NOT NULL REFERENCES accounts(id),
        from_customer_id uuid,
        to_customer_id uuid NOT NULL,
        amount bigint NOT NULL CHECK (amount > 0),
        currency text NOT NULL DEFAULT 'NGN',
        status text NOT NULL DEFAULT 'PENDING',
        blnk_transaction_id text,
        narration text,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_transfers_from_customer_created ON transfers(from_customer_id, created_at)`);
    await q.query(`CREATE INDEX idx_transfers_from_account_created ON transfers(from_account_id, created_at)`);
    await q.query(`CREATE INDEX idx_transfers_to_account_created ON transfers(to_account_id, created_at)`);
    await q.query(`
      CREATE TABLE tier_limits (
        kyc_tier int PRIMARY KEY,
        max_per_transaction bigint NOT NULL,
        daily_outflow bigint NOT NULL,
        weekly_outflow bigint NOT NULL,
        monthly_outflow bigint NOT NULL
      )`);
    // kobo: tier 0 = ₦5k/tx, ₦20k/day; weekly = 5× daily; monthly = 20× daily
    await q.query(`
      INSERT INTO tier_limits (kyc_tier, max_per_transaction, daily_outflow, weekly_outflow, monthly_outflow) VALUES
        (0, 500000, 2000000, 10000000, 40000000),
        (1, 5000000, 20000000, 100000000, 400000000),
        (2, 50000000, 200000000, 1000000000, 4000000000),
        (3, 500000000, 2000000000, 10000000000, 40000000000)`);
    await q.query(`
      CREATE TABLE internal_accounts (
        key text PRIMARY KEY,
        blnk_balance_id text NOT NULL,
        ledger_key text NOT NULL,
        currency text NOT NULL
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE internal_accounts`);
    await q.query(`DROP TABLE tier_limits`);
    await q.query(`DROP TABLE transfers`);
  }
}
