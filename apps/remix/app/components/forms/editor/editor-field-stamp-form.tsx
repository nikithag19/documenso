import {
  FIELD_STAMP_MAX_ROTATION,
  FIELD_STAMP_META_DEFAULT_VALUES,
  FIELD_STAMP_MIN_ROTATION,
  type TStampFieldMeta,
} from '@documenso/lib/types/field-meta';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { Trans, useLingui } from '@lingui/react/macro';
import { RotateCwIcon, UploadIcon } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * The accepted image mime types for a stamp. pdf-lib can only embed PNG and JPG,
 * so we restrict uploads to those formats.
 */
const ACCEPTED_STAMP_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

/**
 * The maximum stamp image size (5MB), matching the signature upload limit.
 */
const MAX_STAMP_FILE_SIZE = 5 * 1024 * 1024;

type EditorFieldStampFormProps = {
  value: TStampFieldMeta | undefined;
  onValueChange: (value: TStampFieldMeta) => void;
};

export const EditorFieldStampForm = ({ value, onValueChange }: EditorFieldStampFormProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const meta: TStampFieldMeta = value ?? FIELD_STAMP_META_DEFAULT_VALUES;

  const [rotation, setRotation] = useState(meta.rotation ?? 0);

  const emit = (partial: Partial<TStampFieldMeta>) => {
    onValueChange({
      ...meta,
      type: 'stamp',
      ...partial,
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    // Reset the input so selecting the same file again re-triggers the change.
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!ACCEPTED_STAMP_MIME_TYPES.includes(file.type)) {
      toast({
        title: t`Invalid file type`,
        description: t`Please upload a PNG or JPG image.`,
        variant: 'destructive',
      });

      return;
    }

    if (file.size > MAX_STAMP_FILE_SIZE) {
      toast({
        title: t`File too large`,
        description: t`The stamp image must be smaller than 5MB.`,
        variant: 'destructive',
      });

      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const imageBase64 = typeof reader.result === 'string' ? reader.result : '';

      if (!imageBase64) {
        return;
      }

      // Load the image to read its intrinsic dimensions so we can preserve the
      // aspect ratio when rendering and embedding.
      const img = new Image();

      img.onload = () => {
        emit({
          imageBase64,
          imageWidth: img.naturalWidth,
          imageHeight: img.naturalHeight,
        });
      };

      img.onerror = () => {
        toast({
          title: t`Invalid image`,
          description: t`The uploaded file could not be read as an image.`,
          variant: 'destructive',
        });
      };

      img.src = imageBase64;
    };

    reader.readAsDataURL(file);
  };

  const handleRotationChange = (nextRotation: number) => {
    const clamped = Math.min(FIELD_STAMP_MAX_ROTATION, Math.max(FIELD_STAMP_MIN_ROTATION, nextRotation));

    setRotation(clamped);
    emit({ rotation: clamped });
  };

  return (
    <fieldset className="mt-2 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>
          <Trans>Stamp Image</Trans>
        </Label>

        {meta.imageBase64 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
            <img
              src={meta.imageBase64}
              alt={t`Stamp preview`}
              className="max-h-32 w-auto object-contain"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            <Trans>Upload a PNG or JPG image to use as the stamp.</Trans>
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_STAMP_MIME_TYPES.join(',')}
          className="hidden"
          data-testid="field-form-stamp-upload"
          onChange={handleFileChange}
        />

        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <UploadIcon className="mr-2 h-4 w-4" />
          {meta.imageBase64 ? <Trans>Replace image</Trans> : <Trans>Upload image</Trans>}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>
          <Trans>Rotation (degrees)</Trans>
        </Label>

        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={FIELD_STAMP_MIN_ROTATION}
            max={FIELD_STAMP_MAX_ROTATION}
            value={rotation}
            className="bg-background"
            data-testid="field-form-stamp-rotation"
            onChange={(event) => handleRotationChange(Number(event.target.value))}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            title={t`Rotate 90°`}
            onClick={() => handleRotationChange((rotation + 90) % 360)}
          >
            <RotateCwIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </fieldset>
  );
};
