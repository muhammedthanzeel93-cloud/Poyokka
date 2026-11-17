export {
  createPropertySchema,
  updatePropertySchema,
  submitPropertyReviewSchema,
  reviewPropertySchema,
  propertyQuerySchema,
  publicPropertyQuerySchema,
  nearbyPropertyQuerySchema,
  propertyIdParamSchema,
  propertySlugParamSchema,
  geoCoordinatesSchema,
  propertyLocationSchema,
} from '@kerala-tourism/validation';

export type {
  CreatePropertyInput,
  UpdatePropertyInput,
  SubmitPropertyReviewInput,
  ReviewPropertyInput,
  PropertyQueryInput,
  PublicPropertyQueryInput,
  NearbyPropertyQueryInput,
  PropertyIdParamInput,
  PropertySlugParamInput,
} from '@kerala-tourism/validation';

/**
 * Normalizes title/name into a URL-safe, SEO-friendly slug
 */
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove non-word characters except spaces and hyphens
    .replace(/[\s_-]+/g, '-') // collapse whitespace and underscores into single hyphens
    .replace(/^-+|-+$/g, ''); // trim leading and trailing hyphens
};

/**
 * Escapes regex metacharacters in search queries to defeat ReDoS attacks
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
