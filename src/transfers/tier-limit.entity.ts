import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from './transfer.entity';

@Entity('tier_limits')
export class TierLimit {
  @PrimaryColumn({ name: 'kyc_tier', type: 'int' })
  kycTier: number;

  @Column({ name: 'max_per_transaction', type: 'bigint', transformer: bigintTransformer })
  maxPerTransaction: number;

  @Column({ name: 'daily_outflow', type: 'bigint', transformer: bigintTransformer })
  dailyOutflow: number;

  @Column({ name: 'weekly_outflow', type: 'bigint', transformer: bigintTransformer })
  weeklyOutflow: number;

  @Column({ name: 'monthly_outflow', type: 'bigint', transformer: bigintTransformer })
  monthlyOutflow: number;
}
