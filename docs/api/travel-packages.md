# Travel Packages & Package Management API Specification

## 1. Overview

The Travel Packages module provides an end-to-end lifecycle for multi-day tour packages in Kerala:
1. **Business Agency Management**: Verified travel agencies create, update, submit, and archive packages.
2. **Public Discovery**: Tourists and unauthenticated clients search, filter, and inspect published packages.
3. **Admin Moderation**: Administrators review, approve, or reject submitted packages with mandatory justifications and immutable audit logs.

All mutating endpoints enforce dedicated rate limiting, strict Zod schema validation, and BOLA/IDOR protection.

---

## 2. Authentication & Authorization Matrix

| Endpoint | Method | Required Role | Required Permission | Rate Limiting | Description |
|---|---|---|---|---|---|
| `/api/v1/business/packages` | `POST` | `BUSINESS` | Active & Verified Agency | `packageMutationRateLimiter` (40/15m) | Create draft package |
| `/api/v1/business/packages` | `GET` | `BUSINESS` | Active Business | Default IP Limiter | List agency's packages |
| `/api/v1/business/packages/:packageId` | `GET` | `BUSINESS` | Active Business | Default IP Limiter | Inspect owned package details |
| `/api/v1/business/packages/:packageId` | `PATCH` | `BUSINESS` | Active & Verified Agency | `packageMutationRateLimiter` (40/15m) | Update draft or rejected package |
| `/api/v1/business/packages/:packageId/submit-review` | `POST` | `BUSINESS` | Active & Verified Agency | `packageMutationRateLimiter` (40/15m) | Submit package for review |
| `/api/v1/business/packages/:packageId` | `DELETE` | `BUSINESS` | Active & Verified Agency | `packageMutationRateLimiter` (40/15m) | Archive/soft-delete package |
| `/api/v1/packages` | `GET` | Public | None | Default IP Limiter | Paginated published packages |
| `/api/v1/packages/search` | `GET` | Public | None | Default IP Limiter | Keyword & multi-filter search |
| `/api/v1/packages/:slug` | `GET` | Public | None | Default IP Limiter | Public package details by slug |
| `/api/v1/admin/packages` | `GET` | `ADMIN` | `VIEW_PACKAGES` | Default IP Limiter | Admin package review queue |
| `/api/v1/admin/packages/:packageId` | `GET` | `ADMIN` | `VIEW_PACKAGES` | Default IP Limiter | Admin package detail inspection |
| `/api/v1/admin/packages/:packageId/review` | `PATCH` | `ADMIN` | `MODERATE_PACKAGES` | `packageMutationRateLimiter` (40/15m) | Approve or reject package |

---

## 3. Business Package APIs

### 3.1 Create Travel Package
- **URL**: `POST /api/v1/business/packages`
- **Headers**: `Authorization: Bearer <JWT>`, `Content-Type: application/json`
- **Rules**:
  - Authenticated account must have `accountType: "BUSINESS"`.
  - Account must have an approved `Agency` profile with `verificationStatus: "VERIFIED"`.
  - Initial status is automatically set to `DRAFT`.
  - Client cannot inject `agencyId`, `createdBy`, or `status`.

#### Request Body
```json
{
  "title": "4D/3N Munnar Tea Trail & Mist Escapes",
  "shortDescription": "Discover rolling tea plantations, pristine waterfalls, and misty peaks.",
  "description": "Comprehensive four-day tour package taking travelers through Cheeyappara falls, Eravikulam National Park, tea tasting sessions, and Mattupetty Dam.",
  "packageCategory": "HILL_STATION",
  "tags": ["munnar", "tea-trail", "hills", "trekking"],
  "destinationIds": ["66e04d3e89a4b2c1d8e1f024"],
  "startLocation": "Cochin International Airport (COK)",
  "endLocation": "Cochin International Airport (COK)",
  "durationDays": 4,
  "durationNights": 3,
  "basePrice": 14500,
  "currency": "INR",
  "pricingUnit": "PER_PERSON",
  "inclusions": [
    "3 Nights Deluxe Estate Resort Stay",
    "Daily Breakfast & Traditional Kerala Dinner",
    "All Sightseeing Transfers via AC Sedan",
    "Tea Museum Entry Ticket"
  ],
  "exclusions": [
    "Airfare/Train tickets to Cochin",
    "Personal expenses and tips",
    "Jeep safari fees"
  ],
  "itinerary": [
    {
      "dayNumber": 1,
      "title": "Cochin to Munnar Scenic Drive",
      "description": "Pick up from COK airport, drive through Valara and Cheeyappara waterfalls, check in at Munnar resort.",
      "activities": ["Waterfall Photo Stop", "Spice Plantation Visit"],
      "estimatedDuration": "6 hours"
    },
    {
      "dayNumber": 2,
      "title": "Eravikulam & Tea Heritage",
      "description": "Morning safari at Eravikulam National park to spot the Nilgiri Tahr. Afternoon guided walk in KDHP Tea Museum.",
      "activities": ["Wildlife Spotting", "Tea Tasting"],
      "estimatedDuration": "7 hours"
    },
    {
      "dayNumber": 3,
      "title": "Mattupetty & Kundala Lake",
      "description": "Visit Mattupetty Dam, Echo Point, and Kundala Lake for pedal boat rides.",
      "activities": ["Speed Boating", "Echo Point Trek"],
      "estimatedDuration": "6 hours"
    },
    {
      "dayNumber": 4,
      "title": "Departure Transfer",
      "description": "Morning breakfast at hotel, transfer back to Cochin airport for onward flight.",
      "activities": ["Airport Drop-off"],
      "estimatedDuration": "5 hours"
    }
  ]
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "id": "67347a1bc8f8c92b5a120001",
    "agencyId": "67347a1bc8f8c92b5a120099",
    "createdBy": "67347a1bc8f8c92b5a120088",
    "updatedBy": "67347a1bc8f8c92b5a120088",
    "title": "4D/3N Munnar Tea Trail & Mist Escapes",
    "slug": "4d-3n-munnar-tea-trail-mist-escapes",
    "shortDescription": "Discover rolling tea plantations, pristine waterfalls, and misty peaks.",
    "description": "Comprehensive four-day tour package taking travelers through Cheeyappara falls...",
    "packageCategory": "HILL_STATION",
    "tags": ["munnar", "tea-trail", "hills", "trekking"],
    "destinationIds": ["66e04d3e89a4b2c1d8e1f024"],
    "startLocation": "Cochin International Airport (COK)",
    "endLocation": "Cochin International Airport (COK)",
    "durationDays": 4,
    "durationNights": 3,
    "basePrice": 14500,
    "currency": "INR",
    "pricingUnit": "PER_PERSON",
    "status": "DRAFT",
    "itinerary": [...],
    "inclusions": [...],
    "exclusions": [...],
    "createdAt": "2026-11-13T10:00:00.000Z",
    "updatedAt": "2026-11-13T10:00:00.000Z"
  }
}
```

