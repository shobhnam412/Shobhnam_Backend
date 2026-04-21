import { z } from 'zod';

export const authValidation = {
  sendOtp: z.object({
    body: z.object({
      phone: z.string().min(10, 'Phone number must be at least 10 digits'),
    }),
  }),
  
  verifyOtpUser: z.object({
    body: z.object({
      phone: z.string().min(10, 'Phone number must be at least 10 digits'),
      otp: z.string().length(6, 'OTP must be exactly 6 digits'),
      name: z.string().optional(),
      city: z.string().optional(),
    }),
  }),

  verifyOtpArtist: z.object({
    body: z.object({
      phone: z.string().min(10, 'Phone number must be at least 10 digits'),
      otp: z.string().length(6, 'OTP must be exactly 6 digits'),
      name: z.string().optional(),
      category: z.enum([
        'Ramleela',
        'Sundarkand',
        'Sunderkand',
        'Bhagwat Katha',
        'Bhagwat khatha',
        'Bhajan sandhya',
        'Rudrabhishek',
        'Ramayan Path',
        'Other',
      ]).optional(),
      city: z.string().optional(),
    }),
  }),

  adminLogin: z.object({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(6),
    }),
  })
};
