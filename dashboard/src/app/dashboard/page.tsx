'use client';

import { useEffect } from 'react';

export default function DashboardPage() {
  useEffect(() => {
    window.location.href = '/dashboard';
  }, []);

  return null;
}
