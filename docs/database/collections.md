# MongoDB Collections Specification & Data Dictionary
**Kerala Tourism Ecosystem**  
**Total Collections:** 51 Collections across 8 Core Functional Domains  
**Format:** Production BSON Schema, Validation Constraints, Cross-References & JSON Document Exemplars  

---

## Domain 1: Authentication & Identity Management

### 1. `accounts`
- **Purpose**: Centralized authentication identity storing primary credentials, security parameters, and account lifecycle state.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `email`: `String` (Normalized lowercase email, unique sparse)
  - `phone`: `String` (E.164 format, unique sparse)
  - `passwordHash`: `String` (bcrypt/Argon2id hash; nullable for OAuth-only users)
  - `role`: `String` (Enum: `TOURIST`, `AGENCY`, `HOTEL`, `INDEPENDENT_HOST`, `ADMIN`)
  - `accountStatus`: `String` (Enum: `ACTIVE`, `PENDING_VERIFICATION`, `SUSPENDED`, `DEACTIVATED`)
  - `isEmailVerified`: `Boolean` (Default `false`)
  - `isPhoneVerified`: `Boolean` (Default `false`)
  - `failedLoginAttempts`: `Int32` (Counter for brute force mitigation, default `0`)
  - `lockoutUntil`: `Date` (Optional temporary lockout expiration timestamp)
  - `twoFactorEnabled`: `Boolean` (Default `false`)
  - `twoFactorSecret`: `String` (Encrypted TOTP secret key, optional)
  - `createdAt`: `Date` (Auto timestamp)
  - `updatedAt`: `Date` (Auto timestamp)
- **Validation**: Email must match RFC 5322 regex. Phone must match `^\+?[1-9]\d{9,14}$`.
- **References**: Profile collections link back to `accountId: ObjectId(accounts._id)`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "email": "arjun.explorer@gmail.com",
  "phone": "+919847012345",
  "passwordHash": "$2b$12$K8j7x9yZ2e3W1v0U...hashed",
  "role": "TOURIST",
  "accountStatus": "ACTIVE",
  "isEmailVerified": true,
  "isPhoneVerified": true,
  "failedLoginAttempts": 0,
  "twoFactorEnabled": false,
  "createdAt": { "$date": "2026-11-10T06:00:00Z" },
  "updatedAt": { "$date": "2026-11-10T06:00:00Z" }
}
```

---

### 2. `touristProfiles`
- **Purpose**: Traveler demographic profile, personalization preferences, and engagement reputation.
- **Fields**:
  - `_id`: `ObjectId`
  - `accountId`: `ObjectId` (Required, Ref: `accounts`, unique)
  - `fullName`: `String` (Required, 2-100 chars)
  - `displayName`: `String` (Required, unique handle)
  - `avatarUrl`: `String` (Optional media URL)
  - `bio`: `String` (Optional, max 300 chars)
  - `preferredLanguage`: `String` (Enum: `EN`, `ML`, default `EN`)
  - `travelInterests`: `Array<String>` (e.g., `["BACKWATERS", "TREKKING", "AYURVEDA"]`)
  - `emergencyContact`: `Object` (Embedded: `name`, `phone`, `relationship`)
  - `tripsCompleted`: `Int32` (Default `0`)
  - `reputationScore`: `Int32` (Default `100`)
  - `isEcoCertifiedTraveler`: `Boolean` (Default `false`)
  - `followersCount`: `Int32` (Default `0`, non-negative `min: 0`)
  - `followingCount`: `Int32` (Default `0`, non-negative `min: 0`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f002" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "fullName": "Arjun Nair",
  "displayName": "arjun_trails",
  "avatarUrl": "https://cdn.keralatourism.gov.in/avatars/arjun.jpg",
  "bio": "Backpacker exploring Western Ghats & ancient temples.",
  "preferredLanguage": "EN",
  "travelInterests": ["BACKWATERS", "HILL_STATION", "AYURVEDA"],
  "emergencyContact": {
    "name": "Lakshmi Nair",
    "phone": "+919847054321",
    "relationship": "Spouse"
  },
  "tripsCompleted": 8,
  "reputationScore": 140,
  "isEcoCertifiedTraveler": true,
  "createdAt": { "$date": "2026-11-10T06:05:00Z" },
  "updatedAt": { "$date": "2026-11-10T06:05:00Z" }
}
```

---

### 3. `businessProfiles`
- **Purpose**: Legal commercial identity and regulatory accreditation data for verified tourism operators.
- **Fields**:
  - `_id`: `ObjectId`
  - `accountId`: `ObjectId` (Required, Ref: `accounts`, unique)
  - `legalEntityName`: `String` (Required)
  - `tradeName`: `String` (Required, customer-facing business name)
  - `businessType`: `String` (Enum: `AGENCY`, `HOTEL`, `RESORT`, `INDEPENDENT_HOST`)
  - `gstin`: `String` (15-character Indian GST identification number)
  - `pan`: `String` (10-character Permanent Account Number)
  - `keralaTourismLicenseNumber`: `String` (e.g. `KTD-HOMESTAY-2024-81`)
  - `accreditationTier`: `String` (Enum: `GOLD`, `SILVER`, `BRONZE`, `UNACCREDITED`)
  - `kycStatus`: `String` (Enum: `PENDING`, `UNDER_REVIEW`, `VERIFIED`, `REVISIONS_REQUIRED`, `REJECTED`)
  - `verifiedAt`: `Date` (Optional timestamp when Directorate approved)
  - `verifiedByAdminId`: `ObjectId` (Optional Ref: `adminProfiles`)
  - `bankSettlementDetails`: `Object` (Encrypted: `accountNumber`, `ifscCode`, `beneficiaryName`)
  - `registeredAddress`: `Object` (Embedded address: `street`, `district`, `pincode`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`, Ref: `adminProfiles._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f003" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f099" },
  "legalEntityName": "Vembanad Heritage Hospitality Pvt Ltd",
  "tradeName": "Kumarakom Lake Breeze Homestay",
  "businessType": "INDEPENDENT_HOST",
  "gstin": "32AAACV1234F1Z8",
  "pan": "AAACV1234F",
  "keralaTourismLicenseNumber": "KTD-HOMESTAY-2024-81",
  "accreditationTier": "GOLD",
  "kycStatus": "VERIFIED",
  "verifiedAt": { "$date": "2026-10-15T10:00:00Z" },
  "registeredAddress": {
    "street": "Post Office Ward, Kavanattinkara",
    "district": "Kottayam",
    "pincode": "686563"
  },
  "createdAt": { "$date": "2026-10-10T08:00:00Z" },
  "updatedAt": { "$date": "2026-10-15T10:00:00Z" }
}
```

---

### 4. `adminProfiles`
- **Purpose**: Government official and platform regulatory supervisor profile with fine-grained RBAC permissions.
- **Fields**:
  - `_id`: `ObjectId`
  - `accountId`: `ObjectId` (Required, Ref: `accounts`, unique)
  - `employeeId`: `String` (Required, unique official government ID, e.g. `KTD-GOV-4091`)
  - `officialName`: `String` (Required)
  - `department`: `String` (e.g. `Tourism Directorate`, `District Collectorate Idukki`)
  - `assignedDistrict`: `String` (Optional district restriction, e.g. `Idukki`, or `ALL`)
  - `permissions`: `Array<String>` (e.g. `["VERIFY_DESTINATION", "APPROVE_KYC", "DISPUTE_REFUND", "VIEW_AUDIT"]`)
  - `clearanceLevel`: `String` (Enum: `SUPER_ADMIN`, `DISTRICT_OFFICER`, `MODERATOR`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f004" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f088" },
  "employeeId": "KTD-INSPECT-04",
  "officialName": "Inspector Rajesh Kumar",
  "department": "Dept of Tourism Governance",
  "assignedDistrict": "ALL",
  "permissions": ["VERIFY_DESTINATION", "APPROVE_KYC", "AUDIT_LEDGER"],
  "clearanceLevel": "DISTRICT_OFFICER",
  "createdAt": { "$date": "2026-09-01T04:00:00Z" },
  "updatedAt": { "$date": "2026-09-01T04:00:00Z" }
}
```

---

