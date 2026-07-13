import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type TransferStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'INFLIGHT' | 'COMMITTED' | 'VOIDED' | 'FAILED';
export type TransferType = 'P2P' | 'DEPOSIT';

// pg returns bigint as string; kobo amounts stay far below 2^53
export const bigintTransformer = {
  to: (v: number) => v,
  from: (v: string | number) => Number(v),
};

@Entity('transfers')
@Index(['fromCustomerId', 'createdAt'])
@Index(['fromAccountId', 'createdAt'])
@Index(['toAccountId', 'createdAt'])
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  type: TransferType;

  @Column({ name: 'from_account_id', type: 'uuid', nullable: true })
  fromAccountId: string | null;

  @Column({ name: 'to_account_id', type: 'uuid' })
  toAccountId: string;

  @Column({ name: 'from_customer_id', type: 'uuid', nullable: true })
  fromCustomerId: string | null;

  @Column({ name: 'to_customer_id', type: 'uuid' })
  toCustomerId: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ type: 'text', default: 'NGN' })
  currency: string;

  @Column({ type: 'text', default: 'PENDING' })
  status: TransferStatus;

  @Column({ name: 'blnk_transaction_id', type: 'text', nullable: true })
  blnkTransactionId: string | null;

  @Column({ type: 'text', nullable: true })
  narration: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
