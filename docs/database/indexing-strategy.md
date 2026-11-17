# Production Indexing Strategy & Performance Engineering
**Kerala Tourism Ecosystem**  
**Database Engine:** MongoDB Atlas (WiredTiger Storage Engine)  
**Standard:** Strict Index Selectivity, Left-Prefix Compound Alignment, Partial & TTL Index Optimization  

---

## 1. Indexing Principles & Memory Footprint Rules

Every index in MongoDB incurs a RAM overhead in WiredTiger cache and a write latency penalty on inserts, updates, and deletes. To ensure high throughput and minimize index memory consumption:
1. **The ESR Rule (Equality, Sort, Range)**: All compound indexes are ordered with **Equality** fields first, **Sort** fields second, and **Range** fields last.
2. **Left-Prefix Utilization**: We avoid single-field indexes when an existing compound index already contains that field as its leftmost prefix.
3. **Partial Filter Indexes**: We apply `partialFilterExpression` on large collections to index only active, verified, or pending documents, reducing index size by up to **75%**.
4. **Automated TTL Eviction**: Expired sessions, temporary inventory locks, and stale device push tokens are cleaned up asynchronously using background TTL worker threads without manual cron jobs.

---

## 2. Complete Index Catalog Across All 51 Collections

### Domain 1: Authentication & Identity Management

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `accounts` | `{ email: 1 }` | Unique, Sparse | `{ email: { $exists: true } }` | User login lookup via email |
| `accounts` | `{ phone: 1 }` | Unique, Sparse | `{ phone: { $exists: true } }` | Mobile OTP authentication & registration |
| `accounts` | `{ accountType: 1, status: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Admin user directory filtered by `accountType` + `status` sorted by `createdAt` |
| `accounts` | `{ status: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Admin user directory filtered by `status` only, sorted by `createdAt` |
| `accounts` | `{ createdAt: -1, _id: -1 }` | Compound | None | Unfiltered admin user directory chronological pagination (zero in-memory sort) |
| `touristProfiles`| `{ accountId: 1 }` | Unique | None | 1:1 account profile retrieval |
| `touristProfiles`| `{ displayName: 1 }` | Unique | None | Handle lookup and `@mention` resolution |
| `businessProfiles`| `{ accountId: 1 }` | Unique | None | 1:1 merchant profile retrieval |
| `businessProfiles`| `{ verificationStatus: 1 }` | Single Field | None | Admin dashboard KYC verification aggregation & queue lookup |
| `businessProfiles`| `{ gstin: 1 }` | Unique, Sparse | None | Merchant tax registration validation |
| `adminProfiles` | `{ accountId: 1 }` | Unique | None | 1:1 admin profile retrieval |
| `adminProfiles` | `{ employeeId: 1 }` | Unique | None | Directorate officer identification |
| `sessions` | `{ expiresAt: 1 }` | TTL Index | `expireAfterSeconds: 0` | Automated session cleanup upon expiration |
| `sessions` | `{ accountId: 1, isRevoked: 1 }` | Compound | None | Active user sessions check |
| `sessions` | `{ refreshTokenHash: 1 }` | Unique | None | Session token refresh & rotation |
| `deviceTokens` | `{ deviceToken: 1 }` | Unique | None | Avoid duplicate device push token registrations across all accounts |
| `deviceTokens` | `{ accountId: 1, isActive: 1 }` | Compound | None | Active device tokens lookup for recipient account during push delivery |
| `deviceTokens` | `{ lastSeenAt: 1 }` | TTL Index | `expireAfterSeconds: 7776000` (90 days) | Auto-prune inactive push notification tokens |

---

### Domain 2: Destinations & Geospatial Registry

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `destinations` | `{ location: "2dsphere" }` | Geospatial | None | Proximity searches (`$nearSphere`, `$geoNear` within radial distance) |
| `destinations` | `{ slug: 1 }` | Unique | None | Clean URL destination details (`/destinations/:slug`) |
| `destinations` | `{ district: 1, verificationStatus: 1, publicationStatus: 1 }` | Compound | None | District filter rail for verified & published destinations |
| `destinations` | `{ categoryIds: 1, verificationStatus: 1, publicationStatus: 1 }` | Compound | None | Category filter rail for verified & published destinations |
| `destinations` | `{ verificationStatus: 1, publicationStatus: 1, createdAt: -1 }` | Compound | None | Paginated public listing sorted by newest |
| `destinations` | `{ name: "text", description: "text", locality: "text" }` | Text | `weights: { name: 10, locality: 5, description: 1 }` | Full-text relevance search |
| `destinationCategories` | `{ slug: 1 }` | Unique | None | Category lookup and routing |
| `destinationCategories` | `{ isActive: 1 }` | Single Field | None | Active category filtering |
| `destinationSubmissions` | `{ submittedBy: 1, createdAt: -1 }` | Compound | None | Tourist profile "My Submissions" history |
| `destinationSubmissions` | `{ status: 1, createdAt: -1 }` | Compound | None | Admin review queue filtering |
| `destinationSubmissions` | `{ destinationId: 1 }` | Single Field | `sparse: true` | Audit linkage to approved destination |

---

### Domain 3: Social Networking & Community Feed

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `posts` | `{ visibility: 1, status: 1, deletedAt: 1, publishedAt: -1, _id: -1 }` | Compound Partial | `partialFilterExpression: { visibility: "PUBLIC", status: "PUBLISHED" }` | Chronological public social feed stream (`GET /api/v1/posts`) |
| `posts` | `{ authorId: 1, deletedAt: 1, createdAt: -1 }` | Compound | None | Tourist own active posts (`GET /api/v1/tourist/posts`) |
| `posts` | `{ destinationId: 1, visibility: 1, status: 1, deletedAt: 1, publishedAt: -1 }` | Compound Partial | `partialFilterExpression: { destinationId: { $type: "objectId" }, visibility: "PUBLIC", status: "PUBLISHED" }` | Destination-scoped public posts |
| `posts` | `{ status: 1, createdAt: -1 }` | Compound Partial | `partialFilterExpression: { status: { $in: ["PENDING", "REJECTED"] } }` | Future moderation queue filtering |
| `posts` | `{ authorId: 1, status: 1, deletedAt: 1, publishedAt: -1, _id: -1, visibility: 1 }` | Compound Partial (`idx_following_feed`) | `partialFilterExpression: { status: "PUBLISHED" }` | Bounded per-author personalized following feed (`GET /api/v1/tourist/feed/following`) |
| `postLikes` | `{ accountId: 1, postId: 1 }` | Unique Compound | None | Prevent duplicate likes (`POST .../likes`) |
| `postLikes` | `{ postId: 1, createdAt: -1 }` | Compound | None | Post-scoped like lookups & ordering |
| `postComments` | `{ postId: 1, status: 1, deletedAt: 1, createdAt: -1, _id: -1 }` | Compound Partial | `partialFilterExpression: { status: "ACTIVE" }` | Paginated active public comment stream (`GET /api/v1/posts/:postId/comments`) |
| `postComments` | `{ authorId: 1, status: 1, deletedAt: 1, createdAt: -1 }` | Compound | None | Author comment lookups & BOLA checks |
| `postReposts` | `{ accountId: 1, originalPostId: 1 }` | Unique Compound | None | Prevent duplicate reposts (`POST .../reposts`) |
| `postReposts` | `{ originalPostId: 1, createdAt: -1 }` | Compound | None | Post-scoped repost lookups |
| `follows` | `{ followerId: 1, followingId: 1 }` | Unique Compound | None | Uniqueness of social connection |
| `follows` | `{ followingId: 1, createdAt: -1, _id: -1 }` | Compound | None | User's follower list (newest-first deterministic pagination) |
| `follows` | `{ followerId: 1, createdAt: -1, _id: -1 }` | Compound | None | User's following list (newest-first deterministic pagination) |
| `bookmarks` | `{ userId: 1, entityId: 1, entityType: 1 }` | Unique Compound | None | User saved places deduplication |
| `hashtags` | `{ tag: 1 }` | Unique | None | Hashtag autocomplete & trending discovery |
| `hashtags` | `{ usageCount: -1 }` | Single Field | None | Trending tags ticker |

---

### Domain 4: Direct Messaging & Inquiries

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `conversations` | `{ propertyId: 1, createdAt: -1 }` | Compound, Sparse | None | Host property inquiry channel lookup |
| `conversationMembers` | `{ conversationId: 1, accountId: 1 }` | Unique Compound | None | Participant lookup in chat channel |
| `conversationMembers` | `{ accountId: 1, unreadCount: -1 }` | Compound | None | Inbox unread message counters |
| `messages` | `{ conversationId: 1, createdAt: 1 }` | Compound | None | Chronological chat bubble message stream |
| `messageReceipts` | `{ messageId: 1, recipientId: 1 }` | Unique Compound | None | Delivery & read receipt verification |

---

### Domain 5: Travel Agencies & Packages

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `agencies` | `{ accountId: 1 }` | Unique | None | 1:1 business account agency identity mapping |
| `agencies` | `{ registrationNumber: 1 }` | Unique | None | Directorate registration number uniqueness |
| `agencies` | `{ verificationStatus: 1, createdAt: -1, _id: -1 }` | Compound | `name: 'idx_agencies_status_created'` | Admin verification triage queues (newest-first) |
| `agencies` | `{ district: 1, verificationStatus: 1 }` | Compound | `name: 'idx_agencies_district_status'` | Regional administrative filtering |
| `agencies` | `{ createdAt: -1, _id: -1 }` | Compound | `name: 'idx_agencies_created'` | Global chronological listing and pagination |
| `agencyDocuments` | `{ agencyId: 1, docType: 1 }` | Compound | None | Compliance document inspections |
| `travelPackages` | `{ slug: 1 }` | Unique | `name: 'idx_packages_slug'` | Package details SEO URL routing |
| `travelPackages` | `{ agencyId: 1, status: 1, createdAt: -1 }` | Compound | `name: 'idx_packages_agency_status_created'` | Agency catalog listing & status filtering |
| `travelPackages` | `{ status: 1, publishedAt: -1, _id: -1 }` | Compound | `name: 'idx_packages_public_published'` | Public newest feed with zero in-memory sort |
| `travelPackages` | `{ status: 1, packageCategory: 1, publishedAt: -1 }` | Compound | `name: 'idx_packages_public_category'` | Public category discovery rail |
| `travelPackages` | `{ status: 1, basePrice: 1, publishedAt: -1 }` | Compound | `name: 'idx_packages_public_price'` | Price range discovery & filtering |
| `travelPackages` | `{ status: 1, durationDays: 1, publishedAt: -1 }` | Compound | `name: 'idx_packages_public_duration'` | Duration filtering |
| `travelPackages` | `{ destinationIds: 1, status: 1 }` | Multikey | `name: 'idx_packages_destinations'` | Destination-based package discovery |
| `packageSchedules` | `{ packageId: 1, departureDate: 1 }` | Compound | None | Departure calendar availability lookup |
| `packageBookings` | `{ bookingId: 1 }` | Unique | None | Booking manifest linkage |
| `packageBookings` | `{ scheduleId: 1 }` | Single Field | None | Passenger manifest export for departure |

---

### Domain 6: Accommodation & Dual-Mode Inventory

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `properties` | `{ slug: 1 }` | Unique | None | SEO property details lookup (`/properties/:slug`) |
| `properties` | `{ location: "2dsphere" }` | Geospatial | None | Spherical radius search with `$geoNear` (`/properties/nearby`) |
| `properties` | `{ businessProfileId: 1, status: 1, createdAt: -1 }` | Compound | None | Business dashboard property listing sorted newest-first |
| `properties` | `{ accountId: 1, status: 1, createdAt: -1 }` | Compound | None | Direct account ownership validation and filtering |
| `properties` | `{ status: 1, publishedAt: -1, _id: -1 }` | Compound | None | Public discovery catalog sorted newest-first (`IXSCAN` without in-memory `SORT`) |
| `properties` | `{ status: 1, district: 1, publishedAt: -1 }` | Compound | None | Public catalog regional district filtering |
| `properties` | `{ status: 1, propertyType: 1, publishedAt: -1 }` | Compound | None | Public catalog accommodation category filtering |
| `properties` | `{ facilities: 1 }` | Multi-key | None | Fast array filtering for property amenities and facilities |
| `propertyDocuments` | `{ propertyId: 1, docType: 1 }` | Compound | None | Property regulatory compliance check |
| `roomTypes` | `{ propertyId: 1, status: 1 }` | Compound (ESR) | None | Property room types directory & active public filtering |
| `roomTypes` | `{ businessProfileId: 1, status: 1 }` | Compound (ESR) | None | Business host room management dashboard |
| `roomTypes` | `{ propertyId: 1, slug: 1 }` | Unique Sparse | None | Enforces unique URL slug per property |
| `roomInventory` | `{ roomTypeId: 1, date: 1 }` | Unique Compound | None | Exactly one calendar date capacity record per room type |
| `roomInventory` | `{ propertyId: 1, date: 1 }` | Compound (ESR) | None | Property-wide multi-room availability scans |
| `roomInventory` | `{ businessProfileId: 1, date: 1 }` | Compound (ESR) | None | Business host daily inventory control ledger |
| `roomInventory` | `{ roomTypeId: 1, date: 1, availableUnits: 1 }` | Covered Compound | None | High-throughput covered index for live booking availability scans |
| `rooms` | `{ propertyId: 1, isActive: 1 }` | Compound | None | Legacy room selection matrix for property |
| `roomRates` | `{ roomId: 1 }` | Unique | None | Legacy 1:1 hourly and daily pricing retrieval |
| `propertyFacilities`| `{ propertyId: 1, facilityCode: 1 }` | Compound | None | Amenity filter matching |
| `propertyMenus` | `{ propertyId: 1, isAvailable: 1 }` | Compound | None | Dining menu preview |

---

### Domain 7: Bookings, Concurrency & Financial Settlement

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `bookings` | `{ bookingReference: 1 }` | Unique | None | Customer booking lookup & invoice generation |
| `bookings` | `{ touristAccountId: 1, createdAt: -1 }` | Compound | None | Traveler "My Bookings" timeline |
| `bookings` | `{ propertyId: 1, checkInDate: 1 }` | Compound | None | Host check-in dashboard register |
| `bookings` | `{ businessProfileId: 1, createdAt: -1 }` | Compound | None | Merchant dashboard booking overview |
| `bookings` | `{ holdId: 1 }` | Single Field | `sparse: true` | Direct hold-to-booking resolution |
| `inventoryHolds` | `{ bookingId: 1 }` | Unique | None | 1:1 reservation to hold integrity |
| `inventoryHolds` | `{ status: 1, expiresAt: 1 }` | Compound | None | Background expiry worker polling |
| `inventoryHolds` | `{ touristAccountId: 1, status: 1 }` | Compound | None | Active holds by traveler |
| `inventoryHolds` | `{ expiresAt: 1 }` | TTL Index | `expireAfterSeconds: 604800` | 7-day disk storage pruning |
| `idempotencyKeys` | `{ touristAccountId: 1, key: 1 }` | Unique Compound | None | Scoped client request idempotency |
| `idempotencyKeys` | `{ expiresAt: 1 }` | TTL Index | `expireAfterSeconds: 0` | 24-hour automatic request cache pruning |
| `bookingGuests` | `{ bookingId: 1 }` | Single Field | None | Police guest manifest retrieval |
| `bookingEvents` | `{ bookingId: 1, timestamp: 1 }` | Compound | None | Chronological audit trail of booking |
| `cancellationRequests`| `{ bookingId: 1 }` | Unique | None | Cancellation appeal tracking |
| `payments` | `{ gatewayTransactionId: 1 }` | Unique | None | Idempotent payment gateway webhook ingestion |
| `payments` | `{ bookingId: 1 }` | Single Field | None | Transaction details for booking |
| `payments` | `{ status: 1, escrowReleaseDueAt: 1 }` | Compound | `partialFilterExpression: { status: "HELD_IN_ESCROW" }` | Automated escrow release cron scanner |
| `refunds` | `{ gatewayRefundId: 1 }` | Unique | None | Payment gateway refund reconciliation |
| `commissions` | `{ bookingId: 1 }` | Unique | None | 1:1 commission record |
| `commissions` | `{ businessProfileId: 1, isSettled: 1 }` | Compound | None | Merchant pending payout calculation |
| `providerPayouts` | `{ payoutReference: 1 }` | Unique | None | Bank settlement manifest tracking |
| `financialLedger` | `{ entryNumber: 1 }` | Unique | None | Double-entry ledger sequential tracking |
| `financialLedger` | `{ bookingId: 1 }` | Single Field, Sparse | None | Tax compliance audit ledger |

---

### Domain 8: Governance, Moderation & Support

| Collection | Index Keys | Type | Partial Filter / Options | Query Supported |
|---|---|---|---|---|
| `reviews` | `{ targetId: 1, targetType: 1, rating: -1 }` | Compound | None | Star review breakdown for stay/spot |
| `reviews` | `{ bookingId: 1 }` | Unique, Sparse | None | 1 review per booking enforcement |
| `reports` | `{ reporterId: 1, targetType: 1, targetId: 1 }` | Unique Partial Compound | `partialFilterExpression: { status: { $in: ['PENDING', 'UNDER_REVIEW'] } }` | Prevents duplicate active reports while preserving resolved history |
| `reports` | `{ status: 1, createdAt: 1, _id: 1 }` | Compound (ESR) | None | Admin report triage FIFO queue |
| `reports` | `{ reporterId: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Tourist personal submitted reports listing |
| `reports` | `{ targetType: 1, targetId: 1, status: 1 }` | Compound (ESR) | None | Active report count aggregation & queue triage |
| `destinationSubmissions` | `{ district: 1, submissionStatus: 1, createdAt: -1 }` | Compound (ESR) | None | Moderation queue filtering submissions by district |
| `posts` | `{ status: 1, deletedAt: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Admin post moderation listing & queue |
| `posts` | `{ authorId: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Moderation filtering by creator account ID |
| `postComments` | `{ status: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Admin comment moderation listing |
| `blocks` | `{ blockerAccountId: 1, blockedAccountId: 1 }` | Unique Compound | None | User blocking check |
| `notifications` | `{ recipientAccountId: 1, createdAt: -1, _id: -1 }` | Compound (ESR) | None | Paginated reverse-chronological notification tray |
| `notifications` | `{ recipientAccountId: 1, isRead: 1, createdAt: -1 }` | Compound (ESR) | None | Unread badge counts and filtered tray query |
| `notifications` | `{ relatedResourceType: 1, relatedResourceId: 1 }` | Sparse Compound | `sparse: true` | Resource reverse-lookup from deep link or target entity |
| `notificationOutbox` | `{ idempotencyKey: 1 }` | Unique | None | Idempotent event deduplication invariant |
| `notificationOutbox` | `{ status: 1, nextRetryAt: 1 }` | Compound | None | Background delivery worker polling queue index |
| `notificationOutbox` | `{ createdAt: 1 }` | TTL Index | `expireAfterSeconds: 2592000` (30 days) | Auto-prune delivered and dead-letter outbox records |
| `notificationPreferences` | `{ accountId: 1 }` | Unique | None | 1:1 account notification opt-out preference retrieval |
| `media` | `{ storageKey: 1 }` | Unique | None | Cloud object key deduplication |
| `media` | `{ destinationId: 1, displayOrder: 1 }` | Compound | None | Destination media gallery sorting |
| `media` | `{ uploaderAccountId: 1, createdAt: -1 }` | Compound | None | Account media upload history |
| `auditLogs` | `{ timestamp: -1 }` | Single Field | None | Directorate immutable audit log viewer |
| `auditLogs` | `{ targetEntityId: 1, targetEntityType: 1, timestamp: -1 }` | Compound (ESR) | None | Chronological entity change history inspection |
| `auditLogs` | `{ actorAccountId: 1, timestamp: -1 }` | Compound (ESR) | None | Chronological actions timeline by acting administrator |
| `supportTickets` | `{ ticketNumber: 1 }` | Unique | None | Tourist police ticket tracking |
| `supportTickets` | `{ status: 1, priority: 1, createdAt: 1 }` | Compound | None | Tourist Police 1364 emergency queue |
| `systemSettings` | `{ configKey: 1 }` | Unique | None | Fast configuration key retrieval |

> [!NOTE]
> **Partial ESR Trade-Off (`idx_following_feed`)**: Ordering `{ authorId: 1, status: 1, deletedAt: 1, publishedAt: -1, _id: -1, visibility: 1 }` satisfies exact equality filters first, preserves pre-sorted `(publishedAt DESC, _id DESC)` order ahead of the `$in` check on `visibility` (`['PUBLIC', 'FOLLOWERS']`) to eliminate blocking in-memory sorts, and restricts index maintenance to `status: "PUBLISHED"` documents only.
