# @civjs/shared

Shared TypeScript types and utilities for CivJS client and server.

## Purpose

This package contains shared types that are used by both the CivJS client and server applications. It's designed to work with separate Railway deployments where client and server are deployed independently.

## Structure

- `src/types/nations.ts` - Nation system type definitions
- `dist/` - Compiled JavaScript and TypeScript definitions (generated)

## Usage

### In Client or Server

```typescript
import { Nation, PlayerNationInfo, DiplomaticState } from '@civjs/shared';
```

## Deployment Notes

For Railway deployment:

1. The shared package is installed as a local dependency in both client and server
2. Each deployment copies the shared package as part of the build process
3. No external dependency on shared types during runtime

This approach ensures both applications can be deployed independently while sharing common types.

## Building

```bash
npm run build
```

This compiles TypeScript to JavaScript and generates type definitions in the `dist/` directory.