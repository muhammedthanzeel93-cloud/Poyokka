import {
  USER_ROLES,
  BOOKING_MODES,
  BOOKING_STATUSES,
  DESTINATION_STATUSES,
  ACCOUNT_TYPES,
  ACCOUNT_STATUSES,
  BUSINESS_TYPES,
  VERIFICATION_STATUSES,
  ADMIN_LEVELS,
  ADMIN_PERMISSIONS,
  BUSINESS_DOCUMENT_TYPES,
  PREFERRED_LANGUAGES,
  AUTH_TOKEN_TYPES,
  SESSION_REVOCATION_REASONS,
  KERALA_DISTRICTS,
  DESTINATION_VERIFICATION_STATUSES,
  DESTINATION_PUBLICATION_STATUSES,
  DESTINATION_SUBMISSION_STATUSES,
  MEDIA_RULES,
  POST_VISIBILITIES,
  POST_STATUSES,
  POST_COMMENT_STATUSES,
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
  MODERATION_CONTENT_TYPES,
  REPORT_TARGET_TYPES,
  REPORT_REASONS,
  REPORT_STATUSES,
  AGENCY_CATEGORIES,
  AGENCY_DOCUMENT_TYPES,
  PACKAGE_STATUSES,
  PACKAGE_CATEGORIES,
  PACKAGE_PRICING_UNITS,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  PROPERTY_FACILITIES,
  INVENTORY_HOLD_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_WEBHOOK_STATUSES,
  NOTIFICATION_TYPES,
  DEVICE_PLATFORMS,
  NOTIFICATION_PROVIDERS,
  NOTIFICATION_DELIVERY_STATUSES,
} from '@kerala-tourism/constants';

// Role Types
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type BookingMode = (typeof BOOKING_MODES)[keyof typeof BOOKING_MODES];
export type BookingStatus = (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];
export type InventoryHoldStatus = (typeof INVENTORY_HOLD_STATUSES)[keyof typeof INVENTORY_HOLD_STATUSES];
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[keyof typeof PAYMENT_PROVIDERS];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];
export type PaymentWebhookStatus = (typeof PAYMENT_WEBHOOK_STATUSES)[keyof typeof PAYMENT_WEBHOOK_STATUSES];
export type DestinationStatus = (typeof DESTINATION_STATUSES)[keyof typeof DESTINATION_STATUSES];
export type KeralaDistrict = (typeof KERALA_DISTRICTS)[number];
export type DestinationVerificationStatus = (typeof DESTINATION_VERIFICATION_STATUSES)[keyof typeof DESTINATION_VERIFICATION_STATUSES];
export type DestinationPublicationStatus = (typeof DESTINATION_PUBLICATION_STATUSES)[keyof typeof DESTINATION_PUBLICATION_STATUSES];
export type DestinationSubmissionStatus = (typeof DESTINATION_SUBMISSION_STATUSES)[keyof typeof DESTINATION_SUBMISSION_STATUSES];
export type MediaMimeType = (typeof MEDIA_RULES.ALLOWED_MIME_TYPES)[number];
export type PostVisibility = (typeof POST_VISIBILITIES)[keyof typeof POST_VISIBILITIES];
export type PostStatus = (typeof POST_STATUSES)[keyof typeof POST_STATUSES];
export type PostCommentStatus = (typeof POST_COMMENT_STATUSES)[keyof typeof POST_COMMENT_STATUSES];

