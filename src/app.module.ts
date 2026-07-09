import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { loadConfig } from './config/configuration';
import { HealthModule } from './health/health.module';
import { ApiKeyGuard } from './auth/api-key.guard';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => loadConfig()] }), HealthModule],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
