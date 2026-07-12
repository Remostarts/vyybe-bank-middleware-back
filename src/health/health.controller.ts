import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/api-key.guard';
import { BlnkClient } from '../blnk/blnk.client';
import { AppError } from '../common/errors';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly blnk: BlnkClient,
  ) {}

  @Get()
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new AppError('INTERNAL', 'Database is unreachable', 503);
    }
    try {
      await this.blnk.ping();
    } catch {
      throw new AppError('BLNK_UNAVAILABLE', 'Blnk is unreachable', 503);
    }
    return { status: 'ready', checks: { database: 'up', blnk: 'up' } };
  }
}
