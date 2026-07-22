# Stamp Field Type Implementation Summary

## Overview

This implementation adds a new **STAMP** field type to Documenso, an open-source document signing platform. The STAMP field allows users to upload and place image stamps (PNG/JPG) on documents, with support for resizing, rotation, multi-page placement, zoom accuracy, persistent state, and PDF embedding.

**Issue Reference:** [#2087 - Add a Stamp Field Type](https://github.com/documenso/documenso/issues/2087)

---

## Architecture & Design Decisions

The STAMP field follows the same architectural patterns as existing field types (SIGNATURE, TEXT, CHECKBOX, etc.) in Documenso's codebase:

1. **Prisma enum + migration** for the database layer
2. **Zod schemas** for type-safe validation at every boundary
3. **Discriminated unions** for exhaustive type matching
4. **Konva.js renderer** for canvas-based field rendering (editor, signing, and PDF export)
5. **Signature model reuse** — stores the stamp image as `signatureImageAsBase64` in the existing `Signature` table (same approach as SIGNATURE fields)
6. **pdf-lib** for PDF embedding with precise coordinate mapping

### Key Design Choice: Reusing the Signature Model

Rather than creating a new database model, the STAMP field reuses the existing `Signature` model's `signatureImageAsBase64` column to store stamp images. This is architecturally consistent with how SIGNATURE fields work and avoids unnecessary schema complexity.

---

## Files Changed (21 modified + 5 new = 26 total)

### New Files Created (5)

| File | Purpose |
|------|---------|
| `apps/remix/app/components/dialogs/sign-field-stamp-dialog.tsx` | Dialog for uploading stamp images with preview, rotation control, and validation (PNG/JPG, max 5MB) |
| `apps/remix/app/components/forms/editor/editor-field-stamp-form.tsx` | Editor settings form for configuring default rotation on stamp fields |
| `apps/remix/app/utils/field-signing/stamp-field.ts` | Click handler for stamp field signing — opens the upload dialog and returns the image data |
| `packages/lib/universal/field-renderer/render-stamp-field.ts` | Konva.js renderer for stamp fields — handles image display with rotation, aspect ratio preservation, both in browser (HTMLImageElement) and server (skia-canvas) |
| `packages/prisma/migrations/20260723120000_add_stamp_field_type/migration.sql` | Database migration to add STAMP to the FieldType enum |

### Modified Files (21)

#### Schema & Type System (5 files)
| File | Changes |
|------|---------|
| `packages/prisma/schema.prisma` | Added `STAMP` to `FieldType` enum |
| `packages/lib/types/field-meta.ts` | Added `ZStampFieldMeta` schema (with rotation), `TStampFieldMeta` type, `FIELD_STAMP_META_DEFAULT_VALUES`, updated all discriminated unions (`ZFieldMetaNotOptionalSchema`, `ZFieldAndMetaSchema`, `ZEnvelopeFieldAndMetaSchema`), updated `FIELD_META_DEFAULT_VALUES` record |
| `packages/lib/types/field.ts` | Added `ZFieldStampSchema`, `TFieldStamp` type, added to `ZFullFieldSchema` discriminated union |
| `packages/ui/primitives/document-flow/types.ts` | Added `STAMP` to `FRIENDLY_FIELD_TYPE` record |
| `packages/lib/utils/fields.ts` | Added `STAMP` to `getClientSideFieldTranslations` |

#### Field Picker & Editor (4 files)
| File | Changes |
|------|---------|
| `apps/remix/.../envelope-editor-fields-drag-drop.tsx` | Added Stamp button to `fieldButtonList` with `ImagePlusIcon` |
| `apps/remix/.../envelope-editor-fields-page.tsx` | Added STAMP to `FieldSettingsTypeTranslations`, imported `TStampFieldMeta` and `EditorFieldStampForm`, added STAMP match case for editor settings panel |
| `packages/ui/primitives/field-selector.tsx` | Added Stamp to `fieldTypes` array with `ImagePlus` icon |
| `packages/ui/primitives/document-flow/field-item.tsx` | Added `STAMP` to `advancedField` list for showing settings toolbar |

#### Signing Flow (6 files)
| File | Changes |
|------|---------|
| `packages/trpc/server/envelope-router/sign-envelope-field.types.ts` | Added STAMP to `ZSignEnvelopeFieldValue` discriminated union |
| `packages/trpc/server/envelope-router/sign-envelope-field.ts` | Added STAMP to assistant restriction check, STAMP image extraction, STAMP signature upsert (reusing Signature model), STAMP audit log matching |
| `packages/lib/server-only/field/sign-field-with-token.ts` | Extended `isSignatureField` check to include STAMP, updated audit log match to include STAMP |
| `packages/lib/utils/envelope-signing.ts` | Added STAMP case to `extractFieldInsertionValues` |
| `apps/remix/.../envelope-signer-page-renderer.tsx` | Added STAMP click handler dispatch using `handleStampFieldClick` |
| `apps/remix/.../envelope-editor-preview-page.tsx` | Added STAMP case for preview rendering |

#### Rendering (3 files)
| File | Changes |
|------|---------|
| `packages/lib/universal/field-renderer/render-field.ts` | Added STAMP case to `renderField` pattern match, imported `renderStampFieldElement` |
| `packages/ui/primitives/document-flow/field-content.tsx` | Added STAMP image rendering with rotation support in field content component |

#### PDF Embedding (1 file)
| File | Changes |
|------|---------|
| `packages/lib/server-only/pdf/insert-field-in-pdf-v1.ts` | Added STAMP image embedding with aspect ratio preservation, rotation, and page rotation handling. V2 embedding works automatically via `renderField`→`renderStampFieldElement` |

#### Other Integration Points (3 files)
| File | Changes |
|------|---------|
| `packages/lib/server-only/pdf/helpers.ts` | Added STAMP to `parseFieldTypeFromPlaceholder` and `parseFieldMetaFromPlaceholder` |
| `packages/lib/server-only/template/create-document-from-direct-template.ts` | Added STAMP to audit log field type matching |
| `packages/prisma/seed/documents.ts` | Added STAMP to seed data field meta defaults |

---

## Feature Details

### 1. Field Creation & Placement
- STAMP appears in the field picker palette alongside other field types
- Drag-and-drop placement on any page of the document
- Resize via drag handles (aspect ratio of the uploaded image is preserved during rendering)
- Duplicate / duplicate-to-all-pages supported
- Advanced settings panel shows rotation configuration

### 2. Image Upload & Validation
- Upload dialog supports PNG and JPG formats
- Maximum file size: 5MB
- Image preview with rotation control (0-360° slider)
- Validates image can actually be loaded before accepting
- Natural image dimensions displayed in the preview

### 3. Resize & Rotation
- Field can be resized on the canvas via Rnd (react-rnd) drag handles
- Image renders with aspect ratio preservation (fits within field bounds)
- Rotation configurable via the editor settings panel (default rotation)
- Rotation also adjustable during signing via the stamp dialog slider
- Rotation persisted in field metadata

### 4. Multi-Page & Zoom Accuracy
- Fields use percentage-based positioning (relative to page dimensions)
- Position, size preserved across zoom levels
- Duplicate-to-all-pages places the stamp on every page
- Different stamp images can be placed on different pages

### 5. State Persistence
- Stamp image stored as base64 in the `Signature` model's `signatureImageAsBase64` column
- Field position (positionX, positionY), size (width, height), and page number stored in the `Field` model
- Rotation stored in `fieldMeta` JSON column
- All state survives page reloads and session changes
- `inserted` flag tracks whether the stamp has been placed

### 6. PDF Embedding
- **V1 path:** Uses `@cantoo/pdf-lib` to embed stamp image at precise PDF coordinates
  - Converts percentage-based positions to PDF coordinate space
  - Handles Y-axis inversion (PDF uses bottom-left origin)
  - Applies page rotation transformation
  - Applies stamp rotation
  - Preserves aspect ratio
- **V2 path:** Uses Konva + skia-canvas rendering pipeline (automatic via `renderField`)
  - Renders stamp with rotation on server-side Konva canvas
  - Canvas exported as PDF overlay and embedded into the page

### 7. Idiomatic Integration
- Follows the exact same patterns as existing field types
- Uses `ts-pattern` exhaustive matching consistently
- Uses Zod discriminated unions for type safety
- Uses `createCallable` from `react-call` for the signing dialog (same as signature)
- Uses Lingui i18n macros for all user-facing strings
- Reuses existing UI primitives (Dialog, Button, Slider, Input, Form)

---

## Testing Approach

The implementation integrates at every layer where existing field types are handled:
- TypeScript's exhaustive type checking (via `ts-pattern .exhaustive()`) ensures STAMP is handled wherever FieldType is matched
- Zod discriminated unions validate STAMP metadata at API boundaries
- The `Record<FieldType, ...>` type ensures STAMP has entries in all lookup tables

---

## Commit History

1. `feat: add Stamp field type for uploading and placing image stamps on documents` — Full implementation across 26 files (5 new + 21 modified)
2. This summary document
