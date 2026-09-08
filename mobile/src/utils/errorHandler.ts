import { AxiosError } from 'axios';
import { logger } from './logger';

export interface AppError {
  message: string;
  code?: string;
  details?: any;
}

/**
 * Normalizes an API or unexpected error into a consistent user-facing format,
 * while silently logging the real underlying issue.
 */
export const normalizeError = (error: unknown): AppError => {
  if (error instanceof AxiosError) {
    const apiError = error.response?.data?.error;
    const message = apiError?.message || 'A network error occurred. Please try again later.';
    logger.error(`API Error [${error.response?.status}]: ${message}`, error);

    return {
      message,
      code: error.code,
      details: apiError?.details,
    };
  }

  if (error instanceof Error) {
    logger.error(`System Error: ${error.message}`, error);
    return { message: 'Something went wrong processing your request.' };
  }

  logger.error('Unknown Error Encountered', error);
  return { message: 'An unexpected error occurred.' };
};
