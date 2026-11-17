import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  BOOKING_STATUSES,
  BUSINESS_TYPES,
  DESTINATION_PUBLICATION_STATUSES,
  DESTINATION_VERIFICATION_STATUSES,
  INVENTORY_HOLD_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_TYPES,
  POST_STATUSES,
  POST_VISIBILITIES,
  PROPERTY_STATUSES,
  ROOM_CATEGORIES,
  ROOM_PRICING_UNITS,
  ROOM_STATUSES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import {
  AuthRepository,
  CreateAccountInput,
  CreateBusinessProfileInput,
  CreateSessionInput,
  CreateTouristProfileInput,
} from '../modules/auth/auth.repository';
import { authService } from '../modules/auth/auth.service';
import { destinationsService } from '../modules/destinations/destinations.service';
import { DestinationsRepository } from '../modules/destinations/destinations.repository';
import { postsService } from '../modules/posts/post.service';
import { PostsRepository } from '../modules/posts/post.repository';
import { postEngagementService } from '../modules/posts/post-engagement.service';
import { PostEngagementRepository } from '../modules/posts/post-engagement.repository';
import { followService } from '../modules/users/follow.service';
import { FollowRepository } from '../modules/users/follow.repository';
import { propertyService } from '../modules/properties/property.service';
import { PropertyRepository, propertyRepository } from '../modules/properties/property.repository';
import { roomService } from '../modules/rooms/room.service';
import { RoomRepository, roomRepository } from '../modules/rooms/room.repository';
import { bookingsService } from '../modules/bookings/bookings.service';
import { BookingsRepository } from '../modules/bookings/bookings.repository';
import { paymentsService } from '../modules/payments/payments.service';
import { PaymentsRepository } from '../modules/payments/payments.repository';
import { webhookService } from '../modules/payments/webhook.service';
import { RazorpayPaymentProvider } from '../modules/payments/providers/razorpay.provider';
import { notificationService } from '../modules/notifications/notification.service';
import { NotificationRepository } from '../modules/notifications/notification.repository';
import { NotificationDeliveryWorker } from '../modules/notifications/delivery/delivery.worker';
import { INotificationProvider } from '../modules/notifications/providers/notification-provider.interface';
import { AuditLogService, RecordAdminAuditInput } from '../modules/admin/audit-log.service';
import {
  IAccountDocument,
  IAdminProfileDocument,
  IBusinessProfileDocument,
  IDestinationDocument,
  IDestinationSubmissionDocument,
  ISessionDocument,
  ITouristProfileDocument,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { dispatchRequest as rawDispatchRequest } from './testUtils';
import { getTodayInKolkata } from '../modules/bookings/bookings.validation';

// Helper to wrap dispatchRequest with Bearer token injection
const dispatch = async (
  appInstance: any,
  method: string,
  url: string,
  options: { token?: string; headers?: Record<string, string>; body?: unknown } = {},
) => {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  const response = await rawDispatchRequest<any>(appInstance, {
    method,
    url,
    headers,
    body: options.body,
  });
  if (response.body && response.body.error && !response.body.message) {
    response.body.message = response.body.error.message;
  }
  return response;
};

// ============================================================================
// TEST DOUBLES & IN-MEMORY REPOSITORIES
// ============================================================================

class InMemoryAuthRepo extends AuthRepository {
  public accounts = new Map<string, IAccountDocument>();
  public accountsById = new Map<string, IAccountDocument>();
  public touristProfiles = new Map<string, ITouristProfileDocument>();
  public businessProfiles = new Map<string, IBusinessProfileDocument>();
  public adminProfiles = new Map<string, IAdminProfileDocument>();
  public sessions = new Map<string, ISessionDocument>();

  public override async withTransaction<T>(fn: (session?: any) => Promise<T>): Promise<T> {
    return await fn({} as any);
  }

  public override async findAccountByEmail(email: string): Promise<IAccountDocument | null> {
    return this.accounts.get(email.trim().toLowerCase()) || null;
  }

  public override async findAccountWithPassword(email: string): Promise<IAccountDocument | null> {
    return this.accounts.get(email.trim().toLowerCase()) || null;
  }

  public override async findAccountById(id: Types.ObjectId | string): Promise<IAccountDocument | null> {
    return this.accountsById.get(id.toString()) || null;
  }

  public override async updateLastLogin(accountId: Types.ObjectId | string): Promise<void> {
    const acc = this.accountsById.get(accountId.toString());
    if (acc) acc.lastLoginAt = new Date();
  }

  public override async createAccount(data: CreateAccountInput): Promise<IAccountDocument> {
    const id = new Types.ObjectId();
    const normalized = data.email.trim().toLowerCase();
    const doc = {
      _id: id,
      id: id.toString(),
      email: normalized,
      passwordHash: data.passwordHash,
      accountType: data.accountType,
      status: data.status || ACCOUNT_STATUSES.ACTIVE,
      emailVerifiedAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IAccountDocument;

    this.accounts.set(normalized, doc);
    this.accountsById.set(id.toString(), doc);
    return doc;
  }

  public override async createTouristProfile(data: CreateTouristProfileInput): Promise<ITouristProfileDocument> {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      accountId: new Types.ObjectId(data.accountId.toString()),
      firstName: data.firstName,
      lastName: data.lastName,
      preferredLanguage: 'EN',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ITouristProfileDocument;

    this.touristProfiles.set(data.accountId.toString(), doc);
    return doc;
  }

  public override async createBusinessProfile(data: CreateBusinessProfileInput): Promise<IBusinessProfileDocument> {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      accountId: new Types.ObjectId(data.accountId.toString()),
      businessName: data.businessName,
      businessType: data.businessType,
      contactNumber: data.contactNumber,
      verificationStatus: data.verificationStatus || VERIFICATION_STATUSES.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IBusinessProfileDocument;

    this.businessProfiles.set(data.accountId.toString(), doc);
    return doc;
  }

  public override async findTouristProfile(accountId: Types.ObjectId | string): Promise<ITouristProfileDocument | null> {
    return this.touristProfiles.get(accountId.toString()) || null;
  }

  public async findBusinessProfileByAccountId(accountId: Types.ObjectId | string): Promise<IBusinessProfileDocument | null> {
    return this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async findBusinessProfile(accountId: Types.ObjectId | string): Promise<IBusinessProfileDocument | null> {
    return this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async findAdminProfile(accountId: Types.ObjectId | string): Promise<IAdminProfileDocument | null> {
    return this.adminProfiles.get(accountId.toString()) || null;
  }

  public override async findProfileByAccountId(
    accountId: Types.ObjectId | string,
    accountType: string,
  ): Promise<any> {
    const idStr = accountId.toString();
    if (accountType === ACCOUNT_TYPES.TOURIST) {
      return this.touristProfiles.get(idStr) || null;
    }
    if (accountType === ACCOUNT_TYPES.BUSINESS) {
      return this.businessProfiles.get(idStr) || null;
    }
    if (accountType === ACCOUNT_TYPES.ADMIN) {
      return this.adminProfiles.get(idStr) || null;
    }
    return null;
  }

  public setAdminProfile(accountId: string, profile: Partial<IAdminProfileDocument>): IAdminProfileDocument {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      accountId: new Types.ObjectId(accountId),
      displayName: profile.displayName || 'State Tourism Officer',
      permissions: profile.permissions || [],
      adminLevel: profile.adminLevel || 'STATE_ADMIN',
      mfaEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IAdminProfileDocument;
    this.adminProfiles.set(accountId, doc);
    return doc;
  }

  public override async createSession(data: CreateSessionInput): Promise<ISessionDocument> {
    const id = new Types.ObjectId();
    const doc: any = {
      _id: id,
      id: id.toString(),
      accountId: new Types.ObjectId(data.accountId.toString()),
      refreshTokenHash: data.refreshTokenHash,
      familyId: data.familyId,
      replacedByTokenHash: null,
      lastUsedAt: null,
      revocationReason: null,
      deviceInformation: data.deviceInformation || {},
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isExpired() { return Date.now() >= this.expiresAt.getTime(); },
      isRevoked() { return this.revokedAt !== null; },
      isValid() { return !this.isExpired() && !this.isRevoked(); },
      revoke(reason?: string) {
        this.revokedAt = new Date();
        if (reason) this.revocationReason = reason;
      },
    };

    this.sessions.set(data.refreshTokenHash, doc);
    return doc as unknown as ISessionDocument;
  }

  public override async findSessionByHash(refreshTokenHash: string): Promise<ISessionDocument | null> {
    return this.sessions.get(refreshTokenHash) || null;
  }

  public override async rotateSessionAtomic(
    oldHash: string,
    newHash: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<ISessionDocument | null> {
    const oldSession = this.sessions.get(oldHash);
    const now = new Date();
    if (!oldSession || oldSession.revokedAt !== null || oldSession.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    oldSession.revokedAt = now;
    oldSession.revocationReason = 'ROTATED';
    oldSession.replacedByTokenHash = newHash;
    oldSession.lastUsedAt = now;

    const id = new Types.ObjectId();
    const newSession: any = {
      _id: id,
      id: id.toString(),
      accountId: oldSession.accountId,
      refreshTokenHash: newHash,
      familyId,
      replacedByTokenHash: null,
      lastUsedAt: null,
      revocationReason: null,
      deviceInformation: oldSession.deviceInformation,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
      isExpired() { return Date.now() >= this.expiresAt.getTime(); },
      isRevoked() { return this.revokedAt !== null; },
      isValid() { return !this.isExpired() && !this.isRevoked(); },
      revoke(reason?: string) {
        this.revokedAt = new Date();
        if (reason) this.revocationReason = reason;
      },
    };

    this.sessions.set(newHash, newSession);
    return newSession as unknown as ISessionDocument;
  }

  public override async revokeFamilySessions(familyId: string, reason = 'REUSE_DETECTED'): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId && !session.revokedAt) {
        session.revokedAt = now;
        session.revocationReason = reason;
        count++;
      }
    }
    return count;
  }

  public override async revokeSessionByHash(refreshTokenHash: string, reason = 'USER_LOGOUT'): Promise<boolean> {
    const session = this.sessions.get(refreshTokenHash);
    if (!session || session.revokedAt) return false;
    session.revokedAt = new Date();
    session.revocationReason = reason;
    return true;
  }
}

class InMemoryDestinationsRepo extends DestinationsRepository {
  public destinations = new Map<string, IDestinationDocument>();
  public submissions = new Map<string, IDestinationSubmissionDocument>();

  public override async findPublishedDestinations(query: any): Promise<{ items: IDestinationDocument[]; total: number }> {
    let list = Array.from(this.destinations.values()).filter(
      (d) =>
        d.verificationStatus === DESTINATION_VERIFICATION_STATUSES.VERIFIED &&
        d.publicationStatus === DESTINATION_PUBLICATION_STATUSES.PUBLISHED,
    );

    if (query.district) {
      list = list.filter((d) => d.district.toLowerCase() === query.district.toLowerCase());
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));
    }
    return { items: list, total: list.length };
  }

  public override async findNearbyDestinations(_query: any): Promise<{ items: any[]; total: number }> {
    const list = Array.from(this.destinations.values()).map((d) => ({
      _id: d._id,
      name: d.name,
      slug: d.slug,
      description: d.description,
      district: d.district,
      location: d.location,
      images: d.images,
      categoryIds: d.categoryIds || [],
      distanceMeters: 5000,
      distanceKm: 5,
    }));
    return { items: list, total: list.length };
  }

  public override async createSubmission(data: any): Promise<IDestinationSubmissionDocument> {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      ...data,
      submittedBy: new Types.ObjectId(data.submittedBy.toString()),
      submissionStatus: data.submissionStatus || 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IDestinationSubmissionDocument;
    this.submissions.set(id.toString(), doc);
    return doc;
  }

  public override async findDestinationById(id: string | Types.ObjectId): Promise<IDestinationDocument | null> {
    return this.destinations.get(id.toString()) || null;
  }

  public override async createDestination(data: any): Promise<IDestinationDocument> {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      ...data,
      verificationStatus: data.verificationStatus || DESTINATION_VERIFICATION_STATUSES.VERIFIED,
      publicationStatus: data.publicationStatus || DESTINATION_PUBLICATION_STATUSES.PUBLISHED,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IDestinationDocument;
    this.destinations.set(id.toString(), doc);
    return doc;
  }
}

class InMemoryPostsRepo extends PostsRepository {
  public posts = new Map<string, any>();

  constructor(private authStore: InMemoryAuthRepo) {
    super();
  }

  public override async createPost(data: any): Promise<any> {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      authorId: data.authorId,
      content: data.content,
      mediaIds: data.mediaIds || [],
      destinationId: data.destinationId || null,
      visibility: data.visibility || POST_VISIBILITIES.PUBLIC,
      status: data.status || POST_STATUSES.PUBLISHED,
      likeCount: 0,
      commentCount: 0,
      repostCount: 0,
      publishedAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.posts.set(id.toString(), doc);
    return doc;
  }

  public override async findPublicFeed(_options: any): Promise<{ items: any[]; total: number }> {
    const list = Array.from(this.posts.values()).filter(
      (p) => p.visibility === POST_VISIBILITIES.PUBLIC && p.status === POST_STATUSES.PUBLISHED && !p.deletedAt,
    );
    return { items: list, total: list.length };
  }

  public override async findById(id: string | Types.ObjectId): Promise<any | null> {
    return this.posts.get(id.toString()) || null;
  }

  public override async findPublicPostById(postId: string | Types.ObjectId): Promise<any | null> {
    const post = this.posts.get(postId.toString());
    if (!post || post.visibility !== POST_VISIBILITIES.PUBLIC || post.status !== POST_STATUSES.PUBLISHED || post.deletedAt) {
      return null;
    }
    return post;
  }

  public override async findTouristProfilesByAccountIds(accountIds: string[]): Promise<any[]> {
    const results: any[] = [];
    for (const id of accountIds) {
      const p = this.authStore.touristProfiles.get(id);
      if (p) results.push(p);
    }
    return results;
  }

  public async findPostsByAuthorIds(authorIds: string[], _options: any): Promise<{ items: any[]; total: number }> {
    const authorSet = new Set(authorIds.map((id) => id.toString()));
    const list = Array.from(this.posts.values()).filter(
      (p) => authorSet.has(p.authorId.toString()) && !p.deletedAt && p.status === POST_STATUSES.PUBLISHED,
    );
    return { items: list, total: list.length };
  }

  public followRepoRef?: InMemoryFollowRepo;

  public override async findFollowingFeed(
    viewerId: string | Types.ObjectId,
    _options: any,
  ): Promise<{ items: any[]; hasMore: boolean }> {
    const followingIds = new Set<string>();
    if (this.followRepoRef) {
      for (const [key] of this.followRepoRef.follows.entries()) {
        const [fId, targetId] = key.split(':');
        if (fId === viewerId.toString()) {
          followingIds.add(targetId);
        }
      }
    }
    const list = Array.from(this.posts.values()).filter(
      (p) => followingIds.has(p.authorId.toString()) && p.status === POST_STATUSES.PUBLISHED && !p.deletedAt,
    );
    return { items: list, hasMore: false };
  }
}

class InMemoryEngagementRepo extends PostEngagementRepository {
  public likes = new Map<string, any>();
  public reposts = new Map<string, any>();
  public comments = new Map<string, any>();

  constructor(private postsStore: InMemoryPostsRepo) {
    super();
  }

  public override async withTransaction<T>(fn: (session?: any) => Promise<T>): Promise<T> {
    return await fn({ inTransaction: () => true } as any);
  }

  public override async findEligiblePublicPostById(postId: string | Types.ObjectId): Promise<any | null> {
    return this.postsStore.findPublicPostById(postId);
  }

  private likeKey(accountId: any, postId: any): string {
    return `${accountId.toString()}:${postId.toString()}`;
  }

  private repostKey(accountId: any, postId: any): string {
    return `${accountId.toString()}:${postId.toString()}`;
  }

  public override async findPostLike(accountId: any, postId: any): Promise<any | null> {
    return this.likes.get(this.likeKey(accountId, postId)) || null;
  }

  public override async createPostLike(accountId: any, postId: any): Promise<any> {
    const key = this.likeKey(accountId, postId);
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      accountId: new Types.ObjectId(accountId.toString()),
      postId: new Types.ObjectId(postId.toString()),
      createdAt: new Date(),
    };
    this.likes.set(key, doc);
    return doc;
  }

  public override async deletePostLike(accountId: any, postId: any): Promise<any | null> {
    const key = this.likeKey(accountId, postId);
    const existing = this.likes.get(key) || null;
    if (existing) this.likes.delete(key);
    return existing;
  }

  public override async createComment(data: any): Promise<any> {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      postId: new Types.ObjectId(data.postId.toString()),
      authorId: new Types.ObjectId(data.authorId.toString()),
      content: data.content,
      status: 'ACTIVE',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.comments.set(id.toString(), doc);
    return doc;
  }

  public override async findPostRepost(accountId: any, postId: any): Promise<any | null> {
    return this.reposts.get(this.repostKey(accountId, postId)) || null;
  }

  public override async createPostRepost(accountId: any, postId: any): Promise<any> {
    const key = this.repostKey(accountId, postId);
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      accountId: new Types.ObjectId(accountId.toString()),
      originalPostId: new Types.ObjectId(postId.toString()),
      createdAt: new Date(),
    };
    this.reposts.set(key, doc);
    return doc;
  }

  public override async deletePostRepost(accountId: any, postId: any): Promise<any | null> {
    const key = this.repostKey(accountId, postId);
    const existing = this.reposts.get(key) || null;
    if (existing) this.reposts.delete(key);
    return existing;
  }

  public override async adjustPostCounter(postId: any, field: string, delta: 1 | -1): Promise<number> {
    const post = this.postsStore.posts.get(postId.toString());
    if (!post) return 0;
    post[field] = Math.max(0, (post[field] || 0) + delta);
    return post[field];
  }
}

