import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/contracts';

export default function RootPage(): never {
  redirect(ROUTES.card);
}