### 5. `sessions`
- **Purpose**: Authenticated device sessions with cryptographically hashed refresh tokens and TTL expiration.
- **Fields**:
  - `_id`: `ObjectId`
  - `accountId`: `ObjectId` (Required, Ref: `accounts`)
  - `refreshTokenHash`: `String` (Required, SHA-256 hash of refresh token)
  - `userAgent`: `String` (Browser / Client agent string)
  - `ipAddress`: `String` (Client IPv4/IPv6 address)
  - `isRevoked`: `Boolean` (Default `false`)
  - `expiresAt`: `Date` (Required, TTL index target)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f005" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "refreshTokenHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)",
  "ipAddress": "49.207.210.12",
  "isRevoked": false,
  "expiresAt": { "$date": "2026-12-10T06:00:00Z" },
  "createdAt": { "$date": "2026-11-10T06:00:00Z" }
}
```

---

### 6. `deviceTokens`
- **Purpose**: Mobile device registration tokens (FCM) for push notifications with automatic stale-token TTL eviction and invalid token self-healing.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `accountId`: `ObjectId` (Required, Ref: `accounts`, indexed)
  - `deviceToken`: `String` (Required, unique push registration token)
  - `platform`: `String` (Enum: `IOS`, `ANDROID`)
  - `provider`: `String` (Enum: `FCM`, default: `FCM`)
  - `deviceId`: `String` (Optional hardware/client installation identifier)
  - `isActive`: `Boolean` (Default: `true`, indexed)
  - `lastSeenAt`: `Date` (Default: `Date.now`, target for 90-day stale token TTL cleanup)
  - `invalidatedAt`: `Date` (Timestamp when invalidated by logout or provider rejection)
  - `invalidReason`: `String` (e.g. `USER_UNREGISTERED`, `FCM_UNREGISTERED`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ deviceToken: 1 }` (Unique registration token)
  - `{ accountId: 1, isActive: 1 }` (Active device token lookup by account)
  - `{ lastSeenAt: 1 }` (90-day TTL cleanup index: `expireAfterSeconds: 7776000`)
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f006" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "deviceToken": "fcm_mobile_mock_android_1731835000000_a1b2c3d4",
  "platform": "ANDROID",
  "provider": "FCM",
  "deviceId": "dev_android_1731835000000",
  "isActive": true,
  "lastSeenAt": { "$date": "2026-11-17T09:00:00Z" },
  "createdAt": { "$date": "2026-11-17T09:00:00Z" },
  "updatedAt": { "$date": "2026-11-17T09:00:00Z" }
}
```

---

## Domain 2: Destinations & Geospatial Registry

### 7. `destinations`
- **Purpose**: Official verified tourism destinations published for public exploration with GeoJSON coordinates.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `name`: `String` (Required, 2–120 chars, trimmed)
  - `slug`: `String` (Required, unique, lowercase, normalized)
  - `description`: `String` (Required, 20–5000 chars)
  - `shortDescription`: `String` (Optional summary, max 300 chars)
  - `categoryIds`: `Array<ObjectId>` (References `destinationCategories._id`, indexed)
  - `location`: `Object` (GeoJSON Point: `{ type: "Point", coordinates: [Number, Number] }`, 2dsphere indexed)
  - `address`: `String` (Required, 5–300 chars)
  - `district`: `String` (Required, enum: 14 approved Kerala districts, indexed)
  - `locality`: `String` (Optional locality/village, max 100 chars)
  - `images`: `Array<String>` (Media reference URLs/IDs)
  - `facilities`: `Array<String>` (e.g. `["PARKING", "RESTROOMS", "VIEWPOINT"]`)
  - `bestTimeToVisit`: `String` (e.g. `October to March`)
  - `entryFee`: `Object` (`{ amount: Number, currency: String, isFree: Boolean }`)
  - `verificationStatus`: `String` (Enum: `PENDING`, `VERIFIED`, `REJECTED`, default: `PENDING`, indexed)
  - `publicationStatus`: `String` (Enum: `DRAFT`, `PUBLISHED`, `ARCHIVED`, default: `DRAFT`, indexed)
  - `createdBy`: `ObjectId` (Required, Ref: `accounts`)
  - `verifiedBy`: `ObjectId` (Optional Ref: `accounts`)
  - `publishedAt`: `Date` (Timestamp of publication)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `destinationCategories._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f007" },
  "name": "Munroe Island Mangrove Waterways",
  "slug": "munroe-island-mangrove-waterways",
  "categoryIds": [{ "$oid": "66e04d3e89a4b2c1d8e1f008" }],
  "district": "Kollam",
  "description": "Quiet canoe trails weaving through narrow tidal canals where the Kallada River meets Ashtamudi Lake.",
  "location": {
    "type": "Point",
    "coordinates": [76.6117, 8.9953]
  },
  "address": "Munroe Island, Kollam District, Kerala 691502",
  "images": [
    "https://cdn.keralatourism.gov.in/spots/munroe-1.jpg",
    "https://cdn.keralatourism.gov.in/spots/munroe-2.jpg"
  ],
  "facilities": ["CANOE_HIRE", "HOMESTAY_ACCESS", "PARKING"],
  "bestTimeToVisit": "October to February",
  "entryFee": {
    "amount": 0,
    "currency": "INR",
    "isFree": true
  },
  "verificationStatus": "VERIFIED",
  "publicationStatus": "PUBLISHED",
  "publishedAt": { "$date": "2026-08-01T00:00:00Z" },
  "createdBy": { "$oid": "66e04d3e89a4b2c1d8e1f004" },
  "verifiedBy": { "$oid": "66e04d3e89a4b2c1d8e1f004" },
  "createdAt": { "$date": "2026-08-01T00:00:00Z" },
  "updatedAt": { "$date": "2026-08-01T00:00:00Z" }
}
```

---

### 8. `destinationCategories`
- **Purpose**: Master taxonomic classifications for Kerala travel destinations.
- **Fields**:
  - `_id`: `ObjectId`
  - `name`: `String` (Required, unique, trimmed, 2–50 chars)
  - `slug`: `String` (Required, unique, lowercase, trimmed)
  - `description`: `String` (Optional, max 500 chars)
  - `icon`: `String` (Material Symbol icon key, e.g. `water`, `terrain`)
  - `isActive`: `Boolean` (Default `true`, indexed)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f008" },
  "name": "Backwaters & Lagoons",
  "slug": "backwaters-and-lagoons",
  "description": "Canal networks, coastal lakes and houseboats",
  "icon": "water",
  "isActive": true,
  "createdAt": { "$date": "2026-08-01T00:00:00Z" },
  "updatedAt": { "$date": "2026-08-01T00:00:00Z" }
}
```

---

### 9. `destinationSubmissions`
- **Purpose**: Crowdsourced community destination suggestions submitted by tourists awaiting regulatory review.
- **Fields**:
  - `_id`: `ObjectId`
  - `submittedBy`: `ObjectId` (Required, Ref: `accounts`, indexed)
  - `name`: `String` (Required, 2–120 chars)
  - `description`: `String` (Required, 20–2000 chars)
  - `categoryIds`: `Array<ObjectId>` (References `destinationCategories._id`)
  - `district`: `String` (Optional, Enum: 14 approved Kerala districts; indexed for moderation queue filtering)
  - `submittedLocation`: `Object` (GeoJSON Point: `{ type: "Point", coordinates: [Number, Number] }`)
  - `submittedAddress`: `String` (Required, 5–300 chars)
  - `imageMediaIds`: `Array<String>` (1 to 10 media references)
  - `submissionStatus`: `String` (Enum: `PENDING`, `APPROVED`, `REJECTED`, default: `PENDING`, indexed)
  - `reviewedBy`: `ObjectId` (Optional Ref: `accounts`)
  - `reviewedAt`: `Date` (Optional review decision timestamp)
  - `reviewNotes`: `String` (Optional review justification, max 1000 chars)
  - `destinationId`: `ObjectId` (Optional Ref: `destinations`, linked upon approval)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`, Ref: `destinationCategories._id`, Ref: `destinations._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f009" },
  "submittedBy": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "name": "Cheeyappara Lower Cascades",
  "description": "Hidden natural pool 400m below the main highway viewpoint.",
  "categoryIds": [{ "$oid": "66e04d3e89a4b2c1d8e1f008" }],
  "submittedLocation": {
    "type": "Point",
    "coordinates": [76.8921, 10.0124]
  },
  "submittedAddress": "Near Mile-marker 32 on Kochi-Dhanushkodi Highway, Idukki",
  "imageMediaIds": ["media-photo-001.jpg", "media-photo-002.jpg"],
  "submissionStatus": "PENDING",
  "createdAt": { "$date": "2026-11-10T04:00:00Z" },
  "updatedAt": { "$date": "2026-11-10T04:00:00Z" }
}
```

---

### 10. `destinationVerifications`
- **Purpose**: Formal administrative decision record, geo-fence audit, and reverse-image safety check.
- **Fields**:
  - `_id`: `ObjectId`
  - `submissionId`: `ObjectId` (Required, Ref: `destinationSubmissions`, unique)
  - `reviewedByAdminId`: `ObjectId` (Required, Ref: `adminProfiles`)
  - `geofenceCheckResult`: `String` (Enum: `PASS_KERALA_BOUNDS`, `FAIL_OUTSIDE_STATE`, `FAIL_CORE_TIGER_ZONE`)
  - `reverseImageSafetyScore`: `Double` (Percentage score from copyright/EXIF authenticity scanner)
  - `decision`: `String` (Enum: `APPROVED`, `REVISION_REQUESTED`, `REJECTED`)
  - `reviewerNotes`: `String` (Audit justification)
  - `assignedDestinationId`: `ObjectId` (Optional Ref: `destinations` if approved)
  - `createdAt`: `Date`
- **References**: Ref: `destinationSubmissions._id`, Ref: `adminProfiles._id`, Ref: `destinations._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f010" },
  "submissionId": { "$oid": "66e04d3e89a4b2c1d8e1f009" },
  "reviewedByAdminId": { "$oid": "66e04d3e89a4b2c1d8e1f004" },
  "geofenceCheckResult": "PASS_KERALA_BOUNDS",
  "reverseImageSafetyScore": 98.4,
  "decision": "APPROVED",
  "reviewerNotes": "Coordinates verified against Forest Department non-restricted recreational buffer.",
  "assignedDestinationId": { "$oid": "66e04d3e89a4b2c1d8e1f007" },
  "createdAt": { "$date": "2026-11-10T05:30:00Z" }
}
```

---

## Domain 3: Social Networking & Community Feed

### 11. `posts`
- **Purpose**: Community traveler posts, travel stories, and optional media/destination-linked moments (Day 13).
- **Fields**:
  - `_id`: `ObjectId`
  - `authorId`: `ObjectId` (Required, Immutable, Ref: `accounts`)
  - `content`: `String` (Required, trimmed, 1–2000 chars)
  - `mediaIds`: `Array<ObjectId>` (Default `[]`, max 10 unique IDs, Ref: `media`)
  - `destinationId`: `ObjectId | null` (Optional Ref: `destinations` — must be `VERIFIED` and `PUBLISHED`)
  - `visibility`: `String` (Enum: `PUBLIC`, `FOLLOWERS`, `PRIVATE`, default `PUBLIC`)
  - `status`: `String` (Enum: `PENDING`, `PUBLISHED`, `REJECTED`, `REMOVED`, default `PUBLISHED`)
  - `publishedAt`: `Date | null` (Publication timestamp used for chronological sorting)
  - `deletedAt`: `Date | null` (Soft-deletion timestamp, default `null`)
  - `likesCount`: `Number` (Default `0`, min `0` — denormalized atomic engagement counter, Day 14)
  - `commentsCount`: `Number` (Default `0`, min `0` — denormalized atomic active comment counter, Day 14)
  - `repostsCount`: `Number` (Default `0`, min `0` — denormalized atomic repost counter, Day 14)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`, Ref: `media._id`, Ref: `destinations._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f011" },
  "authorId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "content": "Watching fishermen haul traditional Chinese fishing nets as mist rolls in over Fort Kochi.",
  "mediaIds": [{ "$oid": "66e04d3e89a4b2c1d8e1f055" }],
  "destinationId": { "$oid": "66e04d3e89a4b2c1d8e1f007" },
  "visibility": "PUBLIC",
  "status": "PUBLISHED",
  "likesCount": 12,
  "commentsCount": 3,
  "repostsCount": 2,
  "publishedAt": { "$date": "2026-11-11T05:00:00Z" },
  "deletedAt": null,
  "createdAt": { "$date": "2026-11-11T05:00:00Z" },
  "updatedAt": { "$date": "2026-11-11T05:00:00Z" }
}
```

---

### 12. `postLikes`
- **Purpose**: Idempotent tracking of tourist post likes (Day 14).
- **Fields**:
  - `_id`: `ObjectId`
  - `accountId`: `ObjectId` (Required, Immutable, Ref: `accounts`)
  - `postId`: `ObjectId` (Required, Immutable, Ref: `posts`)
  - `createdAt`: `Date`
- **Constraint**: Unique compound index `{ accountId: 1, postId: 1 }`.
- **References**: Ref: `accounts._id`, Ref: `posts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f012" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "postId": { "$oid": "66e04d3e89a4b2c1d8e1f011" },
  "createdAt": { "$date": "2026-11-11T06:10:00Z" }
}
```

---

