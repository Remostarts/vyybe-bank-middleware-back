import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';
import { BlnkClient } from '../blnk/blnk.client';
import { AppError } from '../common/errors';

describe('HealthController.readiness', () => {
  const upDb = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as DataSource;
  const downDb = { query: jest.fn().mockRejectedValue(new Error('conn refused')) } as unknown as DataSource;
  const upBlnk = { ping: jest.fn().mockResolvedValue(undefined) } as unknown as BlnkClient;
  const downBlnk = { ping: jest.fn().mockRejectedValue(new AppError('BLNK_UNAVAILABLE', 'down', 502)) } as unknown as BlnkClient;

  it('reports ready when both dependencies are up', async () => {
    const ctrl = new HealthController(upDb, upBlnk);
    await expect(ctrl.readiness()).resolves.toEqual({ status: 'ready', checks: { database: 'up', blnk: 'up' } });
  });

  it('fails with 503 when the database is down', async () => {
    const ctrl = new HealthController(downDb, upBlnk);
    await expect(ctrl.readiness()).rejects.toMatchObject({ status: 503 });
  });

  it('fails with 503 when Blnk is down', async () => {
    const ctrl = new HealthController(upDb, downBlnk);
    await expect(ctrl.readiness()).rejects.toMatchObject({ status: 503 });
  });
});
