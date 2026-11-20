import crypto from 'crypto';
import mongoose, { ClientSession, Types, FilterQuery } from 'mongoose';
import { env } from '../../config/env';
import { ConflictError, InternalServerError } from '../../shared/errors/AppError';
import { BOOKING_STATUSES, INVENTORY_HOLD_STATUSES } from '@kerala-tourism/constants';
import { BookingModel, IBookingDocument } from './bookings.model';
import { InventoryHoldModel, IInventoryHoldDocument } from './inventory-hold.model';
import { IdempotencyRecordModel } from './idempotency.model';
import { RoomInventoryModel } from '../rooms/inventory.model';
import { RoomRepository, roomRepository } from '../rooms/room.repository';
import { parseCalendarDate } from './bookings.validation';
import {
  IBookingLean,
  IInventoryHoldLean,
  IIdempotencyRecordLean,
  CreateHoldPersistenceInput,
  BookingListQueryFilter,
  CreateBookingDto,
  BookingQueryFilter,
} from './bookings.types';

const MAX_TX_RETRIES = 3;

const isTransientTransactionError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { hasErrorLabel?: (label: string) => boolean; codeName?: string };
  if (typeof anyErr.hasErrorLabel === 'function') {
    return (
      anyErr.hasErrorLabel('TransientTransactionError') ||
      anyErr.hasErrorLabel('UnknownTransactionCommitResult')
    );
  }
  return anyErr.codeName === 'WriteConflict';
};

const isUnsupportedTransactionError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : '';
  return (
    message.includes('replica set member') ||
    message.includes('Transaction numbers are only allowed')
  );
};

export class BookingsRepository {
  private roomRepo: RoomRepository = roomRepository;

  public setRoomRepository(repo: RoomRepository): void {
    this.roomRepo = repo;
  }

  // In-memory stores for unit testing without MongoDB connection
  public inMemoryBookings: Map<string, IBookingLean> = new Map();
  public inMemoryHolds: Map<string, IInventoryHoldLean> = new Map();
  public inMemoryIdempotency: Map<string, IIdempotencyRecordLean> = new Map();

  public clearInMemory(): void {
    this.inMemoryBookings.clear();
    this.inMemoryHolds.clear();
    this.inMemoryIdempotency.clear();
  }

  public async withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
    const requireTransactions =
      env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