// Core Account & Profile Types
export type AccountType = (typeof ACCOUNT_TYPES)[keyof typeof ACCOUNT_TYPES];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[keyof typeof ACCOUNT_STATUSES];
export type BusinessType = (typeof BUSINESS_TYPES)[keyof typeof BUSINESS_TYPES];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[keyof typeof VERIFICATION_STATUSES];
export type AdminLevel = (typeof ADMIN_LEVELS)[keyof typeof ADMIN_LEVELS];
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];
export type BusinessDocumentType = (typeof BUSINESS_DOCUMENT_TYPES)[keyof typeof BUSINESS_DOCUMENT_TYPES];
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[keyof typeof PREFERRED_LANGUAGES];
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[keyof typeof AUTH_TOKEN_TYPES];
export type SessionRevocationReason = (typeof SESSION_REVOCATION_REASONS)[keyof typeof SESSION_REVOCATION_REASONS];
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];
export type AuditTargetEntityType = (typeof AUDIT_TARGET_ENTITY_TYPES)[keyof typeof AUDIT_TARGET_ENTITY_TYPES];
export type ModerationContentType = (typeof MODERATION_CONTENT_TYPES)[keyof typeof MODERATION_CONTENT_TYPES];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[keyof typeof REPORT_TARGET_TYPES];
export type AgencyCategory = (typeof AGENCY_CATEGORIES)[keyof typeof AGENCY_CATEGORIES];
export type AgencyDocumentType = (typeof AGENCY_DOCUMENT_TYPES)[keyof typeof AGENCY_DOCUMENT_TYPES];
export type PackageStatus = (typeof PACKAGE_STATUSES)[keyof typeof PACKAGE_STATUSES];
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[keyof typeof PACKAGE_CATEGORIES];
export type PackagePricingUnit = (typeof PACKAGE_PRICING_UNITS)[keyof typeof PACKAGE_PRICING_UNITS];
export type PropertyStatus = (typeof PROPERTY_STATUSES)[keyof typeof PROPERTY_STATUSES];
export type PropertyType = (typeof PROPERTY_TYPES)[keyof typeof PROPERTY_TYPES];
export type PropertyFacility = (typeof PROPERTY_FACILITIES)[keyof typeof PROPERTY_FACILITIES];
export type ReportReason = (typeof REPORT_REASONS)[keyof typeof REPORT_REASONS];
export type ReportStatus = (typeof REPORT_STATUSES)[keyof typeof REPORT_STATUSES];

// Authenticated Principal & Token Types
export interface IAccessTokenClaims {
  sub: string;
  email: string;
  accountType: AccountType;
  status: AccountStatus;
  tokenType: 'access';
  jti: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export interface AuthenticatedPrincipal {
  id: string;
  email: string;
  accountType: AccountType;
  status: AccountStatus;
}

// Base Entity Interface
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// User Entity
export interface User extends BaseEntity {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatarUrl?: string;
  isVerified: boolean;
  reputationScore?: number;
}

// Geospatial
export interface Coordinates {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude] per GeoJSON spec
}

// Destination Entity
export interface DestinationEntryFee {
  amount: number;
  currency: string;
  isFree: boolean;
}

export interface Destination extends BaseEntity {
  name: string;
  title?: string;
  slug: string;
  description: string;
  shortDescription?: string;
  categoryIds?: string[];
  category?: 'BACKWATERS' | 'HILL_STATION' | 'BEACH' | 'HERITAGE' | 'FOREST' | 'CULTURE';
  location: GeoPoint;
  address: string;
  district: string;
  locality?: string;
  images: string[];
  facilities?: string[];
  bestTimeToVisit?: string;
  entryFee?: DestinationEntryFee;
  verificationStatus: DestinationVerificationStatus;
  publicationStatus: DestinationPublicationStatus;
  status?: DestinationStatus;
  createdBy: string;
  submittedBy?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  publishedAt?: string;
  badges?: string[];
  averageRating?: number;
  reviewCount?: number;
}

// Destination Category Entity
export interface DestinationCategory extends BaseEntity {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  isActive: boolean;
}

// Destination Submission Entity
export interface DestinationSubmission extends BaseEntity {
  submittedBy: string;
  name: string;
  description: string;
  categoryIds?: string[];
  submittedLocation: GeoPoint;
  submittedAddress: string;
  imageMediaIds: string[];
  submissionStatus: DestinationSubmissionStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  destinationId?: string;
}

// Nearby Destination with Distance
export interface NearbyDestinationDto extends Omit<Destination, 'createdBy'> {
  createdBy?: string;
  distanceKm: number;
  distanceMeters?: number;
}

// Media Entity
export interface MediaDimensions {
  width: number;
  height: number;
}

export interface MediaDto extends BaseEntity {
  uploaderAccountId: string;
  destinationId?: string;
  storageKey: string;
  url: string;
  mimeType: MediaMimeType;
  fileSizeBytes: number;
  dimensions?: MediaDimensions;
  isPrimary: boolean;
  displayOrder: number;
  isModerated: boolean;
}

