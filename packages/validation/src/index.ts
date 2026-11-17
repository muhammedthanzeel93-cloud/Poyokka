import { z } from 'zod';
import {
  BOOKING_MODES,
  BOOKING_RULES,
  GEOSPATIAL_RULES,
  USER_ROLES,
  BUSINESS_TYPES,
  ACCOUNT_TYPES,
  ACCOUNT_STATUSES,
  ADMIN_USER_MANAGEMENT_RULES,
  DESTINATION_SUBMISSION_STATUSES,
  KERALA_DISTRICTS,
  MEDIA_RULES,
  MAP_CONFIG,
  MODERATION_CONTENT_TYPES,
  MODERATION_RULES,
  POST_COMMENT_STATUSES,
  POST_STATUSES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  AGENCY_CATEGORIES,
  AGENCY_DOCUMENT_TYPES,
  AGENCY_DOCUMENT_RULES,
  AGENCY_RULES,
  PACKAGE_STATUSES,
  PACKAGE_CATEGORIES,
  PACKAGE_PRICING_UNITS,
  PACKAGE_RULES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  PROPERTY_RULES,
  ROOM_STATUSES,
  ROOM_CATEGORIES,
  ROOM_FACILITIES,
  ROOM_PRICING_UNITS,
  ROOM_SIZE_UNITS,
  ROOM_INVENTORY_BLOCK_TYPES,
  ROOM_RULES,
  BOOKING_HOLD_RULES,
  VERIFICATION_STATUSES,
  DEVICE_PLATFORMS,
  NOTIFICATION_RULES,
} from '@kerala-tourism/constants';

// Environment Variables Schema
export const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    HOST: z.string().default('0.0.0.0'),
    MONGO_URL: z.string().url().or(z.string().startsWith('mongodb://')).or(z.string().startsWith('mongodb+srv://')).optional(),
    MONGODB_URI: z.string().url().or(z.string().startsWith('mongodb://')).or(z.string().startsWith('mongodb+srv://')).optional(),
    CLIENT_URL: z.string().url().or(z.string().startsWith('http://')).or(z.string().startsWith('https://')).default('http://localhost:3000'),
    CORS_ORIGINS: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    TRUST_PROXY: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long').default('kerala-tourism-dev-access-secret-32-chars-minimum'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(7),
    JWT_ISSUER: z.string().default('kerala-tourism-auth'),
    JWT_AUDIENCE: z.string().default('kerala-tourism-api'),
    RAZORPAY_KEY_ID: z.string().default('rzp_test_placeholder_key_id'),
    RAZORPAY_KEY_SECRET: z.string().default('rzp_test_placeholder_secret_key_32chars'),
    RAZORPAY_WEBHOOK_SECRET: z.string().default('rzp_webhook_secret_placeholder_32chars'),
    FIREBASE_PROJECT_ID: z.string().default('kerala-tourism-dev'),
    FIREBASE_CLIENT_EMAIL: z.string().default('firebase-adminsdk@kerala-tourism-dev.iam.gserviceaccount.com'),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    FIREBASE_SIMULATED: z.string().default('true'),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        const isDefaultSecret = data.JWT_ACCESS_SECRET === 'kerala-tourism-dev-access-secret-32-chars-minimum';
        const isPlaceholderRazorpay = data.RAZORPAY_KEY_ID?.includes('placeholder');
        return !isDefaultSecret && !isPlaceholderRazorpay;
      }
      return true;
    },
    {
      message: 'Production deployments must provide non-default, production credentials for JWT_ACCESS_SECRET and RAZORPAY_KEY_ID',
    },
  );

export const envSchema = rawEnvSchema.transform((data) => {
  const mongoUrl = data.MONGO_URL || data.MONGODB_URI || 'mongodb://127.0.0.1:27017/kerala_tourism';
  const corsOrigins = data.CORS_ORIGINS || data.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://localhost:3002';
  return {
    NODE_ENV: data.NODE_ENV,
    PORT: data.PORT,
    HOST: data.HOST,
    MONGO_URL: mongoUrl,
    MONGODB_URI: mongoUrl,
    CLIENT_URL: data.CLIENT_URL,
    CORS_ORIGINS: corsOrigins,
    CORS_ORIGIN: corsOrigins,
    TRUST_PROXY: data.TRUST_PROXY,
    JWT_ACCESS_SECRET: data.JWT_ACCESS_SECRET,
    JWT_ACCESS_EXPIRES_IN: data.JWT_ACCESS_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN_DAYS: data.JWT_REFRESH_EXPIRES_IN_DAYS,
    JWT_ISSUER: data.JWT_ISSUER,
    JWT_AUDIENCE: data.JWT_AUDIENCE,
    RAZORPAY_KEY_ID: data.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: data.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: data.RAZORPAY_WEBHOOK_SECRET,
    FIREBASE_PROJECT_ID: data.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: data.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: data.FIREBASE_PRIVATE_KEY,
    FIREBASE_SIMULATED: data.FIREBASE_SIMULATED,
  };
});

export type EnvConfig = z.infer<typeof envSchema>;

// Geospatial Coordinate Validation
export const coordinatesSchema = z.object({
  latitude: z
    .number()
    .min(GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE, 'Latitude is south of Kerala boundary')
    .max(GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE, 'Latitude is north of Kerala boundary'),
  longitude: z
    .number()
    .min(GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE, 'Longitude is west of Kerala boundary')
    .max(GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE, 'Longitude is east of Kerala boundary'),
  altitude: z.number().optional(),
});

// ==============================================================================
// Authentication & Registration Schemas
// ==============================================================================

const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

const E164_PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

export const passwordPolicySchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(100, 'Password cannot exceed 100 characters')
  .regex(
    PASSWORD_COMPLEXITY_REGEX,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  );

export const touristRegistrationSchema = z
  .object({
    firstName: z
      .string({ required_error: 'First name is required' })
      .trim()
      .min(1, 'First name is required')
      .max(50, 'First name cannot exceed 50 characters'),
    lastName: z
      .string({ required_error: 'Last name is required' })
      .trim()
      .min(1, 'Last name is required')
      .max(50, 'Last name cannot exceed 50 characters'),
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid email address format'),
    password: passwordPolicySchema,
    confirmPassword: z.string({ required_error: 'Password confirmation is required' }),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type TouristRegistrationInput = z.infer<typeof touristRegistrationSchema>;

export const businessRegistrationSchema = z
  .object({
    businessName: z
      .string({ required_error: 'Business name is required' })
      .trim()
      .min(2, 'Business name must be at least 2 characters')
      .max(100, 'Business name cannot exceed 100 characters'),
    businessType: z.nativeEnum(BUSINESS_TYPES, {
      errorMap: () => ({ message: 'Invalid business type' }),
    }),
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid email address format'),
    password: passwordPolicySchema,
    confirmPassword: z.string({ required_error: 'Password confirmation is required' }),
    contactNumber: z
      .string({ required_error: 'Contact number is required' })
      .trim()
      .regex(E164_PHONE_REGEX, 'Contact number must be in valid E.164 format (e.g. +919847012345)'),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type BusinessRegistrationInput = z.infer<typeof businessRegistrationSchema>;

// User Login Schema
export const loginSchema = z
  .object({
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid email address format'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password is required'),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type LoginInput = z.infer<typeof loginSchema>;

// Refresh Token Schema
export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().trim().min(1, 'Refresh token cannot be empty').optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// User Registration Schema (Legacy / Internal)
export const userRegistrationSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number format').optional(),
  role: z.nativeEnum(USER_ROLES).default(USER_ROLES.TOURIST),
});

// Destination Submission Schema
export const destinationSubmissionSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(20).max(2000),
  district: z.string().min(2),
  category: z.enum(['BACKWATERS', 'HILL_STATION', 'BEACH', 'HERITAGE', 'FOREST', 'CULTURE']),
  coordinates: coordinatesSchema,
  address: z.string().min(5),
  images: z.array(z.string().url()).min(1, 'At least one image is required'),
});

// Hourly vs Daily Booking Validation Schema
export const bookingCreationSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  roomId: z.string().min(1, 'Room ID is required'),
  mode: z.nativeEnum(BOOKING_MODES),
  checkInTime: z.string().datetime({ message: 'Valid ISO 8601 check-in datetime required' }),
  checkOutTime: z.string().datetime({ message: 'Valid ISO 8601 check-out datetime required' }),
  durationHours: z
    .number()
    .refine(
      (val) => (BOOKING_RULES.HOURLY_SLOT_DURATIONS_HOURS as readonly number[]).includes(val),
      'Hourly duration must be 3, 6, or 12 hours',
    )
    .optional(),
  guestsCount: z.number().int().min(1).max(20),
  specialRequests: z.string().max(500).optional(),
}).refine(
  (data) => {
    if (data.mode === BOOKING_MODES.HOURLY && !data.durationHours) {
      return false;
    }
    return true;
  },
  {
    message: 'Hourly booking requires durationHours (3, 6, or 12)',
    path: ['durationHours'],
  },
);

// ==============================================================================
// Authorization & Profile Update Schemas (Day 10)
// ==============================================================================

export const updateTouristProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name cannot be empty').max(50).optional(),
    lastName: z.string().trim().min(1, 'Last name cannot be empty').max(50).optional(),
    bio: z.string().trim().max(500).optional(),
    phoneNumber: z.string().trim().regex(E164_PHONE_REGEX, 'Invalid phone number format').optional(),
    profileImage: z.string().url('Invalid URL format').optional(),
    preferredLanguage: z.enum(['EN', 'ML']).optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in profile update' });

export type UpdateTouristProfileInput = z.infer<typeof updateTouristProfileSchema>;

