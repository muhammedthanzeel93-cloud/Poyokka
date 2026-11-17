import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  BOOKING_HOLD_RULES,
  PROPERTY_STATUSES,
  ROOM_STATUSES,
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
} from '@kerala-tourism/constants';
import {
  BookingDto,
  InventoryHoldDto,
  CreateBookingHoldResponseDto,
  PriceSnapshotDto,
  BookingStatus,
} from '@kerala-tourism/shared-types';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from '../../shared/errors/AppError';
import { BookingsRepository, bookingsRepository } from './bookings.repository';
import { PropertyRepository, propertyRepository } from '../properties/property.repository';
import { RoomRepository, roomRepository } from '../rooms/room.repository';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';
import {
  CreateBookingHoldInput,
  getTodayInKolkata,
  parseCalendarDate,
  generateStayDates,
  calculateNights,
} from './bookings.validation';
import { IBookingLean, IInventoryHoldLean } from './bookings.types';

export class BookingsService {
  private repo: BookingsRepository;
  private propertyRepo: PropertyRepository;
  private roomRepo: RoomRepository;
  private auditService: AuditLogService;

  constructor(
    repo: BookingsRepository = bookingsRepository,
    propertyRepo: PropertyRepository = propertyRepository,
    roomRepo: RoomRepository = roomRepository,
    auditService: AuditLogService = auditLogService,
  ) {
    this.repo = repo;
    this.propertyRepo = propertyRepo;
    this.roomRepo = roomRepo;
    this.auditService = auditService;
  }

  public get repository(): BookingsRepository {
    return this.repo;
  }

  public setRepository(repo: BookingsRepository): void {
    this.repo = repo;
  }

  public setPropertyRepository(repo: PropertyRepository): void {
    this.propertyRepo = repo;
  }

  public setRoomRepository(repo: RoomRepository): void {
    this.roomRepo = repo;
    this.repo.setRoomRepository(repo);
  }

  public setAuditService(service: AuditLogService): void {
    this.auditService = service;
  }

  // ---------------------------------------------------------------------------
  // MAPPER HELPERS
  // ---------------------------------------------------------------------------

