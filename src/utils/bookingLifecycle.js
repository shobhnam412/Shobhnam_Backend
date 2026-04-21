export const ACTIVATION_CHARGE_AMOUNT = 51;

export const PAYMENT_PLAN = {
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
};

export const BOOKING_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  UPCOMING: 'UPCOMING',
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
};

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
};

export const PAYMENT_TYPE = {
  ACTIVATION: 'ACTIVATION',
  ARTIST_ACTIVATION: 'ARTIST_ACTIVATION',
  BOOKING_FULL: 'BOOKING_FULL',
  BOOKING_PARTIAL: 'BOOKING_PARTIAL',
  BOOKING_REMAINING: 'BOOKING_REMAINING',
  ORDER_FULL: 'ORDER_FULL',
  ORDER_PARTIAL: 'ORDER_PARTIAL',
  ORDER_REMAINING: 'ORDER_REMAINING',
};

export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export const normalizePaymentPlan = (value) =>
  value === PAYMENT_PLAN.PARTIAL ? PAYMENT_PLAN.PARTIAL : PAYMENT_PLAN.FULL;

export const getTimeToEventMs = (eventDate, nowMs = Date.now()) => {
  const eventMs = new Date(eventDate).getTime();
  if (Number.isNaN(eventMs)) return null;
  return eventMs - nowMs;
};

export const requiresFullPaymentByEventDate = (eventDate, nowMs = Date.now()) => {
  const timeToEvent = getTimeToEventMs(eventDate, nowMs);
  if (timeToEvent === null) return false;
  return timeToEvent > 0 && timeToEvent <= THREE_DAYS_MS;
};

export const normalizePaymentPlanForEventDate = (paymentPlan, eventDate, nowMs = Date.now()) => {
  if (requiresFullPaymentByEventDate(eventDate, nowMs)) {
    return PAYMENT_PLAN.FULL;
  }
  return normalizePaymentPlan(paymentPlan);
};

export const normalizePaymentPlanForOrderItems = (paymentPlan, items = [], nowMs = Date.now()) => {
  const hasNearTermItem = items.some((item) => requiresFullPaymentByEventDate(item?.date, nowMs));
  if (hasNearTermItem) {
    return PAYMENT_PLAN.FULL;
  }
  return normalizePaymentPlan(paymentPlan);
};

export const getLatestOrderEventDate = (items = []) => {
  let latest = null;
  for (const item of items) {
    const eventMs = new Date(item?.date).getTime();
    if (Number.isNaN(eventMs)) continue;
    if (latest === null || eventMs > latest) latest = eventMs;
  }
  return latest ? new Date(latest) : null;
};

export const calculatePaymentSplit = (totalAmount, paymentPlan = PAYMENT_PLAN.FULL) => {
  const normalizedTotal = Math.max(0, Number(totalAmount || 0));
  const normalizedPlan = normalizePaymentPlan(paymentPlan);

  if (normalizedPlan === PAYMENT_PLAN.PARTIAL) {
    const partialAmount = Math.max(1, Math.round(normalizedTotal * 0.2));
    return {
      paymentPlan: normalizedPlan,
      currentPayableAmount: partialAmount,
      remainingAmount: Math.max(0, normalizedTotal - partialAmount),
    };
  }

  return {
    paymentPlan: normalizedPlan,
    currentPayableAmount: normalizedTotal,
    remainingAmount: 0,
  };
};

export const createHappyCode = () => {
  return String(Math.floor(1000 + Math.random() * 9000));
};