class InMemoryFollowRepo extends FollowRepository {
  public follows = new Map<string, any>();
  public followersCountMap = new Map<string, number>();
  public followingCountMap = new Map<string, number>();

  constructor(public authStore: InMemoryAuthRepo) {
    super();
  }

  private edgeKey(followerId: string, followingId: string): string {
    return `${followerId}:${followingId}`;
  }

  public override async withTransaction<T>(fn: (session?: any) => Promise<T>): Promise<T> {
    return await fn({ inTransaction: () => true } as any);
  }

  public override async findFollow(
    followerId: string | Types.ObjectId,
    followingId: string | Types.ObjectId,
  ): Promise<any | null> {
    return this.follows.get(this.edgeKey(followerId.toString(), followingId.toString())) || null;
  }

  public override async createFollow(
    followerId: string | Types.ObjectId,
    followingId: string | Types.ObjectId,
  ): Promise<any> {
    const key = this.edgeKey(followerId.toString(), followingId.toString());
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      id: id.toString(),
      followerId: new Types.ObjectId(followerId.toString()),
      followingId: new Types.ObjectId(followingId.toString()),
      createdAt: new Date(),
    };
    this.follows.set(key, doc);
    return doc;
  }

  public override async deleteFollow(
    followerId: string | Types.ObjectId,
    followingId: string | Types.ObjectId,
  ): Promise<any | null> {
    const key = this.edgeKey(followerId.toString(), followingId.toString());
    const existing = this.follows.get(key) || null;
    if (existing) this.follows.delete(key);
    return existing;
  }

  public override async adjustFollowCounts(
    followerId: string | Types.ObjectId,
    followingId: string | Types.ObjectId,
    delta: 1 | -1,
  ): Promise<any> {
    const fId = followerId.toString();
    const tId = followingId.toString();
    const currentFollower = this.followingCountMap.get(fId) || 0;
    const currentFollowing = this.followersCountMap.get(tId) || 0;
    this.followingCountMap.set(fId, Math.max(0, currentFollower + delta));
    this.followersCountMap.set(tId, Math.max(0, currentFollowing + delta));
    return {
      followerFollowingCount: this.followingCountMap.get(fId),
      followingFollowersCount: this.followersCountMap.get(tId),
    };
  }
}

