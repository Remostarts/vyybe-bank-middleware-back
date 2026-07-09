import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/errors';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    const keys = this.config.get<ReadonlyMap<string, string>>('serviceApiKeys');
    if (typeof key !== 'string' || !keys?.has(key)) {
      throw new AppError('UNAUTHORIZED', 'Invalid or missing x-api-key', 401);
    }
    req.serviceName = keys.get(key);
    return true;
  }
}
