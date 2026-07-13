import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { Transfer } from './transfer.entity';
import { TierLimit } from './tier-limit.entity';
import { AppError } from '../common/errors';

const COUNTED_STATUSES = ['PENDING', 'APPLIED', 'INFLIGHT', 'COMMITTED'];

const WINDOWS = [
  { window: 'daily', ms: 24 * 3600_000, field: 'dailyOutflow' },
  { window: 'weekly', ms: 7 * 24 * 3600_000, field: 'weeklyOutflow' },
  { window: 'monthly', ms: 30 * 24 * 3600_000, field: 'monthlyOutflow' },
] as const;

@Injectable()
export class LimitsService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(TierLimit)
    private readonly tierRepo: Repository<TierLimit>,
  ) {}

  async assertWithinLimits(customerId: string, kycTier: number, amount: number): Promise<void> {
    const limits = await this.tierRepo.findOneBy({ kycTier });
    if (!limits) throw new AppError('INTERNAL', `No tier_limits row for tier ${kycTier}`, 500);

    if (amount > limits.maxPerTransaction) {
      throw new AppError('LIMIT_EXCEEDED', 'Amount exceeds the per-transaction limit for this KYC tier', 422, {
        window: 'per_transaction', limit: limits.maxPerTransaction, used: 0, attempted: amount,
      });
    }

    for (const w of WINDOWS) {
      const used = Number(
        (await this.transferRepo.sum('amount', {
          fromCustomerId: customerId,
          type: 'P2P',
          status: In(COUNTED_STATUSES),
          createdAt: MoreThanOrEqual(new Date(Date.now() - w.ms)),
        })) ?? 0,
      );
      if (used + amount > limits[w.field]) {
        throw new AppError('LIMIT_EXCEEDED', `Amount exceeds the ${w.window} outflow limit for this KYC tier`, 422, {
          window: w.window, limit: limits[w.field], used, attempted: amount,
        });
      }
    }
  }
}
