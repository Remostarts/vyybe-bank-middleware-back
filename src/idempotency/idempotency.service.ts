import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { IdempotencyKey } from './idempotency-key.entity';
import { AppError } from '../common/errors';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  static hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  }

  async execute<T>(key: string | undefined, endpoint: string, payload: unknown, fn: () => Promise<T>): Promise<T> {
    if (!key || key.trim() === '') {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required', 400);
    }
    const requestHash = IdempotencyService.hash(payload);
    const existing = await this.repo.findOneBy({ key });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different payload', 409, {
          endpoint: existing.endpoint,
        });
      }
      if (existing.responseBody !== null) return existing.responseBody as T;
      // fall through: earlier attempt failed before completing — re-execute
    } else {
      await this.repo.save(this.repo.create({ key, endpoint, requestHash, responseStatus: null, responseBody: null }));
    }

    const result = await fn();
    await this.repo.update({ key }, { responseStatus: 201, responseBody: result as object });
    return result;
  }
}
