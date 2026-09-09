"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

type ConnectionStatus = "connected" | "needs_reauth" | "disconnected";

type BeaconConnection = {
  provider: string;
  status: ConnectionStatus;
  accountIdentifier: string | null;
  sessionExpiresAt: string | null;
  connectedAt: string | null;
  lastValidatedAt: string | null;
  lastError: string | null;
};

type ApiResponse = {
  connection?: BeaconConnection;
  error?: {
    code?: string;
    message?: string;
  };
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusPresentation(status: ConnectionStatus) {
  if (status === "connected") {
    return {
      label: "Connected",
      description: "govTract has a reusable authenticated Beacon supplier session.",
      icon: CheckCircle2,
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }

  if (status === "needs_reauth") {
    return {
      label: "Reconnect required",
      description: "The saved Beacon session is no longer usable. Paste a fresh magic link to replace it.",
      icon: AlertTriangle,
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  return {
    label: "Not connected",
    description: "Connect a Beacon supplier account to enable authenticated solicitation document retrieval.",
    icon: Link2,
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

export function BeaconConnectionCard() {
  const [connection, setConnection] = useState<BeaconConnection | null>(null);
  const [magicLink, setMagicLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetch("/api/admin/source-connections/beacon", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as ApiResponse;
        if (!response.ok || !body.connection) {
          throw new Error(body.error?.message ?? "Beacon connection status is unavailable.");
        }
        if (active) setConnection(body.connection);
      })
      .catch((fetchError: unknown) => {
        if (active) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Beacon connection status is unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!magicLink.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/source-connections/beacon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ magicLink: magicLink.trim() }),
      });
      const body = (await response.json()) as ApiResponse;

      if (!response.ok || !body.connection) {
        throw new Error(body.error?.message ?? "Beacon connection failed.");
      }

      setConnection(body.connection);
      setMagicLink("");
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Beacon connection failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const status = statusPresentation(connection?.status ?? "disconnected");
  const StatusIcon = status.icon;
  const actionLabel = connection?.status === "connected" ? "Reconnect Beacon" : "Connect Beacon";

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-white">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold tracking-tight">Beacon supplier connection</h2>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                Authentication used only for documents that Beacon restricts to signed-in suppliers.
              </p>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
            status.className,
          )}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <StatusIcon className="size-3.5" />}
          {loading ? "Checking" : status.label}
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-sm leading-6 text-[var(--muted-foreground)]">{status.description}</p>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border bg-slate-50/70 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Account
              </div>
              <div className="mt-1 break-all font-medium">
                {connection?.accountIdentifier ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border bg-slate-50/70 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Session expires
              </div>
              <div className="mt-1 font-medium">{formatDate(connection?.sessionExpiresAt ?? null)}</div>
            </div>
            <div className="rounded-xl border bg-slate-50/70 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Last validated
              </div>
              <div className="mt-1 font-medium">{formatDate(connection?.lastValidatedAt ?? null)}</div>
            </div>
            <div className="rounded-xl border bg-slate-50/70 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Auth method
              </div>
              <div className="mt-1 font-medium">Email magic link</div>
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-950">
            <div className="font-medium">How to connect</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6 text-blue-900/80">
              <li>Open Beacon Login and enter your Beacon account email.</li>
              <li>When Beacon emails the one-time login link, copy the link instead of opening it.</li>
              <li>Paste it here. govTract consumes it once, verifies supplier access, and stores only the encrypted session.</li>
            </ol>
          </div>
        </div>

        <form onSubmit={connect} className="min-w-0 rounded-2xl border bg-slate-50/60 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{actionLabel}</div>
              <div className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                Magic links are treated as credentials and are never persisted or returned by the API.
              </div>
            </div>
            <a
              href="https://www.beaconbid.com/login"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-medium transition hover:bg-slate-50"
            >
              Beacon Login
              <ExternalLink className="size-3.5" />
            </a>
          </div>

          <label htmlFor="beacon-magic-link" className="mt-5 block text-xs font-medium text-slate-700">
            One-time login link
          </label>
          <input
            id="beacon-magic-link"
            type="password"
            value={magicLink}
            onChange={(event) => setMagicLink(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.beaconbid.com/login#token=…"
            className="mt-2 block w-full min-w-0 rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!magicLink.trim() || submitting}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Connecting…
              </>
            ) : connection?.status === "connected" ? (
              <>
                <RefreshCw className="size-4" />
                Reconnect Beacon
              </>
            ) : (
              <>
                <Link2 className="size-4" />
                Connect Beacon
              </>
            )}
          </button>
        </form>
      </div>
    </section>
  );
}
