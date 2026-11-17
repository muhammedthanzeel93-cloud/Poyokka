/**
 * Navigation Type Definitions for Kerala Tourism Mobile App
 */

import {
  BookingDto,
  CreateBookingHoldResponseDto,
  PublicPropertyDto,
  PublicRoomTypeDto,
} from '@kerala-tourism/shared-types';

export type RootScreenName =
  | 'Explore'
  | 'PropertyDetails'
  | 'DateGuestSelection'
  | 'BookingReview'
  | 'PaymentCheckout'
  | 'BookingConfirmation'
  | 'BookingHistory'
  | 'BookingDetails'
  | 'NotificationCenter'
  | 'NotificationPreferences'
  | 'Login';

export interface ScreenParamsMap {
  Explore: undefined;
  PropertyDetails: {
    propertyId: string;
    property?: PublicPropertyDto;
  };
  DateGuestSelection: {
    propertyId: string;
    propertyName: string;
    roomType: PublicRoomTypeDto;
  };
  BookingReview: {
    bookingHold: CreateBookingHoldResponseDto;
    propertyId: string;
    propertyName: string;
    roomType: PublicRoomTypeDto;
  };
  PaymentCheckout: {
    bookingId: string;
    bookingReference: string;
    holdId: string;
    propertyName: string;
    totalPaise: number;
    totalInr: number;
  };
  BookingConfirmation: {
    booking: BookingDto;
    propertyName: string;
    paymentReference?: string;
  };
  BookingHistory: undefined;
  BookingDetails: {
    bookingId: string;
  };
  NotificationCenter: undefined;
  NotificationPreferences: undefined;
  Login: {
    returnScreen?: RootScreenName;
    returnParams?: any;
  };
}

export interface NavigationRoute<T extends RootScreenName = RootScreenName> {
  name: T;
  params?: ScreenParamsMap[T];
}
