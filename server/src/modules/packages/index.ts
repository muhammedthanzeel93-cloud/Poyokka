export {
  TravelPackageModel,
  travelPackageSchema,
} from './package.model';
export type {
  ITravelPackageDocument,
  IItineraryDaySubdocument,
  IPackageGroupPricingSubdocument,
} from './package.model';

export { packageRepository, PackageRepository } from './package.repository';
export { packageService, PackageService } from './package.service';
export { packageController, PackageController } from './package.controller';

export {
  businessPackageRoutes,
  publicPackageRoutes,
  adminPackageRoutes,
} from './package.routes';

export type {
  PackageLean,
  IItineraryDay,
  IPackageGroupPricingTier,
  CreatePackagePersistenceInput,
  UpdatePackagePersistenceInput,
  PackageQueryFilters,
  PaginatedPackagesResult,
} from './package.types';

export * from './package.validation';