### 13. `postComments`
- **Purpose**: Flat paginated tourist comments on published public community posts (Day 14).
- **Fields**:
  - `_id`: `ObjectId`
  - `postId`: `ObjectId` (Required, Immutable, Ref: `posts`)
  - `authorId`: `ObjectId` (Required, Immutable, Ref: `accounts`)
  - `content`: `String` (Required, trimmed, `1–1000` chars)
  - `status`: `String` (Enum: `ACTIVE`, `REMOVED`, default `ACTIVE`)
  - `deletedAt`: `Date | null` (Default `null`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `posts._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f013" },
  "postId": { "$oid": "66e04d3e89a4b2c1d8e1f011" },
  "authorId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "content": "Is the ferry operational early in the morning?",
  "status": "ACTIVE",
  "deletedAt": null,
  "createdAt": { "$date": "2026-11-11T06:15:00Z" },
  "updatedAt": { "$date": "2026-11-11T06:15:00Z" }
}
```

---

### 14. `postReposts`
- **Purpose**: Shares of eligible published public posts by authenticated tourists without duplicating original media or content (Day 14).
- **Fields**:
  - `_id`: `ObjectId`
  - `accountId`: `ObjectId` (Required, Immutable, Ref: `accounts`)
  - `originalPostId`: `ObjectId` (Required, Immutable, Ref: `posts`)
  - `createdAt`: `Date`
- **Constraint**: Unique compound index `{ accountId: 1, originalPostId: 1 }`.
- **References**: Ref: `accounts._id`, Ref: `posts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f014" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "originalPostId": { "$oid": "66e04d3e89a4b2c1d8e1f011" },
  "createdAt": { "$date": "2026-11-11T06:30:00Z" }
}
```

---

### 15. `follows`
- **Purpose**: Directed follow relationships between active `TOURIST` accounts (`followerId` -> `followingId`), synced atomically with denormalized `followersCount` / `followingCount` counters on `touristProfiles`.
- **Fields**:
  - `_id`: `ObjectId`
  - `followerId`: `ObjectId` (Required, Immutable, Ref: `accounts` — active `TOURIST`)
  - `followingId`: `ObjectId` (Required, Immutable, Ref: `accounts` — active `TOURIST`, `followingId !== followerId`)
  - `createdAt`: `Date` (Immutable creation timestamp)
- **Constraints & Indexes**: Unique compound index `{ followerId: 1, followingId: 1 }` (`idx_follows_unique`), `{ followingId: 1, createdAt: -1, _id: -1 }` (`idx_follows_followers`), `{ followerId: 1, createdAt: -1, _id: -1 }` (`idx_follows_following`); schema pre-validate hook rejects self-following.
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f015" },
  "followerId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "followingId": { "$oid": "66e04d3e89a4b2c1d8e1f099" },
  "createdAt": { "$date": "2026-11-09T19:00:00Z" }
}
```

---

### 16. `bookmarks`
- **Purpose**: Private saved collections of destinations, stays, or tour packages.
- **Fields**:
  - `_id`: `ObjectId`
  - `userId`: `ObjectId` (Required, Ref: `accounts`)
  - `entityId`: `ObjectId` (Required, generic ref ID)
  - `entityType`: `String` (Enum: `DESTINATION`, `PROPERTY`, `TRAVEL_PACKAGE`, `POST`)
  - `collectionFolder`: `String` (e.g. `Monsoon Trip`, `Weekend Transit`)
  - `createdAt`: `Date`
- **Constraint**: Unique compound index `{ userId: 1, entityId: 1, entityType: 1 }`.
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f016" },
  "userId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "entityId": { "$oid": "66e04d3e89a4b2c1d8e1f007" },
  "entityType": "DESTINATION",
  "collectionFolder": "Monsoon 2026",
  "createdAt": { "$date": "2026-11-09T19:30:00Z" }
}
```

---