  public mapBookingToDto(booking: IBookingLean): BookingDto {
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      touristAccountId: booking.touristAccountId.toString(),
      propertyId: booking.propertyId.toString(),
      roomTypeId: booking.roomTypeId.toString(),
      businessProfileId: booking.businessProfileId.toString(),
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      numberOfRooms: booking.numberOfRooms,
      adults: booking.adults,
      children: booking.children,
      nights: booking.nights,
      status: booking.status,
      holdId: booking.holdId ? booking.holdId.toString() : null,
      paidAt: booking.paidAt ? (booking.paidAt instanceof Date ? booking.paidAt.toISOString() : new Date(booking.paidAt).toISOString()) : null,
      confirmedAt: booking.confirmedAt ? (booking.confirmedAt instanceof Date ? booking.confirmedAt.toISOString() : new Date(booking.confirmedAt).toISOString()) : null,
      paymentId: booking.paymentId ? booking.paymentId.toString() : null,
      paymentReference: booking.paymentReference || null,
      priceSnapshot: booking.priceSnapshot,
      guestDetails: booking.guestDetails,
      createdAt: booking.createdAt instanceof Date ? booking.createdAt.toISOString() : new Date(booking.createdAt).toISOString(),
      updatedAt: booking.updatedAt instanceof Date ? booking.updatedAt.toISOString() : new Date(booking.updatedAt).toISOString(),
    };
  }

  public mapHoldToDto(hold: IInventoryHoldLean): InventoryHoldDto {
    return {
      id: hold._id.toString(),
      bookingId: hold.bookingId.toString(),
      roomTypeId: hold.roomTypeId.toString(),
      propertyId: hold.propertyId.toString(),
      businessProfileId: hold.businessProfileId.toString(),
      touristAccountId: hold.touristAccountId.toString(),
      numberOfRooms: hold.numberOfRooms,
      stayDates: hold.stayDates,
      status: hold.status,
      expiresAt: hold.expiresAt instanceof Date ? hold.expiresAt.toISOString() : new Date(hold.expiresAt).toISOString(),
      createdAt: hold.createdAt instanceof Date ? hold.createdAt.toISOString() : new Date(hold.createdAt).toISOString(),
      updatedAt: hold.updatedAt instanceof Date ? hold.updatedAt.toISOString() : new Date(hold.updatedAt).toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // CREATE BOOKING HOLD
  // ---------------------------------------------------------------------------

  public async createHold(
    touristAccountId: string,
    input: CreateBookingHoldInput,
    idempotencyKey?: string,
  ): Promise<CreateBookingHoldResponseDto> {
    const touristObjId = new Types.ObjectId(touristAccountId);

    // 1. Validate Date Logic against Asia/Kolkata timezone
    const todayInKolkata = getTodayInKolkata();
    if (input.checkInDate < todayInKolkata) {
      throw new BadRequestError(
        `Check-in date (${input.checkInDate}) cannot be in the past relative to ${BOOKING_HOLD_RULES.TIMEZONE} (today: ${todayInKolkata})`,
        'PAST_CHECK_IN_DATE',
      );
    }

    if (input.checkOutDate <= input.checkInDate) {
      throw new BadRequestError(
        'Check-out date must be strictly after check-in date',
        'INVALID_STAY_DATES',
      );
    }

    const nights = calculateNights(input.checkInDate, input.checkOutDate);
    if (nights > BOOKING_HOLD_RULES.MAX_STAY_NIGHTS) {
      throw new BadRequestError(
        `Stay duration cannot exceed ${BOOKING_HOLD_RULES.MAX_STAY_NIGHTS} nights`,
        'MAX_STAY_EXCEEDED',
      );
    }

    // Check advance booking days
    const checkInMs = parseCalendarDate(input.checkInDate).getTime();
    const todayMs = parseCalendarDate(todayInKolkata).getTime();
    const advanceDays = Math.ceil((checkInMs - todayMs) / (24 * 3600 * 1000));
    if (advanceDays > BOOKING_HOLD_RULES.MAX_ADVANCE_DAYS) {
      throw new BadRequestError(
        `Check-in date cannot be more than ${BOOKING_HOLD_RULES.MAX_ADVANCE_DAYS} days in advance`,
        'MAX_ADVANCE_EXCEEDED',
      );
    }

    // 2. Handle Idempotency Key Scoped per Tourist
    let normalizedKey: string | undefined;
    let requestHash: string | undefined;

    if (idempotencyKey && idempotencyKey.trim().length > 0) {
      normalizedKey = idempotencyKey.trim();
      requestHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

      const cachedRecord = await this.repo.findIdempotencyRecord(touristObjId, normalizedKey);
      if (cachedRecord) {
        if (cachedRecord.requestHash !== requestHash) {
          throw new ConflictError(
            'Idempotency key has already been used with a different request payload',
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
          );
        }
        return cachedRecord.responseBody as CreateBookingHoldResponseDto;
      }
    }

    // 3. Verify Property Status & Publication
    const property = await this.propertyRepo.findPropertyById(input.propertyId);
    if (!property || property.status !== PROPERTY_STATUSES.PUBLISHED) {
      throw new NotFoundError(
        'Property not found or is not currently available for booking',
        'PROPERTY_NOT_AVAILABLE',
      );
    }

    // 4. Verify Room Type Status & Property Association
    const roomTypeId = new Types.ObjectId(input.roomTypeId);
    const roomType = await this.roomRepo.findRoomTypeById(roomTypeId);
    if (
      !roomType ||
      roomType.status !== ROOM_STATUSES.ACTIVE ||
      roomType.propertyId.toString() !== input.propertyId
    ) {
      throw new NotFoundError(
        'Room type not found or is not active for this property',
        'ROOM_TYPE_NOT_AVAILABLE',
      );
    }

    // 5. Validate Occupancy Limits against requested number of rooms
    const maxAdultsAllowed = roomType.maxAdults * input.numberOfRooms;
    const maxOccupancyAllowed = roomType.maxOccupancy * input.numberOfRooms;

    if (input.adults > maxAdultsAllowed) {
      throw new BadRequestError(
        `Requested adults (${input.adults}) exceeds maximum adult capacity (${maxAdultsAllowed}) for ${input.numberOfRooms} room(s)`,
        'MAX_ADULTS_EXCEEDED',
      );
    }

    if (input.adults + input.children > maxOccupancyAllowed) {
      throw new BadRequestError(
        `Total guests (${input.adults + input.children}) exceed maximum total capacity (${maxOccupancyAllowed}) for ${input.numberOfRooms} room(s)`,
        'MAX_OCCUPANCY_EXCEEDED',
      );
    }

    // 6. Calculate Price Snapshot in Integer Paise
    const stayDates = generateStayDates(input.checkInDate, input.checkOutDate);
    const basePricePaise = roomType.basePrice;
    const basePriceInr = Math.round(basePricePaise / 100);

    const dailyBreakdown = stayDates.map((date) => ({
      date,
      pricePaise: basePricePaise,
      priceInr: basePriceInr,
    }));

    const subtotalPaise = basePricePaise * input.numberOfRooms * nights;
    const subtotalInr = Math.round(subtotalPaise / 100);
    const taxesPaise = 0;
    const taxesInr = 0;
    const totalPaise = subtotalPaise + taxesPaise;
    const totalInr = subtotalInr + taxesInr;

    const priceSnapshot: PriceSnapshotDto = {
      basePricePaise,
      basePriceInr,
      numberOfRooms: input.numberOfRooms,
      numberOfNights: nights,
      dailyBreakdown,
      subtotalPaise,
      subtotalInr,
      taxesPaise,
      taxesInr,
      totalPaise,
      totalInr,
      currency: roomType.currency || 'INR',
    };

    // 7. Calculate 15-minute Hold Window
    const expiresAt = new Date(
      Date.now() + BOOKING_HOLD_RULES.DEFAULT_HOLD_DURATION_MINUTES * 60 * 1000,
    );

    // 8. Execute Atomic Multi-document Transaction
    const { booking, hold } = await this.repo.withTransaction(async (session) => {
      return this.repo.createBookingWithHold(
        {
          touristAccountId: touristObjId,
          propertyId: new Types.ObjectId(input.propertyId),
          roomTypeId,
          businessProfileId: property.businessProfileId,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          numberOfRooms: input.numberOfRooms,
          adults: input.adults,
          children: input.children,
          nights,
          stayDates,
          priceSnapshot,
          guestDetails: {
            primaryGuestName: input.guestDetails.primaryGuestName,
            email: input.guestDetails.email,
            phone: input.guestDetails.phone,
            specialRequests: input.guestDetails.specialRequests || null,
          },
          expiresAt,
        },
        session,
      );
    });

    // 9. Record Audit Trail
    try {
      await this.auditService.recordAdminAction({
        actorAccountId: touristObjId,
        actorAccountType: 'TOURIST',
        action: ADMIN_AUDIT_ACTIONS.BOOKING_HOLD_CREATED,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.INVENTORY_HOLD,
        targetEntityId: hold._id,
        reason: `Temporary hold created for ${input.numberOfRooms} room(s) from ${input.checkInDate} to ${input.checkOutDate}`,
        beforeState: {},
        afterState: {
          holdId: hold._id.toString(),
          bookingId: booking._id.toString(),
          roomTypeId: input.roomTypeId,
          numberOfRooms: input.numberOfRooms,
          stayDates,
          expiresAt: hold.expiresAt.toISOString(),
        },
      });
    } catch {
      // Non-blocking audit record
    }

    const remainingSeconds = Math.max(
      0,
      Math.ceil((hold.expiresAt.getTime() - Date.now()) / 1000),
    );

    const response: CreateBookingHoldResponseDto = {
      booking: this.mapBookingToDto(booking),
      hold: this.mapHoldToDto(hold),
      expiresAt: hold.expiresAt.toISOString(),
      remainingSeconds,
    };

    // 10. Cache Idempotent Result (24 Hours TTL)
    if (normalizedKey && requestHash) {
      try {
        const idempExpiry = new Date(
          Date.now() + BOOKING_HOLD_RULES.IDEMPOTENCY_KEY_EXPIRY_HOURS * 3600 * 1000,
        );
        await this.repo.saveIdempotencyRecord({
          touristAccountId: touristObjId,
          key: normalizedKey,
          requestHash,
          responseStatus: 201,
          responseBody: response,
          bookingId: booking._id,
          holdId: hold._id,
          expiresAt: idempExpiry,
        });
      } catch {
        // Idempotency cache write failure is non-fatal
      }
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // GET HOLD DETAILS
  // ---------------------------------------------------------------------------

  public async getHoldById(
    holdId: string,
    touristAccountId: string,
  ): Promise<{ hold: InventoryHoldDto; remainingSeconds: number }> {
    const hold = await this.repo.findHoldById(holdId);
    if (!hold || hold.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Inventory hold not found', 'RESOURCE_NOT_FOUND');
    }

    const remainingSeconds = Math.max(
      0,
      Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000),
    );

    return {
      hold: this.mapHoldToDto(hold),
      remainingSeconds,
    };
  }

  // ---------------------------------------------------------------------------
  // RELEASE HOLD (VOLUNTARY TOURIST RELEASE)
  // ---------------------------------------------------------------------------

  public async releaseHold(
    holdId: string,
    touristAccountId: string,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.repo.withTransaction(async (session) => {
      return this.repo.releaseHold(holdId, touristAccountId, session);
    });

    if (!result) {
      throw new NotFoundError(
        'Active inventory hold not found or already released/expired',
        'HOLD_NOT_FOUND',
      );
    }

    try {
      await this.auditService.recordAdminAction({
        actorAccountId: new Types.ObjectId(touristAccountId),
        actorAccountType: 'TOURIST',
        action: ADMIN_AUDIT_ACTIONS.BOOKING_HOLD_RELEASED,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.INVENTORY_HOLD,
        targetEntityId: result.hold._id,
        reason: 'Temporary inventory hold released by tourist; inventory restored',
        beforeState: { status: 'ACTIVE' },
        afterState: { status: 'RELEASED' },
      });
    } catch {
      // Non-blocking audit record
    }

    return {
      success: true,
      message: 'Hold successfully released and inventory returned',
    };
  }

  // ---------------------------------------------------------------------------
  // GET BOOKING BY ID
  // ---------------------------------------------------------------------------

  public async getBookingById(bookingId: string, touristAccountId: string): Promise<BookingDto> {
    const booking = await this.repo.findBookingById(bookingId);
    if (!booking || booking.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Booking not found', 'RESOURCE_NOT_FOUND');
    }
    return this.mapBookingToDto(booking);
  }

  // ---------------------------------------------------------------------------
  // LIST TOURIST BOOKINGS
  // ---------------------------------------------------------------------------

  public async listTouristBookings(
    touristAccountId: string,
    filter: { status?: BookingStatus; page?: number; limit?: number } = {},
  ): Promise<{ items: BookingDto[]; total: number }> {
    const result = await this.repo.listBookings({
      touristAccountId,
      status: filter.status,
      page: filter.page,
      limit: filter.limit,
    });

    return {
      items: result.items.map((b) => this.mapBookingToDto(b)),
      total: result.total,
    };
  }

  // Backward compatibility
  public async getStatus(): Promise<{ status: string; module: string }> {
    return {
      status: 'ready',
      module: 'bookings',
    };
  }
}

export const bookingsService = new BookingsService();
