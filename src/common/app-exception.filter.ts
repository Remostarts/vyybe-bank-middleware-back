import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AppError, ErrorCode } from './errors';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();

    if (exception instanceof AppError) {
      return res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details ?? {} },
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as { message?: string | string[] } | string;
      const raw = typeof body === 'string' ? body : body?.message ?? exception.message;
      const message = Array.isArray(raw) ? raw.join('; ') : raw;
      const code: ErrorCode = status === 400 ? 'VALIDATION_ERROR' : status === 401 ? 'UNAUTHORIZED' : 'INTERNAL';
      return res.status(status).json({ error: { code, message, details: {} } });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error', details: {} } });
  }
}
