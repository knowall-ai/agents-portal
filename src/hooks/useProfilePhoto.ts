'use client';

import { useEffect, useState } from 'react';

/** Fetch the signed-in user's Microsoft Graph profile photo via the API proxy. */
export function useProfilePhoto(isAuthenticated: boolean) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setPhotoUrl(null);
      return;
    }
    let isMounted = true;
    let objectUrl: string | null = null;

    fetch('/api/me/photo')
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (isMounted) setPhotoUrl(objectUrl);
      })
      .catch(() => {
        // Profile photo is non-critical
      });

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isAuthenticated]);

  return { photoUrl };
}
