import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AppExceptionFilter } from './app-exception.filter';
import { AppError } from './errors';

function mockHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { res, host };
}

describe('AppExceptionFilter', () => {
  const filter = new AppExceptionFilter();

  it('renders AppError with its status, code and details', () => {
    const { res, host } = mockHost();
    filter.catch(new AppError('CUSTOMER_NOT_FOUND', 'no such customer', 404, { id: 'x' }), host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'CUSTOMER_NOT_FOUND', message: 'no such customer', details: { id: 'x' } },
    });
  });

  it('maps validation HttpException (400) to VALIDATION_ERROR and joins messages', () => {
    const { res, host } = mockHost();
    filter.catch(new BadRequestException(['email must be an email', 'firstName should not be empty']), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'email must be an email; firstName should not be empty',
        details: {},
      },
    });
  });

  it('maps unknown exceptions to 500 INTERNAL without leaking internals', () => {
    const { res, host } = mockHost();
    filter.catch(new Error('secret db string'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL', message: 'Internal server error', details: {} },
    });
  });
});
