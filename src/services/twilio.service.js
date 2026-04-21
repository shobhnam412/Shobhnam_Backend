import twilio from 'twilio';
import { env } from '../config/env.js';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export const sendSMS = async (to, body) => {
  try {
    const message = await client.messages.create({
      body: body,
      from: env.TWILIO_PHONE_NUMBER,
      to: to, // Ensure 'to' has country code e.g., +91...
    });
    console.log(`📤 SMS sent to ${to}: ${message.sid}`);
    return message;
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${to}:`, error.message);
    throw new Error(error?.message || 'Failed to send SMS');
  }
};
