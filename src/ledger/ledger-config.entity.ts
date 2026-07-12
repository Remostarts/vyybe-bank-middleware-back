import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('ledger_config')
export class LedgerConfig {
  @PrimaryColumn({ name: 'ledger_key', type: 'text' })
  ledgerKey: string;

  @Column({ name: 'blnk_ledger_id', type: 'text' })
  blnkLedgerId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  currency: string;
}