class InMemoryNotificationRepo extends NotificationRepository {
  public notifications = new Map<string, any>();
  public outbox = new Map<string, any>();
  public devices = new Map<string, any>();
  public preferences = new Map<string, any>();

  public override async upsertDeviceToken(accountId: any, deviceToken: string, platform: any, deviceId?: string): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      accountId: new Types.ObjectId(accountId.toString()),
      deviceToken,
      platform,
      deviceId,
      isActive: true,
      lastSeenAt: new Date(),
    };
    this.devices.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findActiveTokensByAccountId(accountId: any): Promise<string[]> {
    const idStr = accountId.toString();
    return Array.from(this.devices.values())
      .filter((d) => d.accountId.toString() === idStr && d.isActive)
      .map((d) => d.deviceToken);
  }

  public override async createNotification(params: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      recipientAccountId: new Types.ObjectId(params.recipientAccountId.toString()),
      notificationType: params.notificationType,
      title: params.title,
      body: params.body,
      dataPayload: params.dataPayload || {},
      relatedResourceType: params.relatedResourceType,
      relatedResourceId: params.relatedResourceId,
      isRead: false,
      readAt: null,
      deliveryStatus: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.set(doc._id.toString(), doc);
    return doc;
  }

  public override async countUnreadByAccountId(accountId: any): Promise<number> {
    const idStr = accountId.toString();
    return Array.from(this.notifications.values()).filter(
      (n) => n.recipientAccountId.toString() === idStr && !n.isRead,
    ).length;
  }

  public override async findNotificationsByAccountId(
    accountId: any,
    filter: { isRead?: boolean; page: number; limit: number },
  ): Promise<{ items: any[]; total: number }> {
    const accIdStr = accountId.toString();
    let all = Array.from(this.notifications.values()).filter(
      (n) => n.recipientAccountId.toString() === accIdStr,
    );

    if (filter.isRead !== undefined) {
      all = all.filter((n) => n.isRead === filter.isRead);
    }

    all.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      if (diff !== 0) return diff;
      return b._id.toString() > a._id.toString() ? 1 : -1;
    });

    const total = all.length;
    const skip = (filter.page - 1) * filter.limit;
    const items = all.slice(skip, skip + filter.limit);

    return { items, total };
  }

  public override async markAsRead(notificationId: any, accountId: any): Promise<any> {
    const notif = this.notifications.get(notificationId.toString());
    if (!notif || notif.recipientAccountId.toString() !== accountId.toString()) return null;
    notif.isRead = true;
    notif.readAt = new Date();
    return notif;
  }

  public override async deleteNotification(notificationId: any, accountId: any): Promise<boolean> {
    const notif = this.notifications.get(notificationId.toString());
    if (!notif || notif.recipientAccountId.toString() !== accountId.toString()) return false;
    this.notifications.delete(notificationId.toString());
    return true;
  }

  public override async getPreferences(accountId: any): Promise<any> {
    const idStr = accountId.toString();
    let pref = this.preferences.get(idStr);
    if (!pref) {
      pref = {
        accountId: new Types.ObjectId(idStr),
        bookingUpdates: true,
        paymentUpdates: true,
        socialUpdates: true,
      };
      this.preferences.set(idStr, pref);
    }
    return pref;
  }

  public override async updatePreferences(accountId: any, updates: any): Promise<any> {
    const current = await this.getPreferences(accountId);
    const updated = {
      ...current,
      ...(updates.bookingUpdates !== undefined ? { bookingUpdates: updates.bookingUpdates } : {}),
      ...(updates.paymentUpdates !== undefined ? { paymentUpdates: updates.paymentUpdates } : {}),
      ...(updates.socialUpdates !== undefined ? { socialUpdates: updates.socialUpdates } : {}),
      updatedAt: new Date(),
    };
    this.preferences.set(accountId.toString(), updated);
    return updated;
  }

  public override async createOutboxRecord(params: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      ...params,
      status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      retryCount: 0,
      createdAt: new Date(),
    };
    this.outbox.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findPendingOutboxBatch(batchSize = 50, _refNow = new Date()): Promise<any[]> {
    return Array.from(this.outbox.values())
      .filter((o) => o.status === NOTIFICATION_DELIVERY_STATUSES.PENDING)
      .slice(0, batchSize);
  }

  public override async updateOutboxResult(outboxId: any, update: any): Promise<any> {
    const doc = this.outbox.get(outboxId.toString());
    if (doc) {
      Object.assign(doc, update);
    }
    return doc;
  }

  public override async updateDeliveryStatus(notificationId: any, status: any): Promise<any> {
    const doc = this.notifications.get(notificationId.toString());
    if (doc) {
      doc.deliveryStatus = status;
    }
    return doc;
  }
}