### 17. `hashtags`
- **Purpose**: Trending topics and tag discovery index.
- **Fields**:
  - `_id`: `ObjectId`
  - `tag`: `String` (Required, lowercase without `#`, unique)
  - `usageCount`: `Int32` (Default `1`)
  - `lastUsedAt`: `Date`
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f017" },
  "tag": "godsowncountry",
  "usageCount": 18490,
  "lastUsedAt": { "$date": "2026-11-10T06:00:00Z" }
}
```

---

## Domain 4: Direct Messaging & Inquiries

### 18. `conversations`
- **Purpose**: In-app messaging channels between travelers and hospitality hosts or tour operators.
- **Fields**:
  - `_id`: `ObjectId`
  - `conversationType`: `String` (Enum: `DIRECT`, `BOOKING_INQUIRY`, `SUPPORT`)
  - `propertyId`: `ObjectId` (Optional Ref: `properties`)
  - `bookingId`: `ObjectId` (Optional Ref: `bookings`)
  - `lastMessageSnippet`: `String` (Preview text)
  - `lastMessageTimestamp`: `Date`
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `properties._id`, Ref: `bookings._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f018" },
  "conversationType": "BOOKING_INQUIRY",
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "lastMessageSnippet": "Yes, we can prepare the Teak Room by 7:00 AM.",
  "lastMessageTimestamp": { "$date": "2026-11-10T06:12:00Z" },
  "createdAt": { "$date": "2026-11-10T06:00:00Z" }
}
```

---

### 19. `conversationMembers`
- **Purpose**: Membership junction managing read states and unread counters per user.
- **Fields**:
  - `_id`: `ObjectId`
  - `conversationId`: `ObjectId` (Required, Ref: `conversations`)
  - `accountId`: `ObjectId` (Required, Ref: `accounts`)
  - `unreadCount`: `Int32` (Default `0`)
  - `lastReadTimestamp`: `Date`
  - `isMuted`: `Boolean` (Default `false`)
  - `isArchived`: `Boolean` (Default `false`)
- **Constraint**: Unique compound index `{ conversationId: 1, accountId: 1 }`.
- **References**: Ref: `conversations._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f019" },
  "conversationId": { "$oid": "66e04d3e89a4b2c1d8e1f018" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "unreadCount": 0,
  "lastReadTimestamp": { "$date": "2026-11-10T06:15:00Z" }
}
```

---

### 20. `messages`
- **Purpose**: Individual chat messages and embedded reservation passes.
- **Fields**:
  - `_id`: `ObjectId`
  - `conversationId`: `ObjectId` (Required, Ref: `conversations`)
  - `senderId`: `ObjectId` (Required, Ref: `accounts`)
  - `content`: `String` (Required, text message)
  - `messageType`: `String` (Enum: `TEXT`, `IMAGE`, `CUSTOM_OFFER`, `BOOKING_PASS`, `SYSTEM_NOTICE`)
  - `metadata`: `Object` (Optional embedded offer details: `{ price: 850, hours: 3 }`)
  - `attachments`: `Array<String>` (Media URLs)
  - `createdAt`: `Date`
- **References**: Ref: `conversations._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f020" },
  "conversationId": { "$oid": "66e04d3e89a4b2c1d8e1f018" },
  "senderId": { "$oid": "66e04d3e89a4b2c1d8e1f099" },
  "content": "Special 3-hour transit offer for early arrival.",
  "messageType": "CUSTOM_OFFER",
  "metadata": {
    "roomId": "66e04d3e89a4b2c1d8e1f029",
    "slot": "07:00-10:00",
    "rate": 800
  },
  "createdAt": { "$date": "2026-11-10T06:12:00Z" }
}
```

---

### 21. `messageReceipts`
- **Purpose**: Delivery and read acknowledgment tracking per recipient.
- **Fields**:
  - `_id`: `ObjectId`
  - `messageId`: `ObjectId` (Required, Ref: `messages`)
  - `recipientId`: `ObjectId` (Required, Ref: `accounts`)
  - `deliveredAt`: `Date`
  - `readAt`: `Date`
- **Constraint**: Unique compound index `{ messageId: 1, recipientId: 1 }`.
- **References**: Ref: `messages._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f021" },
  "messageId": { "$oid": "66e04d3e89a4b2c1d8e1f020" },
  "recipientId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "deliveredAt": { "$date": "2026-11-10T06:12:02Z" },
  "readAt": { "$date": "2026-11-10T06:15:00Z" }
}
```

---

## Domain 5: Travel Agencies & Curated Packages

### 22. `agencies`
- **Purpose**: Licensed travel agency and tour operator commercial profiles under the Split-Identity architecture.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `accountId`: `ObjectId` (Required, Ref: `accounts`, unique `idx_agencies_accountId_unique`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`, unique `idx_agencies_businessProfileId_unique`)
  - `agencyName`: `String` (Required, 2-100 characters)
  - `registrationNumber`: `String` (Required, unique `idx_agencies_registrationNumber_unique`)
  - `businessCategory`: `String` (Enum: `TOUR_OPERATOR`, `TRAVEL_AGENT`, `ACTIVITY_PROVIDER`, `TRANSPORT_OPERATOR`, `OTHER`)
  - `description`: `String` (Required, 10-2000 characters)
  - `contactEmail`: `String` (Required, lowercase)
  - `contactPhone`: `String` (Required, E.164 format)
  - `website`: `String` (Optional, valid URL)
  - `address`: `String` (Required, 5-300 characters)
  - `district`: `String` (Required, Kerala District)
  - `state`: `String` (Default `Kerala`)
  - `pinCode`: `String` (Required, 6-digit numeric string)
  - `logoMediaId`: `ObjectId` (Optional, Ref: `media`)
  - `verificationStatus`: `String` (Enum: `PENDING`, `UNDER_REVIEW`, `VERIFIED`, `REJECTED`, default `PENDING`)
  - `reviewedBy`: `ObjectId` (Optional, Ref: `accounts`)
  - `reviewedAt`: `Date` (Optional reviewer timestamp)
  - `verifiedAt`: `Date` (Optional approval timestamp)
  - `rejectionReason`: `String` (Mandatory when status is `REJECTED`)
  - `documents`: `Array<Subdocument>` (Compliance documents with `_id`, `documentType`, `originalFileName`, `fileSize`, `mimeType`, `storageKey`, `uploadedAt`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`, `businessProfiles._id`, `media._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f022" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f003" },
  "agencyName": "Kerala Malabar Eco Trails",
  "registrationNumber": "KTD-AGENCY-2026-91",
  "businessCategory": "TOUR_OPERATOR",
  "description": "Eco-friendly guided trekking and backwater tours across Malabar and Wayanad.",
  "contactEmail": "info@malabarecotrails.com",
  "contactPhone": "+919847012345",
  "website": "https://www.malabarecotrails.com",
  "address": "4th Floor, Tourism Complex, MG Road",
  "district": "Ernakulam",
  "state": "Kerala",
  "pinCode": "682016",
  "verificationStatus": "PENDING",
  "documents": [
    {
      "_id": { "$oid": "66e04d3e89a4b2c1d8e1f099" },
      "documentType": "BUSINESS_REGISTRATION",
      "originalFileName": "kerala_gov_registration.pdf",
      "fileSize": 1048576,
      "mimeType": "application/pdf",
      "storageKey": "vault/agencies/66e04d3e89a4b2c1d8e1f022/uuid-v4-file",
      "uploadedAt": { "$date": "2026-11-13T04:30:00Z" }
    }
  ],
  "createdAt": { "$date": "2026-11-13T04:30:00Z" },
  "updatedAt": { "$date": "2026-11-13T04:30:00Z" }
}
```

---

### 23. `agencyDocuments`
- **Purpose**: Regulatory compliance files (Panchayat license, fleet insurance, guide licenses).
- **Fields**:
  - `_id`: `ObjectId`
  - `agencyId`: `ObjectId` (Required, Ref: `agencies`)
  - `documentType`: `String` (Enum: `TRADE_LICENSE`, `INSURANCE_CERT`, `GUIDE_BADGE`)
  - `fileUrl`: `String` (Private cloud storage reference)
  - `expiryDate`: `Date` (Optional expiry)
  - `verificationStatus`: `String` (Enum: `PENDING`, `APPROVED`, `EXPIRED`)
  - `createdAt`: `Date`
- **References**: Ref: `agencies._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f023" },
  "agencyId": { "$oid": "66e04d3e89a4b2c1d8e1f022" },
  "documentType": "TRADE_LICENSE",
  "fileUrl": "s3://kerala-tourism-vault/agency/trade-lic-91.pdf",
  "expiryDate": { "$date": "2027-03-31T00:00:00Z" },
  "verificationStatus": "APPROVED"
}
```

---

### 24. `travelPackages`
- **Purpose**: Canonical travel package catalog representing multi-day curated tour packages with day-by-day itineraries, destinations, and pricing.
- **Fields**:
  - `_id`: `ObjectId` (Primary key)
  - `agencyId`: `ObjectId` (Required, Ref: `agencies`, immutable, indexed)
  - `createdBy`: `ObjectId` (Required, Ref: `accounts`, immutable)
  - `updatedBy`: `ObjectId` (Required, Ref: `accounts`)
  - `title`: `String` (Required, min 3, max 120 chars, e.g. `4D/3N Backwaters & Tea Trail`)
  - `slug`: `String` (Required, unique, lowercase, URL-friendly)
  - `shortDescription`: `String` (Required, max 300 chars)
  - `description`: `String` (Required, min 20, max 5000 chars)
  - `packageCategory`: `String` (Required, enum: `BACKWATER`, `HILL_STATION`, `BEACH`, `AYURVEDA_WELLNESS`, `WILDLIFE`, `CULTURAL_HERITAGE`, `ADVENTURE`, `ECO_TOURISM`, `HONEYMOON`, `PILGRIMAGE`, `TOUR_OPERATOR`, `OTHER`)
  - `tags`: `Array<String>` (Max 20 tags, lowercase)
  - `destinationIds`: `Array<ObjectId>` (Ref: `destinations`)
  - `startLocation`: `String` (Optional, max 120 chars)
  - `endLocation`: `String` (Optional, max 120 chars)
  - `itinerary`: `Array<Object>`:
    - `dayNumber`: `Int32` (1-indexed, sequential)
    - `title`: `String` (Required, max 120 chars)
    - `description`: `String` (Required, max 2000 chars)
    - `activities`: `Array<String>` (Max 20 activities per day)
    - `destinationId`: `ObjectId` (Optional, Ref: `destinations`)
    - `estimatedDuration`: `String` (Optional, max 100 chars)
  - `durationDays`: `Int32` (Required, min 1, max 30)
  - `durationNights`: `Int32` (Required, min 0, max 30)
  - `inclusions`: `Array<String>` (Max 50 items, each max 200 chars)
  - `exclusions`: `Array<String>` (Max 50 items, each max 200 chars)
  - `importantInformation`: `String` (Optional, max 3000 chars)
  - `cancellationPolicy`: `String` (Optional, max 2000 chars)
  - `currency`: `String` (Default `INR`)
  - `basePrice`: `Double` (Required, positive)
  - `childPrice`: `Double` (Optional, positive)
  - `groupPricing`: `Array<Object>` (`minPax`, `maxPax`, `pricePerPerson`)
  - `pricingUnit`: `String` (Enum: `PER_PERSON`, `PER_COUPLE`, `PER_GROUP`, `PER_VEHICLE`, `PER_PACKAGE`, default `PER_PERSON`)
  - `maxGroupSize`: `Int32` (Optional, positive)
  - `coverMediaId`: `ObjectId` (Optional, Ref: `media`)
  - `galleryMediaIds`: `Array<ObjectId>` (Max 10, Ref: `media`)
  - `status`: `String` (Enum: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `REJECTED`, `ARCHIVED`, default `DRAFT`, indexed)
  - `submittedAt`: `Date` (Optional)
  - `publishedAt`: `Date` (Optional, indexed)
  - `reviewedAt`: `Date` (Optional)
  - `reviewedBy`: `ObjectId` (Optional, Ref: `accounts`)
  - `rejectionReason`: `String` (Optional, mandatory when `status === 'REJECTED'`)
  - `archivedAt`: `Date` (Optional)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `idx_packages_slug`: `{ slug: 1 }` (Unique)
  - `idx_packages_agency_status_created`: `{ agencyId: 1, status: 1, createdAt: -1 }` (Agency catalog listing & status filtering)
  - `idx_packages_public_published`: `{ status: 1, publishedAt: -1, _id: -1 }` (Public newest feed)
  - `idx_packages_public_category`: `{ status: 1, packageCategory: 1, publishedAt: -1 }` (Public category browsing)
  - `idx_packages_public_price`: `{ status: 1, basePrice: 1, publishedAt: -1 }` (Price range discovery)
  - `idx_packages_public_duration`: `{ status: 1, durationDays: 1, publishedAt: -1 }` (Duration discovery)
  - `idx_packages_destinations`: `{ destinationIds: 1, status: 1 }` (Destination linkage)
- **References**: Ref: `agencies._id`, `accounts._id`, `destinations._id`, `media._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f024" },
  "agencyId": { "$oid": "66e04d3e89a4b2c1d8e1f022" },
  "createdBy": { "$oid": "66e04d3e89a4b2c1d8e1f010" },
  "updatedBy": { "$oid": "66e04d3e89a4b2c1d8e1f010" },
  "title": "4D/3N Backwaters & Misty Munnar Trail",
  "slug": "4d-3n-backwaters-and-misty-munnar-trail",
  "shortDescription": "Discover rolling tea plantations, pristine waterfalls, and misty peaks.",
  "description": "Comprehensive four-day tour package taking travelers through Cheeyappara falls...",
  "packageCategory": "HILL_STATION",
  "tags": ["munnar", "tea-trail", "hills"],
  "destinationIds": [{ "$oid": "66e04d3e89a4b2c1d8e1f005" }],
  "durationDays": 4,
  "durationNights": 3,
  "basePrice": 14500.0,
  "currency": "INR",
  "pricingUnit": "PER_PERSON",
  "itinerary": [
    { "dayNumber": 1, "title": "Cochin Arrival & Heritage Walk", "activities": ["Dutch Palace", "Jew Town"], "description": "Arrival walk" },
    { "dayNumber": 2, "title": "Munnar Scenic Drive", "activities": ["Tea Terraces", "Cheeyappara Falls"], "description": "Scenic drive" }
  ],
  "inclusions": ["AC Sedan Chauffeur", "Traditional Breakfast & Dinner", "Deluxe Tea Estate Stay"],
  "exclusions": ["Airfare to COK"],
  "maxGroupSize": 10,
  "status": "PUBLISHED",
  "publishedAt": { "$date": "2026-11-13T10:00:00Z" },
  "createdAt": { "$date": "2026-11-10T00:00:00Z" },
  "updatedAt": { "$date": "2026-11-13T10:00:00Z" }
}
```

---

### 25. `packageSchedules`
- **Purpose**: Departure dates and available group slots for travel packages.
- **Fields**:
  - `_id`: `ObjectId`
  - `packageId`: `ObjectId` (Required, Ref: `travelPackages`)
  - `departureDate`: `Date` (Required)
  - `returnDate`: `Date` (Required)
  - `seatsTotal`: `Int32` (Required)
  - `seatsBooked`: `Int32` (Default `0`)
  - `status`: `String` (Enum: `OPEN`, `FILLING_FAST`, `SOLD_OUT`, `CANCELLED`)
- **References**: Ref: `travelPackages._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f025" },
  "packageId": { "$oid": "66e04d3e89a4b2c1d8e1f024" },
  "departureDate": { "$date": "2026-12-05T03:30:00Z" },
  "returnDate": { "$date": "2026-12-09T14:30:00Z" },
  "seatsTotal": 10,
  "seatsBooked": 6,
  "status": "OPEN"
}
```

---

### 26. `packageBookings`
- **Purpose**: Passenger manifest and booking records for scheduled tour departures.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`, unique)
  - `scheduleId`: `ObjectId` (Required, Ref: `packageSchedules`)
  - `pickupLocation`: `String` (e.g. `Cochin International Airport T3`)
  - `passengerManifest`: `Array<Object>` (Embedded: `[{ name, age, gender, phone }]`)
  - `assignedGuide`: `String` (Optional guide name)
- **References**: Ref: `bookings._id`, Ref: `packageSchedules._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f026" },
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "scheduleId": { "$oid": "66e04d3e89a4b2c1d8e1f025" },
  "pickupLocation": "Cochin International Airport Terminal 3",
  "passengerManifest": [
    { "name": "Arjun Nair", "age": 32, "gender": "M", "phone": "+919847012345" },
    { "name": "Lakshmi Nair", "age": 29, "gender": "F", "phone": "+919847054321" }
  ]
}
```

---

## Domain 6: Accommodation & Dual-Mode Inventory

