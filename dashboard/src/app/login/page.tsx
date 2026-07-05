'use client';

import { useEffect } from 'react';

export default function LoginPage() {
  useEffect(() => {
    window.location.href = '/dashboard';
  }, []);

  return null;
}
