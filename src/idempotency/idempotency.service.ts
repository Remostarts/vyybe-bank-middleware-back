import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { IdempotencyKey } from './idempotency-key.entity';
import { AppError } from '../common/errors';

export interface IdempotencyContext {
  checkpoint: unknown | null;
  saveCheckpoint: (value: Record<string, unknown>) => Promise<void>;
}

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  static hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  }

  async execute<T>(
    key: string | undefined,
    endpoint: string,
    payload: unknown,
    fn: (ctx: IdempotencyContext) => Promise<T>,
  ): Promise<T> {
    if (!key || key.trim() === '') {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required', 400);
    }
    const requestHash = IdempotencyService.hash(payload);
    const existing = await this.repo.findOneBy({ key });

    let checkpoint: unknown | null = null;
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different payload', 409, {
          endpoint: existing.endpoint,
        });
      }
      if (existing.responseBody !== null) return existing.responseBody as T;
      // fall through: earlier attempt failed before completing — re-execute, but
      // resume from any checkpoint the earlier attempt recorded (prevents double-spend).
      checkpoint = existing.checkpoint ?? null;
    } else {
      await this.repo.save(
        this.repo.create({ key, endpoint, requestHash, responseStatus: null, responseBody: null, checkpoint: null }),
      );
    }

    const ctx: IdempotencyContext = {
      checkpoint,
      saveCheckpoint: async (value) => {
        await this.repo.update({ key }, { checkpoint: value });
      },
    };

    const result = await fn(ctx);
    await this.repo.update({ key }, { responseStatus: 201, responseBody: result as object });
    return result;
  }
}
