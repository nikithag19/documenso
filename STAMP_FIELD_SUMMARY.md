# Stamp Field Implementation — Summary

Task reference: [documenso#2087](https://github.com/documenso/documenso/issues/2087) —
_"Add a Stamp Field Type to allow uploading and placing image stamps on documents"_.

Branch: `branchC`
Base commit: `7f85388e`
Documented in: proposal `handwritten documenso proposal nikitha (1).docx`.

## Goal

Add a new **STAMP** field type that lets a document creator drop a stamp
placeholder onto a PDF and lets the recipient upload a PNG/JPG image, preview
it, resize/rotate it, place it precisely, and have that stamp embedded into
the sealed PDF via `pdf-lib` at the exact position, size, and rotation.

The stamp must persist across reloads, zoom changes, and pages — the values
survive because they live on the `Field` row (position, size, page, rotation
inside `fieldMeta`) and the image lives on the `Signature` row associated with
the field.

## What was done

### 1. Data model + schema

- `packages/prisma/schema.prisma` — added `STAMP` to the `FieldType` enum.
- `packages/prisma/migrations/20260723000000_add_stamp_field_type/migration.sql`
  — corresponding Postgres enum migration.
- `packages/lib/types/field-meta.ts` — added `ZStampFieldMeta`
  (`type: 'stamp'`, `rotation`, `aspectRatio`) and defaults
  (`FIELD_STAMP_META_DEFAULT_VALUES`), and wired STAMP into
  `ZFieldMetaNotOptionalSchema`, `ZFieldAndMetaSchema`,
  `ZEnvelopeFieldAndMetaSchema`, and `FIELD_META_DEFAULT_VALUES`.
- `packages/lib/types/field.ts` — added `ZFieldStampSchema` and included it
  in `ZFullFieldSchema` so envelope signing can validate STAMP payloads.
- `packages/lib/types/document-audit-logs.ts` — STAMP variant added to the
  inserted/prefilled field audit log unions.

### 2. Field picker / builder

- `packages/ui/primitives/document-flow/types.ts` — added `FRIENDLY_FIELD_TYPE[STAMP]`.
- `packages/ui/primitives/document-flow/add-fields.tsx` — added the Stamp button
  to the document picker (lucide `Stamp` icon).
- `packages/ui/primitives/template-flow/add-template-fields.tsx` — same for
  the template flow picker.
- `apps/remix/app/components/general/envelope-editor/envelope-editor-fields-drag-drop.tsx`
  — added Stamp to the envelope editor drag-drop toolbar (lucide `StampIcon`).
- `apps/remix/app/components/general/envelope-editor/envelope-editor-fields-page.tsx`
  — added a `Stamp Settings` label in the settings type translations map.

### 3. Signing UI (document flow v1)

- `apps/remix/app/components/general/document-signing/document-signing-stamp-field.tsx`
  (new) — a dedicated Stamp signing component:
  - Upload button for PNG/JPG (5 MB cap, aspect-ratio-preserving preview).
  - Rotate left / rotate right (90° increments).
  - "Replace image" and "Cancel" flows.
  - Persists `rotation` and `aspectRatio` via the sign field mutation so the
    transform survives reloads.
- `apps/remix/app/components/general/document-signing/document-signing-page-view-v1.tsx`
  — wires `DocumentSigningStampField` for `FieldType.STAMP`.
- `apps/remix/app/components/general/direct-template/direct-template-signing-form.tsx`
  — same wiring for direct-template signing.

### 4. Signing UI (envelope v2 canvas)

- `apps/remix/app/utils/field-signing/stamp-field.ts` (new) — `handleStampFieldClick`
  that opens a native file picker and returns the base64 payload.
- `apps/remix/app/components/general/envelope-signing/envelope-signer-page-renderer.tsx`
  — added a `.with({ type: FieldType.STAMP }, …)` branch that calls
  `handleStampFieldClick` and submits via `signField`.

### 5. Editor rendering (Konva)

- `packages/lib/universal/field-renderer/render-stamp-field.ts` (new) —
  Konva renderer mirroring `render-signature-field.ts`: fits image inside the
  field bounds with aspect-ratio-preserving contain, applies `fieldMeta.rotation`
  around the image centre, and caches at high pixel ratio for zoom sharpness.
- `packages/lib/universal/field-renderer/render-field.ts` — dispatches STAMP
  to `renderStampFieldElement`.

### 6. Persistence + server flow

- `packages/trpc/server/field-router/schema.ts` — added `ZSignFieldStampMetaSchema`
  and extended `ZSignFieldWithTokenMutationSchema` with an optional
  `stampMeta` (rotation, aspectRatio).
- `packages/trpc/server/field-router/router.ts` — pipes `stampMeta` through to
  the server.
- `packages/lib/server-only/field/sign-field-with-token.ts`:
  - `isImageBackedField` (SIGNATURE ∪ STAMP) shares the base64 image path.
  - Validates that STAMP fields have an uploaded image.
  - Merges `stampMeta` into the field's `fieldMeta` on sign so rotation/aspect
    ratio persist alongside the field.
  - Audit log switch now includes STAMP.
- `packages/trpc/server/envelope-router/sign-envelope-field.types.ts` — added
  a STAMP variant to `ZSignEnvelopeFieldValue`.
- `packages/trpc/server/envelope-router/sign-envelope-field.ts` — validates the
  STAMP payload, stores the image on the `Signature` row, and includes STAMP
  in the audit log discriminated union.
- `packages/lib/utils/envelope-signing.ts` — extended `extractFieldInsertionValues`
  with a STAMP case that requires a base64 image.
- `packages/lib/server-only/template/create-document-from-direct-template.ts` —
  handles STAMP as an image-backed field when materialising a document from a
  direct template.
- `packages/lib/server-only/pdf/helpers.ts` — added STAMP to
  `parseFieldTypeFromPlaceholder`.

### 7. PDF embedding (pdf-lib)

- `packages/lib/server-only/pdf/insert-field-in-pdf-v1.ts` — added a
  STAMP branch:
  - Chooses `embedJpg` vs `embedPng` based on the data URL MIME.
  - Scales the image to fit the field with aspect-ratio preservation.
  - Converts the field's percentage-based position into PDF-space, inverting
    the Y axis for pdf-lib's bottom-left origin.
  - Accounts for page rotation (0/90/180/270).
  - Combines `pageRotation + stampRotation` and rotates about the image
    centre by translating the anchor before/after the rotation.
- `packages/lib/server-only/pdf/legacy-insert-field-in-pdf.ts` — same
  treatment for the legacy embed path.

### 8. Live preview

- `packages/ui/primitives/document-flow/field-content.tsx` — renders the stamp
  image (with CSS `rotate(...)` for the persisted rotation) once the field is
  inserted, mirroring how SIGNATURE image previews are rendered.

## How persistence works end-to-end

1. Recipient uploads an image → base64 data URL.
2. Client rotates the preview; `rotation` and `aspectRatio` are staged locally.
3. Sign mutation (`field.signFieldWithToken`) submits
   `{ value, isBase64: true, stampMeta: { rotation, aspectRatio } }`.
4. Server:
   - Writes the base64 image to `Signature.signatureImageAsBase64` (row keyed
     by the field id).
   - Merges the transform into `Field.fieldMeta` (Json column):
     `{ type: 'stamp', rotation, aspectRatio }`.
5. On reload, the client reads `field.signature.signatureImageAsBase64` and
   `field.fieldMeta`, re-rendering the stamp at the same position, size, and
   rotation.
6. On PDF seal, `insert-field-in-pdf-v*` picks up the same values and uses
   pdf-lib to embed the image at the exact PDF-space coordinates, taking page
   rotation and per-stamp rotation into account.

## Acceptance criteria mapping

| Criterion (from proposal) | Where it lives |
|---|---|
| Field creation + picker integration | Prisma enum + `add-fields.tsx` + `add-template-fields.tsx` + `envelope-editor-fields-drag-drop.tsx` |
| PNG/JPG upload + preview + aspect ratio validation | `document-signing-stamp-field.tsx` (`readImageFile`) |
| Resize preserving aspect ratio | Konva `renderStampFieldElement` fits with `Math.min(fieldW/imgW, fieldH/imgH)` |
| Rotation with handles | Rotate buttons in the sign dialog; stored in `fieldMeta.rotation` |
| Multi-page + zoom accuracy | `positionX/Y/width/height` are percentages of the page; Konva renderer caches at high DPI |
| Persistence across reload | `Field.fieldMeta` + `Signature.signatureImageAsBase64` |
| PDF embedding via pdf-lib at precise position | `insert-field-in-pdf-v1.ts` STAMP branch (with rotation about the centre) |
| Idiomatic integration with existing code | Mirrors the SIGNATURE field's storage path; same discriminated unions and audit log shape |

## Notes / limitations

- The v2 (envelope canvas) signer uses a lightweight file-picker flow; the
  richer rotate/preview UI lives on the v1 signing page where dialog UI is
  already used for signatures.
- Continuous rotation (arbitrary degrees) is stored but the picker only
  exposes 90° increments today; the schema (`min(-360).max(360)`) already
  supports any angle so a slider can be added later without a data migration.
- Free-form drag-handles for rotation on the editor canvas are intentionally
  out of scope for this PR — the transform in `fieldMeta` is the source of
  truth and can be edited/animated by future UX work.