### 27. `properties`
- **Purpose**: Canonical hospitality property establishment records (Hotels, Resorts, Homestays, Villas, Guesthouses, Hostels, Houseboats) under the Split-Identity architecture.
- **Fields**:
  - `_id`: `ObjectId` (Primary key)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`, indexed)
  - `accountId`: `ObjectId` (Required, Ref: `accounts`, indexed)
  - `createdBy`: `ObjectId` (Required, Ref: `accounts`, immutable)
  - `updatedBy`: `ObjectId` (Required, Ref: `accounts`)
  - `name`: `String` (Required, min 2, max 150 chars, e.g. `Kumarakom Heritage Backwater Resort`)
  - `slug`: `String` (Required, unique lowercase URL-safe slug)
  - `propertyType`: `String` (Required, Enum: `HOTEL`, `RESORT`, `HOMESTAY`, `VILLA`, `GUESTHOUSE`, `HOSTEL`, `HOUSEBOAT`, `OTHER`)
  - `shortDescription`: `String` (Optional, max 300 chars)
  - `description`: `String` (Optional, max 5000 chars)
  - `address`: `String` (Required, min 5 chars)
  - `district`: `String` (Required, Kerala District)
  - `city`: `String` (Optional)
  - `state`: `String` (Default `'Kerala'`)
  - `postalCode`: `String` (Optional, 6-digit numeric string)
  - `location`: `Object` (GeoJSON Point: `coordinates: [longitude, latitude]`, 2dsphere indexed)
  - `contactPhone`: `String` (Optional, E.164 format)
  - `contactEmail`: `String` (Optional, lowercase email)
  - `website`: `String` (Optional, valid URL)
  - `facilities`: `Array<String>` (Validated against `PROPERTY_FACILITIES` constants)
  - `coverMediaId`: `ObjectId` (Optional, Ref: `media`)
  - `galleryMediaIds`: `Array<ObjectId>` (Max 15, Ref: `media`, no duplicates)
  - `status`: `String` (Required, Enum: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `REJECTED`, `ARCHIVED`, default `DRAFT`)
  - `submittedAt`: `Date` (Timestamp when submitted for admin review)
  - `publishedAt`: `Date` (Timestamp when approved and published)
  - `reviewedAt`: `Date` (Timestamp when admin decision rendered)
  - `reviewedBy`: `ObjectId` (Ref: `accounts`, administrator who reviewed)
  - `rejectionReason`: `String` (Mandatory on rejection, min 5, max 1000 chars)
  - `archivedAt`: `Date` (Timestamp when soft-deleted/archived)
  - `supportsHourly`: `Boolean` (Default `false`)
  - `supportsDaily`: `Boolean` (Default `true`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `businessProfiles._id`, Ref: `accounts._id`, Ref: `media._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f003" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "createdBy": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "updatedBy": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "name": "Kumarakom Heritage Backwater Resort",
  "slug": "kumarakom-heritage-backwater-resort",
  "propertyType": "RESORT",
  "shortDescription": "Luxury backwater resort situated on the banks of Vembanad Lake.",
  "description": "Experience traditional Kerala architecture with private plunge pools, Ayurvedic rejuvenation, and sunset boat cruises.",
  "address": "Kavanattinkara Jetty Road, Kumarakom",
  "district": "Kottayam",
  "city": "Kumarakom",
  "state": "Kerala",
  "postalCode": "686563",
  "location": {
    "type": "Point",
    "coordinates": [76.4281, 9.6178]
  },
  "contactPhone": "+919847012345",
  "contactEmail": "reservations@kumarakomheritage.test",
  "website": "https://kumarakomheritage.test",
  "facilities": ["WIFI", "PARKING", "SWIMMING_POOL", "RESTAURANT", "AIR_CONDITIONING", "SPA"],
  "coverMediaId": { "$oid": "66e04d3e89a4b2c1d8e1f050" },
  "galleryMediaIds": [
    { "$oid": "66e04d3e89a4b2c1d8e1f051" },
    { "$oid": "66e04d3e89a4b2c1d8e1f052" }
  ],
  "status": "PUBLISHED",
  "submittedAt": { "$date": "2026-11-13T10:00:00Z" },
  "publishedAt": { "$date": "2026-11-13T12:00:00Z" },
  "reviewedAt": { "$date": "2026-11-13T12:00:00Z" },
  "reviewedBy": { "$oid": "66e04d3e89a4b2c1d8e1f999" },
  "rejectionReason": null,
  "archivedAt": null,
  "supportsHourly": false,
  "supportsDaily": true,
  "createdAt": { "$date": "2026-11-13T09:30:00Z" },
  "updatedAt": { "$date": "2026-11-13T12:00:00Z" }
}
```

---

### 28. `propertyDocuments`
- **Purpose**: Property ownership deeds, local Panchayat licenses, and police verification files.
- **Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `docType`: `String` (Enum: `OWNERSHIP_DEED`, `PANCHAYAT_LICENSE`, `HOST_POLICE_VERIFICATION`)
  - `fileUrl`: `String` (Private S3 URL)
  - `expiryDate`: `Date` (Optional)
  - `isApproved`: `Boolean` (Default `false`)
  - `createdAt`: `Date`
- **References**: Ref: `properties._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f028" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "docType": "PANCHAYAT_LICENSE",
  "fileUrl": "s3://kerala-tourism-vault/properties/panchayat-lic-81.pdf",
  "isApproved": true
}
```

---

### 29. `rooms`
- **Purpose**: Specific room unit or room category under a property.
- **Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `roomName`: `String` (Required, e.g. `Deluxe Teak Suite #1`)
  - `roomType`: `String` (Enum: `DELUXE_SUITE`, `HERITAGE_VILLA`, `ECO_COTTAGE`, `TRANSIT_POD`)
  - `capacityAdults`: `Int32` (Required)
  - `capacityChildren`: `Int32` (Default `0`)
  - `bedConfiguration`: `String` (e.g. `1 King Bed + 1 Daybed`)
  - `turnoverBufferMinutes`: `Int32` (Housekeeping buffer, default `60`)
  - `isActive`: `Boolean` (Default `true`)
  - `createdAt`: `Date`
- **References**: Ref: `properties._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f029" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "roomName": "Waterfront Deluxe Teak Room 101",
  "roomType": "DELUXE_SUITE",
  "capacityAdults": 2,
  "capacityChildren": 1,
  "bedConfiguration": "1 King Bed with Lake View Balcony",
  "turnoverBufferMinutes": 60,
  "isActive": true
}
```

---

### 30. `roomTypes`
- **Purpose**: Canonical room type definition for accommodation properties (hotels, resorts, homestays, villas, etc.), holding capacity, facilities, pricing in integer paise, and configured units.
- **Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `accountId`: `ObjectId` (Required, Ref: `accounts`)
  - `name`: `String` (Required, 2-100 chars)
  - `slug`: `String` (Required, unique per property)
  - `description`: `String` (Optional, max 2000 chars)
  - `roomCategory`: `String` (Enum: `STANDARD`, `DELUXE`, `PREMIUM`, `SUITE`, `VILLA`, `STUDIO`, `DORMITORY`, `COTTAGE`, `OTHER`)
  - `maxAdults`: `Int32` (Required, 1-20)
  - `maxChildren`: `Int32` (Required, 0-20)
  - `maxOccupancy`: `Int32` (Required, $\ge maxAdults$)
  - `bedConfiguration`: `String` (Required, e.g. "1 King Bed")
  - `bedCount`: `Int32` (Required, 1-20)
  - `roomSize`: `Double` (Optional)
  - `roomSizeUnit`: `String` (Enum: `SQ_FT`, `SQ_M`)
  - `facilities`: `Array<String>` (Enum values from `ROOM_FACILITIES`)
  - `basePrice`: `Int64` (Required, stored in integer paise: 1 INR = 100 paise)
  - `currency`: `String` (Default `'INR'`)
  - `pricingUnit`: `String` (Enum: `PER_NIGHT`, `PER_DAY`)
  - `coverMediaId`: `ObjectId` (Optional, Ref: `media`)
  - `galleryMediaIds`: `Array<ObjectId>` (Ref: `media`)
  - `status`: `String` (Enum: `ACTIVE`, `INACTIVE`, `ARCHIVED`)
  - `totalUnits`: `Int32` (Configured physical units, $\ge 1$)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ propertyId: 1, status: 1 }`
  - `{ businessProfileId: 1, status: 1 }`
  - `{ propertyId: 1, slug: 1 }` (Unique, sparse)
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f030" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f028" },
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f005" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f002" },
  "name": "Deluxe Sea View Suite",
  "slug": "deluxe-sea-view-suite",
  "description": "Luxurious beachfront suite with direct sea view.",
  "roomCategory": "SUITE",
  "maxAdults": 2,
  "maxChildren": 2,
  "maxOccupancy": 3,
  "bedConfiguration": "1 King Bed",
  "bedCount": 1,
  "roomSize": 450.0,
  "roomSizeUnit": "SQ_FT",
  "facilities": ["WIFI", "AIR_CONDITIONING", "SEA_VIEW", "BALCONY"],
  "basePrice": 650000,
  "currency": "INR",
  "pricingUnit": "PER_NIGHT",
  "status": "ACTIVE",
  "totalUnits": 10,
  "createdAt": { "$date": "2026-11-16T10:00:00Z" },
  "updatedAt": { "$date": "2026-11-16T10:00:00Z" }
}
```

---

### 31. `roomInventory`
- **Purpose**: Daily calendar inventory ledger tracking sellable capacity, host holds, and maintenance blocks for each room type.
- **Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `roomTypeId`: `ObjectId` (Required, Ref: `roomTypes`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `date`: `Date` (Normalized UTC midnight representing calendar date in `Asia/Kolkata`)
  - `totalUnits`: `Int32` (Configured capacity, $\ge 0$)
  - `availableUnits`: `Int32` (Sellable units: $totalUnits - blockedUnits - maintenanceUnits$)
  - `blockedUnits`: `Int32` (Host/VIP holds, $\ge 0$)
  - `maintenanceUnits`: `Int32` (Out of service units, $\ge 0$)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ roomTypeId: 1, date: 1 }` (Unique compound index)
  - `{ propertyId: 1, date: 1 }`
  - `{ businessProfileId: 1, date: 1 }`
  - `{ roomTypeId: 1, date: 1, availableUnits: 1 }` (Covered lookup)
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f031" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f028" },
  "roomTypeId": { "$oid": "66e04d3e89a4b2c1d8e1f030" },
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f005" },
  "date": { "$date": "2026-12-01T00:00:00Z" },
  "totalUnits": 10,
  "availableUnits": 8,
  "blockedUnits": 1,
  "maintenanceUnits": 1,
  "createdAt": { "$date": "2026-11-16T10:00:00Z" },
  "updatedAt": { "$date": "2026-11-16T10:00:00Z" }
}
```

---

### 32. `propertyFacilities`
- **Purpose**: Amenity catalog linked to properties (Ayurveda, Private Jetty, WiFi).
- **Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `facilityCode`: `String` (Enum: `FREE_WIFI`, `AC`, `KERALA_BREAKFAST`, `AYURVEDIC_SPA`, `HOUSEBOAT_JETTY`)
  - `isComplimentary`: `Boolean` (Default `true`)
  - `description`: `String` (Optional notes)
- **References**: Ref: `properties._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f032" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "facilityCode": "HOUSEBOAT_JETTY",
  "isComplimentary": true,
  "description": "Private wooden jetty for direct canoe & houseboat boarding"
}
```

---

### 33. `propertyMenus`
- **Purpose**: Traditional authentic Kerala dining menu available on property.
- **Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `dishName`: `String` (Required, e.g. `Appam with Vegetable Stew`, `Karimeen Pollichathu`)
  - `isVegetarian`: `Boolean` (Required)
  - `price`: `Double` (Required)
  - `isAvailable`: `Boolean` (Default `true`)
- **References**: Ref: `properties._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f033" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "dishName": "Karimeen Pollichathu (Pearl Spot Wrapped in Banana Leaf)",
  "isVegetarian": false,
  "price": 450.0,
  "isAvailable": true
}
```

---

## Domain 7: Bookings, Concurrency & Financial Settlement