export const updateBusinessProfileSchema = z
  .object({
    businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(100).optional(),
    contactNumber: z.string().trim().regex(E164_PHONE_REGEX, 'Invalid phone number format').optional(),
    businessAddress: z
      .object({
        street: z.string().trim().min(1),
        city: z.string().trim().min(1),
        district: z.string().trim().min(1),
        postalCode: z.string().trim().min(1),
        state: z.string().trim().default('Kerala'),
      })
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in business update' });

export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;

export const verifyBusinessActionSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED', 'UNDER_REVIEW']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict({ message: 'Unrecognized fields in verification action' });

export type VerifyBusinessActionInput = z.infer<typeof verifyBusinessActionSchema>;

const propertyObjectIdRegex = /^[0-9a-fA-F]{24}$/;
const propertyObjectIdSchema = (fieldName: string) =>
  z.string().trim().regex(propertyObjectIdRegex, `${fieldName} must be a valid 24-character hexadecimal ObjectId`);

export const geoCoordinatesSchema = z
  .tuple([z.number(), z.number()])
  .refine(
    ([lng, lat]) =>
      lng >= -180 &&
      lng <= 180 &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE &&
      lng <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE &&
      lat >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE &&
      lat <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE,
    {
      message: `Coordinates must be within Kerala geographic bounds (${GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE} <= lng <= ${GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE}, ${GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE} <= lat <= ${GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE})`,
    },
  );

export const propertyLocationSchema = z
  .object({
    type: z.literal('Point').default('Point'),
    coordinates: geoCoordinatesSchema,
  })
  .strict({ message: 'Unrecognized fields in location GeoPoint' });

export const createPropertySchema = z
  .object({
    name: z.string().trim().min(2, 'Property name must be at least 2 characters').max(150, 'Property name cannot exceed 150 characters'),
    category: z.string().trim().min(2).optional(),
    propertyType: z.nativeEnum(PROPERTY_TYPES).optional(),
    district: z.string().trim().min(2),
    address: z.string().trim().min(5),
    city: z.string().trim().min(2).max(100).optional(),
    state: z.string().trim().default('Kerala').optional(),
    postalCode: z.string().trim().regex(/^\d{6}$/, 'Postal code must be a 6-digit PIN').optional(),
    shortDescription: z.string().trim().min(10).max(300).optional(),
    description: z.string().trim().min(10).max(5000).optional(),
    location: propertyLocationSchema.optional(),
    contactPhone: z.string().trim().regex(/^\+?[1-9]\d{6,14}$/, 'Invalid phone number format').optional(),
    contactEmail: z.string().trim().email('Invalid email address').toLowerCase().optional(),
    website: z.string().trim().url('Invalid website URL').optional(),
    facilities: z.array(z.string().trim()).max(30).optional(),
    amenities: z.array(z.string().trim()).default([]).optional(),
    coverMediaId: propertyObjectIdSchema('Cover media ID').optional(),
    galleryMediaIds: z.array(propertyObjectIdSchema('Gallery media ID')).max(15).optional(),
    supportsHourly: z.boolean().default(false).optional(),
    supportsDaily: z.boolean().default(true).optional(),
  })
  .strict({ message: 'Unrecognized fields in property creation' })
  .refine((data) => data.category || data.propertyType, {
    message: 'Either category or propertyType must be provided',
    path: ['propertyType'],
  })
  .refine(
    (data) => {
      if (!data.galleryMediaIds) return true;
      const unique = new Set(data.galleryMediaIds);
      return unique.size === data.galleryMediaIds.length;
    },
    {
      message: 'Gallery media IDs cannot contain duplicate references',
      path: ['galleryMediaIds'],
    },
  );

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const createTourPackageSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    durationDays: z.number().int().positive(),
    durationNights: z.number().int().nonnegative(),
    pricePerPerson: z.number().positive(),
    inclusions: z.array(z.string()).default([]),
    maxGroupSize: z.number().int().positive(),
  })
  .strict({ message: 'Unrecognized fields in package creation' });

export type CreateTourPackageInput = z.infer<typeof createTourPackageSchema>;

// ==============================================================================
// Day 11 – Destination Management Schemas
// ==============================================================================

export const keralaDistrictSchema = z.enum(KERALA_DISTRICTS, {
  errorMap: () => ({ message: 'District must be one of the 14 approved Kerala districts' }),
});

export const geoJsonPointSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: z
      .tuple([
        z.number({ required_error: 'Longitude is required' }),
        z.number({ required_error: 'Latitude is required' }),
      ])
      .refine(
        ([lng, lat]) =>
          lng >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE &&
          lng <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE &&
          lat >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE &&
          lat <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE,
        {
          message: 'Coordinates must be valid Kerala [longitude, latitude] bounds',
        },
      ),
  })
  .strict({ message: 'Unrecognized fields in GeoJSON point' });

export const createDestinationSchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required' })
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(120, 'Name cannot exceed 120 characters'),
    description: z
      .string({ required_error: 'Description is required' })
      .trim()
      .min(20, 'Description must be at least 20 characters')
      .max(5000, 'Description cannot exceed 5000 characters'),
    shortDescription: z.string().trim().max(300, 'Short description cannot exceed 300 characters').optional(),
    categoryIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID format')).optional().default([]),
    location: geoJsonPointSchema,
    address: z
      .string({ required_error: 'Address is required' })
      .trim()
      .min(5, 'Address must be at least 5 characters')
      .max(300, 'Address cannot exceed 300 characters'),
    district: keralaDistrictSchema,
    locality: z.string().trim().max(100).optional(),
    images: z.array(z.string().trim()).default([]),
    facilities: z.array(z.string().trim()).default([]),
    bestTimeToVisit: z.string().trim().max(100).optional(),
    entryFee: z
      .object({
        amount: z.number().min(0, 'Amount cannot be negative').default(0),
        currency: z.string().trim().default('INR'),
        isFree: z.boolean().default(true),
      })
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in destination creation' });

export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;

export const updateDestinationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(20).max(5000).optional(),
    shortDescription: z.string().trim().max(300).optional(),
    categoryIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID format')).optional(),
    location: geoJsonPointSchema.optional(),
    address: z.string().trim().min(5).max(300).optional(),
    district: keralaDistrictSchema.optional(),
    locality: z.string().trim().max(100).optional(),
    images: z.array(z.string().trim()).optional(),
    facilities: z.array(z.string().trim()).optional(),
    bestTimeToVisit: z.string().trim().max(100).optional(),
    entryFee: z
      .object({
        amount: z.number().min(0).default(0),
        currency: z.string().trim().default('INR'),
        isFree: z.boolean().default(true),
      })
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in destination update' });

export type UpdateDestinationInput = z.infer<typeof updateDestinationSchema>;

export const createDestinationCategorySchema = z
  .object({
    name: z
      .string({ required_error: 'Category name is required' })
      .trim()
      .min(2, 'Category name must be at least 2 characters')
      .max(50, 'Category name cannot exceed 50 characters'),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().optional(),
    isActive: z.boolean().default(true),
  })
  .strict({ message: 'Unrecognized fields in category creation' });

export type CreateDestinationCategoryInput = z.infer<typeof createDestinationCategorySchema>;

export const createDestinationSubmissionSchema = z
  .object({
    name: z
      .string({ required_error: 'Destination name is required' })
      .trim()
      .min(2, 'Destination name must be at least 2 characters')
      .max(120, 'Destination name cannot exceed 120 characters'),
    description: z
      .string({ required_error: 'Description is required' })
      .trim()
      .min(20, 'Description must be at least 20 characters')
      .max(2000, 'Description cannot exceed 2000 characters'),
    categoryIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID format')).optional().default([]),
    submittedLocation: geoJsonPointSchema,
    submittedAddress: z
      .string({ required_error: 'Address is required' })
      .trim()
      .min(5, 'Address must be at least 5 characters')
      .max(300, 'Address cannot exceed 300 characters'),
    imageMediaIds: z.array(z.string().trim()).min(1, 'At least one image reference is required').max(10),
  })
  .strict({ message: 'Unrecognized fields in destination submission' });

export type CreateDestinationSubmissionInput = z.infer<typeof createDestinationSubmissionSchema>;

export const reviewDestinationSubmissionSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT'], {
      required_error: 'Review action must be APPROVE or REJECT',
    }),
    reviewNotes: z.string().trim().max(1000).optional(),
  })
  .strict({ message: 'Unrecognized fields in submission review' });

export type ReviewDestinationSubmissionInput = z.infer<typeof reviewDestinationSubmissionSchema>;

export const destinationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  district: keralaDistrictSchema.optional(),
  categoryId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID format').optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(['name', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type DestinationQueryInput = z.infer<typeof destinationQuerySchema>;

// ==============================================================================
// Day 12 – Geospatial Nearby Discovery & Media Management Schemas
// ==============================================================================