    if (mongoose.connection.readyState === 0) {
      if (requireTransactions) {
        throw new InternalServerError(
          'Production booking operations require a connected MongoDB replica-set transaction topology',
          'TRANSACTION_REQUIRED',
        );
      }
      return await fn(undefined);
    }

    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } catch (txError: unknown) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }

        if (isUnsupportedTransactionError(txError)) {
          if (requireTransactions) {
            throw new InternalServerError(
              'Booking hold operations require a MongoDB replica set transaction topology',
              'TRANSACTION_REQUIRED',
            );
          }
          return await fn(undefined);
        }

        if (isTransientTransactionError(txError) && attempt < MAX_TX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 50));
          continue;
        }

        throw txError;
      } finally {
        await session.endSession();
      }
    }

    throw new InternalServerError(
      'Transaction failed after maximum retries due to concurrent write conflicts',
      'TRANSACTION_RETRY_EXHAUSTED',
    );
  }

  public async findBookingById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IBookingLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryBookings.get(idStr) || null;
    }
    return BookingModel.findById(id).session(session || null).lean<IBookingLean>().exec();
  }

  public async findBookingByReference(
    bookingReference: string,
    session?: ClientSession,
  ): Promise<IBookingLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const booking of this.inMemoryBookings.values()) {
        if (booking.bookingReference.toUpperCase() === bookingReference.trim().toUpperCase()) {
          return booking;
        }
      }
      return null;
    }
    return BookingModel.findOne({ bookingReference: bookingReference.trim().toUpperCase() })
      .session(session || null)
      .lean<IBookingLean>()
      .exec();
  }

  public async findHoldById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IInventoryHoldLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryHolds.get(idStr) || null;
    }
    return InventoryHoldModel.findById(id).session(session || null).lean<IInventoryHoldLean>().exec();
  }

  public async findHoldByBookingId(
    bookingId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IInventoryHoldLean | null> {
    const bIdStr = bookingId.toString();
    if (mongoose.connection.readyState === 0) {
      for (const hold of this.inMemoryHolds.values()) {
        if (hold.bookingId.toString() === bIdStr) {
          return hold;
        }
      }
      return null;
    }
    return InventoryHoldModel.findOne({ bookingId }).session(session || null).lean<IInventoryHoldLean>().exec();
  }

  public async findIdempotencyRecord(
    touristAccountId: string | Types.ObjectId,
    key: string,
    session?: ClientSession,
  ): Promise<IIdempotencyRecordLean | null> {
    const tIdStr = touristAccountId.toString();
    const mapKey = `${tIdStr}:${key.trim()}`;
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryIdempotency.get(mapKey) || null;
    }
    return IdempotencyRecordModel.findOne({ touristAccountId, key: key.trim() })
      .session(session || null)
      .lean<IIdempotencyRecordLean>()
      .exec();
  }

  public async saveIdempotencyRecord(
    data: {
      touristAccountId: Types.ObjectId;
      key: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
      bookingId?: Types.ObjectId | null;
      holdId?: Types.ObjectId | null;
      expiresAt: Date;
    },
    session?: ClientSession,
  ): Promise<IIdempotencyRecordLean> {
    if (mongoose.connection.readyState === 0) {
      const id = new Types.ObjectId();
      const record: IIdempotencyRecordLean = {
        _id: id,
        touristAccountId: data.touristAccountId,
        key: data.key.trim(),
        requestHash: data.requestHash,
        responseStatus: data.responseStatus,
        responseBody: data.responseBody,
        bookingId: data.bookingId ?? null,
        holdId: data.holdId ?? null,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.inMemoryIdempotency.set(`${data.touristAccountId.toString()}:${data.key.trim()}`, record);
      return record;
    }

    const created = await IdempotencyRecordModel.create([data], { session });
    return created[0].toObject();
  }

  public async createBookingWithHold(
    input: CreateHoldPersistenceInput,
    session?: ClientSession,
  ): Promise<{ booking: IBookingLean; hold: IInventoryHoldLean }> {
    // 1. Decrement inventory atomically across all stay dates
    if (mongoose.connection.readyState === 0) {
      // In-memory verification and decrement
      for (const dateStr of input.stayDates) {
        const invKey = `${input.roomTypeId.toString()}:${dateStr}`;
        const record = this.roomRepo.inMemoryInventory.get(invKey);
        if (record) {
          if (record.availableUnits < input.numberOfRooms) {
            throw new ConflictError(
              `Insufficient room inventory available for date: ${dateStr}`,
              'INSUFFICIENT_INVENTORY',
            );
          }
          record.availableUnits -= input.numberOfRooms;
        } else {
          throw new ConflictError(
            `Insufficient room inventory available for date: ${dateStr}`,
            'INSUFFICIENT_INVENTORY',
          );
        }
      }

      const bookingId = new Types.ObjectId();
      const holdId = new Types.ObjectId();
      const bookingReference = `KL-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const booking: IBookingLean = {
        _id: bookingId,
        bookingReference,
        touristAccountId: input.touristAccountId,
        propertyId: input.propertyId,
        roomTypeId: input.roomTypeId,
        businessProfileId: input.businessProfileId,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        numberOfRooms: input.numberOfRooms,
        adults: input.adults,
        children: input.children,
        nights: input.nights,
        status: BOOKING_STATUSES.AWAITING_PAYMENT,
        holdId,
        priceSnapshot: input.priceSnapshot,
        guestDetails: input.guestDetails,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const hold: IInventoryHoldLean = {
        _id: holdId,
        bookingId,
        roomTypeId: input.roomTypeId,
        propertyId: input.propertyId,
        businessProfileId: input.businessProfileId,
        touristAccountId: input.touristAccountId,
        numberOfRooms: input.numberOfRooms,
        stayDates: input.stayDates,
        status: INVENTORY_HOLD_STATUSES.ACTIVE,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.inMemoryBookings.set(bookingId.toString(), booking);
      this.inMemoryHolds.set(holdId.toString(), hold);

      return { booking, hold };
    }

    // Real MongoDB transaction
    for (const dateStr of input.stayDates) {
      const dateObj = parseCalendarDate(dateStr);
      const updateResult = await RoomInventoryModel.updateOne(
        {
          propertyId: input.propertyId,
          roomTypeId: input.roomTypeId,
          date: dateObj,
          availableUnits: { $gte: input.numberOfRooms },
        },
        {
          $inc: { availableUnits: -input.numberOfRooms },
        },
        { session },
      );

      if (updateResult.matchedCount === 0) {
        throw new ConflictError(
          `Insufficient room inventory available for date: ${dateStr}`,
          'INSUFFICIENT_INVENTORY',
        );
      }
    }

    const bookingReference = `KL-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const bookingDocs = await BookingModel.create(
      [
        {
          bookingReference,
          touristAccountId: input.touristAccountId,
          propertyId: input.propertyId,
          roomTypeId: input.roomTypeId,
          businessProfileId: input.businessProfileId,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          numberOfRooms: input.numberOfRooms,
          adults: input.adults,
          children: input.children,
          nights: input.nights,
          status: BOOKING_STATUSES.AWAITING_PAYMENT,
          priceSnapshot: input.priceSnapshot,
          guestDetails: input.guestDetails,
        },
      ],
      { session },
    );
    const bookingDoc = bookingDocs[0];

    const holdDocs = await InventoryHoldModel.create(
      [
        {
          bookingId: bookingDoc._id,
          roomTypeId: input.roomTypeId,
          propertyId: input.propertyId,
          businessProfileId: input.businessProfileId,
          touristAccountId: input.touristAccountId,
          numberOfRooms: input.numberOfRooms,
          stayDates: input.stayDates,
          status: INVENTORY_HOLD_STATUSES.ACTIVE,
          expiresAt: input.expiresAt,
        },
      ],
      { session },
    );
    const holdDoc = holdDocs[0];

    bookingDoc.holdId = holdDoc._id;
    await bookingDoc.save({ session });

    return {
      booking: bookingDoc.toObject(),
      hold: holdDoc.toObject(),
    };
  }

  public async releaseHold(
    holdId: string | Types.ObjectId,
    touristAccountId?: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ booking: IBookingLean; hold: IInventoryHoldLean } | null> {
    const holdIdStr = holdId.toString();

    if (mongoose.connection.readyState === 0) {
      const hold = this.inMemoryHolds.get(holdIdStr);
      if (!hold || hold.status !== INVENTORY_HOLD_STATUSES.ACTIVE) {
        return null;
      }
      if (touristAccountId && hold.touristAccountId.toString() !== touristAccountId.toString()) {
        return null;
      }

      hold.status = INVENTORY_HOLD_STATUSES.RELEASED;
      hold.updatedAt = new Date();

      // Restore inventory
      for (const dateStr of hold.stayDates) {
        const invKey = `${hold.roomTypeId.toString()}:${dateStr}`;
        const record = this.roomRepo.inMemoryInventory.get(invKey);
        if (record) {
          record.availableUnits += hold.numberOfRooms;
        }
      }

      const booking = this.inMemoryBookings.get(hold.bookingId.toString());
      if (booking && booking.status === BOOKING_STATUSES.AWAITING_PAYMENT) {
        booking.status = BOOKING_STATUSES.CANCELLED;
        booking.updatedAt = new Date();
      }

      return { booking: booking!, hold };
    }

    const holdFilter: FilterQuery<IInventoryHoldDocument> = {
      _id: holdId,
      status: INVENTORY_HOLD_STATUSES.ACTIVE,
    };
    if (touristAccountId) {
      holdFilter.touristAccountId = touristAccountId;
    }

    const hold = await InventoryHoldModel.findOneAndUpdate(
      holdFilter,
      { $set: { status: INVENTORY_HOLD_STATUSES.RELEASED } },
      { new: true, session },
    )
      .lean<IInventoryHoldLean>()
      .exec();

    if (!hold) {
      return null;
    }

    // Restore inventory across all stay dates
    for (const dateStr of hold.stayDates) {
      const dateObj = parseCalendarDate(dateStr);
      await RoomInventoryModel.updateOne(
        {
          propertyId: hold.propertyId,
          roomTypeId: hold.roomTypeId,
          date: dateObj,
        },
        {
          $inc: { availableUnits: hold.numberOfRooms },
        },
        { session },
      );
    }

    const booking = await BookingModel.findOneAndUpdate(
      { _id: hold.bookingId, status: BOOKING_STATUSES.AWAITING_PAYMENT },
      { $set: { status: BOOKING_STATUSES.CANCELLED } },
      { new: true, session },
    )
      .lean<IBookingLean>()
      .exec();

    return { booking: booking!, hold };
  }

  public async expireHold(
    holdId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ booking: IBookingLean; hold: IInventoryHoldLean } | null> {
    const holdIdStr = holdId.toString();

    if (mongoose.connection.readyState === 0) {
      const hold = this.inMemoryHolds.get(holdIdStr);
      if (!hold || hold.status !== INVENTORY_HOLD_STATUSES.ACTIVE) {
        return null;
      }

      hold.status = INVENTORY_HOLD_STATUSES.EXPIRED;
      hold.updatedAt = new Date();

      // Restore inventory
      for (const dateStr of hold.stayDates) {
        const invKey = `${hold.roomTypeId.toString()}:${dateStr}`;
        const record = this.roomRepo.inMemoryInventory.get(invKey);
        if (record) {
          record.availableUnits += hold.numberOfRooms;
        }
      }

      const booking = this.inMemoryBookings.get(hold.bookingId.toString());
      if (booking && booking.status === BOOKING_STATUSES.AWAITING_PAYMENT) {
        booking.status = BOOKING_STATUSES.EXPIRED;
        booking.updatedAt = new Date();
      }

      return { booking: booking!, hold };
    }

    const hold = await InventoryHoldModel.findOneAndUpdate(
      { _id: holdId, status: INVENTORY_HOLD_STATUSES.ACTIVE },
      { $set: { status: INVENTORY_HOLD_STATUSES.EXPIRED } },
      { new: true, session },
    )
      .lean<IInventoryHoldLean>()
      .exec();

    if (!hold) {
      return null;
    }

    // Restore inventory across all stay dates
    for (const dateStr of hold.stayDates) {
      const dateObj = parseCalendarDate(dateStr);
      await RoomInventoryModel.updateOne(
        {
          propertyId: hold.propertyId,
          roomTypeId: hold.roomTypeId,
          date: dateObj,
        },
        {
          $inc: { availableUnits: hold.numberOfRooms },
        },
        { session },
      );
    }

    const booking = await BookingModel.findOneAndUpdate(
      { _id: hold.bookingId, status: BOOKING_STATUSES.AWAITING_PAYMENT },
      { $set: { status: BOOKING_STATUSES.EXPIRED } },
      { new: true, session },
    )
      .lean<IBookingLean>()
      .exec();

    return { booking: booking!, hold };
  }

  public async findExpiredActiveHolds(
    now: Date = new Date(),
    limit: number = 50,
  ): Promise<IInventoryHoldLean[]> {
    if (mongoose.connection.readyState === 0) {
      const expired: IInventoryHoldLean[] = [];
      for (const hold of this.inMemoryHolds.values()) {
        if (hold.status === INVENTORY_HOLD_STATUSES.ACTIVE && hold.expiresAt.getTime() <= now.getTime()) {
          expired.push(hold);
          if (expired.length >= limit) break;
        }
      }
      return expired;
    }

    return InventoryHoldModel.find({
      status: INVENTORY_HOLD_STATUSES.ACTIVE,
      expiresAt: { $lte: now },
    })
      .limit(limit)
      .lean<IInventoryHoldLean[]>()
      .exec();
  }

  public async listBookings(
    filter: BookingListQueryFilter = {},
  ): Promise<{ items: IBookingLean[]; total: number }> {
    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(50, Math.max(1, filter.limit || 20));
    const skip = (page - 1) * limit;

    if (mongoose.connection.readyState === 0) {
      let items = Array.from(this.inMemoryBookings.values());
      if (filter.touristAccountId) {
        items = items.filter((b) => b.touristAccountId.toString() === filter.touristAccountId);
      }
      if (filter.businessProfileId) {
        items = items.filter((b) => b.businessProfileId.toString() === filter.businessProfileId);
      }
      if (filter.propertyId) {
        items = items.filter((b) => b.propertyId.toString() === filter.propertyId);
      }
      if (filter.status) {
        items = items.filter((b) => b.status === filter.status);
      }
      const total = items.length;
      const paginated = items.slice(skip, skip + limit);
      return { items: paginated, total };
    }

    const query: FilterQuery<IBookingDocument> = {};
    if (filter.touristAccountId) query.touristAccountId = filter.touristAccountId;
    if (filter.businessProfileId) query.businessProfileId = filter.businessProfileId;
    if (filter.propertyId) query.propertyId = filter.propertyId;
    if (filter.status) query.status = filter.status;

    const [items, total] = await Promise.all([
      BookingModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IBookingLean[]>()
        .exec(),
      BookingModel.countDocuments(query).exec(),
    ]);

    return { items, total };
  }

  public async updateBooking(
    bookingId: string | Types.ObjectId,
    update: Partial<IBookingLean>,
    session?: ClientSession,
  ): Promise<IBookingLean | null> {
    const idStr = bookingId.toString();
    if (mongoose.connection.readyState === 0) {
      const b = this.inMemoryBookings.get(idStr);
      if (!b) return null;
      const updated: IBookingLean = {
        ...b,
        ...update,
        updatedAt: new Date(),
      };
      this.inMemoryBookings.set(idStr, updated);
      return updated;
    }

    return BookingModel.findByIdAndUpdate(
      bookingId,
      { $set: update },
      { new: true, session },
    )
      .lean<IBookingLean>()
      .exec();
  }

  // Backward compatibility methods for Day 05 stubs
  public async findById(id: string): Promise<IBookingLean | null> {
    return this.findBookingById(id);
  }

  public async findByBookingNumber(bookingNumber: string): Promise<IBookingLean | null> {
    return this.findBookingByReference(bookingNumber);
  }

  public async create(data: CreateBookingDto): Promise<IBookingLean> {
    const bookingReference = `KL-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const id = new Types.ObjectId();
    const created: IBookingLean = {
      _id: id,
      bookingReference,
      touristAccountId: new Types.ObjectId(),
      propertyId: new Types.ObjectId(data.propertyId),
      roomTypeId: new Types.ObjectId(data.roomId),
      businessProfileId: new Types.ObjectId(),
      checkInDate: data.checkInTime ? data.checkInTime.split('T')[0] : '2026-12-01',
      checkOutDate: data.checkOutTime ? data.checkOutTime.split('T')[0] : '2026-12-02',
      numberOfRooms: 1,
      adults: data.guestsCount || 1,
      children: 0,
      nights: 1,
      status: BOOKING_STATUSES.AWAITING_PAYMENT,
      priceSnapshot: {
        basePricePaise: (data.totalAmount || 1000) * 100,
        basePriceInr: data.totalAmount || 1000,
        numberOfRooms: 1,
        numberOfNights: 1,
        dailyBreakdown: [],
        subtotalPaise: (data.totalAmount || 1000) * 100,
        subtotalInr: data.totalAmount || 1000,
        taxesPaise: 0,
        taxesInr: 0,
        totalPaise: (data.totalAmount || 1000) * 100,
        totalInr: data.totalAmount || 1000,
        currency: 'INR',
      },
      guestDetails: {
        primaryGuestName: 'Guest',
        email: 'guest@example.com',
        phone: '9876543210',
        specialRequests: data.specialRequests,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryBookings.set(id.toString(), created);
    return created;
  }

  public async list(filter: BookingQueryFilter = {}): Promise<IBookingLean[]> {
    const res = await this.listBookings({
      touristAccountId: filter.touristId,
      propertyId: filter.propertyId,
      status: filter.status,
      limit: filter.limit,
    });
    return res.items;
  }
}

export const bookingsRepository = new BookingsRepository();
