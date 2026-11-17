import { useEffect, useRef, useState } from "react";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

type GoogleCredentialResponse = { credential?: string };
type GoogleAccounts = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: { theme: string; size: string; width: number }) => void;
};
declare global {
  interface Window { google?: { accounts: { id: GoogleAccounts } } }
}

let scriptPromise: Promise<void> | undefined;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Не вдалося завантажити Google Sign-In."));
      document.head.appendChild(script);
    }).catch((err) => { scriptPromise = undefined; throw err; });
  }
  return scriptPromise;
}

export function GoogleSignIn({ onCredential, disabled = false }: {
  onCredential: (credential: string) => Promise<void>;
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [error, setError] = useState("");
  callback.current = onCredential;
  useEffect(() => {
    if (!clientId) return;
    let disposed = false;
    loadGoogleScript().then(() => {
      if (disposed || !container.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!response.credential) return;
          setError("");
          void callback.current(response.credential).catch((err: unknown) => {
            if (!disposed) setError(err instanceof Error ? err.message : "Помилка входу через Google.");
          });
        },
      });
      window.google.accounts.id.renderButton(container.current, { theme: "outline", size: "large", width: 280 });
    }).catch((err: unknown) => { if (!disposed) setError(err instanceof Error ? err.message : "Google Sign-In недоступний."); });
    return () => { disposed = true; };
  }, []);
  if (!clientId) return null;
  return <div aria-busy={disabled} style={{ justifySelf: "center" }}>
    <div ref={container} style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }} />
    {error && <p role="alert">{error}</p>}
  </div>;
}
