import "./styles.css";
import { useCallback, useEffect, useState } from "react";
import { useCaller, type RomeAppBootstrap } from "@rome-os/app-web-sdk";
import type { DashboardView, Profile } from "../shared/model";
import { PayeeIdentity, PayPage } from "./pages/pay";
import { Dashboard } from "./pages/dashboard";
import { RequestDetail } from "./pages/detail";
import { ProfilePage } from "./pages/profile";
import { api } from "./lib/api";
import { registerDisplayFont } from "./lib/fonts";
import { useAppPath } from "./lib/route";

registerDisplayFont();

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const path = useAppPath();
  const seg = path.split("/").filter(Boolean);
  const isOwner = useCaller()?.kind === "guardian";

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [path]);

  // The pay page is public: anyone with the link.
  if (seg[0] === "p" && seg[1]) return <PayPage key={seg[1]} id={seg[1]} />;
  if (!isOwner) return <PublicHome />;
  return <OwnerApp seg={seg} />;
}

function OwnerApp({ seg }: { seg: string[] }) {
  const [data, setData] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api<DashboardView>("dashboard"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your requests.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (seg[0] === "r" && seg[1]) return <RequestDetail key={seg[1]} id={seg[1]} onChange={refresh} />;
  if (seg[0] === "profile") return <ProfilePage profile={data?.profile ?? null} onChange={refresh} />;
  return <Dashboard data={data} error={error} onChange={refresh} />;
}

/** What a stranger sees at the app root: who runs it, and where their link goes. */
function PublicHome() {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    api<Profile>("profile").then(setProfile).catch(() => setProfile(null));
  }, []);
  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--app-canvas)] px-6 py-24">
      <div className="max-w-md text-center">
        {profile ? (
          <div className="mb-8 flex justify-center">
            <PayeeIdentity profile={profile} size="md" />
          </div>
        ) : null}
        <h1 className="font-display text-4xl text-foreground">Favor requests</h1>
        <p className="mt-3 text-ui text-muted-foreground">If you were sent a request, open the link you received to view and pay it.</p>
      </div>
    </div>
  );
}
