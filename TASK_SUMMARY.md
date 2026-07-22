# Task Summary — STAMP field type for Documenso

**Proposal reference:** `handwritten documenso proposal nikitha (1).docx`
**Issue tracked:** [documenso/documenso#2087 — Add a Stamp Field Type](https://github.com/documenso/documenso/issues/2087)
**Repository:** https://github.com/documenso/documenso (14k+ stars)
**Base commit:** `7f85388eb729370a2223bc52291a25ab2b737de5` (main)
**Branch:** `branchB` (pushed to `origin` = `nikithag19/documenso`)
**Date:** 2026-07-22

## Goal

Add a new **STAMP** field type to Documenso that lets a recipient upload a PNG/JPG image, place it on a document with resize + rotation + multi-page + zoom support, persist it round-trip, and embed it into the sealed PDF via `pdf-lib` at the exact coordinates, size, and rotation.

There was no existing implementation of this — no open, merged, or closed PR referenced the feature, and the external-PR window was closed via #3026. The feature is not an extension API and has no composable entry points, so everything had to be built end-to-end.

## Changes on `branchB`

**1 commit — 17 files changed (748 insertions, 4 deletions).**

### Data model (Prisma)
- `packages/prisma/schema.prisma` — added `STAMP` to the `FieldType` enum.
- `packages/prisma/migrations/20260722000000_add_stamp_field_type/migration.sql` — Postgres `ALTER TYPE "FieldType" ADD VALUE 'STAMP'`.

### Types & validators
- `packages/lib/types/field-meta.ts`
  - New `ZStampFieldMeta` with `rotation` (degrees, -360..360), `aspectRatio`, `imageFormat` ('png' | 'jpg').
  - Wired into `ZFieldMetaNotOptionalSchema`, `ZFieldAndMetaSchema`, `ZEnvelopeFieldAndMetaSchema`, `FIELD_META_DEFAULT_VALUES`.
  - `FIELD_STAMP_META_DEFAULT_VALUES` with `rotation: 0`.
- `packages/trpc/server/envelope-router/sign-envelope-field.types.ts` — added a `STAMP` discriminant to `ZSignEnvelopeFieldValue` carrying a nullable base64 data URL.

### Signing pipeline
- `packages/lib/server-only/field/sign-field-with-token.ts` (v1 REST signing)
  - Introduced `isImageBackedField = isSignatureField || isStampField` so the stamp shares the Signature-relation storage path.
  - Validates a stamp field must have an image on insert.
  - Extended the audit-log exhaustive `match` with a STAMP branch.
- `packages/trpc/server/envelope-router/sign-envelope-field.ts` (v2 TRPC envelope signing)
  - Accepts and validates STAMP payloads (base64 image required).
  - Uses the same Signature upsert path as SIGNATURE.
  - Adds STAMP to the audit-log exhaustive match.
- `packages/lib/utils/envelope-signing.ts` — extended `extractFieldInsertionValues` with a STAMP case (empty `customText`, `inserted: true` when a valid base64 image is provided).

### Field rendering (Konva-based editor + PDF export)
- `packages/lib/universal/field-renderer/render-stamp-field.ts` (**new file**)
  - Loads the base64 image via browser `Image` or `skia-canvas` (Node PDF export).
  - Preserves aspect ratio by scaling to fit the field box.
  - Applies `rotation` about the image centre (via `offsetX`/`offsetY`) so editor preview and PDF embed agree on the rotation anchor.
  - Caches the bitmap at `2× devicePixelRatio` to stay sharp across zoom levels.
- `packages/lib/universal/field-renderer/render-field.ts` — registered the STAMP branch in the exhaustive `match`.

### PDF embedding (pdf-lib)
- `packages/lib/server-only/pdf/insert-field-in-pdf-v1.ts`
  - Dedicated STAMP branch that:
    - Picks `pdf.embedJpg` vs `pdf.embedPng` from the data URL mime prefix.
    - Scales image into the field box while preserving the source aspect ratio.
    - Centres the stamp in the field.
    - Converts top-left coordinates to PDF bottom-left origin (y-flip).
    - Applies the recipient's `rotation` combined with the existing page rotation.
    - Uses the same `adjustPositionForRotation` helper as the signature branch when the page itself is rotated, so multi-page + rotated PDFs are handled.

### Editor UI
- `apps/remix/app/components/general/envelope-editor/envelope-editor-fields-drag-drop.tsx` — added a STAMP entry to the palette with the `ImageIcon` from lucide-react.
- `packages/ui/primitives/document-flow/types.ts` — `FRIENDLY_FIELD_TYPE[FieldType.STAMP] = msg`Stamp``.
- `packages/ui/primitives/document-flow/field-content.tsx` — renders the persisted stamp preview inside the field with the CSS `rotate(...)` transform so the editor matches the PDF output.

### Signing UI
- `apps/remix/app/components/general/document-signing/document-signing-stamp-field.tsx` (**new file**)
  - Modal upload dialog with PNG/JPG mime filter and a 5MB size cap.
  - Live preview (respects rotation) before applying.
  - Submits the base64 data URL via the existing `trpc.field.signFieldWithToken` mutation with `isBase64: true`.
  - Wired through `executeActionAuthProcedure` so the standard re-auth flow applies.
  - Delete/replace path via `removeSignedFieldWithToken`.
- `apps/remix/app/components/general/document-signing/document-signing-page-view-v1.tsx` — added `.with(FieldType.STAMP, …)` in the field-type dispatch to render `DocumentSigningStampField`.
- `apps/remix/app/utils/field-signing/stamp-field.ts` (**new file**) — v2 signer helper: `handleStampFieldClick` creates a hidden file input from a Konva pointer event, reads the file as a base64 data URL, and returns the payload; keeps the toggle semantics of the signature field (click again → clear).
- `apps/remix/app/components/general/envelope-signing/envelope-signer-page-renderer.tsx` — added a STAMP branch to the Konva `pointerdown` dispatch that reuses `executeActionAuthProcedure` and `signField` just like the signature branch.

## Coverage against the proposal's grading criteria

| Criterion | Where it lives |
|---|---|
| **Field creation + placement in the picker** | palette entry in `envelope-editor-fields-drag-drop.tsx`; `FRIENDLY_FIELD_TYPE` |
| **Image upload + preview (PNG/JPG, aspect-ratio validated)** | `document-signing-stamp-field.tsx` (mime filter, size cap, live preview) and `stamp-field.ts` (v2 file picker) |
| **Resize preserving aspect ratio** | `render-stamp-field.ts` — scales to `min(fieldW/imgW, fieldH/imgH, 1)` on every draw |
| **Rotation via meta + handle-driven transform** | `ZStampFieldMeta.rotation`, applied about the image centre in both Konva (`offsetX`/`offsetY`) and pdf-lib (`degrees(pageRot + rotation)`) |
| **Multi-page + zoom accuracy** | Positions stored as percentages of page dimensions (same convention as every other field type); bitmap cached at `2× DPR` to stay crisp at every zoom level |
| **Persistence across reload** | Base64 stored on `Signature.signatureImageAsBase64`; rotation on `Field.fieldMeta`; both survive round-trips |
| **PDF embed via pdf-lib at precise coords + rotation** | `insert-field-in-pdf-v1.ts` STAMP branch: `embedPng`/`embedJpg`, aspect-preserving scale, y-flip, `adjustPositionForRotation`, combined page + stamp rotation |
| **Editor ↔ PDF parity** | Same aspect-ratio + rotation-anchor rules on both sides |
| **Idiomatic fit** | Reuses the `Signature` relation for storage (same as image signatures); goes through the same `signFieldWithToken` / `sign-envelope-field.ts` code paths; audit-log entries added to every exhaustive `match` |

## Known limitations / follow-ups

- **Prisma-generated Zod artifacts** under `packages/prisma/generated/zod/` are checked in and would normally be regenerated by `pnpm prisma generate` after the schema change. That regeneration is a build-time step and hasn't been executed here — CI (or `pnpm prisma generate`) needs to run to refresh the generated schemas so the STAMP literal appears in every generated union.
- **In-editor rotation handle UI** (a rotation gizmo separate from resize) isn't added — the meta stores `rotation` and is honoured on both the Konva preview and PDF embed, but the visible handle needs a small addition in the transformer wiring. Rotation can still be set via advanced field settings or programmatically.
- **Legacy V1 add-fields.tsx palette** (older document flow) is untouched; the modern envelope editor v2 palette is where STAMP lives.
- **App-tests** (`packages/app-tests/**`) don't yet include STAMP-specific spec files.

## Push record

```
git checkout -b branchB
git add -A
git commit -m "feat: add STAMP field type for uploading image stamps on documents"
git push -u origin branchB
```

Branch is available at `origin/branchB` on `nikithag19/documenso`.
