import { unstable_serialize } from 'swr';

export const AUTH_KEY = ['auth', 'me'] as const;

export const authKeyString = () => unstable_serialize(AUTH_KEY);
