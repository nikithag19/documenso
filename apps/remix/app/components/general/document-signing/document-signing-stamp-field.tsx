import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import { ZStampFieldMeta } from '@documenso/lib/types/field-meta';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { trpc } from '@documenso/trpc/react';
import type {
  TRemovedSignedFieldWithTokenMutationSchema,
  TSignFieldWithTokenMutationSchema,
} from '@documenso/trpc/server/field-router/schema';
import { Button } from '@documenso/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ImageIcon, Loader } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

import { useRequiredDocumentSigningAuthContext } from './document-signing-auth-provider';
import { DocumentSigningFieldContainer } from './document-signing-field-container';
import {
  DocumentSigningFieldsInserted,
  DocumentSigningFieldsLoader,
  DocumentSigningFieldsUninserted,
} from './document-signing-fields';
import { useDocumentSigningRecipientContext } from './document-signing-recipient-provider';

const MAX_STAMP_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED_STAMP_MIME_TYPES = ['image/png', 'image/jpeg'];

export type DocumentSigningStampFieldProps = {
  field: FieldWithSignature;
  onSignField?: (value: TSignFieldWithTokenMutationSchema) => Promise<void> | void;
  onUnsignField?: (value: TRemovedSignedFieldWithTokenMutationSchema) => Promise<void> | void;
};

/**
 * Signing UI for a STAMP field. Lets the recipient upload a PNG/JPG image
 * which becomes the stamp burned into the PDF.
 *
 * The uploaded image is persisted through the same Signature relation used
 * for image-based signatures (see sign-field-with-token.ts) — this way the
 * PDF sealing/embedding pipeline picks up the base64 payload uniformly.
 */
export const DocumentSigningStampField = ({
  field,
  onSignField,
  onUnsignField,
}: DocumentSigningStampFieldProps) => {
  const { toast } = useToast();
  const { _ } = useLingui();
  const { revalidate } = useRevalidator();

  const { recipient } = useDocumentSigningRecipientContext();
  const { executeActionAuthProcedure } = useRequiredDocumentSigningAuthContext();

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const { mutateAsync: removeSignedFieldWithToken, isPending: isRemoveSignedFieldWithTokenLoading } =
    trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const isLoading = isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading;

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedMeta = useMemo(() => {
    const safe = ZStampFieldMeta.safeParse(field.fieldMeta);
    return safe.success ? safe.data : null;
  }, [field.fieldMeta]);

  const rotation = parsedMeta?.rotation ?? 0;

  const onPreSign = () => {
    setPreview(null);
    setShowUploadDialog(true);
    return false;
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read the uploaded stamp image'));
      reader.readAsDataURL(file);
    });

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_STAMP_MIME_TYPES.includes(file.type)) {
      toast({
        title: _(msg`Unsupported image`),
        description: _(msg`The stamp must be a PNG or JPG image.`),
        variant: 'destructive',
      });
      return;
    }

    if (file.size > MAX_STAMP_FILE_SIZE_BYTES) {
      toast({
        title: _(msg`Image too large`),
        description: _(msg`The stamp image must be smaller than 5MB.`),
        variant: 'destructive',
      });
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPreview(dataUrl);
    } catch (err) {
      toast({
        title: _(msg`Could not read image`),
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const onSign = async (authOptions?: TRecipientActionAuth) => {
    if (!preview) {
      toast({
        title: _(msg`No image selected`),
        description: _(msg`Please choose a PNG or JPG stamp image first.`),
        variant: 'destructive',
      });
      return;
    }

    try {
      const payload: TSignFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
        value: preview,
        isBase64: true,
        authOptions,
      };

      if (onSignField) {
        await onSignField(payload);
      } else {
        await signFieldWithToken(payload);
      }

      setShowUploadDialog(false);
      setPreview(null);
      await revalidate();
    } catch (err) {
      const error = AppError.parseError(err);

      const errorMessage =
        error.code === AppErrorCode.UNAUTHORIZED
          ? _(msg`You are not authorized to sign this field.`)
          : _(msg`An error occurred while inserting the stamp.`);

      toast({
        title: _(msg`Error`),
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const onRemove = async () => {
    try {
      const payload: TRemovedSignedFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
      };

      if (onUnsignField) {
        await onUnsignField(payload);
      } else {
        await removeSignedFieldWithToken(payload);
      }

      await revalidate();
    } catch {
      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while removing the stamp.`),
        variant: 'destructive',
      });
    }
  };

  return (
    <DocumentSigningFieldContainer
      field={field}
      onPreSign={onPreSign}
      onSign={(authOptions) => executeActionAuthProcedure({ onReauthFormSubmit: onSign, actionTarget: field.type })}
      onRemove={onRemove}
      type="Stamp"
    >
      {isLoading && <DocumentSigningFieldsLoader />}

      {!field.inserted && (
        <DocumentSigningFieldsUninserted>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            <span className="text-xs">
              <Trans>Stamp</Trans>
            </span>
          </div>
        </DocumentSigningFieldsUninserted>
      )}

      {field.inserted && field.signature?.signatureImageAsBase64 && (
        <DocumentSigningFieldsInserted textAlign="center">
          <img
            src={field.signature.signatureImageAsBase64}
            alt="Uploaded stamp"
            className="max-h-full max-w-full object-contain"
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        </DocumentSigningFieldsInserted>
      )}

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogTitle>
            <Trans>Upload a stamp image</Trans>
          </DialogTitle>

          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
              <Trans>
                Choose a PNG or JPG image (max 5MB) to use as your stamp. The image aspect ratio is
                preserved when placed on the document.
              </Trans>
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_STAMP_MIME_TYPES.join(',')}
              onChange={onFileChange}
              className="text-sm"
            />

            {preview && (
              <div className="border-border flex items-center justify-center rounded border p-4">
                <img
                  src={preview}
                  alt="Stamp preview"
                  className="max-h-48 max-w-full object-contain"
                  style={{ transform: `rotate(${rotation}deg)` }}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowUploadDialog(false)} disabled={isLoading}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={() => void onSign()} disabled={!preview || isLoading}>
              {isLoading ? <Loader className="h-4 w-4 animate-spin" /> : <Trans>Apply stamp</Trans>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DocumentSigningFieldContainer>
  );
};
