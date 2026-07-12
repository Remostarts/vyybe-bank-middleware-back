import { Repository } from 'typeorm';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKey } from './idempotency-key.entity';
import { AppError } from '../common/errors';

function makeRepo(existing: Partial<IdempotencyKey> | null) {
  return {
    findOneBy: jest.fn().mockResolvedValue(existing),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
    update: jest.fn().mockResolvedValue(undefined),
  } as unknown as Repository<IdempotencyKey> & { [k: string]: jest.Mock };
}

describe('IdempotencyService', () => {
  const payload = { externalUserId: 'u1' };

  it('rejects a missing key with VALIDATION_ERROR', async () => {
    const svc = new IdempotencyService(makeRepo(null));
    await expect(svc.execute(undefined, 'POST /v1/customers', payload, async () => 1)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });

  it('runs fn, stores the response, returns the result on first use', async () => {
    const repo = makeRepo(null);
    const svc = new IdempotencyService(repo);
    const result = await svc.execute('k1', 'POST /v1/customers', payload, async () => ({ id: 'c1' }));
    expect(result).toEqual({ id: 'c1' });
    expect(repo.save).toHaveBeenCalled(); // key row inserted before fn
    expect(repo.update).toHaveBeenCalledWith({ key: 'k1' }, expect.objectContaining({ responseBody: { id: 'c1' } }));
  });

  it('replays the stored response for same key + same payload without running fn', async () => {
    const svc = new IdempotencyService(
      makeRepo({
        key: 'k1',
        requestHash: IdempotencyService.hash(payload),
        responseBody: { id: 'c1' },
        responseStatus: 201,
      }),
    );
    const fn = jest.fn();
    const result = await svc.execute('k1', 'POST /v1/customers', payload, fn);
    expect(result).toEqual({ id: 'c1' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('throws IDEMPOTENCY_CONFLICT for same key + different payload', async () => {
    const svc = new IdempotencyService(
      makeRepo({ key: 'k1', requestHash: IdempotencyService.hash({ other: true }), responseBody: null }),
    );
    await expect(svc.execute('k1', 'POST /v1/customers', payload, async () => 1)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  it('re-runs fn when the key exists but no response was stored (failed earlier attempt)', async () => {
    const repo = makeRepo({ key: 'k1', requestHash: IdempotencyService.hash(payload), responseBody: null });
    const svc = new IdempotencyService(repo);
    const fn = jest.fn().mockResolvedValue({ id: 'c1' });
    await expect(svc.execute('k1', 'POST /v1/customers', payload, fn)).resolves.toEqual({ id: 'c1' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates fn failures without storing a response', async () => {
    const repo = makeRepo(null);
    const svc = new IdempotencyService(repo);
    await expect(
      svc.execute('k1', 'e', payload, async () => {
        throw new AppError('ONBOARDING_INCOMPLETE', 'x', 502);
      }),
    ).rejects.toMatchObject({ code: 'ONBOARDING_INCOMPLETE' });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
