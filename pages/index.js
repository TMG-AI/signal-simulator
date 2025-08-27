import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const [email, setEmail] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!email) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Signal Simulator 👋</h1>
        <p>You are not signed in.</p>
        <Link href="/login">Go to login</Link>
      </main>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <p>Signed in as <strong>{email}</strong></p>
      <button onClick={signOut}>Sign out</button>
    </main>
  );
}