### 34. `bookings`
- **Purpose**: Master reservation contract across accommodation booking transactions.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingReference`: `String` (Required, unique, e.g. `KL-7F2A-4819`)
  - `touristAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `roomTypeId`: `ObjectId` (Required, Ref: `roomTypes`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `checkInDate`: `String` (Required, ISO date `YYYY-MM-DD`)
  - `checkOutDate`: `String` (Required, ISO date `YYYY-MM-DD`)
  - `numberOfRooms`: `Int32` (Required, 1-10)
  - `adults`: `Int32` (Required, 1-30)
  - `children`: `Int32` (Required, 0-30, default 0)
  - `nights`: `Int32` (Required, 1-30)
  - `status`: `String` (Enum: `AWAITING_PAYMENT`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `EXPIRED`, `REJECTED`)
  - `holdId`: `ObjectId` (Optional Ref: `inventoryHolds`)
  - `priceSnapshot`: `Object` (Required, immutable integer paise breakdown)
    - `basePricePaise`: `Int64`, `basePriceInr`: `Double`
    - `numberOfRooms`: `Int32`, `numberOfNights`: `Int32`
    - `dailyBreakdown`: `Array<{ date: String, pricePaise: Int64, priceInr: Double }>`
    - `subtotalPaise`: `Int64`, `subtotalInr`: `Double`
    - `taxesPaise`: `Int64`, `taxesInr`: `Double`
    - `totalPaise`: `Int64`, `totalInr`: `Double`, `currency`: `String`
  - `guestDetails`: `Object` (Required, primary guest name, email, phone, special requests)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`, Ref: `properties._id`, Ref: `roomTypes._id`, Ref: `businessProfiles._id`, Ref: `inventoryHolds._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "bookingReference": "KL-7F2A-4819",
  "touristAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "propertyId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "roomTypeId": { "$oid": "66e04d3e89a4b2c1d8e1f029" },
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f010" },
  "checkInDate": "2026-12-01",
  "checkOutDate": "2026-12-04",
  "numberOfRooms": 2,
  "adults": 4,
  "children": 0,
  "nights": 3,
  "status": "AWAITING_PAYMENT",
  "holdId": { "$oid": "66e04d3e89a4b2c1d8e1f035" },
  "priceSnapshot": {
    "basePricePaise": 500000,
    "basePriceInr": 5000,
    "numberOfRooms": 2,
    "numberOfNights": 3,
    "dailyBreakdown": [
      { "date": "2026-12-01", "pricePaise": 500000, "priceInr": 5000 },
      { "date": "2026-12-02", "pricePaise": 500000, "priceInr": 5000 },
      { "date": "2026-12-03", "pricePaise": 500000, "priceInr": 5000 }
    ],
    "subtotalPaise": 3000000,
    "subtotalInr": 30000,
    "taxesPaise": 0,
    "taxesInr": 0,
    "totalPaise": 3000000,
    "totalInr": 30000,
    "currency": "INR"
  },
  "guestDetails": {
    "primaryGuestName": "Anoop Nair",
    "email": "anoop.nair@example.com",
    "phone": "+919876543210",
    "specialRequests": "Quiet floor"
  },
  "createdAt": { "$date": "2026-11-16T15:00:00Z" },
  "updatedAt": { "$date": "2026-11-16T15:00:00Z" }
}
```

---

### 35. `inventoryHolds`
- **Purpose**: High-concurrency temporary reservation hold (15-minute validity window) protecting rooms during checkout.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingId`: `ObjectId` (Required, unique, Ref: `bookings`)
  - `roomTypeId`: `ObjectId` (Required, Ref: `roomTypes`)
  - `propertyId`: `ObjectId` (Required, Ref: `properties`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `touristAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `numberOfRooms`: `Int32` (Required, min 1)
  - `stayDates`: `Array<String>` (Required, ['YYYY-MM-DD', ...])
  - `status`: `String` (Enum: `ACTIVE`, `CONSUMED`, `RELEASED`, `EXPIRED`)
  - `expiresAt`: `Date` (Required, 15 minutes from creation)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Constraint**: Unique index on `bookingId`, compound index on `{ status: 1, expiresAt: 1 }`, 7-day TTL on `expiresAt` for disk pruning.

---

### 36. `idempotencyKeys`
- **Purpose**: Client request deduplication ensuring safe retries for hold creation and bookings.
- **Fields**:
  - `_id`: `ObjectId`
  - `touristAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `key`: `String` (Required, client `Idempotency-Key` header)
  - `requestHash`: `String` (Required, SHA-256 hash of payload)
  - `responseStatus`: `Int32` (Required, HTTP status code)
  - `responseBody`: `Mixed` (Required, cached response payload)
  - `bookingId`: `ObjectId` (Optional Ref: `bookings`)
  - `holdId`: `ObjectId` (Optional Ref: `inventoryHolds`)
  - `expiresAt`: `Date` (Required, 24 hours from creation)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Constraint**: Unique compound index `{ touristAccountId: 1, key: 1 }`, TTL on `expiresAt` (`expireAfterSeconds: 0`).
- **References**: Ref: `rooms._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f035" },
  "roomId": { "$oid": "66e04d3e89a4b2c1d8e1f029" },
  "touristId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "holdStartTime": { "$date": "2026-11-10T08:30:00Z" },
  "holdEndTime": { "$date": "2026-11-10T12:30:00Z" },
  "idempotencyKey": "idem_hold_9f81a7b8e01",
  "expiresAt": { "$date": "2026-11-10T08:15:00Z" },
  "createdAt": { "$date": "2026-11-10T08:00:00Z" }
}
```

---

### 36. `bookingGuests`
- **Purpose**: Guest manifest and mandatory pre-arrival government ID proofs for state tourism police compliance.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`)
  - `fullName`: `String` (Required)
  - `age`: `Int32` (Required)
  - `gender`: `String` (Enum: `M`, `F`, `OTHER`)
  - `idProofType`: `String` (Enum: `AADHAAR`, `PASSPORT`, `VOTER_ID`)
  - `idProofMaskedNumber`: `String` (e.g. `XXXX-XXXX-1234`)
  - `idProofDocumentUrl`: `String` (Encrypted private cloud storage reference)
  - `isPrimaryGuest`: `Boolean` (Default `false`)
- **References**: Ref: `bookings._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f036" },
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "fullName": "Arjun Nair",
  "age": 32,
  "gender": "M",
  "idProofType": "AADHAAR",
  "idProofMaskedNumber": "XXXX-XXXX-9842",
  "idProofDocumentUrl": "s3://kerala-tourism-kyc/passports/arjun-masked.pdf",
  "isPrimaryGuest": true
}
```

---

### 37. `bookingEvents`
- **Purpose**: Append-only event-sourcing log auditing every status transition on a booking.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`)
  - `eventType`: `String` (Enum: `CREATED`, `HOLD_ACQUIRED`, `HOST_APPROVED`, `PAID`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`)
  - `triggeredByAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `priorStatus`: `String`
  - `newStatus`: `String`
  - `notes`: `String` (Optional explanation)
  - `timestamp`: `Date` (Required)
- **References**: Ref: `bookings._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f037" },
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "eventType": "CHECKED_IN",
  "triggeredByAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f099" },
  "priorStatus": "CONFIRMED",
  "newStatus": "CHECKED_IN",
  "notes": "Reception scanned 2D QR Code voucher",
  "timestamp": { "$date": "2026-11-10T08:32:00Z" }
}
```

---

### 38. `cancellationRequests`
- **Purpose**: Cancellation appeals, refund policy calculations, and penalty tracking.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`, unique)
  - `requestedByAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `cancellationReason`: `String` (Required)
  - `hoursBeforeCheckIn`: `Double` (Hours remaining at cancellation time)
  - `refundPercentageApplied`: `Double` (e.g. `100.0` or `50.0`)
  - `calculatedRefundAmount`: `Double`
  - `status`: `String` (Enum: `PENDING_REVIEW`, `REFUNDED`, `REJECTED`)
  - `processedAt`: `Date`
- **References**: Ref: `bookings._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f038" },
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "requestedByAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "cancellationReason": "Flight delayed at Cochin Airport",
  "hoursBeforeCheckIn": 4.5,
  "refundPercentageApplied": 100.0,
  "calculatedRefundAmount": 847.5,
  "status": "REFUNDED",
  "processedAt": { "$date": "2026-11-10T04:00:00Z" }
}
```

---

### 39. `payments`
- **Purpose**: Internal payment transaction records and gateway order/payment tracking.
- **Fields**:
  - `_id`: `ObjectId`
  - `paymentReference`: `String` (Required, Unique, e.g. `'PAY-20261117-9A1B2C'`)
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`)
  - `holdId`: `ObjectId` (Required, Ref: `inventoryHolds`)
  - `touristAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `provider`: `String` (Enum: `'RAZORPAY'`, Required)
  - `providerOrderId`: `String` (e.g. `'order_O8x9y7z6a5b4c3'`)
  - `providerPaymentId`: `String` (e.g. `'pay_P1q2w3e4r5t6y7'`)
  - `amountPaise`: `Number` (Required, Integer paise: 1 INR = 100 paise)
  - `currency`: `String` (Default `'INR'`)
  - `status`: `String` (Enum: `'CREATED'`, `'PENDING'`, `'AUTHORIZED'`, `'CAPTURED'`, `'FAILED'`, `'CANCELLED'`, `'REFUND_PENDING'`, `'REFUNDED'`)
  - `failureCode`: `String`
  - `failureDescription`: `String`
  - `reconciliationStatus`: `String` (`'FLAGGED_FOR_MANUAL_REVIEW'`)
  - `paidAt`: `Date`
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ paymentReference: 1 }` (unique)
  - `{ bookingId: 1, createdAt: -1 }`
  - `{ touristAccountId: 1, createdAt: -1 }`
  - `{ provider: 1, providerOrderId: 1 }`
  - `{ provider: 1, providerPaymentId: 1 }`
  - `{ status: 1 }`
- **Example Document**:
```json
{
  "_id": { "$oid": "673752e5058a98f1d2c10001" },
  "paymentReference": "PAY-20261117-9A1B2C",
  "bookingId": { "$oid": "673752e5058a98f1d2c10002" },
  "holdId": { "$oid": "673752e5058a98f1d2c10003" },
  "touristAccountId": { "$oid": "673752e5058a98f1d2c10004" },
  "businessProfileId": { "$oid": "673752e5058a98f1d2c10005" },
  "provider": "RAZORPAY",
  "providerOrderId": "order_O8x9y7z6a5b4c3",
  "providerPaymentId": "pay_P1q2w3e4r5t6y7",
  "amountPaise": 1500000,
  "currency": "INR",
  "status": "CAPTURED",
  "paidAt": { "$date": "2026-11-17T09:05:00.000Z" },
  "createdAt": { "$date": "2026-11-17T09:00:00.000Z" }
}
```

---

### 40. `paymentWebhookEvents`
- **Purpose**: Ingested gateway webhook notifications for cryptographic audit trail and idempotent deduplication.
- **Fields**:
  - `_id`: `ObjectId`
  - `provider`: `String` (Enum: `'RAZORPAY'`, Required)
  - `providerEventId`: `String` (Required, Provider event ID, e.g. `'evt_O9x8y7z6a5b4c3'`)
  - `eventType`: `String` (Required, e.g. `'payment.captured'`)
  - `paymentId`: `ObjectId` (Ref: `payments`)
  - `providerPaymentId`: `String`
  - `providerOrderId`: `String`
  - `payloadHash`: `String` (Required, SHA-256 hash of raw incoming request body)
  - `processingStatus`: `String` (Enum: `'RECEIVED'`, `'PROCESSED'`, `'IGNORED'`, `'FAILED'`)
  - `receivedAt`: `Date` (Default `Date.now`)
  - `processedAt`: `Date`
  - `failureCode`: `String`
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ provider: 1, providerEventId: 1 }` (unique)
  - `{ processingStatus: 1, receivedAt: 1 }`
  - `{ providerPaymentId: 1 }`
  - `{ createdAt: 1 }` with `expireAfterSeconds: 2592000` (30 days TTL)