// Map Provider & Marker Types
export type MapProviderType = 'google' | 'mapbox' | 'osm';

export interface MapMarkerDto {
  id: string;
  name: string;
  slug: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  district: string;
  locality?: string;
  categoryIds?: string[];
  primaryImage?: string;
  distanceKm?: number;
  markerType: 'destination' | 'cluster';
}

export interface MapConfigDto {
  provider: MapProviderType;
  defaultCenter: {
    latitude: number;
    longitude: number;
  };
  defaultZoom: number;
  bounds: {
    minLatitude: number;
    maxLatitude: number;
    minLongitude: number;
    maxLongitude: number;
  };
  tileLayerUrl?: string;
}

// Room & Stay Inventory
export interface RoomInventory extends BaseEntity {
  propertyId: string;
  roomName: string;
  roomType: 'DELUXE_SUITE' | 'HERITAGE_VILLA' | 'ECO_COTTAGE' | 'TRANSIT_POD';
  supportsHourly: boolean;
  supportsDaily: boolean;
  baseHourlyRate?: number;
  baseDailyRate: number;
  capacity: number;
  amenities: string[];
  turnoverBufferMinutes: number;
}

// Booking Entity
export interface Booking extends BaseEntity {
  bookingNumber: string;
  touristId: string;
  propertyId: string;
  roomId: string;
  mode: BookingMode;
  checkInTime: string;
  checkOutTime: string;
  durationHours?: number;
  guestsCount: number;
  totalAmount: number;
  status: BookingStatus;
  qrPassCode?: string;
  specialRequests?: string;
}

// API Health Response (Safe & Secret-Free)
export interface HealthDatabaseStatus {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  name?: string;
  host?: string;
  readyState: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  database: HealthDatabaseStatus;
  services: {
    api: 'up' | 'down';
  };
}

// Standard API Response Wrappers
export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

// ==============================================================================
// Core Account, Profile & Session Domain Entities
// ==============================================================================

