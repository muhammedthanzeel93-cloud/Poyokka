import mongoose, { ClientSession, FilterQuery, Types } from 'mongoose';
import { env } from '../../config/env';
import { InternalServerError } from '../../shared/errors/AppError';
import { IRoomTypeDocument, RoomTypeModel } from './room-type.model';
import { RoomInventoryModel } from './inventory.model';
import {
  CreateRoomTypePersistenceInput,
  RoomAvailabilityItem,
  RoomInventoryLean,
  RoomTypeLean,
  RoomTypeQueryFilters,
  UpdateInventoryPersistenceInput,
  UpdateRoomTypePersistenceInput,
} from './room.types';
import { ROOM_STATUSES } from '@kerala-tourism/constants';
import { formatCalendarDate } from './room.validation';

const MAX_TX_RETRIES = 8;

const isTransientTransactionError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const maybeErr = err as {
    code?: number;
    errorLabels?: string[];
    hasErrorLabel?: (label: string) => boolean;
  };
  return (
    maybeErr.code === 112 ||
    maybeErr.errorLabels?.includes('TransientTransactionError') === true ||
    (typeof maybeErr.hasErrorLabel === 'function' &&
      maybeErr.hasErrorLabel('TransientTransactionError'))
  );
};

const isUnsupportedTransactionError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : '';
  return (
    message.includes('replica set member') ||
    message.includes('Transaction numbers are only allowed')
  );
};

export class RoomRepository {
  // In-memory backing stores for disconnected unit testing
  public inMemoryRoomTypes: Map<string, RoomTypeLean> = new Map();
  public inMemoryInventory: Map<string, RoomInventoryLean> = new Map();

  private getInventoryKey(roomTypeId: string | Types.ObjectId, date: Date): string {
    const rId = roomTypeId instanceof Types.ObjectId ? roomTypeId.toString() : roomTypeId;
    return `${rId}_${formatCalendarDate(date)}`;
  }

  /**
   * Coordinates multi-document writes in an atomic MongoDB ACID transaction with jittered retries
   */
  public async withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
    const requireTransactions =
      env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

