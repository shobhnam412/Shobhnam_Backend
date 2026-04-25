import { Address } from "../models/address.model.js";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import {
  calculatePaymentSplit,
  normalizePaymentPlanForOrderItems,
  requiresFullPaymentByEventDate,
} from "../utils/bookingLifecycle.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ALL_BOOKING_SLOT_ENUM } from "../utils/istTime.js";

const TRAVELING_FEE = 500;
const ALLOWED_SLOTS = new Set(ALL_BOOKING_SLOT_ENUM);

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const withLifecycleProjection = (order) => {
  const data = order?.toObject ? order.toObject() : order;
  const todayKey = toDateKey(new Date());
  const items = (data.items || []).map((item) => {
    const assigned = Boolean(item.artist) || (Array.isArray(item.assignedArtists) && item.assignedArtists.length > 0);
    const eventStarted = Boolean(todayKey && toDateKey(item.date) && todayKey >= toDateKey(item.date));
    let lifecycleStatus = item.status || 'PENDING';
    if (lifecycleStatus === 'UPCOMING' && eventStarted && assigned && Number(item.remainingAmount || 0) <= 0) {
      lifecycleStatus = 'ONGOING';
    }
    return {
      ...item,
      lifecycleStatus,
      isAssigned: assigned,
    };
  });
  return {
    ...data,
    items,
    paymentStatusLabel:
      data.paymentStatus === 'PAID' && data.paymentPlan === 'PARTIAL' ? 'PARTIALLY_PAID' : data.paymentStatus,
  };
};

export const createOrder = asyncHandler(async (req, res) => {
  const { items, paymentPlan = "FULL" } = req.body;

  const user = await User.findById(req.user._id).select("activationChargeStatus");
  if (!user) throw new ApiError(404, "User not found");
  if (user.activationChargeStatus !== "PAID") {
    throw new ApiError(403, "Activation charge is pending. Please complete activation payment first.");
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "Order items are required");
  }

  const orderItems = [];
  for (const item of items) {
    if (
      !item?.serviceName ||
      !item?.packageTitle ||
      typeof item.price !== "number"
    ) {
      throw new ApiError(
        400,
        "Each order item must include serviceName, packageTitle and price",
      );
    }
    if (!item.date || Number.isNaN(new Date(item.date).getTime())) {
      throw new ApiError(400, "Each order item must include a valid date");
    }
    if (!ALLOWED_SLOTS.has(item.slot)) {
      throw new ApiError(400, "Each order item must include a valid slot");
    }

    let addressLabel = String(item.addressLabel ?? "").trim();
    let addressDetail = String(item.addressDetail ?? "").trim();
    let houseFloor = String(item.houseFloor ?? "").trim();
    let towerBlock = String(item.towerBlock ?? "").trim();
    let landmark = String(item.landmark ?? "").trim();
    let city = String(item.city ?? "").trim();
    let state = String(item.state ?? "").trim();
    let pinCode = String(item.pinCode ?? "").trim();
    let normalizedAddressId = null;

    if (item.addressId) {
      const ownedAddress = await Address.findOne({
        _id: item.addressId,
        user: req.user._id,
      });
      if (!ownedAddress) {
        throw new ApiError(404, "Address not found for this user");
      }
      normalizedAddressId = ownedAddress._id;
      addressLabel = ownedAddress.saveAs;
      addressDetail = [
        ownedAddress.houseFloor,
        ownedAddress.towerBlock,
        ownedAddress.landmark,
      ]
        .filter(Boolean)
        .join(", ");
      houseFloor = ownedAddress.houseFloor;
      towerBlock = ownedAddress.towerBlock;
      landmark = ownedAddress.landmark;
      city = ownedAddress.city;
      state = ownedAddress.state;
      pinCode = ownedAddress.pinCode;
    }

    if (!addressDetail) {
      throw new ApiError(400, "Each order item must include an address");
    }

    orderItems.push({
      serviceName: item.serviceName,
      packageTitle: item.packageTitle,
      price: item.price,
      dateTime: item.dateTime,
      date: new Date(item.date),
      slot: item.slot,
      addressId: normalizedAddressId,
      addressDetail,
      addressLabel,
      houseFloor,
      towerBlock,
      landmark,
      city,
      state,
      pinCode,
    });
  }

  const totalAmount = orderItems.reduce((sum, i) => sum + (i.price ?? 0), 0);
  const grandTotal = totalAmount + TRAVELING_FEE;
  const normalizedPaymentPlan = normalizePaymentPlanForOrderItems(paymentPlan, orderItems);
  const split = calculatePaymentSplit(grandTotal, normalizedPaymentPlan);
  const hasNearTermItem = orderItems.some((item) => requiresFullPaymentByEventDate(item.date));

  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    totalAmount,
    travelingFee: TRAVELING_FEE,
    grandTotal,
    paymentStatus: "PENDING",
    paymentPlan: split.paymentPlan,
    amountPaid: 0,
    remainingAmount: grandTotal,
    bookedAt: new Date(),
  });

  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        {
          ...order.toObject(),
          paymentPlanLockedToFull: hasNearTermItem,
        },
        "Order created successfully"
      )
    );
});

export const getUserOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .populate("items.artist", "name category profilePhoto")
    .populate("items.assignedArtists.artist", "name category profilePhoto")
    .sort({
      createdAt: -1,
    });

  const projected = orders.map(withLifecycleProjection);
  res.status(200).json(new ApiResponse(200, projected, "User orders fetched"));
});
