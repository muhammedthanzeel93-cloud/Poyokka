export {
  createPackageSchema,
  updatePackageSchema,
  submitPackageReviewSchema,
  reviewPackageSchema,
  packageQuerySchema,
  packageSearchQuerySchema,
  packageIdParamSchema,
  itineraryDaySchema,
  groupPricingTierSchema,
} from '@kerala-tourism/validation';

export type {
  CreatePackageInput,
  UpdatePackageInput,
  SubmitPackageReviewInput,
  ReviewPackageInput,
  PackageQueryInput,
  PackageSearchQueryInput,
  PackageIdParam,
  ItineraryDayInput,
  GroupPricingTierInput,
} from '@kerala-tourism/validation';

/**
 * Generates an SEO-friendly URL slug from a package title.
 * Strips special characters, converts spaces and underscores to hyphens.
 */
export const slugify = (text: string): string => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

/**
 * Escapes characters with special meaning in RegExp to prevent ReDoS or injection attacks.
 */
export const escapeRegex = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
