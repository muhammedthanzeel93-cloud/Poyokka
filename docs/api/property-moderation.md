# Admin Property Moderation API Specification

This document details the administrative queue, inspection, and review endpoints for accommodation properties.

---

## 1. Authentication & RBAC Requirements

All moderation endpoints require:
- `authenticate` (Valid Bearer JWT access token)
- `requireActiveAccount` (`account.status === 'ACTIVE'`)
- `requireAccountType('ADMIN')`
- Specific admin permissions:
  - `VIEW_PROPERTIES`: Required for inspection and listing queues
  - `MODERATE_PROPERTIES`: Required for approving or rejecting properties

---

## 2. Admin Property Queue (`GET /api/v1/admin/properties`)

- **Endpoint**: `GET /api/v1/admin/properties`
- **Required Permission**: `VIEW_PROPERTIES`
- **Query Parameters**:
  - `status`: `DRAFT` | `PENDING_REVIEW` | `PUBLISHED` | `REJECTED` | `ARCHIVED`
  - `propertyType`: `HOTEL` | `RESORT` | `HOMESTAY` | `VILLA` | `GUESTHOUSE` | `HOSTEL` | `HOUSEBOAT` | `OTHER`
  - `district`: Kerala district filter
  - `page`: integer $\ge 1$ (default: 1)
  - `limit`: integer $1..50$ (default: 20)
- **Response** (`200 OK`): Paginated array of `PropertyDto` objects sorted by `createdAt: -1`.

---

## 3. Inspect Property Details (`GET /api/v1/admin/properties/:propertyId`)

- **Endpoint**: `GET /api/v1/admin/properties/:propertyId`
- **Required Permission**: `VIEW_PROPERTIES`
- **Response** (`200 OK`): Complete `PropertyDto` with audit timestamps, review notes, and media references.

---

## 4. Moderate Property Review (`PATCH /api/v1/admin/properties/:propertyId/review`)

- **Endpoint**: `PATCH /api/v1/admin/properties/:propertyId/review`
- **Required Permission**: `MODERATE_PROPERTIES`
- **Rate Limit**: 40 req/15 min (`propertyMutationRateLimiter`)
- **Request Body**:
  ```json
  {
    "decision": "APPROVE",
    "internalNotes": "Property inspected and approved according to Kerala State Tourism safety and heritage guidelines."
  }
  ```
  Or rejection:
  ```json
  {
    "decision": "REJECT",
    "rejectionReason": "Property coordinates point outside Kerala geographic territory. Please update exact location coordinates.",
    "internalNotes": "Location pin verified against survey records."
  }
  ```
- **Transaction & Audit Guarantee**:
  - Executed inside a MongoDB multi-document ACID transaction.
  - Automatically records an audit log entry (`AuditLogModel`) with action `PROPERTY_APPROVED` or `PROPERTY_REJECTED`.
  - If database or audit write conflicts occur, the transaction rolls back cleanly with zero orphaned status transitions.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Property reviewed successfully",
    "data": {
      "property": {
        "id": "673456789012345678901234",
        "status": "PUBLISHED",
        "publishedAt": "2026-11-13T14:35:00.000Z",
        "reviewedBy": "670123456789012345678999"
      },
      "auditLog": {
        "id": "673456789012345678901999",
        "action": "PROPERTY_APPROVED",
        "targetEntityType": "PROPERTY",
        "targetEntityId": "673456789012345678901234"
      }
    }
  }
  ```
