/**
 * Mobile Typed API Client with Automatic Authentication & 401 Interception
 *
 * Implements:
 * - Automatic Authorization header injection from volatile auth memory.
 * - Single-flight 401 interception: on token expiry, triggers a refresh
 *   mutex and transparently retries the failed request once.
 * - Idempotency-Key header support for hold creation and payment initiation.
 * - Strictly typed endpoints reusing @kerala-tourism/shared-types.
 */

import {
  ApiResponse,
  BookingDto,
  CreateBookingHoldResponseDto,
  CreatePaymentResponseDto,
  InventoryHoldDto,
  PaymentDto,
  PropertyAvailabilityResponseDto,
  PublicPropertyListResponseDto,
  PublicRoomTypeListResponseDto,
  VerifyPaymentResponseDto,
  DeviceListResponseDto,
  RegisterDeviceResponseDto,
  NotificationDto,
  NotificationListResponseDto,
  NotificationUnreadCountDto,
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from '@kerala-tourism/shared-types';
import { authService } from './auth.service';

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class MobileApiClient {
  private baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions = {}) {
    const raw = (
      options.baseUrl ||
      process.env.EXPO_PUBLIC_API_URL ||
      'http://10.0.2.2:5000'
    ).replace(/\/$/, '');
    // Strip trailing /api/v1 if supplied in environment since endpoints specify /api/v1/...
    this.baseUrl = raw.replace(/\/api\/v1$/, '');
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  public setBaseUrl(url: string): void {
    const raw = url.replace(/\/$/, '');
    this.baseUrl = raw.replace(/\/api\/v1$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const token = authService.getAccessToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      // Handle 401 Unauthorized with single-flight automatic token refresh
      if (response.status === 401 && !isRetry) {
        const refreshedToken = await authService.refreshToken();
        if (refreshedToken) {
          // Retry the request once with new token
          return this.request<T>(endpoint, options, true);
        }
      }

      if (!response.ok) {
        const errorData = data?.error;
        throw new ApiError(
          errorData?.message || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorData?.code || 'HTTP_ERROR',
          errorData?.details,
        );
      }

      return data as ApiResponse<T>;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError(`Request timeout after ${this.timeoutMs}ms`, 408, 'TIMEOUT');
      }
      throw new ApiError(
        err instanceof Error ? err.message : 'Unknown network error',
        0,
        'NETWORK_ERROR',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // ==========================================================================
  // PROPERTY DISCOVERY & ROOM ENDPOINTS
  // ==========================================================================
  public readonly properties = {
    list: async (params?: { page?: number; limit?: number; district?: string }) => {
      const query = new URLSearchParams();
      if (params?.page) query.append('page', String(params.page));
      if (params?.limit) query.append('limit', String(params.limit));
      if (params?.district) query.append('district', params.district);
      const qs = query.toString() ? `?${query.toString()}` : '';
      return this.request<PublicPropertyListResponseDto>(`/api/v1/properties${qs}`, {
        method: 'GET',
      });
    },

    getBySlug: async (slug: string) => {
      return this.request<any>(`/api/v1/properties/${slug}`, {
        method: 'GET',
      });
    },

    getRooms: async (propertyId: string) => {
      return this.request<PublicRoomTypeListResponseDto>(`/api/v1/properties/${propertyId}/rooms`, {
        method: 'GET',
      });
    },

    checkAvailability: async (
      propertyId: string,
      query: {
        checkIn: string; // YYYY-MM-DD
        checkOut: string; // YYYY-MM-DD
        adults?: number;
        children?: number;
        rooms?: number;
      },
    ) => {
      const q = new URLSearchParams({
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        adults: String(query.adults ?? 1),
        children: String(query.children ?? 0),
        rooms: String(query.rooms ?? 1),
      });
      return this.request<PropertyAvailabilityResponseDto>(
        `/api/v1/properties/${propertyId}/availability?${q.toString()}`,
        {
          method: 'GET',
        },
      );
    },
  };

  // ==========================================================================
  // TOURIST BOOKING & HOLD ENDPOINTS
  // ==========================================================================
  public readonly bookings = {
    createHold: async (
      payload: {
        propertyId: string;
        roomTypeId: string;
        checkInDate: string; // YYYY-MM-DD
        checkOutDate: string; // YYYY-MM-DD
        numberOfRooms: number;
        adults: number;
        children?: number;
        guestDetails: {
          primaryGuestName: string;
          email: string;
          phone: string;
          specialRequests?: string | null;
        };
      },
      idempotencyKey?: string,
    ) => {
      const headers: Record<string, string> = {};
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      return this.request<CreateBookingHoldResponseDto>(
        '/api/v1/tourist/bookings/holds',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        },
      );
    },

    getHold: async (holdId: string) => {
      return this.request<{ hold: InventoryHoldDto; remainingSeconds: number; isExpired: boolean }>(
        `/api/v1/tourist/bookings/holds/${holdId}`,
        {
          method: 'GET',
        },
      );
    },

    releaseHold: async (holdId: string) => {
      return this.request<{ released: boolean; message: string }>(
        `/api/v1/tourist/bookings/holds/${holdId}`,
        {
          method: 'DELETE',
        },
      );
    },

    list: async (params?: { status?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.status) query.append('status', params.status);
      if (params?.page) query.append('page', String(params.page));
      if (params?.limit) query.append('limit', String(params.limit));
      const qs = query.toString() ? `?${query.toString()}` : '';
      return this.request<{
        items: BookingDto[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      }>(`/api/v1/tourist/bookings${qs}`, {
        method: 'GET',
      });
    },

    getById: async (bookingId: string) => {
      return this.request<BookingDto>(`/api/v1/tourist/bookings/${bookingId}`, {
        method: 'GET',
      });
    },
  };

  // ==========================================================================
  // TOURIST PAYMENT ENDPOINTS
  // ==========================================================================
  public readonly payments = {
    createPayment: async (bookingId: string, idempotencyKey?: string) => {
      const headers: Record<string, string> = {};
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      return this.request<CreatePaymentResponseDto>(
        `/api/v1/tourist/bookings/${bookingId}/payments`,
        {
          method: 'POST',
          headers,
        },
      );
    },

    verifyPayment: async (payload: {
      paymentId: string;
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }) => {
      return this.request<VerifyPaymentResponseDto>(
        '/api/v1/tourist/payments/verify',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
    },

    getById: async (paymentId: string) => {
      return this.request<PaymentDto>(`/api/v1/tourist/payments/${paymentId}`, {
        method: 'GET',
      });
    },

    getByBookingId: async (bookingId: string) => {
      return this.request<PaymentDto>(
        `/api/v1/tourist/bookings/${bookingId}/payment`,
        {
          method: 'GET',
        },
      );
    },
  };

  // ==========================================================================
  // TOURIST DEVICE ENDPOINTS (DAY 26)
  // ==========================================================================
  public readonly devices = {
    register: async (payload: {
      deviceToken: string;
      platform: 'ANDROID' | 'IOS';
      deviceId?: string;
    }) => {
      return this.request<RegisterDeviceResponseDto>(
        '/api/v1/tourist/devices',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
    },

    list: async () => {
      return this.request<DeviceListResponseDto>('/api/v1/tourist/devices', {
        method: 'GET',
      });
    },

    unregister: async (deviceId: string) => {
      return this.request<{ message: string }>(
        `/api/v1/tourist/devices/${deviceId}`,
        {
          method: 'DELETE',
        },
      );
    },
  };

  // ==========================================================================
  // TOURIST NOTIFICATION ENDPOINTS (DAY 26)
  // ==========================================================================
  public readonly notifications = {
    list: async (params?: { page?: number; limit?: number; isRead?: 'true' | 'false' | 'all' }) => {
      const queryParts: string[] = [];
      if (params?.page) queryParts.push(`page=${params.page}`);
      if (params?.limit) queryParts.push(`limit=${params.limit}`);
      if (params?.isRead) queryParts.push(`isRead=${params.isRead}`);
      const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

      return this.request<NotificationListResponseDto>(
        `/api/v1/tourist/notifications${qs}`,
        {
          method: 'GET',
        },
      );
    },

    getUnreadCount: async () => {
      return this.request<NotificationUnreadCountDto>(
        '/api/v1/tourist/notifications/unread-count',
        {
          method: 'GET',
        },
      );
    },

    markAsRead: async (notificationId: string) => {
      return this.request<{ notification: NotificationDto }>(
        `/api/v1/tourist/notifications/${notificationId}/read`,
        {
          method: 'PATCH',
        },
      );
    },

    markAllAsRead: async () => {
      return this.request<{ modifiedCount: number; message: string }>(
        '/api/v1/tourist/notifications/read-all',
        {
          method: 'PATCH',
        },
      );
    },

    delete: async (notificationId: string) => {
      return this.request<{ message: string }>(
        `/api/v1/tourist/notifications/${notificationId}`,
        {
          method: 'DELETE',
        },
      );
    },

    getPreferences: async () => {
      return this.request<{ preferences: NotificationPreferencesDto }>(
        '/api/v1/tourist/notifications/preferences',
        {
          method: 'GET',
        },
      );
    },

    updatePreferences: async (payload: UpdateNotificationPreferencesDto) => {
      return this.request<{ preferences: NotificationPreferencesDto }>(
        '/api/v1/tourist/notifications/preferences',
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );
    },
  };
}

export const api = new MobileApiClient();
