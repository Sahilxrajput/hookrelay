"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  Gauge,
  KeyRound,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T = unknown>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const value = await res
      .json()
      .catch(() => ({ error: "Cannot connect to the API." }));
    throw new ApiError(value.error || "Request failed.", res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
type Project = { id: string; name: string };
type Endpoint = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  subscriptions: string[];
};
type EventRow = {
  id: string;
  type: string;
  payload: unknown;
  created_at: string;
  deliveries: number;
  succeeded: number;
  failed: number;
};
type Delivery = {
  id: string;
  event_id: string;
  type: string;
  endpoint_name: string;
  url: string;
  status: string;
  attempt_count: number;
  generation: number;
  last_status: number | null;
  last_error: string | null;
  updated_at: string;
};
type Attempt = {
  id: string;
  delivery_id: string;
  generation: number;
  attempt: number;
  status_code: number | null;
  duration_ms: number;
  error: string | null;
  created_at: string;
};
type EventDetail = EventRow & {
  deliveries: never;
  attempts: Attempt[];
  replays: { id: string; generation: number; created_at: string }[];
};
type Detail = Omit<EventDetail, "deliveries"> & { deliveries: Delivery[] };
type Stats = {
  events: number;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  latency: number;
  timeline: { hour: string; succeeded: number; failed: number }[];
};
type Key = {
  id: string;
  name: string;
  prefix: string;
  revoked_at: string | null;
  created_at: string;
};
const emptyStats: Stats = {
  events: 0,
  total: 0,
  succeeded: 0,
  failed: 0,
  pending: 0,
  latency: 0,
  timeline: [],
};
const navigation = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "events", label: "Events", icon: Activity },
  { id: "endpoints", label: "Endpoints", icon: Webhook },
  { id: "dlq", label: "Dead letter queue", icon: ArrowDownLeft },
  { id: "keys", label: "API keys", icon: KeyRound },
] as const;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const when = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const short = (value: string) => value.slice(0, 8);
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {status === "succeeded"
        ? "Delivered"
        : status === "failed"
          ? "Failed"
          : status === "pending"
            ? "Pending"
            : status === "processing"
              ? "Processing"
              : status}
    </span>
  );
}
function Empty({
  icon: Icon = Webhook,
  title,
  children,
  action,
}: {
  icon?: typeof Webhook;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <Loader2 size={20} className="spin" /> Loading your workspace…
    </div>
  );
}
function Auth({ onAuth }: { onAuth: () => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/auth/${register ? "register" : "login"}`, {
        email: data.get("email"),
        password: data.get("password"),
      });
      onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">YOUR EVENTS. DELIVERED.</span>
          <h1>
            A reliable connection.
            <br />
            Every single time.
          </h1>
          <p>
            Webhook infrastructure that keeps your applications in sync. Built
            for developers. Hosted by you.
          </p>
          <div className="flow-visual">
            <div>
              <Terminal />
              <span>Your app</span>
            </div>
            <i />
            <div className="flow-hub">
              <Webhook />
              <span>HookRelay</span>
            </div>
            <i />
            <div>
              <Check />
              <span>Delivered</span>
            </div>
          </div>
          <div className="story-features">
            <span>
              <ShieldCheck size={17} /> Signed & secure
            </span>
            <span>
              <RefreshCw size={17} /> Automatic retries
            </span>
            <span>
              <Activity size={17} /> Full visibility
            </span>
          </div>
        </div>
        <span className="auth-footer">
          Own your infrastructure. Stay in control.
        </span>
      </section>
      <section className="auth-form">
        <div>
          <div className="auth-icon">
            <Webhook size={28} />
          </div>
          <h2>{register ? "Create your workspace" : "Welcome back"}</h2>
          <p>
            {register
              ? "Start delivering events with confidence."
              : "Sign in to your HookRelay account."}
          </p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                placeholder="At least 12 characters"
                minLength={12}
                maxLength={128}
                required
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
            <Button disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : null}
              {register ? "Create account" : "Sign in"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to HookRelay?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Sign in" : "Create an account"}
            </button>
          </p>
          <p className="local-note">
            <ShieldCheck size={14} /> This account belongs to your self-hosted
            instance.
          </p>
        </div>
      </section>
    </main>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Webhook size={23} />
      </span>
      HookRelay<span className="brand-dot">.</span>
    </div>
  );
}
function App() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ email: string }>("/auth/me"),
    retry: false,
  });
  const [page, setPage] = useState("overview"),
    [projectId, setProjectId] = useState(""),
    [modal, setModal] = useState(""),
    [selectedEvent, setSelectedEvent] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [secret, setSecret] = useState(""),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      path: string;
      method: string;
    } | null>(null);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/projects"),
    enabled: !!me.data,
  });
  const active =
    projects.data?.find((p) => p.id === projectId) || projects.data?.[0];
  const base = active ? `/projects/${active.id}` : "";
  const stats = useQuery({
    queryKey: ["stats", active?.id],
    queryFn: () => api<Stats>(`${base}/stats`),
    enabled: !!active,
    refetchInterval: 10000,
  });
  const endpoints = useQuery({
    queryKey: ["endpoints", active?.id],
    queryFn: () => api<Endpoint[]>(`${base}/endpoints`),
    enabled: !!active,
    refetchInterval: 10000,
  });
  const events = useQuery({
    queryKey: ["events", active?.id, search, offset],
    queryFn: () =>
      api<EventRow[]>(
        `${base}/events?q=${encodeURIComponent(search)}&offset=${offset}`,
      ),
    enabled: !!active,
    refetchInterval: 5000,
  });
  const dlq = useQuery({
    queryKey: ["dlq", active?.id, offset],
    queryFn: () => api<Delivery[]>(`${base}/dlq?offset=${offset}`),
    enabled: !!active && page === "dlq",
    refetchInterval: 5000,
  });
  const keys = useQuery({
    queryKey: ["keys", active?.id],
    queryFn: () => api<Key[]>(`${base}/keys`),
    enabled: !!active && page === "keys",
  });
  const detail = useQuery({
    queryKey: ["detail", active?.id, selectedEvent],
    queryFn: () => api<Detail>(`${base}/events/${selectedEvent}`),
    enabled: !!active && !!selectedEvent,
    refetchInterval: 5000,
  });
  const data = stats.data || emptyStats;
  const navigate = (value: string) => {
    setPage(value);
    setOffset(0);
    setSearch("");
    setError("");
  };
  const open = (value: string) => {
    setError("");
    setSecret("");
    setCopied(false);
    setModal(value);
  };
  async function action(path: string, body?: unknown, method?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<Record<string, string>>(path, body, method);
      await client.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "me",
      });
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function perform(
    path: string,
    body?: unknown,
    method?: string,
    message = "Changes saved.",
  ) {
    try {
      await action(path, body, method);
      setNotice(message);
    } catch {}
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      if (modal === "project") {
        const result = await action("/projects", { name: form.get("name") });
        setProjectId(result.id);
        setModal("");
        setNotice("Project created. Add your first endpoint to get started.");
      }
      if (modal === "endpoint") {
        const result = await action(`${base}/endpoints`, {
          name: form.get("name"),
          url: form.get("url"),
          subscriptions: String(form.get("subscriptions"))
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        });
        setSecret(result.secret);
        setModal("secret");
        setNotice("Endpoint created.");
      }
      if (modal === "key") {
        const result = await action(`${base}/keys`, { name: form.get("name") });
        setSecret(result.key);
        setModal("secret");
        setNotice("API key created.");
      }
      if (modal === "event") {
        let payload;
        try {
          payload = JSON.parse(String(form.get("data")));
        } catch {
          setError("Payload must be valid JSON.");
          return;
        }
        const result = await action(`${base}/events`, {
          type: form.get("type"),
          data: payload,
        });
        setModal("");
        setSelectedEvent(result.id);
        setNotice("Event accepted and queued.");
      }
    } catch {}
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Clipboard unavailable. Select and copy the value manually.");
    }
  }
  if (me.isPending) return <Loading />;
  if (!me.data) {
    if (me.error instanceof ApiError && me.error.status === 401)
      return <Auth onAuth={() => void client.invalidateQueries()} />;
    return (
      <div className="connection-error">
        <Brand />
        <h1>Let’s get connected.</h1>
        <p>
          The HookRelay API is unavailable. Start the services, then try again.
        </p>
        <code>docker compose up --build -d</code>
        <Button onClick={() => void me.refetch()}>
          <RefreshCw size={16} /> Try again
        </Button>
      </div>
    );
  }
  const pageTitle =
    page === "docs"
      ? "Developer guide"
      : page === "settings"
        ? "Workspace settings"
        : navigation.find((n) => n.id === page)?.label || "Overview";
  const eventsTable = (rows: EventRow[] | undefined) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Event ID</th>
            <th>Status</th>
            <th>Endpoints</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows?.map((event) => (
            <tr key={event.id} onClick={() => setSelectedEvent(event.id)}>
              <td>
                <button
                  className="event-name"
                  onClick={() => setSelectedEvent(event.id)}
                >
                  <span className="event-icon">
                    <Zap size={14} />
                  </span>
                  {event.type}
                </button>
              </td>
              <td className="mono muted">evt_{short(event.id)}</td>
              <td>
                <Badge
                  status={
                    !event.deliveries
                      ? "No subscribers"
                      : event.failed
                        ? "failed"
                        : event.succeeded === event.deliveries
                          ? "succeeded"
                          : "pending"
                  }
                />
              </td>
              <td className="muted">
                {event.succeeded} / {event.deliveries}
              </td>
              <td className="muted nowrap">{when(event.created_at)}</td>
              <td>
                <ChevronRight size={15} className="muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const pagination = (length: number) => (
    <div className="pagination">
      <span>
        Showing {length ? offset + 1 : 0}–{offset + length}
      </span>
      <div>
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 25))}
        >
          <ChevronLeft size={14} /> Previous
        </Button>
        <Button
          variant="outline"
          disabled={length < 25}
          onClick={() => setOffset(offset + 25)}
        >
          Next <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-selector">
          <div className="workspace-avatar">
            {active?.name[0]?.toUpperCase() || "W"}
          </div>
          <div>
            <span className="tiny muted">WORKSPACE</span>
            <select
              aria-label="Current project"
              value={active?.id || ""}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSelectedEvent("");
                setOffset(0);
              }}
            >
              {projects.data?.length ? (
                projects.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              ) : (
                <option>No projects yet</option>
              )}
            </select>
          </div>
          <button
            aria-label="Create project"
            className="icon-button"
            onClick={() => open("project")}
          >
            <Plus size={15} />
          </button>
        </div>
        <span className="nav-label">PLATFORM</span>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={page === item.id ? "active" : ""}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "dlq" && data.failed > 0 && (
                <span className="nav-count">{data.failed}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="self-hosted">
            <div>
              <span className="status-dot" />
              <strong>Self-hosted</strong>
              <span className="version">v0.1</span>
            </div>
            <p>Your infrastructure. Your control.</p>
          </div>
          <nav>
            <button
              className={page === "docs" ? "active" : ""}
              onClick={() => navigate("docs")}
            >
              <BookOpen size={17} />
              Documentation
              <ArrowUpRight size={14} className="push" />
            </button>
            <button
              className={page === "settings" ? "active" : ""}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={17} />
              Settings
            </button>
          </nav>
          <div className="user-row">
            <span className="user-avatar">
              {me.data.email[0].toUpperCase()}
            </span>
            <div>
              <strong>Your workspace</strong>
              <span>{me.data.email}</span>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={async () => {
                try {
                  await api("/auth/logout", {}, "POST");
                  client.clear();
                  setProjectId("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{active?.name || "Workspace"}</span>
            <ChevronRight size={13} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment">
              <span /> Live environment
            </span>
            <button
              className="icon-button"
              aria-label="Help"
              onClick={() => navigate("docs")}
            >
              <CircleHelp size={18} />
            </button>
            <span className="top-avatar">{me.data.email[0].toUpperCase()}</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="heading-label">
                {page === "overview"
                  ? "WORKSPACE AT A GLANCE"
                  : "HOOKRELAY PLATFORM"}
              </div>
              <h1>
                {pageTitle}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {page === "overview"
                  ? "Every event, every delivery. Everything in view."
                  : page === "events"
                    ? "Follow your events from ingestion to delivery."
                    : page === "endpoints"
                      ? "Connect your applications to the services that matter."
                      : page === "dlq"
                        ? "Inspect exhausted deliveries and give them another try."
                        : page === "keys"
                          ? "Secure access for your applications."
                          : page === "docs"
                            ? "From your first event to a reliable integration."
                            : "Manage your self-hosted workspace."}
              </p>
            </div>
            {active && page !== "docs" && page !== "settings" && (
              <Button
                onClick={() =>
                  open(
                    page === "endpoints"
                      ? "endpoint"
                      : page === "keys"
                        ? "key"
                        : "event",
                  )
                }
              >
                <Plus size={16} />
                {page === "endpoints"
                  ? "Add endpoint"
                  : page === "keys"
                    ? "Create API key"
                    : "Send event"}
              </Button>
            )}
          </div>
          {notice && (
            <div className="notice">
              <Check size={16} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {error && !modal && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
          {[
            projects.error,
            stats.error,
            endpoints.error,
            events.error,
            dlq.error,
            keys.error,
          ]
            .filter(Boolean)
            .slice(0, 1)
            .map((e, i) => (
              <div key={i} className="error-box" role="alert">
                {(e as Error).message}{" "}
                <button onClick={() => void client.invalidateQueries()}>
                  Retry
                </button>
              </div>
            ))}
          {projects.isPending ? (
            <Loading />
          ) : !active ? (
            <section className="panel">
              <Empty
                title="Your next event starts here"
                action={
                  <Button onClick={() => open("project")}>
                    <Plus size={16} />
                    Create your first project
                  </Button>
                }
              >
                Create a project to organize endpoints, generate API keys, and
                start delivering events.
              </Empty>
            </section>
          ) : (
            <>
              {page === "overview" && (
                <>
                  <div className="stat-grid">
                    {[
                      {
                        label: "Total events",
                        value: data.events.toLocaleString(),
                        icon: Activity,
                        note: "Events accepted",
                        tone: "purple",
                      },
                      {
                        label: "Delivery success",
                        value: data.total
                          ? `${((data.succeeded / data.total) * 100).toFixed(1)}%`
                          : "—",
                        icon: ShieldCheck,
                        note: `${data.succeeded.toLocaleString()} delivered successfully`,
                        tone: "green",
                      },
                      {
                        label: "Avg. response time",
                        value: data.latency ? `${data.latency} ms` : "—",
                        icon: Zap,
                        note: "Successful attempts · last 24h",
                        tone: "blue",
                      },
                      {
                        label: "Failed deliveries",
                        value: data.failed.toLocaleString(),
                        icon: ArrowDownLeft,
                        note: data.failed
                          ? "Ready for inspection in the DLQ"
                          : "All clear. Keep shipping.",
                        tone: "orange",
                      },
                    ].map((metric) => (
                      <section className="stat-card" key={metric.label}>
                        <div>
                          <span>{metric.label}</span>
                          <metric.icon size={17} className={metric.tone} />
                        </div>
                        <strong>{metric.value}</strong>
                        <p>
                          <span className={`mini-dot ${metric.tone}`} />
                          {metric.note}
                        </p>
                      </section>
                    ))}
                  </div>
                  <div className="overview-grid">
                    <section className="panel chart-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Delivery activity</h2>
                          <p>A pulse on your webhook traffic.</p>
                        </div>
                        <span className="filter-chip">Last 24 hours</span>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="green-bg" />
                          Successful attempts
                        </span>
                        <span>
                          <i className="orange-bg" />
                          Failed attempts
                        </span>
                      </div>
                      <ActivityChart timeline={data.timeline} />
                      <div className="chart-bottom">
                        <span>
                          <span className="status-dot" /> Updates every 10
                          seconds
                        </span>
                        <span>{data.pending} pending deliveries</span>
                      </div>
                    </section>
                    <section className="panel endpoints-summary">
                      <div className="panel-heading">
                        <div>
                          <h2>Endpoints</h2>
                          <p>Your connected destinations.</p>
                        </div>
                        <span className="count-chip">
                          {endpoints.data?.length || 0}
                        </span>
                      </div>
                      {endpoints.data?.length ? (
                        <div className="endpoint-mini-list">
                          {endpoints.data.slice(0, 4).map((ep) => (
                            <div key={ep.id}>
                              <div className="endpoint-symbol">
                                <Webhook size={17} />
                              </div>
                              <div>
                                <strong>{ep.name}</strong>
                                <span>{new URL(ep.url).hostname}</span>
                              </div>
                              <span
                                className={`endpoint-led ${ep.enabled ? "enabled" : ""}`}
                                title={ep.enabled ? "Enabled" : "Disabled"}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="small-empty">
                          <div className="empty-icon">
                            <Webhook size={24} />
                          </div>
                          <strong>No destinations yet</strong>
                          <p>Add an endpoint to deliver your first event.</p>
                        </div>
                      )}
                      <button
                        className="panel-footer-link"
                        onClick={() =>
                          endpoints.data?.length
                            ? navigate("endpoints")
                            : open("endpoint")
                        }
                      >
                        {endpoints.data?.length
                          ? "Manage endpoints"
                          : "Add your first endpoint"}
                        <ArrowRight size={14} />
                      </button>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Recent events
                          <span className="count-chip">{data.events}</span>
                        </h2>
                        <p>The latest activity across your project.</p>
                      </div>
                      <button
                        className="text-link"
                        onClick={() => navigate("events")}
                      >
                        View all events
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    {events.isPending ? (
                      <Loading />
                    ) : events.data?.length ? (
                      eventsTable(events.data.slice(0, 6))
                    ) : (
                      <Empty
                        title="Waiting for your first event"
                        icon={Activity}
                        action={
                          <Button
                            variant="outline"
                            onClick={() => open("event")}
                          >
                            <Send size={14} />
                            Send an event
                          </Button>
                        }
                      >
                        Send an event through the API or try one from your
                        dashboard.
                      </Empty>
                    )}
                  </section>
                  <div className="developer-banner">
                    <div className="terminal-icon">
                      <Terminal size={22} />
                    </div>
                    <div>
                      <h3>Built for developers. Ready for your stack.</h3>
                      <p>Connect your application with a single API call.</p>
                    </div>
                    <Button variant="outline" onClick={() => navigate("docs")}>
                      Read the docs
                      <ArrowUpRight size={15} />
                    </Button>
                  </div>
                </>
              )}
              {page === "events" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Event stream</h2>
                    <div className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search events"
                        placeholder="Search type or event ID…"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setOffset(0);
                        }}
                      />
                    </div>
                  </div>
                  {events.isPending ? (
                    <Loading />
                  ) : events.data?.length ? (
                    eventsTable(events.data)
                  ) : (
                    <Empty
                      title={search ? "No matching events" : "No events yet"}
                      icon={Activity}
                    >
                      {" "}
                      {search
                        ? "Try another event type or ID."
                        : "Send your first event to start your delivery history."}
                    </Empty>
                  )}
                  {pagination(events.data?.length || 0)}
                </section>
              )}
              {page === "endpoints" && (
                <div className="endpoint-grid">
                  {endpoints.isPending ? (
                    <Loading />
                  ) : endpoints.data?.length ? (
                    endpoints.data.map((ep) => (
                      <section className="panel endpoint-card" key={ep.id}>
                        <div className="endpoint-card-top">
                          <span className="endpoint-symbol">
                            <Webhook size={22} />
                          </span>
                          <Badge status={ep.enabled ? "Enabled" : "Disabled"} />
                        </div>
                        <h2>{ep.name}</h2>
                        <p className="endpoint-url">{ep.url}</p>
                        <div className="subscriptions">
                          <span>SUBSCRIBED EVENTS</span>
                          <div>
                            {ep.subscriptions.map((type) => (
                              <code key={type}>
                                {type === "*" ? "All events" : type}
                              </code>
                            ))}
                          </div>
                        </div>
                        <div className="endpoint-card-actions">
                          <Button
                            variant="outline"
                            disabled={!ep.enabled || busy}
                            onClick={() =>
                              void perform(
                                `${base}/endpoints/${ep.id}/test`,
                                {},
                                "POST",
                                "Test event queued. Inspect it in Events.",
                              )
                            }
                          >
                            <Send size={14} />
                            Test
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void perform(
                                `${base}/endpoints/${ep.id}`,
                                { enabled: !ep.enabled },
                                "PATCH",
                              )
                            }
                          >
                            {ep.enabled ? "Disable" : "Enable"}
                          </Button>
                          <button
                            aria-label={`Delete ${ep.name}`}
                            className="icon-button danger push"
                            onClick={() =>
                              setConfirm({
                                title: `Delete “${ep.name}”?`,
                                path: `${base}/endpoints/${ep.id}`,
                                method: "DELETE",
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </section>
                    ))
                  ) : (
                    <section className="panel full-width">
                      <Empty
                        title="Connect your first destination"
                        action={
                          <Button onClick={() => open("endpoint")}>
                            <Plus size={16} />
                            Add endpoint
                          </Button>
                        }
                      >
                        Register a public URL and choose which events it should
                        receive.
                      </Empty>
                    </section>
                  )}
                </div>
              )}
              {page === "dlq" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Failed deliveries{" "}
                        <span className="count-chip">{data.failed}</span>
                      </h2>
                      <p>
                        Replays preserve the original event and all previous
                        attempts.
                      </p>
                    </div>
                  </div>
                  {dlq.isPending ? (
                    <Loading />
                  ) : dlq.data?.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Endpoint</th>
                            <th>Last result</th>
                            <th>Attempts</th>
                            <th>Failed at</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {dlq.data.map((d) => (
                            <tr key={d.id}>
                              <td>
                                <button
                                  className="text-link"
                                  onClick={() => setSelectedEvent(d.event_id)}
                                >
                                  {d.type}
                                </button>
                              </td>
                              <td>{d.endpoint_name}</td>
                              <td>
                                <span className="code-status">
                                  {d.last_status || "Network / disabled"}
                                </span>
                              </td>
                              <td>{d.attempt_count}</td>
                              <td className="muted nowrap">
                                {when(d.updated_at)}
                              </td>
                              <td>
                                <Button
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void perform(
                                      `${base}/deliveries/${d.id}/replay`,
                                      {},
                                      "POST",
                                      "Delivery queued for replay.",
                                    )
                                  }
                                >
                                  <RefreshCw size={14} />
                                  Replay
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty title="Nothing left behind" icon={ShieldCheck}>
                      Your dead letter queue is empty. Exhausted deliveries will
                      appear here.
                    </Empty>
                  )}
                  {pagination(dlq.data?.length || 0)}
                </section>
              )}
              {page === "keys" && (
                <>
                  <div className="info-banner">
                    <ShieldCheck size={18} />
                    <span>
                      API keys are shown once and stored as hashes. Keep them on
                      your server.
                    </span>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Project API keys</h2>
                    </div>
                    {keys.isPending ? (
                      <Loading />
                    ) : keys.data?.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Key prefix</th>
                              <th>Status</th>
                              <th>Created</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {keys.data.map((key) => (
                              <tr key={key.id}>
                                <td>
                                  <KeyRound size={14} className="inline-icon" />
                                  {key.name}
                                </td>
                                <td className="mono muted">
                                  {key.prefix}••••••
                                </td>
                                <td>
                                  <Badge
                                    status={
                                      key.revoked_at ? "Revoked" : "Active"
                                    }
                                  />
                                </td>
                                <td className="muted">
                                  {when(key.created_at)}
                                </td>
                                <td>
                                  {!key.revoked_at && (
                                    <Button
                                      variant="ghost"
                                      className="danger"
                                      onClick={() =>
                                        setConfirm({
                                          title: `Revoke “${key.name}”?`,
                                          path: `${base}/keys/${key.id}`,
                                          method: "DELETE",
                                        })
                                      }
                                    >
                                      Revoke
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Give your app a key"
                        icon={KeyRound}
                        action={
                          <Button onClick={() => open("key")}>
                            <Plus size={16} />
                            Create API key
                          </Button>
                        }
                      >
                        Create a key to start sending events to this project.
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {page === "docs" && (
                <div className="docs-grid">
                  <section className="panel doc">
                    <span className="step">01</span>
                    <h2>Register your endpoint</h2>
                    <p>
                      Add a public HTTP(S) URL in Endpoints, select event types,
                      and securely save the signing secret shown once. Use{" "}
                      <code>*</code> to subscribe to every event.
                    </p>
                    <Button variant="outline" onClick={() => open("endpoint")}>
                      Add endpoint
                      <ArrowRight size={14} />
                    </Button>
                    <hr />
                    <span className="step">02</span>
                    <h2>Send your first event</h2>
                    <p>
                      Create an API key, then send a JSON object to your API. An
                      event is accepted immediately; delivery happens in the
                      background.
                    </p>
                    <pre>{`curl http://localhost:4000/v1/events \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: order-123" \\\n  -d '{"type":"order.created","data":{"id":"123"}}'`}</pre>
                    <p>
                      Identical idempotent requests return the same event ID.
                      Reusing the key with a different payload returns HTTP 409.
                    </p>
                    <hr />
                    <span className="step">03</span>
                    <h2>Verify incoming requests</h2>
                    <p>
                      Use the raw request body with the SDK. Reject invalid
                      signatures and timestamps older than five minutes.
                      Deduplicate by event ID in your receiver.
                    </p>
                    <pre>{`import { verifyWebhook } from '@hookrelay/sdk';\n\nconst valid = verifyWebhook(\n  signingSecret,\n  headers['webhook-id'],\n  headers['webhook-timestamp'],\n  headers['webhook-signature'],\n  rawBody\n);`}</pre>
                  </section>
                  <div>
                    <section className="panel doc">
                      <h2>Delivery contract</h2>
                      <ul>
                        <li>At-least-once delivery</li>
                        <li>HMAC-SHA256 signed payloads</li>
                        <li>2xx responses mean success</li>
                        <li>429, 408, 5xx and network failures retry</li>
                        <li>Other responses go to the DLQ</li>
                        <li>Exponential backoff with jitter</li>
                        <li>No delivery ordering guarantee</li>
                      </ul>
                      <p>
                        Retry-After is respected for 429 and 503, capped at 24
                        hours. Defaults: 8 attempts and a 10-second timeout.
                        Your operator can configure these values.
                      </p>
                    </section>
                    <section className="panel doc">
                      <h2>Need to replay?</h2>
                      <p>
                        Open the dead letter queue and replay a failed delivery.
                        Each replay starts a new attempt cycle while preserving
                        previous history.
                      </p>
                      <Button variant="outline" onClick={() => navigate("dlq")}>
                        Open dead letter queue
                        <ArrowRight size={14} />
                      </Button>
                    </section>
                  </div>
                </div>
              )}
              {page === "settings" && (
                <div className="settings-grid">
                  <section className="panel doc">
                    <h2>Project details</h2>
                    <label>
                      Project name
                      <input readOnly value={active.name} />
                    </label>
                    <label>
                      Project ID
                      <input readOnly value={active.id} className="mono" />
                    </label>
                    <Button variant="outline" onClick={() => open("project")}>
                      <Plus size={16} />
                      Create another project
                    </Button>
                  </section>
                  <section className="panel doc">
                    <h2>Your account</h2>
                    <label>
                      Email
                      <input readOnly value={me.data.email} />
                    </label>
                    <p>
                      Worker concurrency, database connections, and delivery
                      limits are configured by your instance operator through
                      environment variables. See the repository README for
                      deployment instructions.
                    </p>
                    <div className="info-banner">
                      <ShieldCheck size={18} />
                      Self-hosted · HookRelay v0.1
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              HookRelay <span className="muted">/</span> Reliable by design.
            </span>
            <span>
              <span className="status-dot" />
              Self-hosted infrastructure
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(value) => {
          if (!busy && !value) {
            setModal("");
            setSecret("");
            setError("");
          }
        }}
        title={
          modal === "project"
            ? "Create a project"
            : modal === "endpoint"
              ? "Add an endpoint"
              : modal === "key"
                ? "Create an API key"
                : modal === "secret"
                  ? "Save your secret"
                  : "Send an event"
        }
        description={
          modal === "secret"
            ? "Copy this now. You won’t be able to see it again."
            : modal === "endpoint"
              ? "Connect a public destination to your event stream."
              : modal === "event"
                ? "Send a real event to all matching enabled endpoints."
                : "Keep your integrations organized and secure."
        }
      >
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {modal === "secret" ? (
          <>
            <pre className="secret-value">{secret}</pre>
            <Button onClick={() => void copy(secret)}>
              {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
              {copied ? "Copied" : "Copy secret"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSecret("");
                setModal("");
              }}
            >
              I’ve saved it
            </Button>
          </>
        ) : (
          <form onSubmit={submit}>
            {["project", "endpoint", "key"].includes(modal) && (
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder={
                    modal === "project"
                      ? "My application"
                      : modal === "endpoint"
                        ? "Billing service"
                        : "Production server"
                  }
                  autoFocus
                />
              </label>
            )}
            {modal === "endpoint" && (
              <>
                <label>
                  Endpoint URL
                  <input
                    name="url"
                    type="url"
                    required
                    placeholder="https://api.example.com/webhooks"
                  />
                </label>
                <label>
                  Event subscriptions
                  <input
                    name="subscriptions"
                    required
                    defaultValue="*"
                    placeholder="order.created, payment.succeeded"
                  />
                  <small>
                    Comma-separated event types, or * for all events.
                  </small>
                </label>
              </>
            )}
            {modal === "event" && (
              <>
                <label>
                  Event type
                  <input
                    name="type"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}"
                    defaultValue="order.created"
                  />
                </label>
                <label>
                  JSON payload
                  <textarea
                    name="data"
                    required
                    rows={7}
                    defaultValue={
                      '{\n  "order_id": "ord_123",\n  "amount": 4900,\n  "currency": "USD"\n}'
                    }
                  />
                </label>
              </>
            )}
            <div className="form-actions">
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => setModal("")}
              >
                Cancel
              </Button>
              <Button disabled={busy}>
                {busy && <Loader2 size={15} className="spin" />}
                {modal === "event"
                  ? "Send event"
                  : modal === "endpoint"
                    ? "Add endpoint"
                    : modal === "key"
                      ? "Create key"
                      : "Create project"}
                <ArrowRight size={15} />
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(value) => {
          if (!value) setConfirm(null);
        }}
        title={confirm?.title || "Confirm action"}
        description="This stops future use. Existing delivery history is preserved."
      >
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (confirm)
                try {
                  await action(confirm.path, undefined, confirm.method);
                  setConfirm(null);
                  setNotice("Changes saved.");
                } catch {}
            }}
          >
            Confirm
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!selectedEvent}
        onOpenChange={(value) => {
          if (!value) setSelectedEvent("");
        }}
        title="Event details"
        description={`evt_${selectedEvent}`}
      >
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <div className="error-box">{detail.error.message}</div>
        ) : (
          detail.data && (
            <div className="event-detail">
              <div className="detail-meta">
                <strong>{detail.data.type}</strong>
                <span>{when(detail.data.created_at)}</span>
              </div>
              <h3>Payload</h3>
              <pre>{pretty(detail.data.payload)}</pre>
              <h3>Deliveries</h3>
              {!detail.data.deliveries.length && (
                <p className="muted">
                  No enabled endpoints subscribed to this event.
                </p>
              )}
              {detail.data.deliveries.map((d) => (
                <div className="delivery-detail" key={d.id}>
                  <div>
                    <strong>{d.endpoint_name}</strong>
                    <Badge status={d.status} />
                  </div>
                  <p>{d.url}</p>
                  {d.last_error && <p className="danger">{d.last_error}</p>}
                  {detail
                    .data!.attempts.filter((a) => a.delivery_id === d.id)
                    .map((a) => (
                      <div className="attempt-row" key={a.id}>
                        <span>
                          Cycle {a.generation} · Attempt {a.attempt}
                        </span>
                        <span
                          className={
                            a.status_code && a.status_code < 300
                              ? "green"
                              : "danger"
                          }
                        >
                          {a.status_code || "Error"}
                        </span>
                        <span>{a.duration_ms} ms</span>
                      </div>
                    ))}
                  {d.status === "failed" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          `${base}/deliveries/${d.id}/replay`,
                          {},
                          "POST",
                          "Delivery queued for replay.",
                        )
                      }
                    >
                      <RefreshCw size={14} />
                      Replay delivery
                    </Button>
                  )}
                </div>
              ))}
              {detail.data.replays.length > 0 && (
                <>
                  <h3>Replay history</h3>
                  {detail.data.replays.map((r) => (
                    <p key={r.id} className="muted">
                      Cycle {r.generation} started {when(r.created_at)}
                    </p>
                  ))}
                </>
              )}
            </div>
          )
        )}
      </Dialog>
    </div>
  );
}
function ActivityChart({ timeline }: { timeline: Stats["timeline"] }) {
  const current = new Date();
  current.setMinutes(0, 0, 0);
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const date = new Date(current.getTime() - (23 - i) * 3600000);
    const row = timeline.find(
      (r) => new Date(r.hour).getTime() === date.getTime(),
    );
    return { date, success: row?.succeeded || 0, failed: row?.failed || 0 };
  });
  const max = Math.max(4, ...buckets.map((b) => b.success + b.failed));
  const hasData = buckets.some((b) => b.success + b.failed);
  return (
    <div className="chart">
      <div className="chart-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((n) => (
          <span key={n}>{Math.round(max * n)}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-grid">
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} />
          ))}
        </div>
        <div className="chart-bars">
          {buckets.map((b, i) => (
            <div
              className="bar-slot"
              key={i}
              title={`${b.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${b.success} successful, ${b.failed} failed`}
            >
              <div
                className="bar-failed"
                style={{ height: `${(b.failed / max) * 100}%` }}
              />
              <div
                className="bar-success"
                style={{ height: `${(b.success / max) * 100}%` }}
              />
            </div>
          ))}
        </div>
        {!hasData && (
          <div className="chart-empty">
            <Radio size={20} />
            <span>Listening for your first delivery</span>
          </div>
        )}
        <div className="chart-labels">
          {buckets
            .filter((_, i) => i % 6 === 0 || i === 23)
            .map((b) => (
              <span key={b.date.toISOString()}>
                {b.date.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
export default function Page() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 3000, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}
