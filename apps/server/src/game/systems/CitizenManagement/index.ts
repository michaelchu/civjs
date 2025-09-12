/**
 * CitizenManagement System - Main exports
 * 
 * Provides intelligent citizen assignment optimization following Freeciv's
 * Citizen Management (CM) system architecture.
 */

export { CitizenManagementService } from './CitizenManagementService';
export { CitizenParameterFactory, CitizenParameterUtils } from './CitizenParameter';
export { CitizenResultFactory, CitizenResultUtils } from './CitizenResult';
export { CitizenTileTypeFactory, CitizenTileTypeUtils } from './CitizenTileType';

export type { CitizenParameter } from './CitizenParameter';
export type { CitizenResult } from './CitizenResult';
export type { CitizenTileType } from './CitizenTileType';