---

### 41. `refunds`
- **Purpose**: Financial reversal records processed back to the traveler's source payment account.
- **Fields**:
  - `_id`: `ObjectId`
  - `paymentId`: `ObjectId` (Required, Ref: `payments`)
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`)
  - `gatewayRefundId`: `String` (Required, unique gateway refund reference)
  - `amount`: `Double` (Required)
  - `reason`: `String` (Required)
  - `status`: `String` (Enum: `INITIATED`, `PROCESSED`, `FAILED`)
  - `completedAt`: `Date`
- **References**: Ref: `payments._id`, Ref: `bookings._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f040" },
  "paymentId": { "$oid": "66e04d3e89a4b2c1d8e1f039" },
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "gatewayRefundId": "rfnd_K9j8h7g6f5e4",
  "amount": 847.5,
  "reason": "Host declined booking within 15-minute SLA",
  "status": "PROCESSED",
  "completedAt": { "$date": "2026-11-10T08:15:00Z" }
}
```

---

### 41. `commissions`
- **Purpose**: Kerala Tourism platform maintenance fees and directorate levies.
- **Fields**:
  - `_id`: `ObjectId`
  - `bookingId`: `ObjectId` (Required, Ref: `bookings`, unique)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `grossBookingAmount`: `Double` (Required)
  - `commissionRatePercent`: `Double` (e.g. `8.0` for hourly stays, `10.0` for tour packages)
  - `commissionAmount`: `Double`
  - `netMerchantAmount`: `Double`
  - `isSettled`: `Boolean` (Default `false`)
- **References**: Ref: `bookings._id`, Ref: `businessProfiles._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f041" },
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f003" },
  "grossBookingAmount": 750.0,
  "commissionRatePercent": 8.0,
  "commissionAmount": 60.0,
  "netMerchantAmount": 690.0,
  "isSettled": true
}
```

---

### 42. `providerPayouts`
- **Purpose**: Batch bank payouts released to verified merchants following escrow clearance.
- **Fields**:
  - `_id`: `ObjectId`
  - `payoutReference`: `String` (Required, unique, e.g. `PAYOUT-202611-0081`)
  - `businessProfileId`: `ObjectId` (Required, Ref: `businessProfiles`)
  - `totalSettledAmount`: `Double` (Required)
  - `bankUtrNumber`: `String` (Bank transaction reference number)
  - `includedBookingIds`: `Array<ObjectId>` (Ref: `bookings`)
  - `payoutStatus`: `String` (Enum: `SCHEDULED`, `PROCESSING`, `COMPLETED`, `FAILED`)
  - `payoutDate`: `Date`
- **References**: Ref: `businessProfiles._id`, Ref: `bookings._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f042" },
  "payoutReference": "PAYOUT-202611-0081",
  "businessProfileId": { "$oid": "66e04d3e89a4b2c1d8e1f003" },
  "totalSettledAmount": 14250.0,
  "bankUtrNumber": "SBIN00829182910",
  "includedBookingIds": [{ "$oid": "66e04d3e89a4b2c1d8e1f034" }],
  "payoutStatus": "COMPLETED",
  "payoutDate": { "$date": "2026-11-10T11:00:00Z" }
}
```

---

### 43. `financialLedger`
- **Purpose**: Immutable double-entry audit ledger for statutory state tax compliance.
- **Fields**:
  - `_id`: `ObjectId`
  - `entryNumber`: `String` (Required, unique auto-incrementing ledger ID)
  - `bookingId`: `ObjectId` (Ref: `bookings`)
  - `entryType`: `String` (Enum: `ESCROW_CREDIT`, `COMMISSION_FEE`, `MERCHANT_PAYOUT`, `GST_COLLECTED`, `REFUND_DEBIT`)
  - `debit`: `Double` (Default `0.0`)
  - `credit`: `Double` (Default `0.0`)
  - `currency`: `String` (Default `'INR'`)
  - `checksum`: `String` (Cryptographic verification hash)
  - `createdAt`: `Date`
- **References**: Ref: `bookings._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f043" },
  "entryNumber": "LEDGER-2026-092819",
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "entryType": "COMMISSION_FEE",
  "debit": 0.0,
  "credit": 60.0,
  "currency": "INR",
  "checksum": "sha256_e819b7a0c1f2e...",
  "createdAt": { "$date": "2026-11-10T08:02:00Z" }
}
```

---

## Domain 8: Governance, Moderation & Support

### 44. `reviews`
- **Purpose**: Verified reviews and star ratings for homestays, resorts, packages, and destinations.
- **Fields**:
  - `_id`: `ObjectId`
  - `authorId`: `ObjectId` (Required, Ref: `accounts`)
  - `targetId`: `ObjectId` (Required generic entity ref)
  - `targetType`: `String` (Enum: `PROPERTY`, `TRAVEL_PACKAGE`, `DESTINATION`)
  - `bookingId`: `ObjectId` (Optional Ref: `bookings` proving verified stay)
  - `rating`: `Int32` (Required, 1 to 5 stars)
  - `reviewText`: `String` (Required, 10 to 1000 chars)
  - `photos`: `Array<String>` (Optional guest photos)
  - `isVerifiedStay`: `Boolean` (True if booked through platform)
  - `createdAt`: `Date`
- **References**: Ref: `accounts._id`, Ref: `bookings._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f044" },
  "authorId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "targetId": { "$oid": "66e04d3e89a4b2c1d8e1f027" },
  "targetType": "PROPERTY",
  "bookingId": { "$oid": "66e04d3e89a4b2c1d8e1f034" },
  "rating": 5,
  "reviewText": "Exceptional sunrise view over the backwaters. The transit room was spotless.",
  "isVerifiedStay": true,
  "createdAt": { "$date": "2026-11-10T12:00:00Z" }
}
```

---

### 45. `reports`
- **Purpose**: Community flags submitted by tourists for inappropriate destinations, posts, comments, or accounts, reviewed separately from content moderation lifecycle.
- **Fields**:
  - `_id`: `ObjectId`
  - `reporterId`: `ObjectId` (Required, Ref: `accounts`, immutable)
  - `targetType`: `String` (Enum: `DESTINATION`, `POST`, `COMMENT`, `ACCOUNT`, immutable)
  - `targetId`: `ObjectId` (Required target document ID, immutable)
  - `reason`: `String` (Enum: `SPAM`, `HARASSMENT`, `MISLEADING_INFORMATION`, `INAPPROPRIATE_CONTENT`, `FAKE_DESTINATION`, `FRAUD`, `OTHER`)
  - `description`: `String | null` (Optional details up to 1000 chars; required >= 5 chars when `reason === 'OTHER'`)
  - `status`: `String` (Enum: `PENDING`, `UNDER_REVIEW`, `RESOLVED`, `DISMISSED`, default: `PENDING`)
  - `reviewedBy`: `ObjectId | null` (Optional Ref: `accounts`)
  - `reviewedAt`: `Date | null` (Timestamp when moderator reviewed)
  - `moderatorNotes`: `String | null` (Optional up to 1000 chars; required >= 3 chars when `RESOLVED` or `DISMISSED`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f045" },
  "reporterId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "targetType": "POST",
  "targetId": { "$oid": "66e04d3e89a4b2c1d8e1f011" },
  "reason": "MISLEADING_INFORMATION",
  "description": "Post claims waterfall entry road is open despite monsoon closure.",
  "status": "PENDING",
  "reviewedBy": null,
  "reviewedAt": null,
  "moderatorNotes": null,
  "createdAt": { "$date": "2026-11-12T09:00:00Z" },
  "updatedAt": { "$date": "2026-11-12T09:00:00Z" }
}
```

---

### 46. `blocks`
- **Purpose**: User-to-user blocking for messaging and social feed seclusion.
- **Fields**:
  - `_id`: `ObjectId`
  - `blockerAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `blockedAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `createdAt`: `Date`
- **Constraint**: Unique compound index `{ blockerAccountId: 1, blockedAccountId: 1 }`.
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f046" },
  "blockerAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "blockedAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f099" },
  "createdAt": { "$date": "2026-11-10T09:30:00Z" }
}
```

---

### 47. `notifications`
- **Purpose**: Authoritative in-app notification tray records delivering booking, payment, and social updates.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `recipientAccountId`: `ObjectId` (Required, Ref: `accounts`, indexed)
  - `notificationType`: `String` (Enum: `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `BOOKING_REJECTED`, `PAYMENT_CAPTURED`, `PAYMENT_FAILED`, `PAYMENT_RECONCILIATION_REQUIRED`, `SOCIAL_NEW_FOLLOWER`, `SOCIAL_COMMENT`, `SOCIAL_LIKE`)
  - `title`: `String` (Required, max 150 chars, trimmed)
  - `body`: `String` (Required, max 500 chars, trimmed)
  - `dataPayload`: `Map<String, String>` (Safe routing parameters, e.g. `{ route: "booking_details", bookingId: "bk_123" }`)
  - `relatedResourceType`: `String` (Enum: `BOOKING`, `PAYMENT`, `POST`, `ACCOUNT`)
  - `relatedResourceId`: `String` (ID of associated resource)
  - `isRead`: `Boolean` (Default: `false`, indexed)
  - `readAt`: `Date` (Timestamp when notification was marked as read, nullable)
  - `deliveryStatus`: `String` (Enum: `PENDING`, `DELIVERED`, `FAILED`, default: `PENDING`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ recipientAccountId: 1, createdAt: -1, _id: -1 }` (Recipient reverse-chronological list)
  - `{ recipientAccountId: 1, isRead: 1, createdAt: -1 }` (Unread badge counts & filtering)
  - `{ relatedResourceType: 1, relatedResourceId: 1 }` (Sparse resource reverse lookup)
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f047" },
  "recipientAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "notificationType": "BOOKING_CONFIRMED",
  "title": "Booking Confirmed!",
  "body": "Your stay at Wayanad Tea Estate Villa has been confirmed.",
  "dataPayload": {
    "route": "booking_details",
    "bookingId": "bk_66e04d3e89a4b2c1d8e1f077"
  },
  "relatedResourceType": "BOOKING",
  "relatedResourceId": "bk_66e04d3e89a4b2c1d8e1f077",
  "isRead": false,
  "readAt": null,
  "deliveryStatus": "DELIVERED",
  "createdAt": { "$date": "2026-11-17T09:00:00Z" },
  "updatedAt": { "$date": "2026-11-17T09:00:00Z" }
}
```

