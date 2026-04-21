import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const errorHandler = (err, req, res, next) => {
  let error = err;

  // If the error is not an instance of our custom ApiError, wrap it
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode ? error.statusCode : 500;
    const message = error.message || 'Something went wrong';
    error = new ApiError(statusCode, message, error?.errors || [], err.stack);
  }

  // Construct the standardized response object
  const response = {
    success: false,
    message: error.message,
    errors: error.errors,
    ...(env.NODE_ENV === 'development' ? { stack: error.stack } : {}),
  };

  return res.status(error.statusCode).json(response);
};

export { errorHandler };
