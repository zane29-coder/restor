import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode, type ApiFailure } from '@restor/shared-types';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app-exception';
import { getRequestId } from '../context/request-context';

/**
 * Turns every thrown value into the standard failure envelope (TZ §43).
 *
 * Also the last line of defence for information leakage: in production an
 * unexpected error is reported as a generic message with a request id, while
 * the real stack goes to the structured log where only operators can see it
 * (TZ §59, §60).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId();

    const { status, code, message, details, logLevel } = this.normalize(exception);

    if (logLevel === 'error') {
      this.logger.error(
        {
          requestId,
          method: request?.method,
          url: request?.url,
          status,
          code,
          err: exception,
        },
        message,
      );
    } else {
      this.logger.warn({ requestId, method: request?.method, url: request?.url, status, code }, message);
    }

    const body: ApiFailure = {
      success: false,
      data: null,
      error: { code, message, details },
      meta: { requestId, timestamp: new Date().toISOString() },
    };

    response.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, string[]>;
    logLevel: 'warn' | 'error';
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        // A 5xx we raised ourselves is still a bug worth a full log line.
        logLevel: exception.getStatus() >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: httpStatusToCode(status),
        message: Array.isArray(message) ? message.join('; ') : message,
        logLevel: status >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { ...mapPrismaError(exception), logLevel: 'warn' };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'The request could not be processed',
        logLevel: 'error',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: this.isProduction
        ? 'Something went wrong. Quote the request id when reporting this.'
        : exception instanceof Error
          ? exception.message
          : String(exception),
      logLevel: 'error',
    };
  }
}

/** Maps Prisma's error codes onto our catalog. */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
} {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation — name the field so the form can mark it.
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? (target as string[]) : [String(target ?? 'field')];
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: `A record with this ${fields.join(', ')} already exists`,
        details: Object.fromEntries(fields.map((f) => [f, ['Already taken']])),
      };
    }
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'A referenced record does not exist',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: 'Record not found',
      };
    default:
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'The request could not be processed',
      };
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 422:
      return ErrorCode.VALIDATION_ERROR;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
  }
}
