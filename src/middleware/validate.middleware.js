import { ApiError } from '../utils/ApiError.js';

export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      const parsedData = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Override body (always writable). req.query and req.params are read-only in Express 5.
      req.body = parsedData.body ?? req.body;
      if (parsedData.query !== undefined) {
        req.validated = req.validated || {};
        req.validated.query = parsedData.query;
      }
      if (parsedData.params !== undefined) {
        req.validated = req.validated || {};
        req.validated.params = parsedData.params;
      }

      next();
    } catch (error) {
      if (error.errors) {
        // Error from Zod
        const errorMessages = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
        return next(new ApiError(400, 'Validation Error', errorMessages));
      }
      next(error);
    }
  };
};
