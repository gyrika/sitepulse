import { TARGET_ERROR, TargetPolicyError } from '../security/targetPolicy.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const DUPLICATE_KEY_ERROR = 11000;

export function notFoundHandler(req) {
  throw new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}.`);
}

// Translates known errors into a safe API response.
function toAppError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof TargetPolicyError) {
    const safeCode = TARGET_ERROR[error.code] ?? TARGET_ERROR.BLOCKED_TARGET;
    return new AppError(422, safeCode, error.message);
  }
  if (error.code === DUPLICATE_KEY_ERROR) {
    return new AppError(409, 'DUPLICATE_MONITOR', 'A monitor for this URL already exists.');
  }
  if (error.type === 'entity.parse.failed') {
    return new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
  if (error.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  return null;
}

// Express recognises error handlers by their four parameters, so `next` must stay.
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const appError = toAppError(error);
  if (!appError) {
    logger.error('Unhandled request error', { method: req.method, path: req.path, error: error.message });
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    });
  }

  return res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
}