---

### 48. `notificationOutbox`
- **Purpose**: Durable transaction-decoupled outbox queue ensuring at-least-once push notification delivery with idempotency deduplication and bounded exponential backoff retries.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `notificationId`: `ObjectId` (Required, Ref: `notifications`)
  - `recipientAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `idempotencyKey`: `String` (Required, unique business deduplication key, e.g. `evt_booking_confirmed_bk_123`)
  - `eventType`: `String` (Enum: `NOTIFICATION_TYPES`)
  - `payload`: `Object` (`{ title: String, body: String, data?: Record<String, String> }`)
  - `status`: `String` (Enum: `PENDING`, `PROCESSING`, `DELIVERED`, `FAILED`, `DEAD_LETTER`, default: `PENDING`, indexed)
  - `attempts`: `Number` (Delivery attempt counter, default: `0`)
  - `maxAttempts`: `Number` (Maximum retry attempts before dead-letter, default: `5`)
  - `nextRetryAt`: `Date` (Timestamp scheduled for next delivery attempt, default: `Date.now`, indexed)
  - `lastError`: `String` (Error message from provider upon failure, optional)
  - `processedAt`: `Date` (Timestamp when delivery completed or transitioned to dead-letter, optional)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ idempotencyKey: 1 }` (Unique business event deduplication invariant)
  - `{ status: 1, nextRetryAt: 1 }` (Worker polling queue index)
  - `{ createdAt: 1 }` (30-day purge TTL: `expireAfterSeconds: 2592000`)
- **References**: Ref: `notifications._id`, Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f048" },
  "notificationId": { "$oid": "66e04d3e89a4b2c1d8e1f047" },
  "recipientAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "idempotencyKey": "evt_booking_confirmed_bk_66e04d3e89a4b2c1d8e1f077",
  "eventType": "BOOKING_CONFIRMED",
  "payload": {
    "title": "Booking Confirmed!",
    "body": "Your stay at Wayanad Tea Estate Villa has been confirmed.",
    "data": { "route": "booking_details", "bookingId": "bk_66e04d3e89a4b2c1d8e1f077" }
  },
  "status": "DELIVERED",
  "attempts": 1,
  "maxAttempts": 5,
  "nextRetryAt": { "$date": "2026-11-17T09:00:00Z" },
  "processedAt": { "$date": "2026-11-17T09:00:02Z" },
  "createdAt": { "$date": "2026-11-17T09:00:00Z" }
}
```

---

### 49. `notificationPreferences`
- **Purpose**: Per-tourist category notification controls and opt-out preferences.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `accountId`: `ObjectId` (Required, unique, Ref: `accounts`, indexed)
  - `bookingUpdates`: `Boolean` (Default: `true`)
  - `paymentUpdates`: `Boolean` (Default: `true`)
  - `socialUpdates`: `Boolean` (Default: `true`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **Indexes**:
  - `{ accountId: 1 }` (Unique account preference lookup)
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f049" },
  "accountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "bookingUpdates": true,
  "paymentUpdates": true,
  "socialUpdates": false,
  "createdAt": { "$date": "2026-11-17T09:00:00Z" },
  "updatedAt": { "$date": "2026-11-17T09:00:00Z" }
}
```

---

### 48. `media`
- **Purpose**: Centralized registry of uploaded photography, video assets, and metadata for destinations and platform entities.
- **Fields**:
  - `_id`: `ObjectId` (Primary Key)
  - `uploaderAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `destinationId`: `ObjectId` (Optional, Ref: `destinations`, indexed)
  - `storageKey`: `String` (Required, unique cloud object key)
  - `url`: `String` (Required, direct CDN or accessible storage URL)
  - `mimeType`: `String` (Enum: `image/jpeg`, `image/png`, `image/webp`, `image/avif`)
  - `fileSizeBytes`: `Int64` (File size in bytes, max 5,242,880 / 5MB)
  - `dimensions`: `Object` (Embedded: `{ width: 1920, height: 1080 }`)
  - `isPrimary`: `Boolean` (Default `false`, designates primary destination cover image)
  - `displayOrder`: `Int32` (Default `0`, gallery sort order)
  - `isModerated`: `Boolean` (Default `true`)
  - `createdAt`: `Date` (Auto timestamp)
  - `updatedAt`: `Date` (Auto timestamp)
- **Indexes**:
  - `{ storageKey: 1 }` (Unique)
  - `{ destinationId: 1, displayOrder: 1 }` (Gallery ordering compound index)
  - `{ uploaderAccountId: 1, createdAt: -1 }` (Uploader audit history)
- **References**: Ref: `accounts._id`, Ref: `destinations._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f048" },
  "uploaderAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "destinationId": { "$oid": "66e04d3e89a4b2c1d8e1f009" },
  "storageKey": "destinations/munroe-aerial-1.webp",
  "url": "https://cdn.keralatourism.org/media/destinations/munroe-aerial-1.webp",
  "mimeType": "image/webp",
  "fileSizeBytes": 482100,
  "dimensions": { "width": 1920, "height": 1080 },
  "isPrimary": true,
  "displayOrder": 1,
  "isModerated": true,
  "createdAt": { "$date": "2026-11-10T04:00:00Z" },
  "updatedAt": { "$date": "2026-11-10T04:00:00Z" }
}
```

---

### 49. `auditLogs`
- **Purpose**: Append-only, immutable administrative governance and moderation ledger recording user status overrides and content moderation decisions.
- **Fields**:
  - `_id`: `ObjectId`
  - `actorAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `actorAccountType`: `String` (`ADMIN`)
  - `actorAdminLevel`: `String` (`SUPER_ADMIN`, `DISTRICT_OFFICER`, `MODERATOR`)
  - `action`: `String` (`USER_SUSPENDED`, `USER_REACTIVATED`, `DESTINATION_SUBMISSION_APPROVED`, `DESTINATION_SUBMISSION_REJECTED`, `POST_APPROVED`, `POST_REJECTED`, `POST_REMOVED`, `COMMENT_REMOVED`, `COMMENT_RESTORED`, `REPORT_UNDER_REVIEW`, `REPORT_RESOLVED`, `REPORT_DISMISSED`)
  - `targetEntityId`: `ObjectId`
  - `targetEntityType`: `String` (`ACCOUNT`, `DESTINATION`, `DESTINATION_SUBMISSION`, `POST`, `COMMENT`, `REPORT`)
  - `reason`: `String` (Sanitized justification, max 500 chars)
  - `beforeState`: `Object` (Redacted snapshot prior to modification)
  - `afterState`: `Object` (Redacted snapshot post modification)
  - `ipAddress`: `String | null`, `userAgent`: `String | null`
  - `timestamp`: `Date` (Required)
- **References**: Ref: `accounts._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f049" },
  "actorAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f088" },
  "actorRole": "DISTRICT_OFFICER",
  "action": "APPROVE_DESTINATION_SUBMISSION",
  "targetEntityId": { "$oid": "66e04d3e89a4b2c1d8e1f009" },
  "targetEntityType": "destinationSubmissions",
  "ipAddress": "103.24.18.91",
  "beforeState": { "submissionStatus": "IN_REVIEW" },
  "afterState": { "submissionStatus": "ACCEPTED" },
  "timestamp": { "$date": "2026-11-10T05:30:00Z" }
}
```

---

### 50. `supportTickets`
- **Purpose**: Tourist grievances and Kerala Tourist Police emergency escalation tickets (Helpline 1364).
- **Fields**:
  - `_id`: `ObjectId`
  - `ticketNumber`: `String` (Required, unique, e.g. `HELP-1364-8921`)
  - `requesterAccountId`: `ObjectId` (Required, Ref: `accounts`)
  - `category`: `String` (Enum: `TOURIST_POLICE_EMERGENCY`, `BOOKING_DISPUTE`, `LOST_PROPERTY`, `GENERAL_INQUIRY`)
  - `priority`: `String` (Enum: `CRITICAL_URGENT`, `HIGH`, `MEDIUM`, `LOW`)
  - `subject`: `String` (Required)
  - `description`: `String` (Required)
  - `status`: `String` (Enum: `OPEN`, `DISPATCHED_TO_TOURIST_POLICE`, `RESOLVED`, `CLOSED`)
  - `assignedOfficerId`: `ObjectId` (Ref: `adminProfiles`)
  - `createdAt`: `Date`, `updatedAt`: `Date`
- **References**: Ref: `accounts._id`, Ref: `adminProfiles._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f050" },
  "ticketNumber": "HELP-1364-8921",
  "requesterAccountId": { "$oid": "66e04d3e89a4b2c1d8e1f001" },
  "category": "TOURIST_POLICE_EMERGENCY",
  "priority": "CRITICAL_URGENT",
  "subject": "Stranded during heavy monsoon downpour near Athirappilly",
  "description": "Taxi broken down on forest highway. Need nearest tourist assistance dispatch.",
  "status": "DISPATCHED_TO_TOURIST_POLICE",
  "assignedOfficerId": { "$oid": "66e04d3e89a4b2c1d8e1f004" },
  "createdAt": { "$date": "2026-11-10T10:00:00Z" }
}
```

---

### 51. `systemSettings`
- **Purpose**: Global platform configurations, active monsoon advisories, and statutory tax parameters.
- **Fields**:
  - `_id`: `ObjectId`
  - `configKey`: `String` (Required, unique, e.g. `PLATFORM_FEES`, `MONSOON_ALERT_BANNER`)
  - `configValue`: `Object` (Dynamic JSON structure)
  - `lastModifiedByAdminId`: `ObjectId` (Ref: `adminProfiles`)
  - `updatedAt`: `Date`
- **References**: Ref: `adminProfiles._id`.
- **Example Document**:
```json
{
  "_id": { "$oid": "66e04d3e89a4b2c1d8e1f051" },
  "configKey": "PLATFORM_FEES",
  "configValue": {
    "hourlyStayCommissionPercent": 8.0,
    "dailyStayCommissionPercent": 8.0,
    "tourPackageCommissionPercent": 10.0,
    "luxuryGstRatePercent": 12.0,
    "ecoConservationCessPercent": 1.0,
    "instantBookingGraceMinutes": 120
  },
  "lastModifiedByAdminId": { "$oid": "66e04d3e89a4b2c1d8e1f004" },
  "updatedAt": { "$date": "2026-11-01T00:00:00Z" }
}
```
