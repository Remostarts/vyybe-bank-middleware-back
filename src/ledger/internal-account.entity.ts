import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('internal_accounts')
export class InternalAccount {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ name: 'blnk_balance_id', type: 'text' })
  blnkBalanceId: string;

  @Column({ name: 'ledger_key', type: 'text' })
  ledgerKey: string;

  @Column({ type: 'text' })
  currency: string;
}
