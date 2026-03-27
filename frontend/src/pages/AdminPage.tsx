import { useState, useEffect } from "react";
import { Users, Heart, Clock, Search, ChevronDown, ChevronUp } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  bio?: string;
  photo_urls: string[];
  interests: string[];
  location?: string;
  school?: string;
  looking_for?: string;
  verified: boolean;
  active: boolean;
  stats: Record<string, unknown>;
  created_at: string;
}

interface Signup {
  id: string;
  name: string;
  phone: string;
  gender?: string;
  looking_for?: string;
  hobbies: string[];
  status: string;
  created_at: string;
}

export function AdminPage() {
  const [tab, setTab] = useState<"signups" | "profiles">("signups");
  const [signups, setSignups] = useState<Signup[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch("/api/blind-date/admin/signups").then(r => r.json()),
        fetch("/api/bubl/profiles").then(r => r.json()),
      ]);
      setSignups(sRes.signups || []);
      setProfiles(pRes.profiles || []);
    } catch (e) {
      console.error("Failed to load:", e);
    }
    setLoading(false);
  };

  const filtered = tab === "signups"
    ? signups.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search))
    : profiles.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  const totalSignups = signups.length;
  const waitingCount = signups.filter(s => s.status === "waiting").length;
  const matchedCount = signups.filter(s => s.status === "matched").length;
  const maleCount = signups.filter(s => s.gender === "male" || s.gender === "Male").length;
  const femaleCount = signups.filter(s => s.gender === "female" || s.gender === "Female").length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="border-b border-white/5 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[20px] font-bold tracking-tight">bubl.</span>
            <span className="text-white/30 text-[13px]">admin</span>
          </div>
          <button onClick={loadData} className="text-white/40 text-[13px] hover:text-white transition">
            refresh
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Users className="w-4 h-4" />} label="total signups" value={totalSignups} />
          <StatCard icon={<Clock className="w-4 h-4" />} label="waiting" value={waitingCount} />
          <StatCard icon={<Heart className="w-4 h-4" />} label="matched" value={matchedCount} />
          <StatCard icon={<Users className="w-4 h-4" />} label="M / F" value={`${maleCount} / ${femaleCount}`} />
        </div>

        {/* Tabs + Search */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <div className="flex gap-1 bg-white/5 rounded-lg p-1">
            <button onClick={() => setTab("signups")}
              className={`px-4 py-2 rounded-md text-[13px] font-medium transition ${tab === "signups" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}>
              Signups ({signups.length})
            </button>
            <button onClick={() => setTab("profiles")}
              className={`px-4 py-2 rounded-md text-[13px] font-medium transition ${tab === "profiles" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}>
              Profiles ({profiles.length})
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/20" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="search..."
              className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-white/20 w-48" />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center text-white/30 py-20">loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-white/30 py-20">no results</div>
        ) : tab === "signups" ? (
          <div className="space-y-2">
            {(filtered as Signup[]).map(s => (
              <div key={s.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-pink-500/20 flex items-center justify-center text-[14px] font-bold text-pink-400">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-[14px] font-medium">{s.name}</p>
                      <p className="text-white/30 text-[12px]">{s.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                      s.status === "waiting" ? "bg-yellow-500/10 text-yellow-400" :
                      s.status === "matched" ? "bg-green-500/10 text-green-400" :
                      "bg-white/5 text-white/30"
                    }`}>{s.status}</span>
                    <span className="text-white/20 text-[12px]">{new Date(s.created_at).toLocaleDateString()}</span>
                    {expanded === s.id ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
                  </div>
                </button>
                {expanded === s.id && (
                  <div className="px-5 pb-4 border-t border-white/5 pt-3 space-y-2 text-[13px]">
                    <Row label="Gender" value={s.gender || "—"} />
                    <Row label="Looking for" value={s.looking_for || "—"} />
                    <Row label="Hobbies" value={Array.isArray(s.hobbies) && s.hobbies.length > 0 ? s.hobbies.join(", ") : "—"} />
                    <Row label="Signed up" value={new Date(s.created_at).toLocaleString()} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {(filtered as Profile[]).map(p => (
              <div key={p.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                <button onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition">
                  <div className="flex items-center gap-4">
                    {(p.photo_urls as string[])[0] ? (
                      <img src={(p.photo_urls as string[])[0]} className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-pink-500/20 flex items-center justify-center text-[14px] font-bold text-pink-400">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-white text-[14px] font-medium">{p.name}{p.age ? `, ${p.age}` : ""}</p>
                      <p className="text-white/30 text-[12px]">{p.location || "no location"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-white/20 text-[12px]">{p.gender || "—"}</span>
                    {expanded === p.id ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
                  </div>
                </button>
                {expanded === p.id && (
                  <div className="px-5 pb-4 border-t border-white/5 pt-3 space-y-2 text-[13px]">
                    <Row label="Bio" value={p.bio || "—"} />
                    <Row label="School" value={p.school || "—"} />
                    <Row label="Looking for" value={p.looking_for || "—"} />
                    <Row label="Interests" value={(p.interests as string[]).join(", ") || "—"} />
                    <Row label="Verified" value={p.verified ? "Yes" : "No"} />
                    <Row label="Joined" value={new Date(p.created_at).toLocaleString()} />
                    {(p.photo_urls as string[]).length > 0 && (
                      <div>
                        <p className="text-white/30 mb-2">Photos</p>
                        <div className="flex gap-2 overflow-x-auto">
                          {(p.photo_urls as string[]).map((url, i) => (
                            <img key={i} src={url} className="w-20 h-24 rounded-lg object-cover shrink-0" />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 text-white/30 mb-1">{icon}<span className="text-[11px] uppercase tracking-wider">{label}</span></div>
      <p className="text-[24px] font-bold text-white">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/30">{label}</span>
      <span className="text-white/70 text-right max-w-[60%]">{value}</span>
    </div>
  );
}
