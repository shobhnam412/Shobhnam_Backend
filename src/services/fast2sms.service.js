import { env } from '../config/env.js';

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [250, 750];
const FAST2SMS_MESSAGE_ID_REGEX = /^\d{6,22}$/;

const normalizeIndianPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return String(phone || '').trim();
  return digits.slice(-10);
};

const buildFast2SmsPayload = ({ phone, templateId, variables }) => {
  const numbers = normalizeIndianPhone(phone);
  const variableValues = Array.isArray(variables)
    ? variables.map((value) => String(value ?? '').trim()).join('|')
    : '';

  const payload = {
    route: env.FAST2SMS_ROUTE,
    sender_id: env.FAST2SMS_SENDER_ID,
    message: templateId,
    variables_values: variableValues,
    numbers,
  };
  if (String(env.FAST2SMS_ENTITY_ID || '').trim()) {
    payload.entity_id = env.FAST2SMS_ENTITY_ID;
  }
  return payload;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildSmsErrorMessage = (error, data, response) => {
  const providerMessage =
    data?.message ||
    data?.error_message ||
    data?.errors?.[0]?.message ||
    (Array.isArray(data?.errors) ? data.errors.join(', ') : '');
  const statusPart = response ? `status ${response.status}` : 'network/provider failure';
  return providerMessage
    ? `Fast2SMS ${statusPart}: ${providerMessage}`
    : `Fast2SMS ${statusPart}: ${error?.message || 'Unknown SMS send error'}`;
};

const sendTemplateSMS = async ({ phone, templateId, variables = [], eventName = 'GENERIC_SMS' }) => {
  const normalizedTemplateId = String(templateId || '').trim();
  if (!FAST2SMS_MESSAGE_ID_REGEX.test(normalizedTemplateId)) {
    throw new Error(
      `[SMS][${eventName}] Invalid template identifier. FAST2SMS_TEMPLATE_* must be Fast2SMS numeric message ID (usually 6 digits), not DLT template ID or full text.`
    );
  }

  const payload = buildFast2SmsPayload({ phone, templateId: normalizedTemplateId, variables });

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(env.FAST2SMS_API_URL, {
        method: 'POST',
        headers: {
          authorization: env.FAST2SMS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      const status = String(data?.return || '').toLowerCase();
      if (!response.ok || (status && status !== 'true')) {
        throw new Error(buildSmsErrorMessage(new Error('Provider rejected request'), data, response));
      }

      return data;
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_RETRIES;
      const maskedPhone = payload.numbers ? `xxxxxx${String(payload.numbers).slice(-4)}` : 'unknown';
      console.warn(
        `[SMS][${eventName}] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${maskedPhone}: ${error.message}`
      );
      if (isLastAttempt) break;
      await sleep(RETRY_DELAYS_MS[attempt] || 1000);
    }
  }

  throw lastError || new Error('Failed to send SMS via Fast2SMS');
};

export const sendAuthOtp = async (phone, otpCode) =>
  sendTemplateSMS({
    phone,
    templateId: env.FAST2SMS_TEMPLATE_AUTH_OTP,
    variables: [otpCode],
    eventName: 'AUTH_OTP',
  });

export const sendBookingConfirmed = async ({ phone, orderId, packageName, dateTime, address, paidAmount }) =>
  sendTemplateSMS({
    phone,
    templateId: env.FAST2SMS_TEMPLATE_BOOKING_CONFIRMED,
    variables: [orderId, packageName, dateTime, address, paidAmount],
    eventName: 'BOOKING_CONFIRMED',
  });

export const sendArtistAssigned = async ({ phone, orderId, happyCode }) =>
  sendTemplateSMS({
    phone,
    templateId: env.FAST2SMS_TEMPLATE_ARTIST_ASSIGNED,
    variables: [orderId, happyCode],
    eventName: 'ARTIST_ASSIGNED',
  });

export const sendServiceCompleted = async ({ phone, orderId }) =>
  sendTemplateSMS({
    phone,
    templateId: env.FAST2SMS_TEMPLATE_SERVICE_COMPLETED,
    variables: [orderId],
    eventName: 'SERVICE_COMPLETED',
  });
