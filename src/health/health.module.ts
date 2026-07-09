import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BlnkModule } from '../blnk/blnk.module';

@Module({ imports: [BlnkModule], controllers: [HealthController] })
export class HealthModule {}