export const nearbyDestinationQuerySchema = z.object({
  latitude: z.coerce
    .number({ required_error: 'Latitude is required' })
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z.coerce
    .number({ required_error: 'Longitude is required' })
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  radiusKm: z.coerce
    .number({ invalid_type_error: 'Radius must be a number' })
    .positive('Radius must be greater than 0')
    .max(MAP_CONFIG.MAX_RADIUS_KM, `Radius cannot exceed ${MAP_CONFIG.MAX_RADIUS_KM} km`)
    .default(MAP_CONFIG.DEFAULT_RADIUS_KM),
  categoryId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID format').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type NearbyDestinationQueryInput = z.infer<typeof nearbyDestinationQuerySchema>;

export const attachDestinationMediaSchema = z
  .object({
    storageKey: z.string().trim().min(3, 'Storage key must be at least 3 characters').max(255),
    url: z.string().url('Invalid URL format'),
    mimeType: z.enum(MEDIA_RULES.ALLOWED_MIME_TYPES, {
      errorMap: () => ({
        message: `Unsupported MIME type. Allowed types: ${MEDIA_RULES.ALLOWED_MIME_TYPES.join(', ')}`,
      }),
    }),
    fileSizeBytes: z
      .number()
      .int()
      .positive('File size must be positive')
      .max(
        MEDIA_RULES.MAX_FILE_SIZE_BYTES,
        `File size exceeds maximum allowed limit of ${MEDIA_RULES.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      ),
    dimensions: z
      .object({
        width: z.number().int().positive('Width must be positive'),
        height: z.number().int().positive('Height must be positive'),
      })
      .optional(),
    isPrimary: z.boolean().default(false),
    displayOrder: z.number().int().nonnegative('Display order cannot be negative').default(0),
  })
  .strict({ message: 'Unrecognized fields in media payload' });

export type AttachDestinationMediaInput = z.infer<typeof attachDestinationMediaSchema>;

export const updateDestinationMediaSchema = z
  .object({
    isPrimary: z.boolean().optional(),
    displayOrder: z.number().int().nonnegative('Display order cannot be negative').optional(),
  })
  .strict({ message: 'Unrecognized fields in media update' });

export type UpdateDestinationMediaInput = z.infer<typeof updateDestinationMediaSchema>;

// ==============================================================================
// Day 17 – Admin Dashboard Overview & User Management Schemas
// ==============================================================================

const adminObjectIdSchema = z
  .string({ required_error: 'User ID is required' })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid user ID format');

export const adminUserIdParamSchema = z
  .object({
    userId: adminObjectIdSchema,
  })
  .strict({ message: 'Unrecognized route parameters' });

export type AdminUserIdParamInput = z.infer<typeof adminUserIdParamSchema>;

export const adminUsersQuerySchema = z
  .object({
    page: z.coerce
      .number({ invalid_type_error: 'Page must be a positive integer' })
      .int('Page must be an integer')
      .min(1, 'Page must be at least 1')
      .max(ADMIN_USER_MANAGEMENT_RULES.MAX_PAGE, `Page cannot exceed ${ADMIN_USER_MANAGEMENT_RULES.MAX_PAGE}`)
      .default(ADMIN_USER_MANAGEMENT_RULES.DEFAULT_PAGE),
    limit: z.coerce
      .number({ invalid_type_error: 'Limit must be a positive integer' })
      .int('Limit must be an integer')
      .min(1, 'Limit must be at least 1')
      .max(ADMIN_USER_MANAGEMENT_RULES.MAX_LIMIT, `Limit cannot exceed ${ADMIN_USER_MANAGEMENT_RULES.MAX_LIMIT}`)
      .default(ADMIN_USER_MANAGEMENT_RULES.DEFAULT_LIMIT),
    search: z
      .string({ invalid_type_error: 'Search query must be a string' })
      .trim()
      .min(1, 'Search query cannot be empty')
      .max(
        ADMIN_USER_MANAGEMENT_RULES.MAX_SEARCH_LENGTH,
        `Search query cannot exceed ${ADMIN_USER_MANAGEMENT_RULES.MAX_SEARCH_LENGTH} characters`,
      )
      .refine((val) => !val.includes('\0'), 'Search query contains invalid characters')
      .optional(),
    accountType: z
      .nativeEnum(ACCOUNT_TYPES, {
        errorMap: () => ({ message: 'Invalid accountType. Allowed values: TOURIST, BUSINESS, ADMIN' }),
      })
      .optional(),
    status: z
      .nativeEnum(ACCOUNT_STATUSES, {
        errorMap: () => ({ message: 'Invalid status. Allowed values: ACTIVE, SUSPENDED, DEACTIVATED' }),
      })
      .optional(),
    sortBy: z
      .enum(['createdAt'], {
        errorMap: () => ({ message: 'Invalid sortBy field. Allowed value: createdAt' }),
      })
      .default('createdAt'),
    sortOrder: z
      .enum(['asc', 'desc'], {
        errorMap: () => ({ message: 'Invalid sortOrder. Allowed values: asc, desc' }),
      })
      .default('desc'),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type AdminUsersQueryInput = z.infer<typeof adminUsersQuerySchema>;

export const suspendUserSchema = z
  .object({
    reason: z
      .string({ required_error: 'Suspension reason is required' })
      .trim()
      .min(
        ADMIN_USER_MANAGEMENT_RULES.MIN_REASON_LENGTH,
        `Suspension reason must be at least ${ADMIN_USER_MANAGEMENT_RULES.MIN_REASON_LENGTH} characters`,
      )
      .max(
        ADMIN_USER_MANAGEMENT_RULES.MAX_REASON_LENGTH,
        `Suspension reason cannot exceed ${ADMIN_USER_MANAGEMENT_RULES.MAX_REASON_LENGTH} characters`,
      ),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

export const reactivateUserSchema = z
  .object({
    reason: z
      .string({ invalid_type_error: 'Reactivation reason must be a string' })
      .trim()
      .min(
        ADMIN_USER_MANAGEMENT_RULES.MIN_REASON_LENGTH,
        `Reactivation reason must be at least ${ADMIN_USER_MANAGEMENT_RULES.MIN_REASON_LENGTH} characters`,
      )
      .max(
        ADMIN_USER_MANAGEMENT_RULES.MAX_REASON_LENGTH,
        `Reactivation reason cannot exceed ${ADMIN_USER_MANAGEMENT_RULES.MAX_REASON_LENGTH} characters`,
      )
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type ReactivateUserInput = z.infer<typeof reactivateUserSchema>;

// ==============================================================================
// Day 18 – Admin Content Moderation & User Reports Schemas
// ==============================================================================

const moderationObjectIdSchema = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, `Invalid ${label.toLowerCase()} format`);

const ALL_MODERATION_STATUSES = [
  ...new Set([
    ...Object.values(DESTINATION_SUBMISSION_STATUSES),
    ...Object.values(POST_STATUSES),
    ...Object.values(POST_COMMENT_STATUSES),
  ]),
] as [string, ...string[]];

const moderationDateFilterSchema = z
  .string()
  .trim()
  .refine((val) => !Number.isNaN(Date.parse(val)), 'Invalid ISO date filter')
  .optional();

export const submissionIdParamSchema = z
  .object({
    submissionId: moderationObjectIdSchema('Submission ID'),
  })
  .strict({ message: 'Unrecognized route parameters' });

export type SubmissionIdParamInput = z.infer<typeof submissionIdParamSchema>;

export const moderationPostIdParamSchema = z
  .object({
    postId: moderationObjectIdSchema('Post ID'),
  })
  .strict({ message: 'Unrecognized route parameters' });

export type ModerationPostIdParamInput = z.infer<typeof moderationPostIdParamSchema>;

export const moderationCommentIdParamSchema = z
  .object({
    commentId: moderationObjectIdSchema('Comment ID'),
  })
  .strict({ message: 'Unrecognized route parameters' });

export type ModerationCommentIdParamInput = z.infer<typeof moderationCommentIdParamSchema>;

export const reportIdParamSchema = z
  .object({
    reportId: moderationObjectIdSchema('Report ID'),
  })
  .strict({ message: 'Unrecognized route parameters' });

export type ReportIdParamInput = z.infer<typeof reportIdParamSchema>;

export const moderationQueueQuerySchema = z
  .object({
    contentType: z
      .nativeEnum(MODERATION_CONTENT_TYPES, {
        errorMap: () => ({ message: 'Invalid contentType. Allowed values: DESTINATION, POST, COMMENT' }),
      })
      .optional(),
    moderationStatus: z
      .enum(ALL_MODERATION_STATUSES, {
        errorMap: () => ({ message: 'Invalid moderationStatus filter value' }),
      })
      .optional(),
    submissionDate: moderationDateFilterSchema,
    submittedFrom: moderationDateFilterSchema,
    submittedTo: moderationDateFilterSchema,
    creatorAccountId: moderationObjectIdSchema('Creator account ID').optional(),
    district: keralaDistrictSchema.optional(),
    page: z.coerce
      .number({ invalid_type_error: 'Page must be a positive integer' })
      .int('Page must be an integer')
      .min(1, 'Page must be at least 1')
      .max(MODERATION_RULES.MAX_PAGE, `Page cannot exceed ${MODERATION_RULES.MAX_PAGE}`)
      .default(MODERATION_RULES.DEFAULT_PAGE),
    limit: z.coerce
      .number({ invalid_type_error: 'Limit must be a positive integer' })
      .int('Limit must be an integer')
      .min(1, 'Limit must be at least 1')
      .max(MODERATION_RULES.MAX_LIMIT, `Limit cannot exceed ${MODERATION_RULES.MAX_LIMIT}`)
      .default(MODERATION_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' })
  .superRefine((data, ctx) => {
    if (!data.contentType && !data.district && data.page * data.limit > MODERATION_RULES.MAX_UNIFIED_QUEUE_WINDOW) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page'],
        message: 'Unified cross-collection queue window cannot exceed 500 items; specify contentType for deep pagination',
      });
    }
  });

export type ModerationQueueQueryInput = z.infer<typeof moderationQueueQuerySchema>;

export const moderationDestinationsQuerySchema = z
  .object({
    status: z
      .nativeEnum(DESTINATION_SUBMISSION_STATUSES, {
        errorMap: () => ({ message: 'Invalid status. Allowed values: PENDING, APPROVED, REJECTED' }),
      })
      .optional(),
    district: keralaDistrictSchema.optional(),
    creatorAccountId: moderationObjectIdSchema('Creator account ID').optional(),
    submittedFrom: moderationDateFilterSchema,
    submittedTo: moderationDateFilterSchema,
    page: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_PAGE).default(MODERATION_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_LIMIT).default(MODERATION_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type ModerationDestinationsQueryInput = z.infer<typeof moderationDestinationsQuerySchema>;

export const approveDestinationModerationSchema = z
  .object({
    reviewNotes: z
      .string({ invalid_type_error: 'Review notes must be a string' })
      .trim()
      .min(MODERATION_RULES.MIN_REASON_LENGTH, `Review notes must be at least ${MODERATION_RULES.MIN_REASON_LENGTH} characters`)
      .max(MODERATION_RULES.MAX_NOTES_LENGTH, `Review notes cannot exceed ${MODERATION_RULES.MAX_NOTES_LENGTH} characters`)
      .optional(),
    district: keralaDistrictSchema.optional(),
    location: geoJsonPointSchema.optional(),
    address: z.string().trim().min(5).max(300).optional(),
    destinationId: moderationObjectIdSchema('Destination ID').optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type ApproveDestinationModerationInput = z.infer<typeof approveDestinationModerationSchema>;

export const rejectDestinationModerationSchema = z
  .object({
    reviewNotes: z
      .string({ required_error: 'Review notes are required when rejecting a destination submission' })
      .trim()
      .min(
        MODERATION_RULES.MIN_REASON_LENGTH,
        `Review notes must be at least ${MODERATION_RULES.MIN_REASON_LENGTH} characters`,
      )
      .max(
        MODERATION_RULES.MAX_NOTES_LENGTH,
        `Review notes cannot exceed ${MODERATION_RULES.MAX_NOTES_LENGTH} characters`,
      ),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type RejectDestinationModerationInput = z.infer<typeof rejectDestinationModerationSchema>;

export const moderationPostsQuerySchema = z
  .object({
    status: z
      .nativeEnum(POST_STATUSES, {
        errorMap: () => ({ message: 'Invalid status. Allowed values: PENDING, PUBLISHED, REJECTED, REMOVED' }),
      })
      .optional(),
    creatorAccountId: moderationObjectIdSchema('Creator account ID').optional(),
    submittedFrom: moderationDateFilterSchema,
    submittedTo: moderationDateFilterSchema,
    reportedOnly: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_PAGE).default(MODERATION_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_LIMIT).default(MODERATION_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type ModerationPostsQueryInput = z.infer<typeof moderationPostsQuerySchema>;

export const approvePostModerationSchema = z
  .object({
    reason: z
      .string({ invalid_type_error: 'Moderation reason must be a string' })
      .trim()
      .min(MODERATION_RULES.MIN_REASON_LENGTH)
      .max(MODERATION_RULES.MAX_REASON_LENGTH)
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type ApprovePostModerationInput = z.infer<typeof approvePostModerationSchema>;

const requiredModerationReasonBodySchema = (label: string) =>
  z
    .object({
      reason: z
        .string({ required_error: `${label} reason is required` })
        .trim()
        .min(
          MODERATION_RULES.MIN_REASON_LENGTH,
          `${label} reason must be at least ${MODERATION_RULES.MIN_REASON_LENGTH} characters`,
        )
        .max(
          MODERATION_RULES.MAX_REASON_LENGTH,
          `${label} reason cannot exceed ${MODERATION_RULES.MAX_REASON_LENGTH} characters`,
        ),
    })
    .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export const rejectPostModerationSchema = requiredModerationReasonBodySchema('Rejection');
export type RejectPostModerationInput = z.infer<typeof rejectPostModerationSchema>;

export const removePostModerationSchema = requiredModerationReasonBodySchema('Removal');
export type RemovePostModerationInput = z.infer<typeof removePostModerationSchema>;

export const moderationCommentsQuerySchema = z
  .object({
    status: z
      .nativeEnum(POST_COMMENT_STATUSES, {
        errorMap: () => ({ message: 'Invalid status. Allowed values: ACTIVE, REMOVED' }),
      })
      .optional(),
    postId: moderationObjectIdSchema('Post ID').optional(),
    creatorAccountId: moderationObjectIdSchema('Creator account ID').optional(),
    reportedOnly: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_PAGE).default(MODERATION_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_LIMIT).default(MODERATION_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type ModerationCommentsQueryInput = z.infer<typeof moderationCommentsQuerySchema>;

export const removeCommentModerationSchema = requiredModerationReasonBodySchema('Removal');
export type RemoveCommentModerationInput = z.infer<typeof removeCommentModerationSchema>;

export const restoreCommentModerationSchema = z
  .object({
    reason: z
      .string({ invalid_type_error: 'Restoration reason must be a string' })
      .trim()
      .min(MODERATION_RULES.MIN_REASON_LENGTH)
      .max(MODERATION_RULES.MAX_REASON_LENGTH)
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type RestoreCommentModerationInput = z.infer<typeof restoreCommentModerationSchema>;

export const createContentReportSchema = z
  .object({
    targetType: z.nativeEnum(REPORT_TARGET_TYPES, {
      errorMap: () => ({ message: 'Invalid targetType. Allowed values: DESTINATION, POST, COMMENT, ACCOUNT' }),
    }),
    targetId: moderationObjectIdSchema('Target ID'),
    reason: z.nativeEnum(REPORT_REASONS, {
      errorMap: () => ({ message: 'Invalid report reason' }),
    }),
    description: z
      .string({ invalid_type_error: 'Description must be a string' })
      .trim()
      .max(
        MODERATION_RULES.MAX_DESCRIPTION_LENGTH,
        `Description cannot exceed ${MODERATION_RULES.MAX_DESCRIPTION_LENGTH} characters`,
      )
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .superRefine((data, ctx) => {
    if (
      data.reason === REPORT_REASONS.OTHER &&
      (!data.description || data.description.trim().length < MODERATION_RULES.MIN_OTHER_DESCRIPTION_LENGTH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: `A description of at least ${MODERATION_RULES.MIN_OTHER_DESCRIPTION_LENGTH} characters is required when reason is OTHER`,
      });
    }
  });

export type CreateContentReportInput = z.infer<typeof createContentReportSchema>;

export const touristReportsQuerySchema = z
  .object({
    status: z
      .nativeEnum(REPORT_STATUSES, {
        errorMap: () => ({ message: 'Invalid report status filter' }),
      })
      .optional(),
    targetType: z
      .nativeEnum(REPORT_TARGET_TYPES, {
        errorMap: () => ({ message: 'Invalid targetType filter' }),
      })
      .optional(),
    page: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_PAGE).default(MODERATION_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_LIMIT).default(MODERATION_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type TouristReportsQueryInput = z.infer<typeof touristReportsQuerySchema>;

export const adminReportsQuerySchema = z
  .object({
    status: z
      .nativeEnum(REPORT_STATUSES, {
        errorMap: () => ({ message: 'Invalid report status filter' }),
      })
      .optional(),
    targetType: z
      .nativeEnum(REPORT_TARGET_TYPES, {
        errorMap: () => ({ message: 'Invalid targetType filter' }),
      })
      .optional(),
    reason: z
      .nativeEnum(REPORT_REASONS, {
        errorMap: () => ({ message: 'Invalid reason filter' }),
      })
      .optional(),
    page: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_PAGE).default(MODERATION_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MODERATION_RULES.MAX_LIMIT).default(MODERATION_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type AdminReportsQueryInput = z.infer<typeof adminReportsQuerySchema>;

export const reviewReportSchema = z
  .object({
    status: z.enum(
      [REPORT_STATUSES.UNDER_REVIEW, REPORT_STATUSES.RESOLVED, REPORT_STATUSES.DISMISSED],
      {
        errorMap: () => ({ message: 'Status must be UNDER_REVIEW, RESOLVED, or DISMISSED' }),
      },
    ),
    moderatorNotes: z
      .string({ invalid_type_error: 'Moderator notes must be a string' })
      .trim()
      .max(
        MODERATION_RULES.MAX_NOTES_LENGTH,
        `Moderator notes cannot exceed ${MODERATION_RULES.MAX_NOTES_LENGTH} characters`,
      )
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .superRefine((data, ctx) => {
    if (
      (data.status === REPORT_STATUSES.RESOLVED || data.status === REPORT_STATUSES.DISMISSED) &&
      (!data.moderatorNotes || data.moderatorNotes.trim().length < MODERATION_RULES.MIN_REASON_LENGTH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moderatorNotes'],
        message: `Moderator notes of at least ${MODERATION_RULES.MIN_REASON_LENGTH} characters are required when resolving or dismissing a report`,
      });
    }
  });

export type ReviewReportInput = z.infer<typeof reviewReportSchema>;

// ==============================================================================
// Day 19 – Agency Registration, Document Management & Verification Schemas
// ==============================================================================

const agencyObjectIdSchema = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, `Invalid ${label.toLowerCase()} format`);

export const agencyIdParamSchema = z
  .object({
    agencyId: agencyObjectIdSchema('Agency ID'),
  })
  .strict({ message: 'Unrecognized route parameters' });

export type AgencyIdParamInput = z.infer<typeof agencyIdParamSchema>;

export const agencyDocumentIdParamSchema = z
  .object({
    documentId: agencyObjectIdSchema('Document ID'),
  })
  .strict({ message: 'Unrecognized route parameters' });

export type AgencyDocumentIdParamInput = z.infer<typeof agencyDocumentIdParamSchema>;

export const registerAgencySchema = z
  .object({
    agencyName: z
      .string({ required_error: 'Agency name is required' })
      .trim()
      .min(AGENCY_RULES.MIN_NAME_LENGTH, `Agency name must be at least ${AGENCY_RULES.MIN_NAME_LENGTH} characters`)
      .max(AGENCY_RULES.MAX_NAME_LENGTH, `Agency name cannot exceed ${AGENCY_RULES.MAX_NAME_LENGTH} characters`),
    registrationNumber: z
      .string({ required_error: 'Registration number is required' })
      .trim()
      .min(3, 'Registration number must be at least 3 characters')
      .max(50, 'Registration number cannot exceed 50 characters')
      .regex(/^[A-Za-z0-9/.-]+$/, 'Registration number can only contain alphanumeric characters, hyphens, slashes, and dots'),
    businessCategory: z.nativeEnum(AGENCY_CATEGORIES, {
      errorMap: () => ({ message: 'Invalid agency business category' }),
    }),
    description: z
      .string({ required_error: 'Agency description is required' })
      .trim()
      .min(AGENCY_RULES.MIN_DESCRIPTION_LENGTH, `Description must be at least ${AGENCY_RULES.MIN_DESCRIPTION_LENGTH} characters`)
      .max(AGENCY_RULES.MAX_DESCRIPTION_LENGTH, `Description cannot exceed ${AGENCY_RULES.MAX_DESCRIPTION_LENGTH} characters`),
    contactEmail: z
      .string({ required_error: 'Contact email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid contact email format'),
    contactPhone: z
      .string({ required_error: 'Contact phone is required' })
      .trim()
      .regex(E164_PHONE_REGEX, 'Contact phone must be in valid E.164 format (e.g. +919847012345)'),
    website: z
      .string({ invalid_type_error: 'Website must be a valid URL string' })
      .trim()
      .url('Website must be a valid URL')
      .optional()
      .nullable(),
    address: z
      .string({ required_error: 'Address is required' })
      .trim()
      .min(5, 'Address must be at least 5 characters')
      .max(300, 'Address cannot exceed 300 characters'),
    district: keralaDistrictSchema,
    state: z.string().trim().min(2).max(50).default('Kerala'),
    pinCode: z
      .string({ required_error: 'PIN code is required' })
      .trim()
      .regex(/^\d{6}$/, 'PIN code must be a 6-digit numeric string'),
    logoMediaId: agencyObjectIdSchema('Logo media ID').optional().nullable(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type RegisterAgencyInput = z.infer<typeof registerAgencySchema>;

export const updateAgencySchema = z
  .object({
    agencyName: z
      .string()
      .trim()
      .min(AGENCY_RULES.MIN_NAME_LENGTH, `Agency name must be at least ${AGENCY_RULES.MIN_NAME_LENGTH} characters`)
      .max(AGENCY_RULES.MAX_NAME_LENGTH, `Agency name cannot exceed ${AGENCY_RULES.MAX_NAME_LENGTH} characters`)
      .optional(),
    businessCategory: z.nativeEnum(AGENCY_CATEGORIES, {
      errorMap: () => ({ message: 'Invalid agency business category' }),
    }).optional(),
    description: z
      .string()
      .trim()
      .min(AGENCY_RULES.MIN_DESCRIPTION_LENGTH, `Description must be at least ${AGENCY_RULES.MIN_DESCRIPTION_LENGTH} characters`)
      .max(AGENCY_RULES.MAX_DESCRIPTION_LENGTH, `Description cannot exceed ${AGENCY_RULES.MAX_DESCRIPTION_LENGTH} characters`)
      .optional(),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email('Invalid contact email format')
      .optional(),
    contactPhone: z
      .string()
      .trim()
      .regex(E164_PHONE_REGEX, 'Contact phone must be in valid E.164 format (e.g. +919847012345)')
      .optional(),
    website: z
      .string({ invalid_type_error: 'Website must be a valid URL string' })
      .trim()
      .url('Website must be a valid URL')
      .optional()
      .nullable(),
    address: z
      .string()
      .trim()
      .min(5, 'Address must be at least 5 characters')
      .max(300, 'Address cannot exceed 300 characters')
      .optional(),
    district: keralaDistrictSchema.optional(),
    state: z.string().trim().min(2).max(50).optional(),
    pinCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'PIN code must be a 6-digit numeric string')
      .optional(),
    logoMediaId: agencyObjectIdSchema('Logo media ID').optional().nullable(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type UpdateAgencyInput = z.infer<typeof updateAgencySchema>;

export const uploadAgencyDocumentSchema = z
  .object({
    documentType: z.nativeEnum(AGENCY_DOCUMENT_TYPES, {
      errorMap: () => ({ message: 'Invalid agency document type' }),
    }),
    originalFileName: z
      .string({ required_error: 'Original file name is required' })
      .trim()
      .min(1, 'File name cannot be empty')
      .max(255, 'File name cannot exceed 255 characters'),
    fileSize: z.coerce
      .number({ required_error: 'File size is required' })
      .int('File size must be an integer')
      .min(1, 'File size must be greater than 0 bytes')
      .max(AGENCY_DOCUMENT_RULES.MAX_FILE_SIZE_BYTES, `File size cannot exceed ${AGENCY_DOCUMENT_RULES.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`),
    mimeType: z.enum(AGENCY_DOCUMENT_RULES.ALLOWED_MIME_TYPES, {
      errorMap: () => ({ message: 'Unsupported document MIME type. Allowed types: application/pdf, image/jpeg, image/png, image/webp' }),
    }),
    fileData: z.string().trim().optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type UploadAgencyDocumentInput = z.infer<typeof uploadAgencyDocumentSchema>;

export const adminAgenciesQuerySchema = z
  .object({
    verificationStatus: z
      .nativeEnum(VERIFICATION_STATUSES, {
        errorMap: () => ({ message: 'Invalid verification status filter' }),
      })
      .optional(),
    district: keralaDistrictSchema.optional(),
    search: z.string().trim().max(100, 'Search query cannot exceed 100 characters').optional(),
    page: z.coerce.number().int().min(1).max(AGENCY_RULES.MAX_PAGE).default(AGENCY_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(AGENCY_RULES.MAX_LIMIT).default(AGENCY_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type AdminAgenciesQueryInput = z.infer<typeof adminAgenciesQuerySchema>;

export const reviewAgencySchema = z
  .object({
    status: z.enum(
      [VERIFICATION_STATUSES.UNDER_REVIEW, VERIFICATION_STATUSES.VERIFIED, VERIFICATION_STATUSES.REJECTED],
      {
        errorMap: () => ({ message: 'Status must be UNDER_REVIEW, VERIFIED, or REJECTED' }),
      },
    ),
    rejectionReason: z
      .string({ invalid_type_error: 'Rejection reason must be a string' })
      .trim()
      .max(AGENCY_RULES.MAX_REASON_LENGTH, `Rejection reason cannot exceed ${AGENCY_RULES.MAX_REASON_LENGTH} characters`)
      .optional(),
    reviewNotes: z
      .string({ invalid_type_error: 'Review notes must be a string' })
      .trim()
      .max(AGENCY_RULES.MAX_REASON_LENGTH, `Review notes cannot exceed ${AGENCY_RULES.MAX_REASON_LENGTH} characters`)
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .superRefine((data, ctx) => {
    if (
      data.status === VERIFICATION_STATUSES.REJECTED &&
      (!data.rejectionReason || data.rejectionReason.trim().length < AGENCY_RULES.MIN_REASON_LENGTH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: `A rejection reason of at least ${AGENCY_RULES.MIN_REASON_LENGTH} characters is required when status is REJECTED`,
      });
    }
  });

export type ReviewAgencyInput = z.infer<typeof reviewAgencySchema>;

// ==============================================================================
// Day 20 – Travel Package Validation Schemas
// ==============================================================================

const packageObjectIdSchema = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, `${label} must be a valid 24-character hexadecimal ObjectId`);

export const packageIdParamSchema = z
  .object({
    packageId: packageObjectIdSchema('Package ID'),
  })
  .strict({ message: 'Unrecognized path parameters' });

export type PackageIdParam = z.infer<typeof packageIdParamSchema>;

export const itineraryDaySchema = z
  .object({
    dayNumber: z
      .number({ required_error: 'Day number is required' })
      .int('Day number must be an integer')
      .min(1, 'Day number must be at least 1')
      .max(PACKAGE_RULES.MAX_ITINERARY_DAYS, `Day number cannot exceed ${PACKAGE_RULES.MAX_ITINERARY_DAYS}`),
    title: z
      .string({ required_error: 'Itinerary title is required' })
      .trim()
      .min(2, 'Itinerary title must be at least 2 characters')
      .max(120, 'Itinerary title cannot exceed 120 characters'),
    description: z
      .string({ required_error: 'Itinerary description is required' })
      .trim()
      .min(5, 'Itinerary description must be at least 5 characters')
      .max(2000, 'Itinerary description cannot exceed 2000 characters'),
    activities: z
      .array(z.string().trim().min(1).max(200))
      .max(20, 'Cannot exceed 20 activities per day')
      .default([]),
    destinationId: packageObjectIdSchema('Destination ID').optional().nullable(),
    estimatedDuration: z.string().trim().max(100).optional().nullable(),
  })
  .strict({ message: 'Unrecognized fields in itinerary day' });

export type ItineraryDayInput = z.infer<typeof itineraryDaySchema>;

export const groupPricingTierSchema = z
  .object({
    minPax: z.number().int().min(1, 'minPax must be at least 1'),
    maxPax: z.number().int().min(1, 'maxPax must be at least 1'),
    pricePerPerson: z.number().positive('Price per person must be positive'),
  })
  .strict({ message: 'Unrecognized fields in group pricing tier' })
  .refine((data) => data.maxPax >= data.minPax, {
    message: 'maxPax must be greater than or equal to minPax',
    path: ['maxPax'],
  });

export type GroupPricingTierInput = z.infer<typeof groupPricingTierSchema>;

export const createPackageSchema = z
  .object({
    title: z
      .string({ required_error: 'Package title is required' })
      .trim()
      .min(PACKAGE_RULES.MIN_TITLE_LENGTH, `Title must be at least ${PACKAGE_RULES.MIN_TITLE_LENGTH} characters`)
      .max(PACKAGE_RULES.MAX_TITLE_LENGTH, `Title cannot exceed ${PACKAGE_RULES.MAX_TITLE_LENGTH} characters`),
    shortDescription: z
      .string()
      .trim()
      .max(
        PACKAGE_RULES.MAX_SHORT_DESCRIPTION_LENGTH,
        `Short description cannot exceed ${PACKAGE_RULES.MAX_SHORT_DESCRIPTION_LENGTH} characters`,
      )
      .optional(),
    description: z
      .string()
      .trim()
      .max(
        PACKAGE_RULES.MAX_DESCRIPTION_LENGTH,
        `Description cannot exceed ${PACKAGE_RULES.MAX_DESCRIPTION_LENGTH} characters`,
      )
      .optional(),
    packageCategory: z
      .nativeEnum(PACKAGE_CATEGORIES, {
        errorMap: () => ({ message: 'Invalid package category' }),
      })
      .default(PACKAGE_CATEGORIES.TOUR_OPERATOR),
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(PACKAGE_RULES.MAX_TAG_LENGTH, `Tag cannot exceed ${PACKAGE_RULES.MAX_TAG_LENGTH} characters`),
      )
      .max(PACKAGE_RULES.MAX_TAGS, `Cannot exceed ${PACKAGE_RULES.MAX_TAGS} tags`)
      .default([]),
    destinationIds: z
      .array(packageObjectIdSchema('Destination ID'))
      .max(PACKAGE_RULES.MAX_DESTINATIONS, `Cannot exceed ${PACKAGE_RULES.MAX_DESTINATIONS} destinations`)
      .default([]),
    startLocation: z.string().trim().max(120).optional().nullable(),
    endLocation: z.string().trim().max(120).optional().nullable(),
    durationDays: z
      .number({ required_error: 'Duration days is required' })
      .int('Duration days must be an integer')
      .min(PACKAGE_RULES.MIN_DAYS, `Duration days must be at least ${PACKAGE_RULES.MIN_DAYS}`)
      .max(PACKAGE_RULES.MAX_DAYS, `Duration days cannot exceed ${PACKAGE_RULES.MAX_DAYS}`),
    durationNights: z
      .number({ required_error: 'Duration nights is required' })
      .int('Duration nights must be an integer')
      .min(PACKAGE_RULES.MIN_NIGHTS, `Duration nights must be at least ${PACKAGE_RULES.MIN_NIGHTS}`)
      .max(PACKAGE_RULES.MAX_NIGHTS, `Duration nights cannot exceed ${PACKAGE_RULES.MAX_NIGHTS}`),
    itinerary: z
      .array(itineraryDaySchema)
      .max(PACKAGE_RULES.MAX_ITINERARY_DAYS, `Cannot exceed ${PACKAGE_RULES.MAX_ITINERARY_DAYS} itinerary days`)
      .default([]),
    inclusions: z
      .array(z.string().trim().min(1).max(200))
      .max(PACKAGE_RULES.MAX_INCLUSIONS, `Cannot exceed ${PACKAGE_RULES.MAX_INCLUSIONS} inclusions`)
      .default([]),
    exclusions: z
      .array(z.string().trim().min(1).max(200))
      .max(PACKAGE_RULES.MAX_EXCLUSIONS, `Cannot exceed ${PACKAGE_RULES.MAX_EXCLUSIONS} exclusions`)
      .default([]),
    importantInformation: z.string().trim().max(3000).optional().nullable(),
    cancellationPolicy: z.string().trim().max(2000).optional().nullable(),
    currency: z.literal('INR').default('INR'),
    basePrice: z.number().positive('Base price must be positive').optional(),
    pricePerPerson: z.number().positive('Price per person must be positive').optional(), // backward compatibility alias
    childPrice: z.number().positive('Child price must be positive').optional().nullable(),
    groupPricing: z.array(groupPricingTierSchema).optional(),
    pricingUnit: z
      .nativeEnum(PACKAGE_PRICING_UNITS, {
        errorMap: () => ({ message: 'Invalid pricing unit' }),
      })
      .default(PACKAGE_PRICING_UNITS.PER_PERSON),
    maxGroupSize: z.number().int().positive().optional().nullable(),
    coverMediaId: packageObjectIdSchema('Cover media ID').optional().nullable(),
    galleryMediaIds: z
      .array(packageObjectIdSchema('Gallery media ID'))
      .max(PACKAGE_RULES.MAX_GALLERY_MEDIA, `Cannot exceed ${PACKAGE_RULES.MAX_GALLERY_MEDIA} gallery media`)
      .default([]),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .superRefine((data, ctx) => {
    if (data.basePrice === undefined && data.pricePerPerson === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['basePrice'],
        message: 'Either basePrice or pricePerPerson is required',
      });
    }
  });

export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const updatePackageSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(PACKAGE_RULES.MIN_TITLE_LENGTH, `Title must be at least ${PACKAGE_RULES.MIN_TITLE_LENGTH} characters`)
      .max(PACKAGE_RULES.MAX_TITLE_LENGTH, `Title cannot exceed ${PACKAGE_RULES.MAX_TITLE_LENGTH} characters`)
      .optional(),
    shortDescription: z
      .string()
      .trim()
      .max(
        PACKAGE_RULES.MAX_SHORT_DESCRIPTION_LENGTH,
        `Short description cannot exceed ${PACKAGE_RULES.MAX_SHORT_DESCRIPTION_LENGTH} characters`,
      )
      .optional(),
    description: z
      .string()
      .trim()
      .max(
        PACKAGE_RULES.MAX_DESCRIPTION_LENGTH,
        `Description cannot exceed ${PACKAGE_RULES.MAX_DESCRIPTION_LENGTH} characters`,
      )
      .optional(),
    packageCategory: z
      .nativeEnum(PACKAGE_CATEGORIES, {
        errorMap: () => ({ message: 'Invalid package category' }),
      })
      .optional(),
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(PACKAGE_RULES.MAX_TAG_LENGTH, `Tag cannot exceed ${PACKAGE_RULES.MAX_TAG_LENGTH} characters`),
      )
      .max(PACKAGE_RULES.MAX_TAGS, `Cannot exceed ${PACKAGE_RULES.MAX_TAGS} tags`)
      .optional(),
    destinationIds: z
      .array(packageObjectIdSchema('Destination ID'))
      .max(PACKAGE_RULES.MAX_DESTINATIONS, `Cannot exceed ${PACKAGE_RULES.MAX_DESTINATIONS} destinations`)
      .optional(),
    startLocation: z.string().trim().max(120).optional().nullable(),
    endLocation: z.string().trim().max(120).optional().nullable(),
    durationDays: z
      .number()
      .int('Duration days must be an integer')
      .min(PACKAGE_RULES.MIN_DAYS, `Duration days must be at least ${PACKAGE_RULES.MIN_DAYS}`)
      .max(PACKAGE_RULES.MAX_DAYS, `Duration days cannot exceed ${PACKAGE_RULES.MAX_DAYS}`)
      .optional(),
    durationNights: z
      .number()
      .int('Duration nights must be an integer')
      .min(PACKAGE_RULES.MIN_NIGHTS, `Duration nights must be at least ${PACKAGE_RULES.MIN_NIGHTS}`)
      .max(PACKAGE_RULES.MAX_NIGHTS, `Duration nights cannot exceed ${PACKAGE_RULES.MAX_NIGHTS}`)
      .optional(),
    itinerary: z
      .array(itineraryDaySchema)
      .max(PACKAGE_RULES.MAX_ITINERARY_DAYS, `Cannot exceed ${PACKAGE_RULES.MAX_ITINERARY_DAYS} itinerary days`)
      .optional(),
    inclusions: z
      .array(z.string().trim().min(1).max(200))
      .max(PACKAGE_RULES.MAX_INCLUSIONS, `Cannot exceed ${PACKAGE_RULES.MAX_INCLUSIONS} inclusions`)
      .optional(),
    exclusions: z
      .array(z.string().trim().min(1).max(200))
      .max(PACKAGE_RULES.MAX_EXCLUSIONS, `Cannot exceed ${PACKAGE_RULES.MAX_EXCLUSIONS} exclusions`)
      .optional(),
    importantInformation: z.string().trim().max(3000).optional().nullable(),
    cancellationPolicy: z.string().trim().max(2000).optional().nullable(),
    currency: z.literal('INR').optional(),
    basePrice: z.number().positive('Base price must be positive').optional(),
    pricePerPerson: z.number().positive('Price per person must be positive').optional(),
    childPrice: z.number().positive('Child price must be positive').optional().nullable(),
    groupPricing: z.array(groupPricingTierSchema).optional(),
    pricingUnit: z
      .nativeEnum(PACKAGE_PRICING_UNITS, {
        errorMap: () => ({ message: 'Invalid pricing unit' }),
      })
      .optional(),
    maxGroupSize: z.number().int().positive().optional().nullable(),
    coverMediaId: packageObjectIdSchema('Cover media ID').optional().nullable(),
    galleryMediaIds: z
      .array(packageObjectIdSchema('Gallery media ID'))
      .max(PACKAGE_RULES.MAX_GALLERY_MEDIA, `Cannot exceed ${PACKAGE_RULES.MAX_GALLERY_MEDIA} gallery media`)
      .optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' });

export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

export const submitPackageReviewSchema = z
  .object({
    submissionNotes: z.string().trim().max(1000).optional(),
  })
  .strict({ message: 'Unrecognized fields in submission' });

export type SubmitPackageReviewInput = z.infer<typeof submitPackageReviewSchema>;

export const reviewPackageSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT'], {
      errorMap: () => ({ message: 'Decision must be APPROVE or REJECT' }),
    }),
    rejectionReason: z
      .string({ invalid_type_error: 'Rejection reason must be a string' })
      .trim()
      .max(
        PACKAGE_RULES.MAX_REJECTION_REASON_LENGTH,
        `Rejection reason cannot exceed ${PACKAGE_RULES.MAX_REJECTION_REASON_LENGTH} characters`,
      )
      .optional(),
    internalNotes: z.string().trim().max(1000).optional(),
  })
  .strict({ message: 'Unrecognized or unauthorized fields in request body' })
  .superRefine((data, ctx) => {
    if (
      data.decision === 'REJECT' &&
      (!data.rejectionReason || data.rejectionReason.trim().length < PACKAGE_RULES.MIN_REJECTION_REASON_LENGTH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: `A rejection reason of at least ${PACKAGE_RULES.MIN_REJECTION_REASON_LENGTH} characters is required when decision is REJECT`,
      });
    }
  });

export type ReviewPackageInput = z.infer<typeof reviewPackageSchema>;

export const packageQuerySchema = z
  .object({
    status: z.nativeEnum(PACKAGE_STATUSES).optional(),
    packageCategory: z.nativeEnum(PACKAGE_CATEGORIES).optional(),
    district: keralaDistrictSchema.optional(),
    destinationId: packageObjectIdSchema('Destination ID').optional(),
    minDays: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_DAYS).optional(),
    maxDays: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_DAYS).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z
      .enum(['newest', 'price_asc', 'price_desc', 'duration_asc', 'duration_desc'])
      .default('newest'),
    page: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_PAGE).default(PACKAGE_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_LIMIT).default(PACKAGE_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type PackageQueryInput = z.infer<typeof packageQuerySchema>;

export const packageSearchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1, 'Search query cannot be empty')
      .max(100, 'Search query cannot exceed 100 characters'),
    packageCategory: z.nativeEnum(PACKAGE_CATEGORIES).optional(),
    district: keralaDistrictSchema.optional(),
    destinationId: packageObjectIdSchema('Destination ID').optional(),
    minDays: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_DAYS).optional(),
    maxDays: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_DAYS).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z
      .enum(['newest', 'price_asc', 'price_desc', 'duration_asc', 'duration_desc'])
      .default('newest'),
    page: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_PAGE).default(PACKAGE_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PACKAGE_RULES.MAX_LIMIT).default(PACKAGE_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized search query parameters' });

export type PackageSearchQueryInput = z.infer<typeof packageSearchQuerySchema>;

// ==============================================================================
// Day 21 – Property & Accommodation Management Schemas
// ==============================================================================

export const updatePropertySchema = z
  .object({
    name: z.string().trim().min(2, 'Property name must be at least 2 characters').max(150, 'Property name cannot exceed 150 characters').optional(),
    propertyType: z.nativeEnum(PROPERTY_TYPES).optional(),
    category: z.string().trim().min(2).optional(),
    shortDescription: z.string().trim().min(10).max(300).optional(),
    description: z.string().trim().min(10).max(5000).optional(),
    address: z.string().trim().min(5).optional(),
    district: z.string().trim().min(2).optional(),
    city: z.string().trim().min(2).max(100).optional(),
    state: z.string().trim().optional(),
    postalCode: z.string().trim().regex(/^\d{6}$/, 'Postal code must be a 6-digit PIN').optional(),
    location: propertyLocationSchema.optional(),
    contactPhone: z.string().trim().regex(/^\+?[1-9]\d{6,14}$/, 'Invalid phone number format').optional(),
    contactEmail: z.string().trim().email('Invalid email address').toLowerCase().optional(),
    website: z.string().trim().url('Invalid website URL').optional(),
    facilities: z.array(z.string().trim()).max(30).optional(),
    amenities: z.array(z.string().trim()).optional(),
    coverMediaId: propertyObjectIdSchema('Cover media ID').optional().nullable(),
    galleryMediaIds: z.array(propertyObjectIdSchema('Gallery media ID')).max(15).optional(),
    supportsHourly: z.boolean().optional(),
    supportsDaily: z.boolean().optional(),
  })
  .strict({ message: 'Unrecognized fields in property update' })
  .refine(
    (data) => {
      if (!data.galleryMediaIds) return true;
      const unique = new Set(data.galleryMediaIds);
      return unique.size === data.galleryMediaIds.length;
    },
    {
      message: 'Gallery media IDs cannot contain duplicate references',
      path: ['galleryMediaIds'],
    },
  );

export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

export const submitPropertyReviewSchema = z
  .object({
    businessNotes: z.string().trim().max(1000).optional(),
  })
  .strict({ message: 'Unrecognized fields in review submission' });

export type SubmitPropertyReviewInput = z.infer<typeof submitPropertyReviewSchema>;

export const reviewPropertySchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    rejectionReason: z
      .string()
      .trim()
      .max(PROPERTY_RULES.MAX_REJECTION_REASON_LENGTH, `Rejection reason cannot exceed ${PROPERTY_RULES.MAX_REJECTION_REASON_LENGTH} characters`)
      .optional(),
    internalNotes: z.string().trim().max(1000).optional(),
  })
  .strict({ message: 'Unrecognized fields in property review' })
  .superRefine((data, ctx) => {
    if (
      data.decision === 'REJECT' &&
      (!data.rejectionReason || data.rejectionReason.trim().length < PROPERTY_RULES.MIN_REJECTION_REASON_LENGTH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: `A rejection reason of at least ${PROPERTY_RULES.MIN_REJECTION_REASON_LENGTH} characters is required when decision is REJECT`,
      });
    }
  });

export type ReviewPropertyInput = z.infer<typeof reviewPropertySchema>;

export const propertyQuerySchema = z
  .object({
    status: z.nativeEnum(PROPERTY_STATUSES).optional(),
    propertyType: z.nativeEnum(PROPERTY_TYPES).optional(),
    district: z.string().optional(),
    page: z.coerce.number().int().min(1).max(PROPERTY_RULES.MAX_PAGE).default(PROPERTY_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PROPERTY_RULES.MAX_LIMIT).default(PROPERTY_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type PropertyQueryInput = z.infer<typeof propertyQuerySchema>;

export const publicPropertyQuerySchema = z
  .object({
    district: z.string().optional(),
    propertyType: z.nativeEnum(PROPERTY_TYPES).optional(),
    facility: z.string().optional(),
    facilities: z.string().or(z.array(z.string())).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(PROPERTY_RULES.MAX_PAGE).default(PROPERTY_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PROPERTY_RULES.MAX_LIMIT).default(PROPERTY_RULES.DEFAULT_LIMIT),
    sort: z.enum(['newest', 'name_asc', 'name_desc']).default('newest'),
  })
  .strict({ message: 'Unrecognized public query parameters' });

export type PublicPropertyQueryInput = z.infer<typeof publicPropertyQuerySchema>;

export const nearbyPropertyQuerySchema = z
  .object({
    latitude: z.coerce
      .number()
      .min(-90, 'Latitude must be >= -90')
      .max(90, 'Latitude must be <= 90')
      .refine(
        (lat) =>
          lat >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE &&
          lat <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE,
        {
          message: `Latitude must be within Kerala bounds (${GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE} to ${GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE})`,
        },
      ),
    longitude: z.coerce
      .number()
      .min(-180, 'Longitude must be >= -180')
      .max(180, 'Longitude must be <= 180')
      .refine(
        (lng) =>
          lng >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE &&
          lng <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE,
        {
          message: `Longitude must be within Kerala bounds (${GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE} to ${GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE})`,
        },
      ),
    radius: z.coerce
      .number()
      .positive('Radius must be positive')
      .max(PROPERTY_RULES.MAX_RADIUS_KM, `Radius cannot exceed ${PROPERTY_RULES.MAX_RADIUS_KM}km`)
      .default(PROPERTY_RULES.DEFAULT_RADIUS_KM),
    propertyType: z.nativeEnum(PROPERTY_TYPES).optional(),
    page: z.coerce.number().int().min(1).max(PROPERTY_RULES.MAX_PAGE).default(PROPERTY_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PROPERTY_RULES.MAX_LIMIT).default(PROPERTY_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized nearby query parameters' });

export type NearbyPropertyQueryInput = z.infer<typeof nearbyPropertyQuerySchema>;

export const propertyIdParamSchema = z
  .object({
    propertyId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Property ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized URL parameters' });

export type PropertyIdParamInput = z.infer<typeof propertyIdParamSchema>;

export const propertySlugParamSchema = z
  .object({
    slug: z.string().trim().min(2).max(150),
  })
  .strict({ message: 'Unrecognized URL parameters' });

export type PropertySlugParamInput = z.infer<typeof propertySlugParamSchema>;

// ============================================================================
// ROOM & INVENTORY SCHEMAS (Day 22)
// ============================================================================

export const roomTypeIdParamSchema = z
  .object({
    roomTypeId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Room type ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized URL parameters' });

export type RoomTypeIdParamInput = z.infer<typeof roomTypeIdParamSchema>;

export const propertyRoomParamsSchema = z
  .object({
    propertyId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Property ID must be a valid 24-character hexadecimal ObjectId'),
    roomTypeId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Room type ID must be a valid 24-character hexadecimal ObjectId')
      .optional(),
  })
  .strict({ message: 'Unrecognized URL parameters' });

export type PropertyRoomParamsInput = z.infer<typeof propertyRoomParamsSchema>;

export const inventoryIdParamSchema = z
  .object({
    roomTypeId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Room type ID must be a valid 24-character hexadecimal ObjectId'),
    inventoryId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Inventory ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized URL parameters' });

export type InventoryIdParamInput = z.infer<typeof inventoryIdParamSchema>;

export const createRoomTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(ROOM_RULES.MIN_NAME_LENGTH, `Room name must be at least ${ROOM_RULES.MIN_NAME_LENGTH} characters`)
      .max(ROOM_RULES.MAX_NAME_LENGTH, `Room name cannot exceed ${ROOM_RULES.MAX_NAME_LENGTH} characters`),
    roomCategory: z.nativeEnum(ROOM_CATEGORIES),
    description: z.string().trim().max(ROOM_RULES.MAX_DESCRIPTION_LENGTH).optional().nullable(),
    maxAdults: z
      .number()
      .int('Adult capacity must be an integer')
      .min(ROOM_RULES.MIN_CAPACITY_ADULTS, `Adult capacity must be at least ${ROOM_RULES.MIN_CAPACITY_ADULTS}`)
      .max(ROOM_RULES.MAX_CAPACITY_ADULTS, `Adult capacity cannot exceed ${ROOM_RULES.MAX_CAPACITY_ADULTS}`),
    maxChildren: z
      .number()
      .int('Children capacity must be an integer')
      .min(ROOM_RULES.MIN_CAPACITY_CHILDREN)
      .max(ROOM_RULES.MAX_CAPACITY_CHILDREN)
      .default(0),
    maxOccupancy: z
      .number()
      .int('Max occupancy must be an integer')
      .min(ROOM_RULES.MIN_OCCUPANCY)
      .max(ROOM_RULES.MAX_OCCUPANCY),
    bedConfiguration: z.string().trim().min(2, 'Bed configuration is required').max(100),
    bedCount: z
      .number()
      .int()
      .min(ROOM_RULES.MIN_BED_COUNT)
      .max(ROOM_RULES.MAX_BED_COUNT)
      .default(1),
    roomSize: z.number().positive('Room size must be positive').optional().nullable(),
    roomSizeUnit: z.nativeEnum(ROOM_SIZE_UNITS).default('SQ_FT'),
    facilities: z.array(z.nativeEnum(ROOM_FACILITIES)).max(ROOM_RULES.MAX_FACILITIES).default([]),
    basePrice: z
      .number()
      .int('Base price in paise must be an integer')
      .positive('Base price must be positive')
      .min(ROOM_RULES.MIN_PRICE_PAISE, `Base price must be at least ${ROOM_RULES.MIN_PRICE_PAISE} paise`)
      .max(ROOM_RULES.MAX_PRICE_PAISE, `Base price cannot exceed ${ROOM_RULES.MAX_PRICE_PAISE} paise`),
    currency: z.literal('INR').default('INR'),
    pricingUnit: z.nativeEnum(ROOM_PRICING_UNITS).default('PER_NIGHT'),
    coverMediaId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Cover media ID must be a valid 24-character hexadecimal ObjectId')
      .optional()
      .nullable(),
    galleryMediaIds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F]{24}$/, 'Gallery media ID must be a valid 24-character hexadecimal ObjectId'),
      )
      .max(ROOM_RULES.MAX_GALLERY_MEDIA)
      .default([]),
    totalUnits: z
      .number()
      .int('Total units must be an integer')
      .min(1, 'Room type must have at least 1 unit')
      .max(ROOM_RULES.MAX_INVENTORY_UNITS)
      .default(1),
  })
  .strict({ message: 'Unrecognized fields in create room type payload' })
  .refine((data) => data.maxOccupancy >= data.maxAdults, {
    message: 'Max occupancy must be greater than or equal to max adults',
    path: ['maxOccupancy'],
  });

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;

export const updateRoomTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(ROOM_RULES.MIN_NAME_LENGTH)
      .max(ROOM_RULES.MAX_NAME_LENGTH)
      .optional(),
    roomCategory: z.nativeEnum(ROOM_CATEGORIES).optional(),
    description: z.string().trim().max(ROOM_RULES.MAX_DESCRIPTION_LENGTH).optional().nullable(),
    maxAdults: z
      .number()
      .int()
      .min(ROOM_RULES.MIN_CAPACITY_ADULTS)
      .max(ROOM_RULES.MAX_CAPACITY_ADULTS)
      .optional(),
    maxChildren: z
      .number()
      .int()
      .min(ROOM_RULES.MIN_CAPACITY_CHILDREN)
      .max(ROOM_RULES.MAX_CAPACITY_CHILDREN)
      .optional(),
    maxOccupancy: z
      .number()
      .int()
      .min(ROOM_RULES.MIN_OCCUPANCY)
      .max(ROOM_RULES.MAX_OCCUPANCY)
      .optional(),
    bedConfiguration: z.string().trim().min(2).max(100).optional(),
    bedCount: z
      .number()
      .int()
      .min(ROOM_RULES.MIN_BED_COUNT)
      .max(ROOM_RULES.MAX_BED_COUNT)
      .optional(),
    roomSize: z.number().positive().optional().nullable(),
    roomSizeUnit: z.nativeEnum(ROOM_SIZE_UNITS).optional(),
    facilities: z.array(z.nativeEnum(ROOM_FACILITIES)).max(ROOM_RULES.MAX_FACILITIES).optional(),
    basePrice: z
      .number()
      .int('Base price in paise must be an integer')
      .positive()
      .min(ROOM_RULES.MIN_PRICE_PAISE)
      .max(ROOM_RULES.MAX_PRICE_PAISE)
      .optional(),
    currency: z.literal('INR').optional(),
    pricingUnit: z.nativeEnum(ROOM_PRICING_UNITS).optional(),
    coverMediaId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional()
      .nullable(),
    galleryMediaIds: z
      .array(z.string().trim().regex(/^[0-9a-fA-F]{24}$/))
      .max(ROOM_RULES.MAX_GALLERY_MEDIA)
      .optional(),
    status: z.nativeEnum(ROOM_STATUSES).optional(),
    totalUnits: z
      .number()
      .int()
      .min(1)
      .max(ROOM_RULES.MAX_INVENTORY_UNITS)
      .optional(),
  })
  .strict({ message: 'Unrecognized fields in update room type payload' })
  .refine(
    (data) => {
      if (data.maxOccupancy !== undefined && data.maxAdults !== undefined) {
        return data.maxOccupancy >= data.maxAdults;
      }
      return true;
    },
    {
      message: 'Max occupancy must be greater than or equal to max adults',
      path: ['maxOccupancy'],
    },
  );

export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;

export const roomTypeQuerySchema = z
  .object({
    status: z.nativeEnum(ROOM_STATUSES).optional(),
    roomCategory: z.nativeEnum(ROOM_CATEGORIES).optional(),
    page: z.coerce.number().int().min(1).max(ROOM_RULES.MAX_PAGE).default(ROOM_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(ROOM_RULES.MAX_LIMIT).default(ROOM_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type RoomTypeQueryInput = z.infer<typeof roomTypeQuerySchema>;

export const inventoryQuerySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format').optional(),
    page: z.coerce.number().int().min(1).max(ROOM_RULES.MAX_PAGE).default(ROOM_RULES.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(ROOM_RULES.MAX_LIMIT).default(ROOM_RULES.DEFAULT_LIMIT),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>;

export const setInventorySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format'),
    totalUnits: z.number().int().min(0).max(ROOM_RULES.MAX_INVENTORY_UNITS),
    blockedUnits: z.number().int().min(0).default(0),
    maintenanceUnits: z.number().int().min(0).default(0),
  })
  .strict({ message: 'Unrecognized fields in inventory payload' })
  .refine((data) => data.totalUnits >= data.blockedUnits + data.maintenanceUnits, {
    message: 'Total units must be greater than or equal to blocked units plus maintenance units',
    path: ['totalUnits'],
  });

export type SetInventoryInput = z.infer<typeof setInventorySchema>;

export const updateInventorySchema = z
  .object({
    totalUnits: z.number().int().min(0).max(ROOM_RULES.MAX_INVENTORY_UNITS).optional(),
    blockedUnits: z.number().int().min(0).optional(),
    maintenanceUnits: z.number().int().min(0).optional(),
  })
  .strict({ message: 'Unrecognized fields in update inventory payload' });

export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>;

export const blockDatesSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format'),
    unitsToBlock: z.number().int().min(1).max(ROOM_RULES.MAX_INVENTORY_UNITS).default(1),
    blockType: z.nativeEnum(ROOM_INVENTORY_BLOCK_TYPES).default('MAINTENANCE'),
    reason: z.string().trim().max(500).optional(),
  })
  .strict({ message: 'Unrecognized fields in block dates payload' });

export type BlockDatesInput = z.infer<typeof blockDatesSchema>;

export const unblockDatesSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format'),
    unitsToUnblock: z.number().int().min(1).max(ROOM_RULES.MAX_INVENTORY_UNITS).default(1),
    blockType: z.nativeEnum(ROOM_INVENTORY_BLOCK_TYPES).default('MAINTENANCE'),
  })
  .strict({ message: 'Unrecognized fields in unblock dates payload' });

export type UnblockDatesInput = z.infer<typeof unblockDatesSchema>;

export const publicAvailabilityQuerySchema = z
  .object({
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Check-in date must be in YYYY-MM-DD format'),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Check-out date must be in YYYY-MM-DD format'),
    adults: z.coerce.number().int().min(1).max(20).default(1),
    children: z.coerce.number().int().min(0).max(20).default(0),
    rooms: z.coerce.number().int().min(1).max(20).default(1),
  })
  .strict({ message: 'Unrecognized availability query parameters' });

export type PublicAvailabilityQueryInput = z.infer<typeof publicAvailabilityQuerySchema>;

// Day 23 Booking Engine & Inventory Hold Schemas
export const guestDetailsSchema = z
  .object({
    primaryGuestName: z
      .string({ required_error: 'Primary guest name is required' })
      .trim()
      .min(
        BOOKING_HOLD_RULES.MIN_NAME_LENGTH,
        `Primary guest name must be at least ${BOOKING_HOLD_RULES.MIN_NAME_LENGTH} characters`,
      )
      .max(
        BOOKING_HOLD_RULES.MAX_NAME_LENGTH,
        `Primary guest name cannot exceed ${BOOKING_HOLD_RULES.MAX_NAME_LENGTH} characters`,
      ),
    email: z
      .string({ required_error: 'Guest email is required' })
      .trim()
      .email('Invalid email address')
      .toLowerCase(),
    phone: z
      .string({ required_error: 'Guest phone is required' })
      .trim()
      .min(10, 'Guest phone must be at least 10 characters')
      .max(20, 'Guest phone cannot exceed 20 characters'),
    specialRequests: z
      .string()
      .trim()
      .max(500, 'Special requests cannot exceed 500 characters')
      .optional()
      .nullable(),
  })
  .strict({ message: 'Unrecognized guest details fields' });

export type GuestDetailsInput = z.infer<typeof guestDetailsSchema>;

export const createBookingHoldSchema = z
  .object({
    propertyId: z
      .string({ required_error: 'Property ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Property ID must be a valid 24-character hexadecimal ObjectId'),
    roomTypeId: z
      .string({ required_error: 'Room type ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Room type ID must be a valid 24-character hexadecimal ObjectId'),
    checkInDate: z
      .string({ required_error: 'Check-in date is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Check-in date must be in YYYY-MM-DD format'),
    checkOutDate: z
      .string({ required_error: 'Check-out date is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Check-out date must be in YYYY-MM-DD format'),
    numberOfRooms: z
      .number({ required_error: 'Number of rooms is required' })
      .int('Number of rooms must be an integer')
      .min(BOOKING_HOLD_RULES.MIN_ROOMS, `Number of rooms must be at least ${BOOKING_HOLD_RULES.MIN_ROOMS}`)
      .max(BOOKING_HOLD_RULES.MAX_ROOMS, `Number of rooms cannot exceed ${BOOKING_HOLD_RULES.MAX_ROOMS}`),
    adults: z
      .number({ required_error: 'Number of adults is required' })
      .int('Number of adults must be an integer')
      .min(BOOKING_HOLD_RULES.MIN_ADULTS, `Number of adults must be at least ${BOOKING_HOLD_RULES.MIN_ADULTS}`)
      .max(BOOKING_HOLD_RULES.MAX_ADULTS, `Number of adults cannot exceed ${BOOKING_HOLD_RULES.MAX_ADULTS}`),
    children: z
      .number()
      .int('Number of children must be an integer')
      .min(BOOKING_HOLD_RULES.MIN_CHILDREN, 'Number of children cannot be negative')
      .max(BOOKING_HOLD_RULES.MAX_CHILDREN, `Number of children cannot exceed ${BOOKING_HOLD_RULES.MAX_CHILDREN}`)
      .default(0),
    guestDetails: guestDetailsSchema,
  })
  .strict({ message: 'Unrecognized fields in booking hold request' });

export type CreateBookingHoldInput = z.infer<typeof createBookingHoldSchema>;

export const holdIdParamSchema = z
  .object({
    holdId: z
      .string({ required_error: 'Hold ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Hold ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized parameters' });

export type HoldIdParamInput = z.infer<typeof holdIdParamSchema>;

export const bookingIdParamSchema = z
  .object({
    bookingId: z
      .string({ required_error: 'Booking ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Booking ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized parameters' });

export type BookingIdParamInput = z.infer<typeof bookingIdParamSchema>;

// Day 24 — Payment Validation Schemas
export const verifyPaymentSignatureSchema = z
  .object({
    paymentId: z
      .string({ required_error: 'Payment ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Payment ID must be a valid 24-character hexadecimal ObjectId'),
    razorpay_order_id: z
      .string({ required_error: 'Razorpay order ID is required' })
      .trim()
      .min(1, 'Razorpay order ID cannot be empty'),
    razorpay_payment_id: z
      .string({ required_error: 'Razorpay payment ID is required' })
      .trim()
      .min(1, 'Razorpay payment ID cannot be empty'),
    razorpay_signature: z
      .string({ required_error: 'Razorpay signature is required' })
      .trim()
      .min(1, 'Razorpay signature cannot be empty'),
  })
  .strict({ message: 'Unrecognized fields in payment verification request' });

export type VerifyPaymentSignatureInput = z.infer<typeof verifyPaymentSignatureSchema>;

export const paymentIdParamSchema = z
  .object({
    paymentId: z
      .string({ required_error: 'Payment ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Payment ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized parameters' });

export type PaymentIdParamInput = z.infer<typeof paymentIdParamSchema>;

export const paymentQueryFilterSchema = z
  .object({
    status: z.string().trim().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type PaymentQueryFilterInput = z.infer<typeof paymentQueryFilterSchema>;

// ============================================================================
// NOTIFICATION & DEVICE SCHEMAS (DAY 26)
// ============================================================================

export const registerDeviceSchema = z
  .object({
    deviceToken: z
      .string({ required_error: 'Device token is required' })
      .trim()
      .min(10, 'Device token must be at least 10 characters')
      .max(500, 'Device token cannot exceed 500 characters'),
    platform: z.enum([DEVICE_PLATFORMS.ANDROID, DEVICE_PLATFORMS.IOS], {
      errorMap: () => ({ message: 'Platform must be either ANDROID or IOS' }),
    }),
    deviceId: z
      .string()
      .trim()
      .max(100, 'Device ID cannot exceed 100 characters')
      .optional(),
  })
  .strict({ message: 'Unrecognized fields in device registration request' });

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const deviceIdParamSchema = z
  .object({
    deviceId: z
      .string({ required_error: 'Device ID is required' })
      .trim()
      .min(1, 'Device ID cannot be empty'),
  })
  .strict({ message: 'Unrecognized parameters' });

export type DeviceIdParamInput = z.infer<typeof deviceIdParamSchema>;

export const listNotificationsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(NOTIFICATION_RULES.MAX_LIMIT).default(NOTIFICATION_RULES.DEFAULT_LIMIT),
    isRead: z.enum(['true', 'false', 'all']).optional(),
  })
  .strict({ message: 'Unrecognized query parameters' });

export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamSchema = z
  .object({
    notificationId: z
      .string({ required_error: 'Notification ID is required' })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Notification ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict({ message: 'Unrecognized parameters' });

export type NotificationIdParamInput = z.infer<typeof notificationIdParamSchema>;

export const updateNotificationPreferencesSchema = z
  .object({
    bookingUpdates: z.boolean().optional(),
    paymentUpdates: z.boolean().optional(),
    socialUpdates: z.boolean().optional(),
  })
  .strict({ message: 'Unrecognized preference fields' });

export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;






