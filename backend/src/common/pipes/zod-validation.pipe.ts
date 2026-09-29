import { Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { AppException } from '../errors/app-exception';

/**
 * Validates and TRANSFORMS a payload with a shared Zod schema.
 *
 * The schemas come from `@restor/validation`, which the web forms also use, so
 * a rule cannot drift between what the UI accepts and what the API accepts
 * (TZ §52). Because the schemas transform as well as check — normalising a
 * phone to E.164, coercing `?page=2` to a number — the handler receives
 * already-clean data and never re-parses.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodSchema> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw AppException.validation('Validation failed', formatZodError(result.error));
    }

    return result.data;
  }
}

/** Convenience factory so controllers read `@Body(zodBody(createOrderSchema))`. */
export function zodBody<TSchema extends ZodSchema>(schema: TSchema): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}

/** Groups issues by dotted field path for the client's form. */
export function formatZodError(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    (details[path] ??= []).push(issue.message);
  }

  return details;
}
