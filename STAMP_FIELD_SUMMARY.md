# Stamp Field Type — Implementation Summary

Implements the **Stamp image field type** for Documenso, per issue
[#2087](https://github.com/documenso/documenso/issues/2087): *"Add a Stamp
Field Type to allow uploading and placing image stamps on documents."*

A stamp is an author-placed image (PNG/JPG) that can be positioned, resized
(aspect-ratio preserved), and rotated in the editor, is persisted across
reload, and is embedded into the sealed PDF at the exact position, size, and
rotation shown in the editor.

## What the feature does

- **New field type** — `STAMP` added to the `FieldType` enum, selectable from
  the envelope editor's field palette (dedicated icon + label).
- **Image upload** — Author uploads a PNG/JPG in the stamp settings panel.
  Files are validated by mime type (PNG/JPG only, matching what pdf-lib can
  embed) and size (max 5 MB). A live preview (with the current rotation
  applied) is shown.
- **Placement & move** — Placed and dragged on the Konva canvas exactly like
  every other field.
- **Resize (aspect preserved)** — The image is fitted inside the field bounds
  while its aspect ratio is preserved, both while resizing and at rest.
- **Rotation** — Rotation (0–360°) is set via a numeric input / quick 90°
  button and applied about the image centre.
- **Multi-page & zoom** — Positions/sizes are stored as page percentages
  (the repo's existing convention), so stamps stay accurate across pages and
  zoom levels.
- **Persistence** — The image (base64 data URL), its intrinsic dimensions, and
  rotation live in `fieldMeta`, which is persisted as JSON on the `Field`
  record. Round-trips through save/reload with no extra file storage.
- **PDF embedding** — On sealing, the stamp is embedded via pdf-lib
  (`embedPng`/`embedJpg`) with the correct bottom-left-origin y-flip and
  centre-anchored rotation so the output matches the editor.

## Design decisions

- **Author-filled, not recipient-signed.** A stamp needs no recipient action,
  so `isRequiredField` returns `false` for it (it never blocks completion), and
  the signing click handler treats it as a no-op. Stamps carrying an image are
  auto-sealed even when not flagged `inserted`.
- **Image stored in `fieldMeta`.** Keeps the field self-contained and satisfies
  the persistence requirement without introducing new upload/storage plumbing.
- **Reuses existing rendering paths.** The Konva renderer plugs into the same
  `renderField` dispatch used by the editor, signing, and the v2 export
  pipeline, and the v1 sealing path gains a single `STAMP` match arm.

## Files changed

### Schema & types
- `packages/prisma/schema.prisma` — add `STAMP` to `FieldType`.
- `packages/prisma/migrations/20260722120000_add_stamp_field_type/migration.sql`
  — `ALTER TYPE "FieldType" ADD VALUE 'STAMP'`.
- `packages/lib/types/field-meta.ts` — `ZStampFieldMeta` (`imageBase64`,
  `imageWidth`, `imageHeight`, `rotation`), defaults, and registration in
  every field-meta union / default-value map.
- `packages/lib/types/field.ts` — `ZFieldStampSchema` in the full field union.
- `packages/lib/types/document-audit-logs.ts` — `STAMP` in the inserted /
  prefilled field audit unions.

### Editor UI
- `apps/remix/app/components/general/envelope-editor/envelope-editor-fields-drag-drop.tsx`
  — palette entry + `StampIcon`.
- `apps/remix/app/components/forms/editor/editor-field-stamp-form.tsx` (new) —
  upload/validation/preview + rotation controls.
- `apps/remix/app/components/general/envelope-editor/envelope-editor-fields-page.tsx`
  — settings-panel dispatch + settings title.
- `apps/remix/app/components/general/envelope-editor/envelope-editor-preview-page.tsx`
  — preview placeholder case.
- `packages/ui/primitives/document-flow/types.ts` — friendly type label.
- `packages/lib/utils/fields.ts` — client-side translation label.

### Rendering
- `packages/lib/universal/field-renderer/render-stamp-field.ts` (new) — Konva
  renderer (aspect-fit, centre rotation, sharp caching, browser + skia-canvas).
- `packages/lib/universal/field-renderer/render-field.ts` — dispatch arm.

### Signing & sealing
- `packages/lib/utils/advanced-fields-helpers.ts` — stamps are never required.
- `apps/remix/app/components/general/envelope-signing/envelope-signer-page-renderer.tsx`
  — no-op click handler.
- `packages/lib/server-only/pdf/insert-field-in-pdf-v1.ts` — pdf-lib embed with
  y-flip + centre-anchored rotation + page-rotation handling.
- `packages/lib/jobs/definitions/internal/seal-document.handler.ts` — auto-seal
  stamps carrying an image.

### Exhaustiveness fixes for the new enum member
- `packages/lib/server-only/field/sign-field-with-token.ts`
- `packages/trpc/server/envelope-router/sign-envelope-field.ts`
- `packages/lib/server-only/template/create-document-from-direct-template.ts`
- `packages/api/v1/implementation.ts`

## Verification

- `packages/lib`, `packages/ui`, `packages/api`, and `apps/remix` typecheck
  clean for all stamp-touched files (`tsc --noEmit`). The only remaining
  diagnostics are pre-existing and unrelated to this change (e.g. a couple of
  Subscription/Team Prisma-where mismatches and route-typegen `any` noise).

## Known limitations / follow-ups

- Coverage is intentionally focused on the primary lifecycle: create → place →
  upload → resize/rotate → persist → embed. Edge polish such as an on-canvas
  rotation handle (rotation is currently driven from the settings panel),
  richer legacy-editor parity, and dedicated e2e tests are natural next steps.
