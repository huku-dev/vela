import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

export interface BriefRatingState {
  /** null = not yet rated, true = helpful, false = not helpful */
  rating: boolean | null;
  comment: string;
  isLoading: boolean;
  isSubmitting: boolean;
  submitRating: (rating: boolean, comment?: string) => Promise<void>;
}

/**
 * Manages fetching and submitting a rating for a specific brief.
 * Uses Pattern A (direct Supabase client) — RLS handles auth.
 */
export function useBriefRating(briefId: string | null): BriefRatingState {
  const { supabaseClient, user } = useAuthContext();
  const [rating, setRating] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch existing rating on mount / briefId change
  useEffect(() => {
    if (!briefId || !supabaseClient) {
      setRating(null);
      setComment('');
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    supabaseClient
      .from('brief_ratings')
      .select('rating, comment')
      .eq('brief_id', briefId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Table may not exist yet — fail silently
          console.error('[useBriefRating] fetch error:', error.message);
        }
        setRating(data?.rating ?? null);
        setComment(data?.comment ?? '');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [briefId, supabaseClient]);

  const submitRating = useCallback(
    async (newRating: boolean, newComment?: string) => {
      if (!briefId) return;

      setIsSubmitting(true);

      // Optimistic update — user sees feedback immediately regardless of DB result
      setRating(newRating);
      setComment(newComment ?? '');

      // Try to persist to DB (may fail if table doesn't exist yet — that's OK)
      if (supabaseClient && user?.privyDid) {
        try {
          const { error } = await supabaseClient.from('brief_ratings').upsert(
            {
              user_id: user.privyDid,
              brief_id: briefId,
              rating: newRating,
              comment: newComment ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,brief_id' }
          );

          if (error) {
            console.warn('[useBriefRating] Could not persist rating:', error.message);
          }
        } catch (err) {
          console.warn('[useBriefRating] submit exception:', err);
        }
      }

      setIsSubmitting(false);
    },
    [briefId, supabaseClient, user?.privyDid]
  );

  return { rating, comment, isLoading, isSubmitting, submitRating };
}
