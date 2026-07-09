export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'CUSTOMER_ALREADY_EXISTS'
  | 'CUSTOMER_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ONBOARDING_INCOMPLETE'
  | 'BLNK_UNAVAILABLE'
  | 'BLNK_REQUEST_REJECTED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
