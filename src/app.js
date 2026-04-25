import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startBookingReminderWorker } from './services/bookingReminder.service.js';
import { ApiError } from './utils/ApiError.js';

import adminRouter from './routes/admin.routes.js';
import addressRouter from './routes/address.routes.js';
import artistRouter from './routes/artist.routes.js';
import authRouter from './routes/auth.routes.js';
import bookingRouter from './routes/booking.routes.js';
import cancellationRouter from './routes/cancellation.routes.js';
import orderRouter from './routes/order.routes.js';
import paymentRouter from './routes/payment.routes.js';
import notificationRouter from './routes/notification.routes.js';
import reviewRouter from './routes/review.routes.js';
import searchRouter from './routes/search.routes.js';
import supportRouter from './routes/support.routes.js';
import userRouter from './routes/user.routes.js';

const app = express();
startBookingReminderWorker();

// --- Global Middlewares ---
app.use(helmet());
app.use(
  cors(
    env.NODE_ENV === 'development'
      ? { origin: true, credentials: true }
      : {
          credentials: true,
          origin(origin, callback) {
            if (!origin) return callback(null, true);
            if (env.clientUrls.includes(origin)) return callback(null, true);
            callback(null, false);
          },
        }
  )
);

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(morgan('dev')); // Logger

// Root health check (for quick connectivity verification)
app.get('/health', (req, res) => res.json({ ok: true, timestamp: Date.now() }));

// --- Routes ---
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/artists', artistRouter);
app.use('/api/v1/addresses', addressRouter);
app.use('/api/v1/bookings', bookingRouter);
app.use('/api/v1/cancellations', cancellationRouter);
app.use('/api/v1/orders', orderRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/search', searchRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/support', supportRouter);

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Shobhnam API is running' });
});

// Public config
app.get('/api/v1/config', (req, res) => {
  res.status(200).json({
    paymentMethod: 'MANUAL_QR',
    razorpayEnabled: false,
  });
});

// --- 404 Route Handler ---
app.use((req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
});

// --- Error Handler ---
app.use(errorHandler);

export { app };
