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

  registerArtist: z.object({
    body: z
      .object({
        onboardingToken: z.string().min(10, 'Onboarding token is required'),
        fullName: z.string().min(1, 'Full name is required'),
        gender: z.string().min(1, 'Gender is required'),
        expertise: z.string().min(1, 'Expertise is required'),
        experience: z.string().min(1, 'Experience is required'),
        serviceLocation: z.string().min(1, 'Service location is required'),
        profilePhoto: z.string().min(1, 'Profile photo is required'),
        aadharCard: z.string().min(1, 'Aadhar card is required'),
      })
      .passthrough(),
  }),

  adminLogin: z.object({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(6),
    }),
  })
};