export interface IAccount {
  id: string;
  email: string;
  passwordHash?: string;
  accountType: AccountType;
  status: AccountStatus;
  emailVerifiedAt?: Date | null;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITouristProfile {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string;
  profileImage?: string;
  bio?: string;
  phoneNumber?: string;
  preferredLanguage: PreferredLanguage;
  followersCount?: number;
  followingCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBusinessAddress {
  street: string;
  city: string;
  district: string;
  postalCode: string;
  state: string;
}

export interface IBusinessDocument {
  documentType: BusinessDocumentType;
  storageKey: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

export interface IBusinessProfile {
  id: string;
  accountId: string;
  businessName: string;
  businessType: BusinessType;
  businessAddress?: IBusinessAddress;
  contactNumber: string;
  verificationStatus: VerificationStatus;
  documents: IBusinessDocument[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IAdminProfile {
  id: string;
  accountId: string;
  displayName: string;
  permissions: AdminPermission[];
  adminLevel: AdminLevel;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeviceInformation {
  userAgent?: string;
  ipAddress?: string;
  deviceId?: string;
}

export interface ISession {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  familyId: string;
  replacedByTokenHash?: string | null;
  lastUsedAt?: Date | null;
  deviceInformation?: IDeviceInformation;
  expiresAt: Date;
  revokedAt?: Date | null;
  revocationReason?: SessionRevocationReason | string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ==============================================================================
// Social Posts & Community Feed Domain DTOs (Day 13)
// ==============================================================================

export interface PostAuthorDto {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  profileImage?: string;
}

export interface PostMediaDto {
  id: string;
  url: string;
  mimeType: MediaMimeType;
  fileSizeBytes: number;
  dimensions?: MediaDimensions;
}

export interface PostDestinationSummaryDto {
  id: string;
  name: string;
  slug: string;
  district: string;
  locality?: string;
  primaryImage?: string;
}

export interface PostDto extends BaseEntity {
  authorId: string;
  author?: PostAuthorDto;
  content: string;
  mediaIds: string[];
  media: PostMediaDto[];
  destinationId?: string;
  destination?: PostDestinationSummaryDto;
  visibility: PostVisibility;
  status: PostStatus;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  publishedAt?: string | null;
}

export interface PostLikeSummaryDto {
  id: string;
  accountId: string;
  postId: string;
  createdAt: string;
}

export interface PostLikeResponseDto {
  postId: string;
  liked: boolean;
  likesCount: number;
  like?: PostLikeSummaryDto;
}

export interface PostCommentDto extends BaseEntity {
  postId: string;
  authorId: string;
  author?: PostAuthorDto;
  content: string;
  status: PostCommentStatus;
}

export interface PostRepostSummaryDto {
  id: string;
  accountId: string;
  originalPostId: string;
  createdAt: string;
}

export interface PostRepostResponseDto {
  postId: string;
  reposted: boolean;
  repostsCount: number;
  repost?: PostRepostSummaryDto;
}

// ==============================================================================
// Follow & Unfollow System Domain DTOs (Day 15)
// ==============================================================================

export interface FollowRelationshipSummaryDto {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface FollowMutationResponseDto {
  targetUserId: string;
  following: boolean;
  followersCount: number;
  followingCount: number;
  follow?: FollowRelationshipSummaryDto;
}

export interface FollowUserSummaryDto {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  profileImage?: string;
  bio?: string;
  followedAt: string;
}

// ==============================================================================
// Following Feed Cursor Pagination DTOs (Day 16)
// ==============================================================================

export interface CursorPaginationMeta {
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}

// ==============================================================================
// Admin Dashboard Overview & User Governance DTOs (Day 17)
// ==============================================================================

export interface AdminDashboardUsersStatsDto {
  total: number;
  tourists: number;
  businesses: number;
  admins: number;
  active: number;
  suspended: number;
}

export interface AdminDashboardDestinationsStatsDto {
  total: number;
  verified: number;
  pending: number;
  published: number;
}

export interface AdminDashboardSocialStatsDto {
  totalPosts: number;
  pendingPosts: number;
  publishedPosts: number;
}

export interface AdminDashboardBusinessVerificationStatsDto {
  pending: number;
  verified: number;
  rejected: number;
}

export interface AdminDashboardOverviewDto {
  users: AdminDashboardUsersStatsDto;
  destinations: AdminDashboardDestinationsStatsDto;
  social: AdminDashboardSocialStatsDto;
  businessVerification: AdminDashboardBusinessVerificationStatsDto;
}

export interface AdminTouristProfileSummaryDto {
  id: string;
  firstName: string;
  lastName: string;
  preferredLanguage: PreferredLanguage;
  followersCount: number;
  followingCount: number;
}

export interface AdminBusinessProfileSummaryDto {
  id: string;
  businessName: string;
  businessType: BusinessType;
  contactNumber: string;
  verificationStatus: VerificationStatus;
  documentsCount: number;
}

export interface AdminAdminProfileSummaryDto {
  id: string;
  displayName: string;
  adminLevel: AdminLevel;
  permissions: AdminPermission[];
  mfaEnabled: boolean;
}

export type AdminUserProfileSummaryDto =
  | AdminTouristProfileSummaryDto
  | AdminBusinessProfileSummaryDto
  | AdminAdminProfileSummaryDto;

export interface AdminUserListItemDto {
  id: string;
  email: string;
  accountType: AccountType;
  status: AccountStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  profile: AdminUserProfileSummaryDto | null;
}

export type AdminUserDetailsDto = AdminUserListItemDto;

export interface AdminUsersPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminUsersListResponseDto {
  items: AdminUserListItemDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface AuditLogEntryDto {
  id: string;
  actorAccountId: string;
  actorAccountType: AccountType;
  actorAdminLevel?: AdminLevel | null;
  action: AdminAuditAction;
  targetEntityId: string;
  targetEntityType: AuditTargetEntityType;
  reason: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

export interface AdminUserStatusTransitionResponseDto {
  user: AdminUserDetailsDto;
  revokedSessionsCount?: number;
  auditLog: AuditLogEntryDto;
}

// ==============================================================================
// Content Moderation & User Reports DTOs (Day 18)
// ==============================================================================

export interface ModerationCreatorSummaryDto {
  id: string;
  accountType: AccountType;
  status: AccountStatus;
  displayName: string;
}

export interface ModerationQueueItemDto {
  contentType: ModerationContentType;
  contentId: string;
  moderationStatus: string;
  creatorAccountId: string;
  creator: ModerationCreatorSummaryDto | null;
  district: KeralaDistrict | null;
  titleOrExcerpt: string;
  activeReportsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationQueueResponseDto {
  items: ModerationQueueItemDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface ModerationDestinationSubmissionDto {
  id: string;
  submittedBy: string;
  creator: ModerationCreatorSummaryDto | null;
  name: string;
  description: string;
  categoryIds: string[];
  district: KeralaDistrict | null;
  submittedLocation: GeoPoint;
  submittedAddress: string;
  imageMediaIds: string[];
  submissionStatus: DestinationSubmissionStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  destinationId: string | null;
  activeReportsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationDestinationsListResponseDto {
  items: ModerationDestinationSubmissionDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface ModerationDestinationMutationResponseDto {
  submission: ModerationDestinationSubmissionDto;
  destination: {
    id: string;
    name: string;
    slug: string;
    district: KeralaDistrict;
    location: GeoPoint;
    address: string;
    verificationStatus: DestinationVerificationStatus;
    publicationStatus: DestinationPublicationStatus;
    verifiedBy: string | null;
  } | null;
  auditLog: AuditLogEntryDto;
}

export interface ModerationPostDto {
  id: string;
  authorId: string;
  creator: ModerationCreatorSummaryDto | null;
  content: string;
  mediaIds: string[];
  destinationId: string | null;
  visibility: PostVisibility;
  status: PostStatus;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  publishedAt: string | null;
  deletedAt: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  moderationReason: string | null;
  activeReportsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationPostsListResponseDto {
  items: ModerationPostDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface ModerationPostMutationResponseDto {
  post: ModerationPostDto;
  auditLog: AuditLogEntryDto;
}

export interface ModerationCommentDto {
  id: string;
  postId: string;
  authorId: string;
  creator: ModerationCreatorSummaryDto | null;
  content: string;
  status: PostCommentStatus;
  deletedAt: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  moderationReason: string | null;
  activeReportsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationCommentsListResponseDto {
  items: ModerationCommentDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface ModerationCommentMutationResponseDto {
  comment: ModerationCommentDto;
  postCommentsCount: number;
  auditLog: AuditLogEntryDto;
}

export interface ContentReportDto {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  reviewedBy?: string | null;
  reviewedAt: string | null;
  moderatorNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportsListResponseDto {
  items: ContentReportDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface ReportReviewResponseDto {
  report: ContentReportDto;
  auditLog: AuditLogEntryDto;
}

// ==============================================================================
// Day 19 – Agency Registration, Document Management & Verification DTOs
// ==============================================================================

export interface AgencyDocumentDto {
  id: string;
  documentType: AgencyDocumentType;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}

export interface AgencyDto {
  id: string;
  accountId: string;
  businessProfileId: string;
  agencyName: string;
  registrationNumber: string;
  businessCategory: AgencyCategory;
  description: string;
  contactEmail: string;
  contactPhone: string;
  website: string | null;
  address: string;
  district: KeralaDistrict;
  state: string;
  pinCode: string;
  logoMediaId: string | null;
  verificationStatus: VerificationStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  documents?: AgencyDocumentDto[];
  documentsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgencyListResponseDto {
  items: AgencyDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface AgencyReviewResponseDto {
  agency: AgencyDto;
  auditLog: AuditLogEntryDto;
}

// ==============================================================================
// Day 20 – Travel Package Types & DTOs
// ==============================================================================

export interface ItineraryDayDto {
  dayNumber: number;
  title: string;
  description: string;
  activities: string[];
  destinationId?: string | null;
  estimatedDuration?: string | null;
}

export interface PackageGroupPricingTierDto {
  minPax: number;
  maxPax: number;
  pricePerPerson: number;
}

export interface TravelPackageDto {
  id: string;
  agencyId: string;
  createdBy: string;
  updatedBy: string;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  packageCategory: PackageCategory;
  tags: string[];
  destinationIds: string[];
  startLocation?: string | null;
  endLocation?: string | null;
  itinerary: ItineraryDayDto[];
  durationDays: number;
  durationNights: number;
  inclusions: string[];
  exclusions: string[];
  importantInformation?: string | null;
  cancellationPolicy?: string | null;
  currency: string;
  basePrice: number;
  childPrice?: number | null;
  groupPricing?: PackageGroupPricingTierDto[];
  pricingUnit: PackagePricingUnit;
  maxGroupSize?: number | null;
  coverMediaId?: string | null;
  galleryMediaIds: string[];
  status: PackageStatus;
  submittedAt?: string | null;
  publishedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPackageAgencyDto {
  id: string;
  agencyName: string;
  district: KeralaDistrict;
  contactEmail: string;
  contactPhone: string;
  website?: string | null;
  logoMediaId?: string | null;
}

export interface PublicTravelPackageDto {
  id: string;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  packageCategory: PackageCategory;
  tags: string[];
  destinations: Array<{
    id: string;
    name: string;
    slug: string;
    district: KeralaDistrict;
    coverImage?: string | null;
  }>;
  startLocation?: string | null;
  endLocation?: string | null;
  itinerary: ItineraryDayDto[];
  durationDays: number;
  durationNights: number;
  inclusions: string[];
  exclusions: string[];
  importantInformation?: string | null;
  cancellationPolicy?: string | null;
  currency: string;
  basePrice: number;
  childPrice?: number | null;
  groupPricing?: PackageGroupPricingTierDto[];
  pricingUnit: PackagePricingUnit;
  maxGroupSize?: number | null;
  coverMediaId?: string | null;
  galleryMediaIds: string[];
  publishedAt: string;
  agency: PublicPackageAgencyDto;
}

export interface PackageListResponseDto {
  items: TravelPackageDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface PublicPackageListResponseDto {
  items: PublicTravelPackageDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface AdminPackageReviewDto {
  package: TravelPackageDto;
  auditLog: AuditLogEntryDto;
}

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface PropertyDto {
  id: string;
  businessProfileId: string;
  accountId: string;
  createdBy: string;
  updatedBy: string;
  name: string;
  slug: string;
  propertyType: PropertyType;
  shortDescription?: string | null;
  description?: string | null;
  address: string;
  district: KeralaDistrict;
  city?: string | null;
  state: string;
  postalCode?: string | null;
  location: GeoPoint;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  facilities: string[];
  coverMediaId?: string | null;
  galleryMediaIds: string[];
  status: PropertyStatus;
  submittedAt?: string | null;
  publishedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPropertyBusinessDto {
  id: string;
  businessName: string;
  businessType: BusinessType;
  district?: string | null;
  contactNumber?: string | null;
}

export interface PublicPropertyDto {
  id: string;
  name: string;
  slug: string;
  propertyType: PropertyType;
  shortDescription?: string | null;
  description?: string | null;
  address: string;
  district: KeralaDistrict;
  city?: string | null;
  state: string;
  postalCode?: string | null;
  location: GeoPoint;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  facilities: string[];
  coverMediaId?: string | null;
  galleryMediaIds: string[];
  coverImageUrl?: string | null;
  galleryImageUrls?: string[];
  distanceMeters?: number | null;
  distanceKm?: number | null;
  publishedAt: string;
  business: PublicPropertyBusinessDto;
}

export interface PropertyListResponseDto {
  items: PropertyDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface PublicPropertyListResponseDto {
  items: PublicPropertyDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface AdminPropertyReviewDto {
  property: PropertyDto;
  auditLog: AuditLogEntryDto;
}

// ============================================================================
// ROOM & INVENTORY DOMAIN TYPES (Day 22)
// ============================================================================

export type RoomStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type RoomCategory =
  | 'STANDARD'
  | 'DELUXE'
  | 'PREMIUM'
  | 'SUITE'
  | 'VILLA'
  | 'STUDIO'
  | 'DORMITORY'
  | 'COTTAGE'
  | 'OTHER';

export type RoomFacility =
  | 'WIFI'
  | 'AIR_CONDITIONING'
  | 'TV'
  | 'PRIVATE_BATHROOM'
  | 'BALCONY'
  | 'SEA_VIEW'
  | 'MOUNTAIN_VIEW'
  | 'KITCHEN'
  | 'MINIBAR'
  | 'DESK'
  | 'ROOM_SERVICE'
  | 'COFFEE_MAKER'
  | 'SAFE'
  | 'HAIRDRYER'
  | 'IRONING';

export type RoomPricingUnit = 'PER_NIGHT' | 'PER_DAY';

export type RoomSizeUnit = 'SQ_FT' | 'SQ_M';

export type RoomInventoryBlockType = 'MAINTENANCE' | 'BLOCKED';

export interface RoomTypeDto {
  id: string;
  propertyId: string;
  businessProfileId: string;
  accountId: string;
  name: string;
  slug: string;
  description?: string | null;
  roomCategory: RoomCategory;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedConfiguration: string;
  bedCount: number;
  roomSize?: number | null;
  roomSizeUnit: RoomSizeUnit;
  facilities: string[];
  basePrice: number; // In integer paise
  basePriceInr: number; // In INR (e.g. 3500.00)
  currency: string; // 'INR'
  pricingUnit: RoomPricingUnit;
  coverMediaId?: string | null;
  galleryMediaIds: string[];
  coverImageUrl?: string | null;
  galleryImageUrls?: string[];
  status: RoomStatus;
  totalUnits: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicRoomTypeDto {
  id: string;
  propertyId: string;
  name: string;
  slug: string;
  description?: string | null;
  roomCategory: RoomCategory;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedConfiguration: string;
  bedCount: number;
  roomSize?: number | null;
  roomSizeUnit: RoomSizeUnit;
  facilities: string[];
  basePrice: number;
  pricePerNight: number; // In INR
  pricePerNightPaise: number;
  currency: string;
  pricingUnit: RoomPricingUnit;
  coverMediaId?: string | null;
  galleryMediaIds?: string[];
  coverImageUrl?: string | null;
  galleryImageUrls: string[];
  totalUnits: number;
}

export interface RoomInventoryDto {
  id: string;
  propertyId: string;
  roomTypeId: string;
  businessProfileId: string;
  date: string; // ISO 'YYYY-MM-DD'
  totalUnits: number;
  availableUnits: number;
  blockedUnits: number;
  maintenanceUnits: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomAvailabilityCheckResultDto {
  roomType: PublicRoomTypeDto;
  requestedRooms: number;
  availableUnitsAcrossStay: number;
  isAvailable: boolean;
  nightsCount: number;
  pricePerNight: number;
  totalStayPrice: number;
  currency: string;
}

export interface RoomTypeListResponseDto {
  items: RoomTypeDto[];
  total: number;
  pagination?: AdminUsersPaginationMeta;
}

export interface PublicRoomTypeListResponseDto {
  items: PublicRoomTypeDto[];
  total: number;
  pagination?: AdminUsersPaginationMeta;
}

export interface RoomInventoryListResponseDto {
  items: RoomInventoryDto[];
  total: number;
  startDate: string;
  endDate: string;
  dateRange?: { startDate: string; endDate: string };
  roomTypeId?: string;
}

export interface PropertyAvailabilityResponseDto {
  propertyId: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  nightsCount: number;
  availableRoomTypes: RoomAvailabilityCheckResultDto[];
}

// Day 23 Booking Engine & Inventory Hold DTOs
export interface PriceSnapshotDailyBreakdownDto {
  date: string; // ISO 'YYYY-MM-DD'
  pricePaise: number;
  priceInr: number;
}

export interface PriceSnapshotDto {
  basePricePaise: number;
  basePriceInr: number;
  numberOfRooms: number;
  numberOfNights: number;
  dailyBreakdown: PriceSnapshotDailyBreakdownDto[];
  subtotalPaise: number;
  subtotalInr: number;
  taxesPaise: number;
  taxesInr: number;
  totalPaise: number;
  totalInr: number;
  currency: string;
}

export interface GuestDetailsDto {
  primaryGuestName: string;
  email: string;
  phone: string;
  specialRequests?: string | null;
}

export interface BookingDto {
  id: string;
  bookingReference: string;
  touristAccountId: string;
  propertyId: string;
  roomTypeId: string;
  businessProfileId: string;
  checkInDate: string; // ISO 'YYYY-MM-DD'
  checkOutDate: string; // ISO 'YYYY-MM-DD'
  numberOfRooms: number;
  adults: number;
  children: number;
  nights: number;
  status: BookingStatus;
  holdId?: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  paymentId?: string | null;
  paymentReference?: string | null;
  priceSnapshot: PriceSnapshotDto;
  guestDetails: GuestDetailsDto;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryHoldDto {
  id: string;
  bookingId: string;
  roomTypeId: string;
  propertyId: string;
  businessProfileId: string;
  touristAccountId: string;
  numberOfRooms: number;
  stayDates: string[]; // ['YYYY-MM-DD', ...]
  status: InventoryHoldStatus;
  expiresAt: string; // ISO String
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingHoldResponseDto {
  booking: BookingDto;
  hold: InventoryHoldDto;
  expiresAt: string; // ISO String
  remainingSeconds: number;
}

export interface HoldExpiryResultDto {
  scannedCount: number;
  expiredCount: number;
  restoredCount: number;
  failedCount: number;
}

export interface PaymentDto {
  id: string;
  paymentReference: string;
  bookingId: string;
  holdId: string;
  touristAccountId: string;
  businessProfileId: string;
  provider: PaymentProvider;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  amountPaise: number;
  amountInr: number;
  currency: string;
  status: PaymentStatus;
  failureCode?: string | null;
  failureDescription?: string | null;
  reconciliationStatus?: string | null;
  paidAt?: string | null;
  refundId?: string | null;
  refundAmountPaise?: number | null;
  refundedAt?: string | null;
  refundReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RazorpayCheckoutDataDto {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  businessName: string;
  description: string;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
  notes: Record<string, string>;
}

export interface CreatePaymentResponseDto {
  payment: PaymentDto;
  checkoutData: RazorpayCheckoutDataDto;
}

export interface VerifyPaymentResponseDto {
  payment: PaymentDto;
  booking: BookingDto;
  isConfirmed: boolean;
  message: string;
}

export interface RefundPaymentResponseDto {
  payment: PaymentDto;
  refundId: string;
  amountPaise: number;
  currency: string;
  status: string;
  message: string;
}

export interface PaymentWebhookResultDto {
  received: boolean;
  event: string;
  eventId: string;
  status: string;
}

// ============================================================================
// NOTIFICATION & DEVICE TYPES (DAY 26)
// ============================================================================

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[keyof typeof DEVICE_PLATFORMS];
export type NotificationProvider = (typeof NOTIFICATION_PROVIDERS)[keyof typeof NOTIFICATION_PROVIDERS];
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[keyof typeof NOTIFICATION_DELIVERY_STATUSES];

export interface NotificationDto {
  id: string;
  recipientAccountId: string;
  notificationType: NotificationType;
  title: string;
  body: string;
  dataPayload?: Record<string, string>;
  relatedResourceType?: 'BOOKING' | 'PAYMENT' | 'POST' | 'ACCOUNT';
  relatedResourceId?: string;
  isRead: boolean;
  readAt?: string | null;
  deliveryStatus: NotificationDeliveryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResponseDto {
  items: NotificationDto[];
  pagination: AdminUsersPaginationMeta;
}

export interface NotificationUnreadCountDto {
  unreadCount: number;
}

export interface DeviceDto {
  id: string;
  platform: DevicePlatform;
  maskedToken: string;
  deviceId?: string;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface DeviceListResponseDto {
  items: DeviceDto[];
}

export interface RegisterDeviceResponseDto {
  device: DeviceDto;
  message: string;
}

export interface NotificationPreferencesDto {
  bookingUpdates: boolean;
  paymentUpdates: boolean;
  socialUpdates: boolean;
}

export interface UpdateNotificationPreferencesDto {
  bookingUpdates?: boolean;
  paymentUpdates?: boolean;
  socialUpdates?: boolean;
}

export interface SendPushNotificationParams {
  deviceTokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushDeliveryResult {
  success: boolean;
  deliveredCount: number;
  failedCount: number;
  invalidTokens: string[];
  error?: string;
}




