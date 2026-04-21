import crypto from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';

export const razorpayInstance = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID || 'disabled',
  key_secret: env.RAZORPAY_KEY_SECRET || 'disabled',
});

export const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  const generatedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(orderId + '|' + paymentId)
    .digest('hex');

  return generatedSignature === signature;
};

export const verifyWebhookSignature = (body, signature) => {
  const generatedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
    
  return generatedSignature === signature;
};
