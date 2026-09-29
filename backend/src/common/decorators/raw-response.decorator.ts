import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'restor:rawResponse';

/**
 * Opts a route out of the `{ success, data, error }` envelope.
 *
 * Needed where the response shape is dictated by someone else: Click and Payme
 * webhooks expect their own acknowledgement format, and a file download must
 * return bytes (TZ §36).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
