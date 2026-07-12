import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AccountStatus = 'PENDING' | 'ACTIVE' | 'FROZEN' | 'CLOSED';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'blnk_balance_id', type: 'text', unique: true, nullable: true })
  blnkBalanceId: string | null;

  @Column({ name: 'ledger_key', type: 'text', default: 'CUSTOMER_MAIN' })
  ledgerKey: string;

  @Column({ name: 'virtual_account_number', type: 'char', length: 10, unique: true })
  virtualAccountNumber: string;

  @Column({ type: 'text', default: 'NGN' })
  currency: string;

  @Column({ name: 'account_type', type: 'text', default: 'MAIN' })
  accountType: string;

  @Column({ type: 'text', default: 'PENDING' })
  status: AccountStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
