import { AppError } from '../utils/AppError.js';

// Validated values go on req.validated. In Express 5 req.query is read-only, and
// controllers should only ever see data that has passed its schema.
export function validate(schemas) {
  return (req, _res, next) => {
    req.validated = {};
    const issues = [];

    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        req.validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ field: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'The request is not valid.', issues);
    }
    next();
  };
}
