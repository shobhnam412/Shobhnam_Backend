import { ApiError } from './ApiError.js';

/** Wraps multer upload middleware to catch S3/multer errors, log them, and return a structured 500 */
export const uploadWithErrorHandling = (uploadMiddleware, controller) => [
  (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        console.error('[Upload] Multer/S3 error:', err?.message || err, err?.stack);
        next(new ApiError(500, 'File upload failed. Please try again.'));
      } else {
        next();
      }
    });
  },
  controller,
];
