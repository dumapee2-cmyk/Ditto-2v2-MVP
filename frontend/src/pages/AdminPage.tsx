import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";

interface Signup {
  id: string;
  name: string;
  phone: string;
  gender?: string;
  looking_for?: string;
  hobbies: string[];
  status: string;
  school_id_url?: string;
  created_at: string;
}

const ADMIN_PASS = "bubl2026";

export function AdminPage() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("bubl-admin") === "true");
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState(false);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Signup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (authed) loadData(); }, [authed]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-[24px] font-bold text-white mb-1">bubl.</h1>
          <p className="text-white/30 text-[13px] mb-6">admin access</p>
          <input
            type="password"
            value={passInput}
            onChange={e => { setPassInput(e.target.value); setPassError(false); }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                if (passInput === ADMIN_PASS) {
                  sessionStorage.setItem("bubl-admin", "true");
                  setAuthed(true);
                } else {
                  setPassError(true);
                }
              }
            }}
            placeholder="password"
            className={`w-[240px] px-4 py-2.5 bg-white/5 border ${passError ? 'border-red-500/50' : 'border-white/10'} rounded-lg text-[14px] text-white text-center placeholder-white/20 focus:outline-none focus:border-white/20`}
            autoFocus
          />
          {passError && <p className="text-red-400 text-[12px] mt-2">wrong password</p>}
        </div>
      </div>
    );
  }

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/blind-date/admin/signups");
      const data = await res.json();
      setSignups(data.signups || []);
    } catch (e) { console.error("Failed to load:", e); }
    setLoading(false);
  };

  const removeSignup = async (id: string) => {
    if (!confirm("Remove this person from the waitlist?")) return;
    try {
      await fetch(`/api/blind-date/admin/signups/${id}`, { method: "DELETE" });
      setSignups(prev => prev.filter(s => s.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch (e) { console.error("Failed to remove:", e); }
  };

  const filtered = signups.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search)
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex">
      {/* Sidebar — user list */}
      <div className="w-[340px] border-r border-white/5 flex flex-col h-screen">
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[18px] font-bold">bubl.</span>
              <span className="text-white/30 text-[12px]">admin</span>
            </div>
            <span className="text-white/30 text-[12px]">{signups.length} waitlists</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/20" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="search waitlists..."
              className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/8 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-white/15" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-center text-white/20 py-10 text-[13px]">loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-white/20 py-10 text-[13px]">no waitlists</p>
          ) : (
            filtered.map(s => (
              <button key={s.id} onClick={() => setSelected(s)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition border-b border-white/[0.03] ${
                  selected?.id === s.id ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                }`}>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/30 to-purple-500/30 flex items-center justify-center shrink-0">
                  {s.school_id_url ? (
                    <img src={s.school_id_url} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <span className="text-[15px] font-bold text-pink-400">{s.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-[14px] font-medium truncate">{s.name}</p>
                  <p className="text-white/30 text-[12px] truncate">{s.phone}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    s.status === "waiting" ? "bg-yellow-500/10 text-yellow-400" :
                    s.status === "matched" ? "bg-green-500/10 text-green-400" :
                    "bg-white/5 text-white/30"
                  }`}>{s.status}</span>
                  <span className="text-white/15 text-[10px]">{timeAgo(s.created_at)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main — user profile card */}
      <div className="flex-1 flex items-center justify-center p-8">
        {selected ? (
          <div className="max-w-md w-full">
            {/* Close button */}
            <button onClick={() => setSelected(null)}
              className="mb-4 text-white/30 hover:text-white/60 transition">
              <X className="w-5 h-5" />
            </button>

            {/* Profile card */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl overflow-hidden">
              {/* Photo */}
              {selected.school_id_url && (
                <div className="w-full aspect-[4/3] bg-white/[0.02]">
                  <img src={selected.school_id_url} className="w-full h-full object-cover" />
                </div>
              )}

              {/* Info */}
              <div className="p-6 space-y-5">
                <div>
                  <h2 className="text-[28px] font-bold text-white">{selected.name}</h2>
                  <p className="text-white/40 text-[14px] mt-1">{selected.phone}</p>
                </div>

                <div className="h-px bg-white/5" />

                <ProfileRow label="Status" value={
                  <span className={`text-[13px] px-3 py-1 rounded-full ${
                    selected.status === "waiting" ? "bg-yellow-500/10 text-yellow-400" :
                    selected.status === "matched" ? "bg-green-500/10 text-green-400" :
                    "bg-white/5 text-white/30"
                  }`}>{selected.status}</span>
                } />
                <ProfileRow label="Gender" value={<span className="text-white/70 text-[14px]">{selected.gender || "—"}</span>} />
                <ProfileRow label="Looking for" value={<span className="text-white/70 text-[14px]">{selected.looking_for || "—"}</span>} />
                <ProfileRow label="Hobbies" value={
                  Array.isArray(selected.hobbies) && selected.hobbies.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selected.hobbies.map(h => (
                        <span key={h} className="text-[12px] px-2.5 py-1 rounded-full bg-white/5 text-white/50">{h}</span>
                      ))}
                    </div>
                  ) : <span className="text-white/30 text-[14px]">—</span>
                } />
                <ProfileRow label="Signed up" value={
                  <span className="text-white/50 text-[13px]">{new Date(selected.created_at).toLocaleString()}</span>
                } />

                <button onClick={() => removeSignup(selected.id)}
                  className="w-full mt-2 py-2.5 rounded-xl bg-red-500/10 text-red-400 text-[13px] font-medium hover:bg-red-500/20 transition">
                  Remove from waitlist
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-white/15 text-[15px]">select a user to view their profile</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-white/30 text-[11px] uppercase tracking-wider mb-1.5">{label}</p>
      {value}
    </div>
  );
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
