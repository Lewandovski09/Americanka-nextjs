import { redirect } from 'next/navigation';

// The login UI now lives inside /register as a tab (matching the
// original design where "Увійти" and "Реєстрація" are tabs on one
// screen). This route just redirects there for any old links.
export default function LoginPage() {
  redirect('/register');
}