    if (mongoose.connection.readyState === 0) {
      return fn(undefined);
    }

    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt += 1) {
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
              'Room operations require a MongoDB replica set transaction topology',
              'TRANSACTION_REQUIRED',
            );
          }
          return await fn(undefined);
        }

        if (isTransientTransactionError(txError) && attempt < MAX_TX_RETRIES) {
          const jitterMs = 10 + Math.floor(Math.random() * 25);
          await new Promise((resolve) => setTimeout(resolve, jitterMs));
          continue;
        }

        throw txError;
      } finally {
        await session.endSession();
      }
    }

    throw new InternalServerError(
      'Room transaction retries exhausted',
      'TRANSACTION_EXHAUSTED',
    );
  }

  // ============================================================================
  // ROOM TYPE DATA ACCESS
  // ============================================================================

  public async createRoomType(
    data: CreateRoomTypePersistenceInput,
    session?: ClientSession,
  ): Promise<RoomTypeLean> {
    if (mongoose.connection.readyState === 0) {
      const id = new Types.ObjectId();
      const lean: RoomTypeLean = {
        _id: id,
        propertyId: data.propertyId,
        businessProfileId: data.businessProfileId,
        accountId: data.accountId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        roomCategory: data.roomCategory,
        maxAdults: data.maxAdults,
        maxChildren: data.maxChildren,
        maxOccupancy: data.maxOccupancy,
        bedConfiguration: data.bedConfiguration,
        bedCount: data.bedCount,
        roomSize: data.roomSize ?? null,
        roomSizeUnit: data.roomSizeUnit ?? 'SQ_FT',
        facilities: data.facilities ? [...data.facilities] : [],
        basePrice: data.basePrice,
        currency: data.currency ?? 'INR',
        pricingUnit: data.pricingUnit ?? 'PER_NIGHT',
        coverMediaId: data.coverMediaId ?? null,
        galleryMediaIds: data.galleryMediaIds ? [...data.galleryMediaIds] : [],
        status: data.status ?? ROOM_STATUSES.ACTIVE,
        totalUnits: data.totalUnits ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.inMemoryRoomTypes.set(id.toString(), lean);
      return lean;
    }

    const created = await RoomTypeModel.create([data], { session });
    return created[0].toObject();
  }

  public async updateRoomType(
    id: Types.ObjectId,
    data: UpdateRoomTypePersistenceInput,
    session?: ClientSession,
  ): Promise<RoomTypeLean | null> {
    if (mongoose.connection.readyState === 0) {
      const existing = this.inMemoryRoomTypes.get(id.toString());
      if (!existing) return null;

      const updated: RoomTypeLean = {
        ...existing,
        ...data,
        facilities: data.facilities ? [...data.facilities] : existing.facilities,
        galleryMediaIds: data.galleryMediaIds
          ? [...data.galleryMediaIds]
          : existing.galleryMediaIds,
        updatedAt: new Date(),
      };
      this.inMemoryRoomTypes.set(id.toString(), updated);
      return updated;
    }

    return await RoomTypeModel.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true, session },
    )
      .lean<RoomTypeLean>()
      .exec();
  }

  public async findRoomTypeById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<RoomTypeLean | null> {
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryRoomTypes.get(id.toString()) || null;
    }

    return await RoomTypeModel.findById(id).session(session || null).lean<RoomTypeLean>().exec();
  }

  public async findRoomTypeByPropertyAndSlug(
    propertyId: Types.ObjectId,
    slug: string,
    session?: ClientSession,
  ): Promise<RoomTypeLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const room of this.inMemoryRoomTypes.values()) {
        if (room.propertyId.toString() === propertyId.toString() && room.slug === slug) {
          return room;
        }
      }
      return null;
    }

    return await RoomTypeModel.findOne({ propertyId, slug })
      .session(session || null)
      .lean<RoomTypeLean>()
      .exec();
  }

  public async findPropertyRoomTypes(
    propertyId: Types.ObjectId,
    filters: RoomTypeQueryFilters = {},
  ): Promise<RoomTypeLean[]> {
    if (mongoose.connection.readyState === 0) {
      let results = Array.from(this.inMemoryRoomTypes.values()).filter(
        (r) => r.propertyId.toString() === propertyId.toString(),
      );

      if (filters.status) {
        results = results.filter((r) => r.status === filters.status);
      } else {
        // Exclude archived by default unless requested
        results = results.filter((r) => r.status !== ROOM_STATUSES.ARCHIVED);
      }

      if (filters.roomCategory) {
        results = results.filter((r) => r.roomCategory === filters.roomCategory);
      }

      return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const query: FilterQuery<IRoomTypeDocument> = { propertyId };

    if (filters.status) {
      query.status = filters.status;
    } else {
      query.status = { $ne: ROOM_STATUSES.ARCHIVED };
    }

    if (filters.roomCategory) {
      query.roomCategory = filters.roomCategory;
    }

    return await RoomTypeModel.find(query).sort({ createdAt: -1 }).lean<RoomTypeLean[]>().exec();
  }

  public async countRoomTypesBySlugPrefix(
    propertyId: Types.ObjectId,
    slugPrefix: string,
  ): Promise<number> {
    if (mongoose.connection.readyState === 0) {
      let count = 0;
      for (const room of this.inMemoryRoomTypes.values()) {
        if (
          room.propertyId.toString() === propertyId.toString() &&
          room.slug.startsWith(slugPrefix)
        ) {
          count += 1;
        }
      }
      return count;
    }

    const regex = new RegExp(`^${slugPrefix}(-[0-9]+)?$`, 'i');
    return await RoomTypeModel.countDocuments({ propertyId, slug: regex }).exec();
  }

  // ============================================================================
  // INVENTORY DATA ACCESS
  // ============================================================================

  public async upsertInventoryRange(
    propertyId: Types.ObjectId,
    roomTypeId: Types.ObjectId,
    businessProfileId: Types.ObjectId,
    dates: Date[],
    totalUnits: number,
    blockedUnits: number,
    maintenanceUnits: number,
    session?: ClientSession,
  ): Promise<number> {
    const availableUnits = totalUnits - blockedUnits - maintenanceUnits;

    if (mongoose.connection.readyState === 0) {
      let upsertedCount = 0;
      for (const date of dates) {
        const key = this.getInventoryKey(roomTypeId, date);
        const existing = this.inMemoryInventory.get(key);
        const id = existing?._id || new Types.ObjectId();

        const record: RoomInventoryLean = {
          _id: id,
          propertyId,
          roomTypeId,
          businessProfileId,
          date,
          totalUnits,
          availableUnits,
          blockedUnits,
          maintenanceUnits,
          createdAt: existing?.createdAt || new Date(),
          updatedAt: new Date(),
        };

        this.inMemoryInventory.set(key, record);
        upsertedCount += 1;
      }
      return upsertedCount;
    }

    const bulkOps = dates.map((date) => ({
      updateOne: {
        filter: { roomTypeId, date },
        update: {
          $set: {
            propertyId,
            businessProfileId,
            totalUnits,
            availableUnits,
            blockedUnits,
            maintenanceUnits,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await RoomInventoryModel.bulkWrite(bulkOps, { session });
    return (result.upsertedCount || 0) + (result.modifiedCount || 0);
  }

  public async findInventoryByRange(
    roomTypeId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    session?: ClientSession,
  ): Promise<RoomInventoryLean[]> {
    if (mongoose.connection.readyState === 0) {
      const startMs = startDate.getTime();
      const endMs = endDate.getTime();
      const rId = roomTypeId.toString();

      const results: RoomInventoryLean[] = [];
      for (const inv of this.inMemoryInventory.values()) {
        if (inv.roomTypeId.toString() === rId) {
          const invMs = inv.date.getTime();
          if (invMs >= startMs && invMs <= endMs) {
            results.push(inv);
          }
        }
      }

      return results.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    return await RoomInventoryModel.find({
      roomTypeId,
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: 1 })
      .session(session || null)
      .lean<RoomInventoryLean[]>()
      .exec();
  }

  public async findInventoryById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<RoomInventoryLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const inv of this.inMemoryInventory.values()) {
        if (inv._id.toString() === id.toString()) {
          return inv;
        }
      }
      return null;
    }

    return await RoomInventoryModel.findById(id).session(session || null).lean<RoomInventoryLean>().exec();
  }

  public async updateInventoryItem(
    id: Types.ObjectId,
    update: UpdateInventoryPersistenceInput,
    session?: ClientSession,
  ): Promise<RoomInventoryLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const [key, inv] of this.inMemoryInventory.entries()) {
        if (inv._id.toString() === id.toString()) {
          const totalUnits = update.totalUnits !== undefined ? update.totalUnits : inv.totalUnits;
          const blockedUnits =
            update.blockedUnits !== undefined ? update.blockedUnits : inv.blockedUnits;
          const maintenanceUnits =
            update.maintenanceUnits !== undefined ? update.maintenanceUnits : inv.maintenanceUnits;

          const availableUnits = totalUnits - blockedUnits - maintenanceUnits;
          if (availableUnits < 0) {
            return null; // Invariant violation
          }

          const updated: RoomInventoryLean = {
            ...inv,
            totalUnits,
            availableUnits,
            blockedUnits,
            maintenanceUnits,
            updatedAt: new Date(),
          };
          this.inMemoryInventory.set(key, updated);
          return updated;
        }
      }
      return null;
    }

    const current = await RoomInventoryModel.findById(id).session(session || null).exec();
    if (!current) return null;

    const totalUnits = update.totalUnits !== undefined ? update.totalUnits : current.totalUnits;
    const blockedUnits =
      update.blockedUnits !== undefined ? update.blockedUnits : current.blockedUnits;
    const maintenanceUnits =
      update.maintenanceUnits !== undefined ? update.maintenanceUnits : current.maintenanceUnits;

    const availableUnits = totalUnits - blockedUnits - maintenanceUnits;
    if (availableUnits < 0) {
      return null;
    }

    current.totalUnits = totalUnits;
    current.blockedUnits = blockedUnits;
    current.maintenanceUnits = maintenanceUnits;
    current.availableUnits = availableUnits;
    await current.save({ session });

    return current.toObject();
  }

  /**
   * Atomically blocks units for maintenance/hold across dates using conditional updates
   */
  public async conditionalBlockUnits(
    roomTypeId: Types.ObjectId,
    dates: Date[],
    unitsToBlock: number,
    blockType: 'MAINTENANCE' | 'BLOCKED',
    session?: ClientSession,
  ): Promise<boolean> {
    const incField = blockType === 'MAINTENANCE' ? 'maintenanceUnits' : 'blockedUnits';

    if (mongoose.connection.readyState === 0) {
      // In-memory verification: all dates must have availableUnits >= unitsToBlock
      for (const date of dates) {
        const key = this.getInventoryKey(roomTypeId, date);
        const record = this.inMemoryInventory.get(key);
        if (!record || record.availableUnits < unitsToBlock) {
          return false;
        }
      }

      // Apply update
      for (const date of dates) {
        const key = this.getInventoryKey(roomTypeId, date);
        const record = this.inMemoryInventory.get(key)!;
        record[incField] += unitsToBlock;
        record.availableUnits -= unitsToBlock;
        record.updatedAt = new Date();
      }
      return true;
    }

    // MongoDB conditional atomic execution
    for (const date of dates) {
      const updateResult = await RoomInventoryModel.updateOne(
        {
          roomTypeId,
          date,
          availableUnits: { $gte: unitsToBlock },
        },
        {
          $inc: {
            [incField]: unitsToBlock,
            availableUnits: -unitsToBlock,
          },
        },
        { session },
      );

      if (updateResult.matchedCount === 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Atomically unblocks units from maintenance/hold across dates using conditional updates
   */
  public async conditionalUnblockUnits(
    roomTypeId: Types.ObjectId,
    dates: Date[],
    unitsToUnblock: number,
    blockType: 'MAINTENANCE' | 'BLOCKED',
    session?: ClientSession,
  ): Promise<boolean> {
    const decField = blockType === 'MAINTENANCE' ? 'maintenanceUnits' : 'blockedUnits';

    if (mongoose.connection.readyState === 0) {
      for (const date of dates) {
        const key = this.getInventoryKey(roomTypeId, date);
        const record = this.inMemoryInventory.get(key);
        if (!record || record[decField] < unitsToUnblock) {
          return false;
        }
      }

      for (const date of dates) {
        const key = this.getInventoryKey(roomTypeId, date);
        const record = this.inMemoryInventory.get(key)!;
        record[decField] -= unitsToUnblock;
        record.availableUnits += unitsToUnblock;
        record.updatedAt = new Date();
      }
      return true;
    }

    for (const date of dates) {
      const updateResult = await RoomInventoryModel.updateOne(
        {
          roomTypeId,
          date,
          [decField]: { $gte: unitsToUnblock },
        },
        {
          $inc: {
            [decField]: -unitsToUnblock,
            availableUnits: unitsToUnblock,
          },
        },
        { session },
      );

      if (updateResult.matchedCount === 0) {
        return false;
      }
    }

    return true;
  }

  // ============================================================================
  // PUBLIC DISCOVERY & AVAILABILITY
  // ============================================================================

  public async findPublicPropertyRooms(propertyId: Types.ObjectId): Promise<RoomTypeLean[]> {
    return this.findPropertyRoomTypes(propertyId, { status: ROOM_STATUSES.ACTIVE });
  }

  public async findPublicRoomById(roomTypeId: Types.ObjectId): Promise<RoomTypeLean | null> {
    const room = await this.findRoomTypeById(roomTypeId);
    if (!room || room.status !== ROOM_STATUSES.ACTIVE) {
      return null;
    }
    return room;
  }

  public async checkPropertyAvailability(
    propertyId: Types.ObjectId,
    stayDates: Date[],
    requestedRooms: number,
    adults: number,
    children: number,
  ): Promise<RoomAvailabilityItem[]> {
    const activeRooms = await this.findPublicPropertyRooms(propertyId);
    if (activeRooms.length === 0) {
      return [];
    }

    const roomTypeIds = activeRooms.map((r) => r._id);
    const startDate = stayDates[0];
    const endDate = stayDates[stayDates.length - 1];

    let inventoryRecords: RoomInventoryLean[] = [];

    if (mongoose.connection.readyState === 0) {
      const startMs = startDate.getTime();
      const endMs = endDate.getTime();
      const idSet = new Set(roomTypeIds.map((id) => id.toString()));

      for (const inv of this.inMemoryInventory.values()) {
        if (idSet.has(inv.roomTypeId.toString())) {
          const invMs = inv.date.getTime();
          if (invMs >= startMs && invMs <= endMs) {
            inventoryRecords.push(inv);
          }
        }
      }
    } else {
      inventoryRecords = await RoomInventoryModel.find({
        roomTypeId: { $in: roomTypeIds },
        date: { $gte: startDate, $lte: endDate },
      })
        .lean<RoomInventoryLean[]>()
        .exec();
    }

    // Group inventory by roomTypeId
    const invByRoomId = new Map<string, RoomInventoryLean[]>();
    for (const inv of inventoryRecords) {
      const rId = inv.roomTypeId.toString();
      const list = invByRoomId.get(rId) || [];
      list.push(inv);
      invByRoomId.set(rId, list);
    }

    const stayNights = stayDates.length;
    const results: RoomAvailabilityItem[] = [];

    for (const room of activeRooms) {
      const rId = room._id.toString();
      const records = invByRoomId.get(rId) || [];

      // Check if all stay nights have inventory records
      const hasAllDates = records.length === stayNights;
      let minAvailable = 0;

      if (hasAllDates) {
        minAvailable = Math.min(...records.map((rec) => rec.availableUnits));
      }

      const fitsOccupancy =
        requestedRooms * room.maxOccupancy >= adults + children &&
        requestedRooms * room.maxAdults >= adults;

      const isAvailable = hasAllDates && minAvailable >= requestedRooms && fitsOccupancy;
      const totalPrice = stayNights * requestedRooms * room.basePrice;

      results.push({
        roomTypeId: rId,
        name: room.name,
        slug: room.slug,
        roomCategory: room.roomCategory,
        basePrice: room.basePrice,
        currency: room.currency,
        pricingUnit: room.pricingUnit,
        maxAdults: room.maxAdults,
        maxChildren: room.maxChildren,
        maxOccupancy: room.maxOccupancy,
        totalUnits: room.totalUnits,
        availableUnits: Math.max(0, minAvailable),
        isAvailable,
        totalPrice,
        stayNights,
      });
    }

    return results;
  }
}

export const roomRepository = new RoomRepository();