class MockNotificationProvider implements INotificationProvider {
  public providerName = 'FIREBASE';
  public sentMessages: any[] = [];
  public async sendPush(input: any): Promise<any> {
    this.sentMessages.push(input);
    return {
      success: true,
      successCount: input.deviceTokens?.length || 1,
      failureCount: 0,
      failedTokens: [],
      invalidTokens: [],
    };
  }
}

class MockAuditLogService extends AuditLogService {
  public recordedLogs: RecordAdminAuditInput[] = [];
  public override async recordAdminAction(input: RecordAdminAuditInput): Promise<any> {
    this.recordedLogs.push(input);
    return { id: new Types.ObjectId().toString(), ...input, createdAt: new Date().toISOString() };
  }
}

// ============================================================================
// SUITE EXECUTION
// ============================================================================

describe('DAY 27 — End-to-End User Journeys (Journeys A through F)', () => {
  let app: any;
  let authRepo: InMemoryAuthRepo;
  let destRepo: InMemoryDestinationsRepo;
  let postsRepo: InMemoryPostsRepo;
  let engagementRepo: InMemoryEngagementRepo;
  let followRepo: InMemoryFollowRepo;
  let propRepo: PropertyRepository;
  let roomRepo: RoomRepository;
  let bookingsRepo: BookingsRepository;
  let paymentsRepo: PaymentsRepository;
  let notifRepo: InMemoryNotificationRepo;
  let mockAudit: MockAuditLogService;
  let mockProvider: MockNotificationProvider;
  let razorpayProvider: RazorpayPaymentProvider;

  const razorpayKeySecret = 'test_secret_32_characters_minimum_len';
  const razorpayWebhookSecret = 'test_webhook_secret_32_chars_min';

  beforeEach(() => {
    resetRateLimiter();

    authRepo = new InMemoryAuthRepo();
    destRepo = new InMemoryDestinationsRepo();
    postsRepo = new InMemoryPostsRepo(authRepo);
    engagementRepo = new InMemoryEngagementRepo(postsRepo);
    followRepo = new InMemoryFollowRepo(authRepo);
    postsRepo.followRepoRef = followRepo;
    propRepo = propertyRepository;
    propRepo.inMemoryStore.clear();
    roomRepo = roomRepository;
    roomRepo.inMemoryRoomTypes.clear();
    roomRepo.inMemoryInventory.clear();
    bookingsRepo = new BookingsRepository();
    paymentsRepo = new PaymentsRepository();
    notifRepo = new InMemoryNotificationRepo();
    mockAudit = new MockAuditLogService();
    mockProvider = new MockNotificationProvider();

    razorpayProvider = new RazorpayPaymentProvider(
      'rzp_test_mock_key_id',
      razorpayKeySecret,
      razorpayWebhookSecret,
      true,
    );

    // Wire up repositories across domain services
    authMiddleware.setRepository(authRepo);
    authorizationMiddleware.setRepository(authRepo);

    authService.setRepository(authRepo);
    destinationsService.setRepository(destRepo);
    postsService.setRepository(postsRepo);
    postsService.setAuthRepository(authRepo);
    postEngagementService.setRepository(engagementRepo);
    postEngagementService.setPostsRepository(postsRepo);
    postEngagementService.setAuthRepository(authRepo);

    followService.setRepository(followRepo);
    followService.setAuthRepository(authRepo);

    propertyService.setRepository(propRepo);
    propertyService.setAuditService(mockAudit);

    roomService.setRepository(roomRepo);
    roomService.setAuditService(mockAudit);

    bookingsService.setRepository(bookingsRepo);
    bookingsRepo.setRoomRepository(roomRepo);
    bookingsService.setPropertyRepository(propRepo);
    bookingsService.setRoomRepository(roomRepo);
    bookingsService.setAuditService(mockAudit);

    paymentsService.setRepository(paymentsRepo);
    paymentsService.setBookingsRepository(bookingsRepo);
    paymentsService.setPropertyRepository(propRepo);
    paymentsService.setProvider(razorpayProvider);
    paymentsService.setAuditService(mockAudit);

    webhookService.setRepository(paymentsRepo);
    webhookService.setProvider(razorpayProvider);
    webhookService.setAuditService(mockAudit);

    paymentsRepo.setBookingMemoryStores(bookingsRepo.inMemoryBookings, bookingsRepo.inMemoryHolds);

    notificationService.setRepository(notifRepo);

    app = createApp();
  });

  // --------------------------------------------------------------------------
  // JOURNEY A: Tourist Registration and Authentication Lifecycle
  // --------------------------------------------------------------------------
  it('Journey A: registers tourist, verifies Argon2id hash, rotates refresh tokens, rejects replay, and logs out', async () => {
    const rawPassword = 'SecureKeralaPassword@2026';
    const email = 'arjun.tourist@kerala.voyage';

    // 1. Registration
    const regRes = await dispatch(app, 'POST', '/api/v1/auth/register/tourist', {
      body: {
        email,
        password: rawPassword,
        confirmPassword: rawPassword,
        firstName: 'Arjun',
        lastName: 'Nair',
      },
    });

    assert.equal(regRes.status, 201, `Registration failed: ${JSON.stringify(regRes.body)}`);
    assert.equal(regRes.body.success, true);
    assert.equal(regRes.body.data.account.email, email);
    // Password must NEVER be returned in response
    assert.equal(regRes.body.data.account.password, undefined);
    assert.equal(regRes.body.data.account.passwordHash, undefined);

    // Verify Argon2id hashing in underlying storage
    const storedAccount = await authRepo.findAccountByEmail(email);
    assert.ok(storedAccount, 'Account must exist in storage');
    assert.ok(
      storedAccount.passwordHash.startsWith('$argon2id$'),
      'Password must be hashed with Argon2id',
    );
    assert.notEqual(storedAccount.passwordHash, rawPassword, 'Password must not be stored in plaintext');

    // 2. Login
    const loginRes = await dispatch(app, 'POST', '/api/v1/auth/login', {
      body: {
        email,
        password: rawPassword,
      },
    });

    assert.equal(loginRes.status, 200, 'Login failed');
    assert.ok(loginRes.body.data.accessToken, 'Access token must be returned');
    assert.ok(loginRes.body.data.refreshToken, 'Refresh token must be returned');

    const firstAccessToken = loginRes.body.data.accessToken;
    const firstRefreshToken = loginRes.body.data.refreshToken;

    // Verify authenticated /me endpoint
    const meRes = await dispatch(app, 'GET', '/api/v1/auth/me', {
      token: firstAccessToken,
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.account.email, email);

    // 3. Refresh Token Rotation
    const refreshRes = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
      body: {
        refreshToken: firstRefreshToken,
      },
    });

    assert.equal(refreshRes.status, 200, 'Refresh token rotation failed');
    const secondAccessToken = refreshRes.body.data.accessToken;
    const secondRefreshToken = refreshRes.body.data.refreshToken;
    assert.notEqual(secondAccessToken, firstAccessToken, 'New access token must be issued');
    assert.notEqual(secondRefreshToken, firstRefreshToken, 'New refresh token must be rotated');

    // 4. Token Replay Protection (Replaying firstRefreshToken must fail)
    const replayRes = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
      body: {
        refreshToken: firstRefreshToken,
      },
    });
    assert.equal(replayRes.status, 401, 'Replayed refresh token must be rejected with 401');

    // Replay invalidates entire session family: secondRefreshToken is also now revoked
    const familyCheckRes = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
      body: {
        refreshToken: secondRefreshToken,
      },
    });
    assert.equal(familyCheckRes.status, 401, 'Compromised family token must be rejected');

    // 5. Logout verification with fresh login
    resetRateLimiter();
    const freshLogin = await dispatch(app, 'POST', '/api/v1/auth/login', {
      body: { email, password: rawPassword },
    });
    assert.equal(freshLogin.status, 200, `Fresh login failed: ${JSON.stringify(freshLogin.body)}`);
    const freshRefresh = freshLogin.body.data.refreshToken;

    const logoutRes = await dispatch(app, 'POST', '/api/v1/auth/logout', {
      token: freshLogin.body.data.accessToken,
      body: { refreshToken: freshRefresh },
    });
    assert.equal(logoutRes.status, 200, 'Logout failed');

    // Attempting refresh with logged out token fails
    const postLogoutRefresh = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
      body: { refreshToken: freshRefresh },
    });
    assert.equal(postLogoutRefresh.status, 401, 'Revoked token must be rejected');
  });

  // --------------------------------------------------------------------------
  // JOURNEY B: Destination Discovery and Community Submission
  // --------------------------------------------------------------------------
  it('Journey B: discovers public destinations, queries nearby, submits recommendation, and reflects approved destination', async () => {
    // 1. Seed published destination
    await destRepo.createDestination({
      name: 'Munnar Tea Hills',
      slug: 'munnar-tea-hills',
      description: 'Lush green sprawling tea plantations in the Western Ghats',
      district: 'Idukki',
      location: { type: 'Point', coordinates: [77.0595, 10.0889] },
      images: ['https://cdn.kerala.voyage/munnar.webp'],
      categoryIds: [new Types.ObjectId()],
      facilities: ['Parking', 'Viewpoint'],
      createdBy: new Types.ObjectId(),
    });

    // 2. Public Catalog Search
    const searchRes = await dispatch(app, 'GET', '/api/v1/destinations?district=Idukki&search=Tea');
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.success, true);
    assert.ok(searchRes.body.data.length >= 1);
    assert.equal(searchRes.body.data[0].name, 'Munnar Tea Hills');

    // 3. Nearby Geospatial Discovery
    const nearbyRes = await dispatch(app, 'GET', '/api/v1/destinations/nearby?longitude=77.06&latitude=10.09&radiusKm=15');
    assert.equal(nearbyRes.status, 200);
    assert.ok(Array.isArray(nearbyRes.body.data));

    // 4. Authenticated Tourist Destination Recommendation
    const touristId = new Types.ObjectId();
    const touristToken = jwtService.signAccessToken({
      id: touristId.toString(),
      email: 'tourist.explorer@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    authRepo.accountsById.set(touristId.toString(), {
      _id: touristId,
      email: 'tourist.explorer@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);

    const submissionRes = await dispatch(app, 'POST', '/api/v1/tourist/destination-submissions', {
      token: touristToken,
      body: {
        name: 'Hidden Waterfalls of Athirappilly',
        description: 'Majestic forest waterfall cascading into the Chalakudy River in Kerala Western Ghats',
        submittedLocation: { type: 'Point', coordinates: [76.5186, 10.2934] },
        submittedAddress: 'Athirappilly, Thrissur, Kerala',
        imageMediaIds: ['media_dest_athirappilly_01'],
      },
    });

    assert.equal(submissionRes.status, 201, `Submission failed: ${JSON.stringify(submissionRes.body)}`);
    assert.equal(submissionRes.body.success, true);
    assert.equal(submissionRes.body.data.name, 'Hidden Waterfalls of Athirappilly');

    // 5. Admin publishes approved destination
    await destRepo.createDestination({
      name: 'Athirappilly Falls',
      slug: 'athirappilly-falls',
      description: 'The Niagara of South India',
      district: 'Thrissur',
      location: { type: 'Point', coordinates: [76.5186, 10.2934] },
      images: ['https://cdn.kerala.voyage/athirappilly.webp'],
      categoryIds: [new Types.ObjectId()],
      facilities: ['Trekking Trail'],
      createdBy: touristId,
    });

    // 6. Public Search immediately discovers the newly published destination
    const discoveryRes = await dispatch(app, 'GET', '/api/v1/destinations?district=Thrissur');
    assert.equal(discoveryRes.status, 200);
    const discovered = discoveryRes.body.data.find((d: any) => d.name === 'Athirappilly Falls');
    assert.ok(discovered, 'Newly published destination must be public');
  });

  // --------------------------------------------------------------------------
  // JOURNEY C: Social Platform and Community Engagement
  // --------------------------------------------------------------------------
  it('Journey C: creates post, public feed displays it, peer likes, comments, reposts, follows, and following feed delivers', async () => {
    // Author Tourist
    const authorId = new Types.ObjectId();
    const authorToken = jwtService.signAccessToken({
      id: authorId.toString(),
      email: 'author@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    authRepo.accountsById.set(authorId.toString(), {
      _id: authorId,
      email: 'author@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);
    authRepo.touristProfiles.set(authorId.toString(), {
      _id: new Types.ObjectId(),
      accountId: authorId,
      firstName: 'Lakshmi',
      lastName: 'Menon',
    } as any);

    // Peer Tourist
    const peerId = new Types.ObjectId();
    const peerToken = jwtService.signAccessToken({
      id: peerId.toString(),
      email: 'peer@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    authRepo.accountsById.set(peerId.toString(), {
      _id: peerId,
      email: 'peer@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);
    authRepo.touristProfiles.set(peerId.toString(), {
      _id: new Types.ObjectId(),
      accountId: peerId,
      firstName: 'Rohan',
      lastName: 'Verma',
    } as any);

    // 1. Author creates a post
    const postRes = await dispatch(app, 'POST', '/api/v1/tourist/posts', {
      token: authorToken,
      body: {
        content: 'Watching the sunset over the serene backwaters of Kumarakom!',
        visibility: 'PUBLIC',
      },
    });

    assert.equal(postRes.status, 201, `Post creation failed: ${JSON.stringify(postRes.body)}`);
    const postId = postRes.body.data.id || postRes.body.data._id;
    assert.ok(postId);

    // 2. Public feed includes the post
    const feedRes = await dispatch(app, 'GET', '/api/v1/posts');
    assert.equal(feedRes.status, 200);
    assert.ok(feedRes.body.data.some((p: any) => (p.id || p._id) === postId));

    // 3. Peer likes the post
    const likeRes = await dispatch(app, 'POST', `/api/v1/tourist/posts/${postId}/likes`, {
      token: peerToken,
    });
    assert.equal(likeRes.status, 201, 'Liking post failed');
    assert.equal(likeRes.body.data.likesCount, 1);

    // 4. Peer comments on the post
    const commentRes = await dispatch(app, 'POST', `/api/v1/tourist/posts/${postId}/comments`, {
      token: peerToken,
      body: {
        content: 'Breathtaking view! Which houseboat service did you choose?',
      },
    });
    assert.equal(commentRes.status, 201, 'Comment creation failed');
    assert.equal(commentRes.body.data.content, 'Breathtaking view! Which houseboat service did you choose?');

    // 5. Peer reposts the post
    const repostRes = await dispatch(app, 'POST', `/api/v1/tourist/posts/${postId}/reposts`, {
      token: peerToken,
    });
    assert.equal(repostRes.status, 201, 'Repost failed');
    assert.equal(repostRes.body.data.repostsCount, 1);

    // 6. Peer follows the author
    const followRes = await dispatch(app, 'POST', `/api/v1/tourist/users/${authorId}/follow`, {
      token: peerToken,
      body: {},
    });
    assert.equal(followRes.status, 201, `Follow failed: ${JSON.stringify(followRes.body)}`);
    assert.equal(followRes.body.data.following, true);

    // 7. Following feed includes author's post
    const followingFeedRes = await dispatch(app, 'GET', '/api/v1/tourist/feed/following', {
      token: peerToken,
    });
    assert.equal(followingFeedRes.status, 200);
    assert.ok(
      followingFeedRes.body.data.some((p: any) => (p.id || p._id) === postId),
      'Author post must be present in following feed',
    );

    // 8. Peer unfollows author
    const unfollowRes = await dispatch(app, 'DELETE', `/api/v1/tourist/users/${authorId}/follow`, {
      token: peerToken,
      body: {},
    });
    assert.equal(unfollowRes.status, 200, `Unfollow failed: ${JSON.stringify(unfollowRes.body)}`);
    assert.equal(unfollowRes.body.data.following, false);

    // Following feed no longer contains author's post
    const postUnfollowFeed = await dispatch(app, 'GET', '/api/v1/tourist/feed/following', {
      token: peerToken,
    });
    assert.equal(postUnfollowFeed.status, 200);
    assert.equal(postUnfollowFeed.body.data.length, 0);
  });

  // --------------------------------------------------------------------------
  // JOURNEY D: Business Onboarding, Property and Room Inventory
  // --------------------------------------------------------------------------
  it('Journey D: registers business, enforces verification barrier, verifies business, creates property, room, and inventory', async () => {
    const businessEmail = 'stay@keralaluxuryresort.com';
    const businessPassword = 'ResortAdminPassword@2026';

    // 1. Business Registration
    const regRes = await dispatch(app, 'POST', '/api/v1/auth/register/business', {
      body: {
        email: businessEmail,
        password: businessPassword,
        confirmPassword: businessPassword,
        businessName: 'Kumarakom Lagoon Sanctuary',
        businessType: BUSINESS_TYPES.RESORT,
        contactNumber: '+919846012345',
      },
    });

    assert.equal(regRes.status, 201, `Business registration failed: ${JSON.stringify(regRes.body)}`);
    const businessAccountId = regRes.body.data.account.id || regRes.body.data.account._id;

    // 2. Login to get business token
    const loginRes = await dispatch(app, 'POST', '/api/v1/auth/login', {
      body: { email: businessEmail, password: businessPassword },
    });
    const businessToken = loginRes.body.data.accessToken;

    // 3. Verification Barrier: Unverified business CANNOT create property
    const blockedRes = await dispatch(app, 'POST', '/api/v1/business/properties', {
      token: businessToken,
      body: {
        name: 'Kumarakom Lagoon Sanctuary',
        description: 'Luxury backwater resort with private plunge pools',
        propertyType: 'RESORT',
        district: 'Kottayam',
        address: 'Vembanad Lakefront, Kumarakom',
        contactEmail: businessEmail,
        contactPhone: '+919846012345',
      },
    });

    assert.equal(blockedRes.status, 403, 'Unverified business must be rejected with 403');
    assert.ok(
      blockedRes.body.message?.includes('verified') || blockedRes.body.error?.code === 'BUSINESS_NOT_VERIFIED',
    );

    // 4. Admin verifies the business
    const storedProfile = await authRepo.findBusinessProfileByAccountId(businessAccountId);
    assert.ok(storedProfile);
    storedProfile.verificationStatus = VERIFICATION_STATUSES.VERIFIED;

    // 5. Verified business creates Property
    const propRes = await dispatch(app, 'POST', '/api/v1/business/properties', {
      token: businessToken,
      body: {
        name: 'Kumarakom Lagoon Sanctuary',
        description: 'Luxury backwater resort with private plunge pools',
        propertyType: 'RESORT',
        district: 'Kottayam',
        address: 'Vembanad Lakefront, Kumarakom',
        contactEmail: businessEmail,
        contactPhone: '+919846012345',
      },
    });

    assert.equal(propRes.status, 201, `Property creation failed: ${JSON.stringify(propRes.body)}`);
    const propertyId = propRes.body.data.id || propRes.body.data._id;
    assert.ok(propertyId);

    // Mark property verified and published for booking
    const seededProp = propRepo.inMemoryStore.get(propertyId.toString());
    if (seededProp) {
      seededProp.status = PROPERTY_STATUSES.PUBLISHED;
      (seededProp as any).verificationStatus = VERIFICATION_STATUSES.VERIFIED;
    }

    // 6. Business creates Room Type
    const roomRes = await dispatch(app, 'POST', `/api/v1/business/properties/${propertyId}/rooms`, {
      token: businessToken,
      body: {
        name: 'Heritage Lake Villa',
        roomCategory: ROOM_CATEGORIES.VILLA,
        maxAdults: 2,
        maxChildren: 1,
        maxOccupancy: 3,
        bedConfiguration: '1 King Bed',
        bedCount: 1,
        basePrice: 1500000, // 15,000 INR
        totalUnits: 1,
        description: 'Traditional Kerala villa overlooking Vembanad Lake',
      },
    });

    assert.equal(roomRes.status, 201, `Room creation failed: ${JSON.stringify(roomRes.body)}`);
    const roomTypeId = roomRes.body.data.id || roomRes.body.data._id;
    assert.ok(roomTypeId);

    // 7. Business configures room inventory for future stay
    const today = getTodayInKolkata();
    const [y, m, d] = today.split('-').map((v) => parseInt(v, 10));
    const checkInDate = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().split('T')[0];
    const checkOutDate = new Date(Date.UTC(y, m - 1, d + 9)).toISOString().split('T')[0]; // 2 nights

    const invRes = await dispatch(app, 'PUT', `/api/v1/business/rooms/${roomTypeId}/inventory`, {
      token: businessToken,
      body: {
        startDate: checkInDate,
        endDate: checkOutDate,
        totalUnits: 1,
        blockedUnits: 0,
        maintenanceUnits: 0,
      },
    });

    assert.equal(invRes.status, 200, `Inventory setup failed: ${JSON.stringify(invRes.body)}`);

    // 8. Public availability check reflects 1 available room unit
    const availRes = await dispatch(
      app,
      'GET',
      `/api/v1/properties/${propertyId}/availability?checkIn=${checkInDate}&checkOut=${checkOutDate}`,
    );

    assert.equal(availRes.status, 200, 'Public availability check failed');
    assert.ok(availRes.body.data.availableRoomTypes.length >= 1);
    assert.equal(availRes.body.data.availableRoomTypes[0].isAvailable, true);
    assert.equal(availRes.body.data.availableRoomTypes[0].availableUnitsAcrossStay, 1);
  });

  // --------------------------------------------------------------------------
  // JOURNEY E: Booking and Payment Lifecycle
  // --------------------------------------------------------------------------
  it('Journey E: creates 15-min hold, snapshots price, initiates Razorpay payment, confirms via webhook, and enforces anti-overbooking', async () => {
    // 1. Setup Merchant Property and Room Type
    const merchantId = new Types.ObjectId();
    const businessProfileId = new Types.ObjectId();
    const propertyId = new Types.ObjectId();
    const roomTypeId = new Types.ObjectId();

    authRepo.accountsById.set(merchantId.toString(), {
      _id: merchantId,
      email: 'host@resort.kerala.voyage',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);
    authRepo.businessProfiles.set(merchantId.toString(), {
      _id: businessProfileId,
      accountId: merchantId,
      businessName: 'Vembanad Retreat',
      businessType: BUSINESS_TYPES.RESORT,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    } as any);

    propRepo.inMemoryStore.set(propertyId.toString(), {
      _id: propertyId,
      businessProfileId,
      accountId: merchantId,
      ownerAccountId: merchantId,
      status: PROPERTY_STATUSES.PUBLISHED,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    } as any);

    roomRepo.inMemoryRoomTypes.set(roomTypeId.toString(), {
      _id: roomTypeId,
      propertyId,
      businessProfileId,
      accountId: merchantId,
      name: 'Deluxe Heritage Villa',
      roomCategory: ROOM_CATEGORIES.VILLA,
      totalUnits: 1,
      basePrice: 1000000,
      pricing: { basePricePaise: 1000000, pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT },
      status: ROOM_STATUSES.ACTIVE,
    } as any);

    const today = getTodayInKolkata();
    const [y, m, d] = today.split('-').map((v) => parseInt(v, 10));
    const checkInDate = new Date(Date.UTC(y, m - 1, d + 10)).toISOString().split('T')[0];
    const checkOutDate = new Date(Date.UTC(y, m - 1, d + 12)).toISOString().split('T')[0]; // 2 nights
    const night1 = checkInDate;
    const night2 = new Date(Date.UTC(y, m - 1, d + 11)).toISOString().split('T')[0];

    // Seed inventory with exactly 1 unit
    roomRepo.inMemoryInventory.set(`${roomTypeId.toString()}:${night1}`, {
      _id: new Types.ObjectId(),
      roomTypeId,
      propertyId,
      businessProfileId: new Types.ObjectId(),
      date: new Date(`${night1}T00:00:00.000Z`),
      totalUnits: 1,
      availableUnits: 1,
      blockedUnits: 0,
      maintenanceUnits: 0,
      basePricePaise: 1000000,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    roomRepo.inMemoryInventory.set(`${roomTypeId.toString()}:${night2}`, {
      _id: new Types.ObjectId(),
      roomTypeId,
      propertyId,
      businessProfileId: new Types.ObjectId(),
      date: new Date(`${night2}T00:00:00.000Z`),
      totalUnits: 1,
      availableUnits: 1,
      blockedUnits: 0,
      maintenanceUnits: 0,
      basePricePaise: 1000000,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // 2. Tourist 1 initiates 15-minute temporary inventory hold
    const tourist1Id = new Types.ObjectId();
    const tourist1Token = jwtService.signAccessToken({
      id: tourist1Id.toString(),
      email: 'tourist1@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    authRepo.accountsById.set(tourist1Id.toString(), {
      _id: tourist1Id,
      email: 'tourist1@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);

    const holdRes = await dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: tourist1Token,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        children: 0,
        guestDetails: {
          primaryGuestName: 'Arjun Nair',
          email: 'arjun.tourist@kerala.voyage',
          phone: '+919846012345',
        },
      },
    });

    assert.equal(holdRes.status, 201, `Hold creation failed: ${JSON.stringify(holdRes.body)}`);
    const holdData = holdRes.body.data.hold;
    const bookingData = holdRes.body.data.booking;
    assert.equal(holdData.status, INVENTORY_HOLD_STATUSES.ACTIVE);
    assert.equal(holdData.roomTypeId, roomTypeId.toString());
    assert.ok(holdRes.body.data.expiresAt, 'Hold must have expiry timestamp');

    // Verify hold duration is ~15 minutes
    const expiresMs = new Date(holdRes.body.data.expiresAt).getTime();
    const diffMins = (expiresMs - Date.now()) / (60 * 1000);
    assert.ok(diffMins >= 14 && diffMins <= 16, `Hold expiry was ${diffMins} minutes; expected ~15`);

    // Verify pricing breakdown snapshot in integer paise (2 nights * 10,000 INR = 20,000 INR = 2,000,000 paise)
    assert.equal(bookingData.priceSnapshot.basePricePaise, 1000000);
    assert.equal(bookingData.priceSnapshot.subtotalPaise, 2000000);
    assert.equal(bookingData.priceSnapshot.totalPaise, 2000000);

    // Verify Booking created in AWAITING_PAYMENT status
    const bookingId = bookingData.id;
    assert.ok(bookingId);
    const bookingDoc = bookingsRepo.inMemoryBookings.get(bookingId.toString());
    assert.ok(bookingDoc);
    assert.equal(bookingDoc.status, BOOKING_STATUSES.AWAITING_PAYMENT);

    // 3. Concurrency Protection: Tourist 2 tries to hold the same room -> 409 Conflict (no units left)
    const tourist2Id = new Types.ObjectId();
    const tourist2Token = jwtService.signAccessToken({
      id: tourist2Id.toString(),
      email: 'tourist2@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    authRepo.accountsById.set(tourist2Id.toString(), {
      _id: tourist2Id,
      email: 'tourist2@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);

    const conflictingHold = await dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: tourist2Token,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        children: 0,
        guestDetails: {
          primaryGuestName: 'Sneha Rao',
          email: 'sneha.tourist@kerala.voyage',
          phone: '+919846054321',
        },
      },
    });

    assert.equal(conflictingHold.status, 409, 'Concurrent hold for sold-out room must return 409 Conflict');

    // 4. Tourist 1 initiates payment for the pending booking
    const initPayRes = await dispatch(
      app,
      'POST',
      `/api/v1/tourist/bookings/${bookingId}/payments`,
      {
        token: tourist1Token,
      },
    );

    assert.equal(initPayRes.status, 201, `Payment initiation failed: ${JSON.stringify(initPayRes.body)}`);
    const { checkoutData } = initPayRes.body.data;
    assert.ok(checkoutData.orderId.startsWith('order_'));
    assert.equal(checkoutData.amountPaise, 2000000);
    assert.equal(checkoutData.currency, 'INR');

    // 5. Razorpay Webhook Simulation: payment.captured with valid HMAC-SHA256 signature
    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_test_e2e_01',
            order_id: checkoutData.orderId,
            amount: 2000000,
            currency: 'INR',
            status: 'captured',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    };

    const webhookPayload = JSON.stringify(webhookBody);
    const validSignature = crypto
      .createHmac('sha256', razorpayWebhookSecret)
      .update(webhookPayload)
      .digest('hex');

    const webhookRes = await dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': 'evt_test_captured_e2e_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.equal(webhookRes.status, 200, `Webhook processing failed: ${JSON.stringify(webhookRes.body)}`);
    assert.equal(webhookRes.body.success, true);

    // 6. Authoritative State Verification
    const confirmedBooking = bookingsRepo.inMemoryBookings.get(bookingId.toString());
    assert.ok(confirmedBooking);
    assert.equal(confirmedBooking.status, BOOKING_STATUSES.CONFIRMED);

    const consumedHold = bookingsRepo.inMemoryHolds.get(holdData.id);
    assert.ok(consumedHold);
    assert.equal(consumedHold.status, INVENTORY_HOLD_STATUSES.CONSUMED);
  });

  // --------------------------------------------------------------------------
  // JOURNEY F: Push Notifications Lifecycle
  // --------------------------------------------------------------------------
  it('Journey F: registers device token, processes outbox delivery, updates preferences, reads tray, and enforces 404 BOLA deletion', async () => {
    const touristId = new Types.ObjectId();
    const otherTouristId = new Types.ObjectId();

    const touristToken = jwtService.signAccessToken({
      id: touristId.toString(),
      email: 'fcm.tourist@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    const otherToken = jwtService.signAccessToken({
      id: otherTouristId.toString(),
      email: 'other.tourist@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    authRepo.accountsById.set(touristId.toString(), {
      _id: touristId,
      email: 'fcm.tourist@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);
    authRepo.accountsById.set(otherTouristId.toString(), {
      _id: otherTouristId,
      email: 'other.tourist@kerala.voyage',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    } as any);

    // 1. Device Token Registration
    const rawFcmToken = 'fcm_e2e_test_token_valid_masked_device_token_2026';
    const regDeviceRes = await dispatch(app, 'POST', '/api/v1/tourist/devices', {
      token: touristToken,
      body: {
        deviceToken: rawFcmToken,
        platform: 'ANDROID',
        deviceId: 'pixel-9-pro-kerala',
      },
    });

    assert.equal(regDeviceRes.status, 201, 'Device registration failed');
    assert.equal(regDeviceRes.body.success, true);
    // Token in API response must be masked for security
    const returnedToken = regDeviceRes.body.data.device?.maskedToken;
    assert.ok(
      returnedToken && returnedToken.includes('...'),
      'Device token must be masked in API response',
    );
    assert.equal(
      regDeviceRes.body.data.device?.deviceToken,
      undefined,
      'Raw device token must never be leaked in response',
    );

    // 2. Notification Dispatch & Outbox Processing
    const notification = await notifRepo.createNotification({
      recipientAccountId: touristId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed!',
      body: 'Your reservation at Kumarakom Lagoon Sanctuary is confirmed.',
      relatedResourceType: 'BOOKING',
      relatedResourceId: new Types.ObjectId(),
    });

    await notifRepo.createOutboxRecord({
      notificationId: notification._id,
      recipientAccountId: touristId,
      idempotencyKey: `evt_booking_confirmed_${notification._id}`,
      eventType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      payload: {
        title: 'Booking Confirmed!',
        body: 'Your reservation at Kumarakom Lagoon Sanctuary is confirmed.',
      },
    });

    // Run delivery worker to process outbox
    const worker = new NotificationDeliveryWorker(notifRepo, mockProvider);
    const workerResult = await worker.processPendingOutboxBatch(10);
    assert.equal(workerResult.deliveredCount, 1, 'Delivery worker should have delivered 1 notification');
    assert.equal(mockProvider.sentMessages.length, 1, 'Push provider must have been invoked');

    // 3. User Notification Preferences Update
    const prefRes = await dispatch(app, 'PATCH', '/api/v1/tourist/notifications/preferences', {
      token: touristToken,
      body: {
        socialUpdates: false,
      },
    });
    assert.equal(prefRes.status, 200, 'Preference update failed');
    assert.equal(prefRes.body.data.preferences.socialUpdates, false);

    // 4. View Notification Tray & Unread Count
    const unreadRes = await dispatch(app, 'GET', '/api/v1/tourist/notifications/unread-count', {
      token: touristToken,
    });
    assert.equal(unreadRes.status, 200);
    assert.equal(unreadRes.body.data.unreadCount, 1);

    const listRes = await dispatch(app, 'GET', '/api/v1/tourist/notifications', {
      token: touristToken,
    });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.items.length, 1);

    // 5. Mark as Read
    const markReadRes = await dispatch(
      app,
      'PATCH',
      `/api/v1/tourist/notifications/${notification._id}/read`,
      {
        token: touristToken,
      },
    );
    assert.equal(markReadRes.status, 200, 'Mark as read failed');
    assert.equal(markReadRes.body.data.notification.isRead, true);

    const postReadUnread = await dispatch(app, 'GET', '/api/v1/tourist/notifications/unread-count', {
      token: touristToken,
    });
    assert.equal(postReadUnread.body.data.unreadCount, 0);

    // 6. Security & BOLA Concealment: Other tourist trying to delete notification gets 404
    const bolaDelete = await dispatch(
      app,
      'DELETE',
      `/api/v1/tourist/notifications/${notification._id}`,
      {
        token: otherToken,
      },
    );
    assert.equal(bolaDelete.status, 404, 'Deleting another user notification must return 404 (anti-enumeration)');

    // 7. Legitimate Owner Deletes Notification
    const ownerDelete = await dispatch(
      app,
      'DELETE',
      `/api/v1/tourist/notifications/${notification._id}`,
      {
        token: touristToken,
      },
    );
    assert.equal(ownerDelete.status, 200, 'Owner deletion failed');
    assert.equal(ownerDelete.body.success, true);
  });
});
