import { HttpException } from '@nestjs/common';
import { ErrorCode } from '@restor/shared-types';

/**
 * The only exception the application throws deliberately (TZ §43).
 *
 * Carries a stable machine-readable `code` alongside the HTTP status, because
 * clients branch on the code — the status alone cannot distinguish
 * `ORDER_NOT_FOUND` from `PRODUCT_NOT_FOUND`.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status = 400,
    readonly details?: Record<string, string[]>,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(entity: string, code: string = ErrorCode.NOT_FOUND): AppException {
    return new AppException(code, `${entity} not found`, 404);
  }

  static forbidden(message = 'You do not have permission to do that'): AppException {
    return new AppException(ErrorCode.FORBIDDEN, message, 403);
  }

  static unauthorized(
    message = 'Authentication required',
    code: string = ErrorCode.UNAUTHORIZED,
  ): AppException {
    return new AppException(code, message, 401);
  }

  static conflict(message: string, code: string = ErrorCode.CONFLICT): AppException {
    return new AppException(code, message, 409);
  }

  static badRequest(message: string, code: string = ErrorCode.BAD_REQUEST): AppException {
    return new AppException(code, message, 400);
  }

  static validation(
    message: string,
    details?: Record<string, string[]>,
  ): AppException {
    return new AppException(ErrorCode.VALIDATION_ERROR, message, 422, details);
  }

  static internal(message = 'Something went wrong'): AppException {
    return new AppException(ErrorCode.INTERNAL_ERROR, message, 500);
  }
}
