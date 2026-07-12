import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';
import { AppError } from '../common/errors';

function ctxWithHeaders(headers: Record<string, string>): { ctx: ExecutionContext; req: any } {
  const req: any = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('ApiKeyGuard', () => {
  const config = { get: jest.fn().mockReturnValue(new Map([['key-1', 'user-service']])) } as unknown as ConfigService;

  function guardWithPublic(isPublic: boolean) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
    return new ApiKeyGuard(config, reflector);
  }

  it('allows a request with a known key and attaches serviceName', () => {
    const { ctx, req } = ctxWithHeaders({ 'x-api-key': 'key-1' });
    expect(guardWithPublic(false).canActivate(ctx)).toBe(true);
    expect(req.serviceName).toBe('user-service');
  });

  it('rejects a missing key with UNAUTHORIZED AppError', () => {
    const { ctx } = ctxWithHeaders({});
    expect(() => guardWithPublic(false).canActivate(ctx)).toThrow(AppError);
    try {
      guardWithPublic(false).canActivate(ctx);
    } catch (e) {
      expect((e as AppError).code).toBe('UNAUTHORIZED');
      expect((e as AppError).status).toBe(401);
    }
  });

  it('rejects an unknown key', () => {
    const { ctx } = ctxWithHeaders({ 'x-api-key': 'wrong' });
    expect(() => guardWithPublic(false).canActivate(ctx)).toThrow(AppError);
  });

  it('allows @Public() endpoints without a key', () => {
    const { ctx } = ctxWithHeaders({});
    expect(guardWithPublic(true).canActivate(ctx)).toBe(true);
  });
});
