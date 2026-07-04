'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import { Spinner } from '../components/ui';

export default function HomePage() {
  const { data, error } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
    else if (data) router.replace(data.activeOrganizationId ? '/dashboard' : '/onboarding');
  }, [data, error, router]);

  return <Spinner />;
}