---

### 3.2 Submit Package for Review
- **URL**: `POST /api/v1/business/packages/:packageId/submit-review`
- **Headers**: `Authorization: Bearer <JWT>`
- **Rules**:
  - Caller must own the package.
  - Package status must be `DRAFT` or `REJECTED`.
  - Package must satisfy completeness checks (description >= 20 chars, itinerary >= 1 day).
  - Transition status to `PENDING_REVIEW` and records `submittedAt`.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "67347a1bc8f8c92b5a120001",
    "status": "PENDING_REVIEW",
    "submittedAt": "2026-11-13T10:15:00.000Z"
  }
}
```

---

## 4. Public Package Discovery APIs

### 4.1 List Public Packages
- **URL**: `GET /api/v1/packages`
- **Query Parameters**:
  - `packageCategory`: enum filter
  - `district`: Kerala district filter
  - `minDays`, `maxDays`: integer duration range
  - `minPrice`, `maxPrice`: numeric price bounds
  - `sort`: `newest`, `price_asc`, `price_desc`, `duration_asc`, `duration_desc` (default: `newest`)
  - `page`: integer (default: 1)
  - `limit`: integer (default: 20, max: 50)
- **Security**: Only returns packages where `status === 'PUBLISHED'`, owning agency is `VERIFIED`, and owning account is `ACTIVE`.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "67347a1bc8f8c92b5a120001",
      "title": "4D/3N Munnar Tea Trail & Mist Escapes",
      "slug": "4d-3n-munnar-tea-trail-mist-escapes",
      "shortDescription": "Discover rolling tea plantations, pristine waterfalls, and misty peaks.",
      "description": "Comprehensive four-day tour package...",
      "packageCategory": "HILL_STATION",
      "tags": ["munnar", "tea-trail"],
      "destinations": [
        {
          "id": "66e04d3e89a4b2c1d8e1f024",
          "name": "Munnar",
          "slug": "munnar",
          "district": "Idukki",
          "coverImage": "https://storage.keralatourism.org/destinations/munnar-cover.jpg"
        }
      ],
      "durationDays": 4,
      "durationNights": 3,
      "basePrice": 14500,
      "currency": "INR",
      "pricingUnit": "PER_PERSON",
      "publishedAt": "2026-11-13T10:30:00.000Z",
      "agency": {
        "id": "67347a1bc8f8c92b5a120099",
        "agencyName": "Kerala Horizons Eco Expeditions",
        "district": "Idukki",
        "contactEmail": "contact@keralahorizons.test",
        "contactPhone": "+919847055555",
        "website": "https://keralahorizons.test"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

## 5. Admin Moderation APIs

### 5.1 Review Travel Package
- **URL**: `PATCH /api/v1/admin/packages/:packageId/review`
- **Headers**: `Authorization: Bearer <AdminJWT>`, `Content-Type: application/json`
- **Required Permission**: `MODERATE_PACKAGES`
- **Rules**:
  - Executed inside a MongoDB ACID transaction.
  - Verifies owning agency is actively `VERIFIED`.
  - When `decision === "APPROVE"`, status transitions to `PUBLISHED` and sets `publishedAt = now`.
  - When `decision === "REJECT"`, `rejectionReason` (min 5 chars) is strictly mandatory.
  - Records an immutable append-only record in `auditLogs` collection via `AuditLogService`.

#### Request Body (Approval)
```json
{
  "decision": "APPROVE",
  "internalNotes": "Itinerary and safety protocols meet tourism standards."
}
```

#### Request Body (Rejection)
```json
{
  "decision": "REJECT",
  "rejectionReason": "Day 3 itinerary lacks mandatory safety permits for mountain safari.",
  "internalNotes": "Advise agency to attach forest entry permits."
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "package": {
      "id": "67347a1bc8f8c92b5a120001",
      "status": "PUBLISHED",
      "publishedAt": "2026-11-13T10:30:00.000Z",
      "reviewedBy": "67347a1bc8f8c92b5a120077",
      "reviewedAt": "2026-11-13T10:30:00.000Z"
    },
    "auditLog": {
      "id": "67347a1bc8f8c92b5a120055",
      "action": "PACKAGE_APPROVED",
      "targetEntityId": "67347a1bc8f8c92b5a120001",
      "targetEntityType": "TRAVEL_PACKAGE",
      "timestamp": "2026-11-13T10:30:00.000Z"
    }
  }
}
```
