import { env } from '../config/env.js';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Send OTP via WhatsApp Cloud API using authentication template.
 * @param {string} to - Phone number in E.164 format (e.g. +918546031266)
 * @param {string} otp - 6-digit OTP code
 */
export const sendOtpViaWhatsApp = async (to, otp) => {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  const templateName = env.WHATSAPP_AUTH_TEMPLATE || 'auth_otp';
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp OTP provider is not configured');
  }

  // WhatsApp expects phone without + prefix
  const toNumber = String(to).replace(/\D/g, '');

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toNumber,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otp }],
        },
      ],
    },
  };

  try {
    const res = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      const upstreamMessage = data?.error?.message || 'Failed to send WhatsApp OTP';
      const upstreamCode = data?.error?.code;
      console.error('❌ WhatsApp API error:', data);
      throw new Error(`WhatsApp API error${upstreamCode ? ` (${upstreamCode})` : ''}: ${upstreamMessage}`);
    }

    console.log(`📱 WhatsApp OTP sent to ${to}: ${data.messages?.[0]?.id || 'ok'}`);
    return data;
  } catch (error) {
    console.error(`❌ Failed to send WhatsApp OTP to ${to}:`, error.message);
    throw error;
  }
};
