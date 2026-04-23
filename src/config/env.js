import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  MONGODB_URI: z.string().min(1, 'Database URI is required'),
  
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT Access Secret is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT Refresh Secret is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  OTP_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  FAST2SMS_API_KEY: z.string().min(1, 'FAST2SMS_API_KEY is required'),
  FAST2SMS_API_URL: z.string().url().default('https://www.fast2sms.com/dev/bulkV2'),
  FAST2SMS_ROUTE: z.string().default('dlt'),
  FAST2SMS_ENTITY_ID: z.string().optional(),
  FAST2SMS_SENDER_ID: z.string().optional(),
  FAST2SMS_TEMPLATE_AUTH_OTP: z.string().min(1, 'FAST2SMS_TEMPLATE_AUTH_OTP is required'),
  FAST2SMS_TEMPLATE_BOOKING_CONFIRMED: z.string().min(1, 'FAST2SMS_TEMPLATE_BOOKING_CONFIRMED is required'),
  FAST2SMS_TEMPLATE_ARTIST_ASSIGNED: z.string().min(1, 'FAST2SMS_TEMPLATE_ARTIST_ASSIGNED is required'),
  FAST2SMS_TEMPLATE_SERVICE_COMPLETED: z.string().min(1, 'FAST2SMS_TEMPLATE_SERVICE_COMPLETED is required'),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_AUTH_TEMPLATE: z.string().default('auth_otp'),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  
  AWS_REGION: z.string().min(1, 'AWS Region is required'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS Access Key ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS Secret Access Key is required'),
  AWS_S3_BUCKET_NAME: z.string().min(1, 'AWS S3 Bucket Name is required'),
  
  ADMIN_EMAIL: z.string().email('Valid Admin Email is required'),
  ADMIN_PASSWORD: z.string().min(6, 'Admin Password must be at least 6 characters'),

  CLIENT_URL: z.string().url().default('http://localhost:5173'),
}).superRefine((data, ctx) => {
  const isDltRoute = String(data.FAST2SMS_ROUTE || '').toLowerCase() === 'dlt';
  if (!isDltRoute) return;

  if (!String(data.FAST2SMS_SENDER_ID || '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FAST2SMS_SENDER_ID'],
      message: 'FAST2SMS_SENDER_ID is required for dlt route',
    });
  }
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:\n', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
