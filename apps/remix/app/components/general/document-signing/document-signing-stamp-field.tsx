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
import { Loader, RotateCcw, RotateCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

import { DocumentSigningDisclosure } from '~/components/general/document-signing/document-signing-disclosure';

import { useRequiredDocumentSigningAuthContext } from './document-signing-auth-provider';
import { DocumentSigningFieldContainer } from './document-signing-field-container';
import { useDocumentSigningRecipientContext } from './document-signing-recipient-provider';

export type DocumentSigningStampFieldProps = {
  field: FieldWithSignature;
  onSignField?: (value: TSignFieldWithTokenMutationSchema) => Promise<void> | void;
  onUnsignField?: (value: TRemovedSignedFieldWithTokenMutationSchema) => Promise<void> | void;
};

const MAX_STAMP_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

/**
 * Reads a File as a base64 data URL and also returns the intrinsic image dimensions.
 * Rejects when the mime type is unsupported.
 */
const readImageFile = (
  file: File,
): Promise<{ dataUrl: string; naturalWidth: number; naturalHeight: number }> =>
  new Promise((resolve, reject) => {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      reject(new Error('Unsupported image type. Please upload a PNG or JPG image.'));
      return;
    }

    if (file.size > MAX_STAMP_UPLOAD_BYTES) {
      reject(new Error('Image is too large. Please upload an image smaller than 5MB.'));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';

      if (!dataUrl) {
        reject(new Error('Failed to read file'));
        return;
      }

      const img = new Image();
      img.onload = () =>
        resolve({
          dataUrl,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
      img.onerror = () => reject(new Error('Could not decode the image'));
      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });

/**
 * Signing UI for the STAMP field type.
 *
 * Lets the recipient upload a PNG/JPG image, preview it with rotation controls,
 * and commit the stamp. The image is stored on the Signature row alongside the
 * field (mirroring the SIGNATURE field storage path), and the rotation is
 * persisted on the field's fieldMeta so it survives reloads and zoom changes.
 */
export const DocumentSigningStampField = ({ field, onSignField, onUnsignField }: DocumentSigningStampFieldProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { revalidate } = useRevalidator();

  const { recipient } = useDocumentSigningRecipientContext();
  const { executeActionAuthProcedure } = useRequiredDocumentSigningAuthContext();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const safeFieldMeta = ZStampFieldMeta.safeParse(field.fieldMeta);
  const parsedFieldMeta = safeFieldMeta.success ? safeFieldMeta.data : null;
  const persistedRotation = parsedFieldMeta?.rotation ?? 0;

  const { signature } = field;

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const { mutateAsync: removeSignedFieldWithToken, isPending: isRemoveSignedFieldWithTokenLoading } =
    trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const isLoading = isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading;

  const [showStampModal, setShowStampModal] = useState(false);
  const [localStamp, setLocalStamp] = useState<string | null>(null);
  const [localRotation, setLocalRotation] = useState<number>(0);
  const [localAspectRatio, setLocalAspectRatio] = useState<number | undefined>(undefined);

  const onPreSign = () => {
    setLocalStamp(null);
    setLocalRotation(0);
    setLocalAspectRatio(undefined);
    setShowStampModal(true);
    // Return false so the container waits for the modal flow to commit.
    return false;
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const onFileSelected = async (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    // Reset value so selecting the same file twice still fires the change event.
    evt.target.value = '';

    if (!file) {
      return;
    }

    try {
      const { dataUrl, naturalWidth, naturalHeight } = await readImageFile(file);
      setLocalStamp(dataUrl);
      setLocalAspectRatio(naturalHeight > 0 ? naturalWidth / naturalHeight : undefined);
    } catch (err) {
      toast({
        title: _(msg`Error`),
        description: err instanceof Error ? err.message : _(msg`Could not read image`),
        variant: 'destructive',
      });
    }
  };

  const onDialogSignClick = () => {
    if (!localStamp) {
      return;
    }

    setShowStampModal(false);

    void executeActionAuthProcedure({
      onReauthFormSubmit: async (authOptions) => await onSign(authOptions, localStamp, localRotation, localAspectRatio),
      actionTarget: field.type,
    });
  };

  const onSign = async (
    authOptions?: TRecipientActionAuth,
    stampDataUrl?: string,
    rotation?: number,
    aspectRatio?: number,
  ) => {
    try {
      const value = stampDataUrl;

      if (!value) {
        setShowStampModal(true);
        return;
      }

      const payload: TSignFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
        value,
        isBase64: true,
        authOptions,
        stampMeta: {
          rotation: rotation ?? 0,
          aspectRatio,
        },
      };

      if (onSignField) {
        await onSignField(payload);
      } else {
        await signFieldWithToken(payload);
      }

      await revalidate();
    } catch (err) {
      const error = AppError.parseError(err);

      if (error.code === AppErrorCode.UNAUTHORIZED) {
        throw error;
      }

      console.error(err);

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while placing the stamp.`),
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
    } catch (err) {
      console.error(err);

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while removing the stamp.`),
        variant: 'destructive',
      });
    }
  };

  const rotateLeft = () => setLocalRotation((r) => (r - 90 + 360) % 360);
  const rotateRight = () => setLocalRotation((r) => (r + 90) % 360);

  return (
    <DocumentSigningFieldContainer field={field} onPreSign={onPreSign} onSign={onSign} onRemove={onRemove} type="Stamp">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background">
          <Loader className="h-5 w-5 animate-spin text-primary md:h-8 md:w-8" />
        </div>
      )}

      {!field.inserted && (
        <p className="flex items-center gap-x-1 text-muted-foreground text-xs duration-200 group-hover:text-recipient-green">
          <Upload className="h-3 w-3" />
          <Trans>Stamp</Trans>
        </p>
      )}

      {field.inserted && signature?.signatureImageAsBase64 && (
        <img
          src={signature.signatureImageAsBase64}
          alt="Stamp"
          className="h-full w-full object-contain"
          style={persistedRotation ? { transform: `rotate(${persistedRotation}deg)` } : undefined}
        />
      )}

      <Dialog open={showStampModal} onOpenChange={setShowStampModal}>
        <DialogContent>
          <DialogTitle>
            <Trans>Upload a stamp image</Trans>
          </DialogTitle>

          <div className="mt-2 flex flex-col items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={onFileSelected}
            />

            {!localStamp && (
              <button
                type="button"
                onClick={handlePickFile}
                className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm">
                  <Trans>Click to upload a PNG or JPG image</Trans>
                </span>
              </button>
            )}

            {localStamp && (
              <>
                <div className="flex h-48 w-full items-center justify-center overflow-hidden rounded border border-border bg-muted/30">
                  <img
                    src={localStamp}
                    alt="Stamp preview"
                    className="max-h-full max-w-full object-contain"
                    style={{ transform: `rotate(${localRotation}deg)` }}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={rotateLeft}>
                    <RotateCcw className="h-4 w-4" />
                    <span className="ml-1">
                      <Trans>Rotate left</Trans>
                    </span>
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={rotateRight}>
                    <RotateCw className="h-4 w-4" />
                    <span className="ml-1">
                      <Trans>Rotate right</Trans>
                    </span>
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={handlePickFile}>
                    <Trans>Replace</Trans>
                  </Button>
                </div>
              </>
            )}
          </div>

          <DocumentSigningDisclosure />

          <DialogFooter>
            <div className="flex w-full flex-1 flex-nowrap gap-4">
              <Button
                type="button"
                className="flex-1"
                variant="secondary"
                onClick={() => {
                  setShowStampModal(false);
                  setLocalStamp(null);
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button type="button" className="flex-1" disabled={!localStamp} onClick={onDialogSignClick}>
                <Trans>Place stamp</Trans>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DocumentSigningFieldContainer>
  );
};
