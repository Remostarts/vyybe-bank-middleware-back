import { Repository } from 'typeorm';
import { LimitsService } from './limits.service';
import { Transfer } from './transfer.entity';
import { TierLimit } from './tier-limit.entity';

const tier0: TierLimit = { kycTier: 0, maxPerTransaction: 500000, dailyOutflow: 2000000, weeklyOutflow: 10000000, monthlyOutflow: 40000000 };

function makeService(usedPerWindow: number, tier: TierLimit | null = tier0) {
  const tierRepo = { findOneBy: jest.fn().mockResolvedValue(tier) } as unknown as Repository<TierLimit>;
  const transferRepo = { sum: jest.fn().mockResolvedValue(usedPerWindow) } as unknown as Repository<Transfer> & { sum: jest.Mock };
  return { svc: new LimitsService(transferRepo, tierRepo), transferRepo };
}

describe('LimitsService.assertWithinLimits', () => {
  it('passes when amount is within every limit', async () => {
    const { svc } = makeService(0);
    await expect(svc.assertWithinLimits('cus-1', 0, 100000)).resolves.toBeUndefined();
  });

  it('rejects an amount above max_per_transaction before querying windows', async () => {
    const { svc, transferRepo } = makeService(0);
    await expect(svc.assertWithinLimits('cus-1', 0, 500001)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED', status: 422, details: expect.objectContaining({ window: 'per_transaction', limit: 500000 }),
    });
    expect(transferRepo.sum).not.toHaveBeenCalled();
  });

  it('rejects when a window is exhausted, naming the window', async () => {
    const { svc } = makeService(1900000); // daily used 19,000 NGN of 20,000
    await expect(svc.assertWithinLimits('cus-1', 0, 200000)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED', details: expect.objectContaining({ window: 'daily', used: 1900000, attempted: 200000 }),
    });
  });

  it('treats a null sum (no transfers) as zero', async () => {
    const tierRepo = { findOneBy: jest.fn().mockResolvedValue(tier0) } as unknown as Repository<TierLimit>;
    const transferRepo = { sum: jest.fn().mockResolvedValue(null) } as unknown as Repository<Transfer>;
    const svc = new LimitsService(transferRepo, tierRepo);
    await expect(svc.assertWithinLimits('cus-1', 0, 500000)).resolves.toBeUndefined();
  });

  it('queries only counted statuses and P2P type', async () => {
    const { svc, transferRepo } = makeService(0);
    await svc.assertWithinLimits('cus-1', 0, 1000);
    const where = transferRepo.sum.mock.calls[0][1];
    expect(where.type).toBe('P2P');
    expect(where.fromCustomerId).toBe('cus-1');
  });

  it('fails INTERNAL when the tier row is missing', async () => {
    const { svc } = makeService(0, null);
    await expect(svc.assertWithinLimits('cus-1', 9, 1000)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
