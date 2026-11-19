import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';

import { DestinationModel } from '../modules/destinations/destinations.model';
import { PostModel } from '../modules/posts/post.model';
import { BookingModel } from '../modules/bookings/bookings.model';
import { InventoryHoldModel } from '../modules/bookings/inventory-hold.model';
import { PaymentModel } from '../modules/payments/payments.model';
import { NotificationModel } from '../modules/notifications/models/notification.model';
import { NotificationOutboxModel } from '../modules/notifications/models/outbox.model';
import { PropertyModel } from '../modules/properties/property.model';
import {
  BOOKING_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_TYPES,
} from '@kerala-tourism/constants';
import {
  resolveTestMongoUri,
  safeDropTestDatabase,
  ValidatedTestDatabase,
} from './test-database-guard';

/**
 * Recursively scans an explain() executionStages tree to find any stage with the given name
 */
const findStage = (stage: any, name: string): any => {
  if (!stage) return null;
  if (stage.stage === name) return stage;
  if (stage.inputStage) {
    const found = findStage(stage.inputStage, name);
    if (found) return found;
  }
  if (Array.isArray(stage.inputStages)) {
    for (const child of stage.inputStages) {
      const found = findStage(child, name);
      if (found) return found;
    }
  }
  return null;
};

describe('DAY 28 — Performance Benchmark & Query Optimization Suite', () => {
  let hasLiveMongo = false;
  let validatedDb: ValidatedTestDatabase | null = null;

  const testTouristId = new Types.ObjectId();
  const testBusinessId = new Types.ObjectId();
  const testPropertyId = new Types.ObjectId();

  before(async () => {
    // 1. Resolve & validate TEST_MONGO_URL (fails immediately on missing or unsafe configuration)
    validatedDb = resolveTestMongoUri();

    // 2. Safely attempt connection to the validated test database
    try {
      await mongoose.connect(validatedDb.uri, {
        serverSelectionTimeoutMS: 1500,
        connectTimeoutMS: 2000,
      });
      hasLiveMongo = true;
    } catch {
      // Handle connection failure safely without masking safety-validation errors
      hasLiveMongo = false;
    }

    if (hasLiveMongo) {
      // 3. Destructive cleanup permitted ONLY against the validated test database
      await safeDropTestDatabase(mongoose.connection, validatedDb);

      // Build all indexes
      await Promise.all([
        DestinationModel.init(),
        PostModel.init(),
        BookingModel.init(),
        InventoryHoldModel.init(),
        PaymentModel.init(),
        NotificationModel.init(),
        NotificationOutboxModel.init(),
        PropertyModel.init(),
      ]);

      // Seed Representative Datasets
        const districts = ['Wayanad', 'Idukki', 'Ernakulam', 'Alappuzha', 'Kozhikode'];
        const destinations = [];
        for (let i = 0; i < 50; i++) {
          destinations.push({
            name: `Scenic Destination ${i}`,
            slug: `scenic-destination-${i}`,
            description: 'Pristine Kerala backwater and hill station sanctuary',
            district: districts[i % districts.length],
            locality: 'Local Area',
            location: {
              type: 'Point' as const,
              coordinates: [76.2 + i * 0.01, 10.5 + i * 0.01],
            },
            category: 'NATURE',
            status: i % 5 === 0 ? 'DRAFT' : 'PUBLISHED',
            rating: 3.5 + (i % 15) * 0.1,
            reviewCount: i * 3,
            createdAt: new Date(Date.now() - i * 3600000),
          });
        }
        await DestinationModel.insertMany(destinations);

        const posts = [];
        for (let i = 0; i < 60; i++) {
          posts.push({
            authorAccountId: i % 2 === 0 ? testTouristId : new Types.ObjectId(),
            caption: `Exploring beautiful Kerala #${i}`,
            media: [],
            likesCount: i * 5,
            commentsCount: i * 2,
            isPublished: i % 10 !== 0,
            createdAt: new Date(Date.now() - i * 1800000),
          });
        }
        await PostModel.insertMany(posts);

        const bookings = [];
        const statuses = [
          BOOKING_STATUSES.CONFIRMED,
          BOOKING_STATUSES.AWAITING_PAYMENT,
          BOOKING_STATUSES.CANCELLED,
        ];
        for (let i = 0; i < 40; i++) {
          bookings.push({
            bookingReference: `BK-PERF-${1000 + i}`,
            touristAccountId: i % 3 === 0 ? testTouristId : new Types.ObjectId(),
            businessProfileId: testBusinessId,
            propertyId: testPropertyId,
            roomTypeId: new Types.ObjectId(),
            checkInDate: '2026-12-01',
            checkOutDate: '2026-12-04',
            stayDates: ['2026-12-01', '2026-12-02', '2026-12-03'],
            numberOfNights: 3,
            numberOfRooms: 1,
            totalAmount: 9000,
            currency: 'INR',
            status: statuses[i % statuses.length],
            idempotencyKey: `idemp-bk-${i}`,
            createdAt: new Date(Date.now() - i * 7200000),
          });
        }
        await BookingModel.insertMany(bookings);

        const notifications = [];
        const outboxItems = [];
        for (let i = 0; i < 50; i++) {
          const notifId = new Types.ObjectId();
          notifications.push({
            _id: notifId,
            recipientAccountId: i % 2 === 0 ? testTouristId : new Types.ObjectId(),
            notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
            title: `Booking Update ${i}`,
            body: `Your booking BK-PERF-${1000 + i} status update`,
            isRead: i % 3 === 0,
            deliveryStatus: NOTIFICATION_DELIVERY_STATUSES.DELIVERED,
            createdAt: new Date(Date.now() - i * 900000),
          });

          outboxItems.push({
            notificationId: notifId,
            recipientAccountId: i % 2 === 0 ? testTouristId : new Types.ObjectId(),
            idempotencyKey: `outbox-key-${i}`,
            eventType: 'BOOKING_UPDATE',
            payload: { title: `Push ${i}`, body: `Body ${i}` },
            status:
              i % 4 === 0
                ? NOTIFICATION_DELIVERY_STATUSES.PENDING
                : NOTIFICATION_DELIVERY_STATUSES.DELIVERED,
            attempts: i % 2,
            maxAttempts: 5,
            nextRetryAt: new Date(Date.now() - i * 60000),
            createdAt: new Date(Date.now() - i * 60000),
          });
        }
        await NotificationModel.insertMany(notifications);
        await NotificationOutboxModel.insertMany(outboxItems);

        const properties = [];
        for (let i = 0; i < 30; i++) {
          properties.push({
            title: `Kerala Luxury Villa ${i}`,
            slug: `kerala-luxury-villa-${i}`,
            description: 'Exquisite backwater and plantation retreat',
            businessProfileId: testBusinessId,
            propertyType: 'RESORT',
            status: 'PUBLISHED',
            isVerified: true,
            address: {
              street: `${i} Coconut Grove`,
              locality: 'Kumarakom',
              district: 'Kottayam',
              pincode: '686563',
              state: 'Kerala',
            },
            location: {
              type: 'Point' as const,
              coordinates: [76.4 + i * 0.01, 9.6 + i * 0.01],
            },
            rating: 4.2 + (i % 8) * 0.1,
            reviewCount: i * 4,
            createdAt: new Date(Date.now() - i * 3600000),
          });
        }
        await PropertyModel.insertMany(properties);
      }
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      if (hasLiveMongo && validatedDb) {
        await safeDropTestDatabase(mongoose.connection, validatedDb);
      }
      await mongoose.disconnect();
    }
  });

  test('1. Schema Index Inventory - Redundant Indexes Are Completely Removed', () => {
    const bookingIndexes = BookingModel.schema.indexes();
    const holdIndexes = InventoryHoldModel.schema.indexes();
    const paymentIndexes = PaymentModel.schema.indexes();
    const notifIndexes = NotificationModel.schema.indexes();
    const outboxIndexes = NotificationOutboxModel.schema.indexes();

    // Verify BookingModel has no standalone redundant single-field indexes
    const bookingSingleField = bookingIndexes.filter(([keys]) => Object.keys(keys).length === 1);
    const bookingSingleKeys = bookingSingleField.map(([keys]) => Object.keys(keys)[0]);
    assert.strictEqual(
      bookingSingleKeys.includes('touristAccountId'),
      false,
      'touristAccountId single index must be eliminated in favor of compound index',
    );
    assert.strictEqual(
      bookingSingleKeys.includes('status'),
      false,
      'status single index must be eliminated in favor of compound index',
    );
    assert.strictEqual(
      bookingSingleKeys.includes('propertyId'),
      false,
      'propertyId single index must be eliminated in favor of compound index',
    );

    // Verify InventoryHoldModel has no standalone redundant single-field indexes
    const holdSingleField = holdIndexes.filter(([keys]) => Object.keys(keys).length === 1);
    const holdSingleKeys = holdSingleField.map(([keys]) => Object.keys(keys)[0]);
    assert.strictEqual(
      holdSingleKeys.includes('touristAccountId'),
      false,
      'Hold touristAccountId single index must be eliminated',
    );
    assert.strictEqual(
      holdSingleKeys.includes('status'),
      false,
      'Hold status single index must be eliminated',
    );

    // Verify PaymentModel has no redundant single-field indexes
    const paymentSingleField = paymentIndexes.filter(([keys]) => Object.keys(keys).length === 1);
    const paymentSingleKeys = paymentSingleField.map(([keys]) => Object.keys(keys)[0]);
    assert.strictEqual(
      paymentSingleKeys.includes('bookingId'),
      false,
      'Payment bookingId single index must be eliminated',
    );
    assert.strictEqual(
      paymentSingleKeys.includes('providerOrderId'),
      false,
      'Payment providerOrderId single index must be eliminated',
    );

    // Verify NotificationModel has no redundant single-field indexes
    const notifSingleField = notifIndexes.filter(([keys]) => Object.keys(keys).length === 1);
    const notifSingleKeys = notifSingleField.map(([keys]) => Object.keys(keys)[0]);
    assert.strictEqual(
      notifSingleKeys.includes('recipientAccountId'),
      false,
      'Notification recipientAccountId single index must be eliminated in favor of compound index',
    );
    assert.strictEqual(
      notifSingleKeys.includes('isRead'),
      false,
      'Notification isRead single index must be eliminated in favor of compound index',
    );

    // Verify OutboxModel has no redundant single-field indexes
    const outboxSingleField = outboxIndexes.filter(([keys]) => Object.keys(keys).length === 1);
    const outboxSingleKeys = outboxSingleField.map(([keys]) => Object.keys(keys)[0]);
    assert.strictEqual(
      outboxSingleKeys.includes('status'),
      false,
      'Outbox status single index must be eliminated in favor of compound index',
    );
    assert.strictEqual(
      outboxSingleKeys.includes('nextRetryAt'),
      false,
      'Outbox nextRetryAt single index must be eliminated in favor of compound index',
    );
  });

  test('2. Compound ESR Indexes Architecture Verification', () => {
    // 1. Booking ESR index: { touristAccountId: 1, status: 1, createdAt: -1 }
    const bookingIndexes = BookingModel.schema.indexes();
    const hasBookingEsr = bookingIndexes.some(([keys]) => {
      const entries = Object.entries(keys);
      return (
        entries.length === 3 &&
        entries[0][0] === 'touristAccountId' &&
        entries[1][0] === 'status' &&
        entries[2][0] === 'createdAt'
      );
    });
    assert.ok(hasBookingEsr, 'BookingModel must declare compound ESR index { touristAccountId: 1, status: 1, createdAt: -1 }');

    // 2. Notification feed compound index: { recipientAccountId: 1, createdAt: -1 }
    const notifIndexes = NotificationModel.schema.indexes();
    const hasNotifFeed = notifIndexes.some(([keys]) => {
      const entries = Object.entries(keys);
      return entries.length === 2 && entries[0][0] === 'recipientAccountId' && entries[1][0] === 'createdAt';
    });
    assert.ok(hasNotifFeed, 'NotificationModel must declare compound index { recipientAccountId: 1, createdAt: -1 }');

    // 3. Outbox worker queue compound index: { status: 1, nextRetryAt: 1, lockedAt: 1 }
    const outboxIndexes = NotificationOutboxModel.schema.indexes();
    const hasOutboxQueue = outboxIndexes.some(([keys]) => {
      const entries = Object.entries(keys);
      return (
        entries.length === 3 &&
        entries[0][0] === 'status' &&
        entries[1][0] === 'nextRetryAt' &&
        entries[2][0] === 'lockedAt'
      );
    });
    assert.ok(hasOutboxQueue, 'NotificationOutboxModel must declare compound index { status: 1, nextRetryAt: 1, lockedAt: 1 }');

    // 4. Destinations 2dsphere index on location
    const destIndexes = DestinationModel.schema.indexes();
    const has2dsphere = destIndexes.some(([keys]) => keys.location === '2dsphere');
    assert.ok(has2dsphere, 'DestinationModel must declare 2dsphere index on location');

    // 5. Post Feed compound index: { visibility: 1, status: 1, deletedAt: 1, publishedAt: -1, _id: -1 }
    const postIndexes = PostModel.schema.indexes();
    const hasPostFeed = postIndexes.some(([keys]) => {
      return (
        keys.visibility === 1 &&
        keys.status === 1 &&
        keys.publishedAt === -1 &&
        keys._id === -1
      );
    });
    assert.ok(hasPostFeed, 'PostModel must declare compound index idx_public_feed on published feed');
  });

  test('3. Explain Plan Execution Verification (Live MongoDB)', async () => {
    if (!hasLiveMongo) {
      assert.ok(
        true,
        'Live explain plans skipped (MongoDB host unreachable at validated TEST_MONGO_URL); schema verified',
      );
      return;
    }

    // Destinations public filter & sort
    const destExplain: any = await DestinationModel.find({ status: 'PUBLISHED', district: 'Wayanad' })
      .sort({ rating: -1, createdAt: -1 })
      .explain('executionStats');
    const destStages = destExplain.executionStats.executionStages;
    assert.ok(findStage(destStages, 'IXSCAN'), 'Destinations query must use IXSCAN');
    assert.strictEqual(findStage(destStages, 'SORT'), null, 'Destinations query must not use in-memory SORT');

    // Social Feed
    const postExplain: any = await PostModel.find({ isPublished: true })
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .explain('executionStats');
    const postStages = postExplain.executionStats.executionStages;
    assert.ok(findStage(postStages, 'IXSCAN'), 'Social feed query must use IXSCAN');
    assert.strictEqual(findStage(postStages, 'SORT'), null, 'Social feed must not use in-memory SORT');

    // Bookings
    const bookingExplain: any = await BookingModel.find({
      touristAccountId: testTouristId,
      status: BOOKING_STATUSES.CONFIRMED,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .explain('executionStats');
    const bookingStages = bookingExplain.executionStats.executionStages;
    assert.ok(findStage(bookingStages, 'IXSCAN'), 'Bookings query must use IXSCAN');
    assert.strictEqual(findStage(bookingStages, 'SORT'), null, 'Bookings query must not use in-memory SORT');
  });
});
