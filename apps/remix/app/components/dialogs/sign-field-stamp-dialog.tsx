import { Button } from '@documenso/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@documenso/ui/primitives/dialog';
import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
import { Slider } from '@documenso/ui/primitives/slider';
import { Trans } from '@lingui/react/macro';
import { RotateCwIcon, UploadIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { createCallable } from 'react-call';

const MAX_STAMP_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

export type SignFieldStampDialogProps = {
  initialStampImage?: string;
  initialRotation?: number;
};

export type SignFieldStampDialogResult = {
  stampImageAsBase64: string;
  rotation: number;
} | null;

export const SignFieldStampDialog = createCallable<SignFieldStampDialogProps, SignFieldStampDialogResult>(
  ({ call, initialStampImage, initialRotation = 0 }) => {
    const [stampImage, setStampImage] = useState<string | null>(initialStampImage ?? null);
    const [rotation, setRotation] = useState(initialRotation);
    const [error, setError] = useState<string | null>(null);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setError('Please upload a PNG or JPG image.');
        return;
      }

      if (file.size > MAX_STAMP_SIZE_BYTES) {
        setError('Image must be less than 5MB.');
        return;
      }

      setError(null);

      const reader = new FileReader();

      reader.onload = (e) => {
        const base64 = e.target?.result as string;

        // Validate that the image can actually be loaded
        const img = new Image();

        img.onload = () => {
          setStampImage(base64);
          setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
        };

        img.onerror = () => {
          setError('Failed to load image. Please try a different file.');
        };

        img.src = base64;
      };

      reader.readAsDataURL(file);
    }, []);

    const handleConfirm = () => {
      if (!stampImage) {
        return;
      }

      call.end({
        stampImageAsBase64: stampImage,
        rotation,
      });
    };

    return (
      <Dialog open={true} onOpenChange={(value) => (!value ? call.end(null) : null)}>
        <DialogContent position="center" className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>Upload Stamp Image</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Upload area */}
            <div
              className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border p-4 transition-colors hover:border-primary/50"
              onClick={() => fileInputRef.current?.click()}
            >
              {stampImage ? (
                <div className="flex flex-col items-center gap-2">
                  <div
                    className="flex max-h-[180px] max-w-[280px] items-center justify-center overflow-hidden"
                    style={{ transform: `rotate(${rotation}deg)` }}
                  >
                    <img
                      src={stampImage}
                      alt="Stamp preview"
                      className="max-h-[180px] max-w-[280px] object-contain"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    <Trans>Click to replace</Trans>
                    {naturalSize && (
                      <span className="ml-1">
                        ({naturalSize.width}×{naturalSize.height}px)
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <UploadIcon className="h-8 w-8" />
                  <p className="text-sm">
                    <Trans>Click to upload stamp image</Trans>
                  </p>
                  <p className="text-xs">
                    <Trans>PNG, JPG up to 5MB</Trans>
                  </p>
                </div>
              )}
            </div>

            <Input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileChange}
            />

            {error && <p className="text-destructive text-sm">{error}</p>}

            {/* Rotation control */}
            {stampImage && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <RotateCwIcon className="h-3.5 w-3.5" />
                    <Trans>Rotation</Trans>
                  </Label>
                  <span className="text-muted-foreground text-sm">{rotation}°</span>
                </div>
                <Slider
                  value={[rotation]}
                  onValueChange={([value]) => setRotation(value)}
                  min={0}
                  max={360}
                  step={1}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => call.end(null)}>
              <Trans>Cancel</Trans>
            </Button>

            <Button type="button" disabled={!stampImage} onClick={handleConfirm}>
              <Trans>Place Stamp</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
