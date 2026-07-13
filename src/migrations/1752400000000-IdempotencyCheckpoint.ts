import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdempotencyCheckpoint1752400000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE idempotency_keys ADD COLUMN checkpoint jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE idempotency_keys DROP COLUMN checkpoint`);
  }
}
