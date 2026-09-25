'use client';

import { useState, useTransition } from 'react';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { togglePantoneFavorite } from '@/app/actions/production-colors';
import { toast } from 'sonner';

type FavoriteButtonProps = {
  tcx: string;
  initialFavorited: boolean;
  size?: 'sm' | 'icon';
  className?: string;
  onToggle?: (favorited: boolean) => void;
};

export function FavoriteButton({
  tcx,
  initialFavorited,
  size = 'icon',
  className,
  onToggle,
}: FavoriteButtonProps) {
  const t = useTranslations('productionColors');
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    startTransition(async () => {
      try {
        const { favorited: next } = await togglePantoneFavorite(tcx);
        setFavorited(next);
        onToggle?.(next);
      } catch {
        toast.error(t('favoriteError'));
      }
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={size === 'sm' ? 'sm' : 'icon'}
      className={cn('shrink-0', className)}
      disabled={pending}
      onClick={handleClick}
      aria-label={favorited ? t('removeFavorite') : t('addFavorite')}
      title={favorited ? t('removeFavorite') : t('addFavorite')}
    >
      <Heart
        className={cn(
          'h-4 w-4',
          favorited ? 'fill-red-500 text-red-500' : 'text-muted-foreground'
        )}
      />
    </Button>
  );
}
