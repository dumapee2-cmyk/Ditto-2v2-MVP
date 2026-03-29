import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "motion/react";

type Slot = {
  position: number;
  name: string | null;
  role: "guy" | "girl";
  is_host: boolean;
  filled: boolean;
};

type PartyData = {
  code: string;
  status: string;
  slots: Slot[];
};

const sectionVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const API = import.meta.env.VITE_API_URL || "";

function SlotCard({ slot, index, onJoin }: { slot: Slot; index: number; onJoin: () => void }) {
  const isLeft = slot.role === "guy";
  const emptyColor = isLeft ? "border-blue-500/20" : "border-pink-500/20";
  const filledBg = isLeft ? "bg-blue-500/10 border-blue-500/30" : "bg-pink-500/10 border-pink-500/30";
  const accentColor = isLeft ? "text-blue-400" : "text-pink-400";
  const pulseColor = isLeft ? "bg-blue-500" : "bg-pink-500";

  return (
    <motion.div
      variants={itemVariants}
      className={`relative border rounded-2xl p-6 transition-all duration-300 ${
        slot.filled ? filledBg : `border-dashed ${emptyColor} hover:border-opacity-50`
      }`}
      style={{ minHeight: 200 }}
    >
      <div className="absolute top-3 left-4 font-mono text-[11px] text-white/15">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className={`absolute top-3 right-4 text-[10px] font-semibold uppercase tracking-widest ${accentColor}`}>
        {slot.role === "guy" ? "his side" : "her side"}
      </div>

      <div className="flex flex-col items-center justify-center h-full pt-4">
        {slot.filled ? (
          <>
            <div className={`w-16 h-16 rounded-full ${isLeft ? "bg-blue-500/20" : "bg-pink-500/20"} flex items-center justify-center mb-3 ring-2 ${isLeft ? "ring-blue-500/30" : "ring-pink-500/30"}`}>
              <span className="text-2xl">{isLeft ? "🧑" : "👩"}</span>
            </div>
            <p className="text-white font-semibold text-[16px]">{slot.name}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <div className={`w-2 h-2 rounded-full ${pulseColor} animate-pulse`} />
              <span className="text-[12px] text-white/40">{slot.is_host ? "matched" : "joined"}</span>
            </div>
          </>
        ) : (
          <>
            <div className={`w-16 h-16 rounded-full border-2 border-dashed ${emptyColor} flex items-center justify-center mb-3`}>
              <span className="text-2xl opacity-30">{isLeft ? "🧑" : "👩"}</span>
            </div>
            <p className="text-white/25 text-[14px] mb-3">waiting for +1...</p>
            <button
              onClick={onJoin}
              className={`px-5 py-2 rounded-full text-[13px] font-semibold transition-all ${
                isLeft
                  ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                  : "bg-pink-500/20 text-pink-300 hover:bg-pink-500/30"
              }`}
            >
              join slot
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function JoinModal({ role, onClose, onSubmit, submitting }: { role: "guy" | "girl"; onClose: () => void; onSubmit: (name: string, phone: string) => void; submitting: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const fmt = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative bg-[#1a1a1a] border border-white/10 rounded-2xl p-8 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-white font-bold text-[24px] mb-1">join the party</h3>
        <p className="text-white/40 text-[14px] mb-6">you're joining as {role === "guy" ? "his" : "her"} +1</p>

        <div className="space-y-3">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="your name"
            className="w-full px-4 py-3 rounded-lg border border-white/10 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/25 transition bg-white/5" />
          <div>
            <input type="tel" value={phone} onChange={(e) => setPhone(fmt(e.target.value))} placeholder="phone"
              className="w-full px-4 py-3 rounded-lg border border-white/10 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/25 transition bg-white/5" />
            <p className="text-[11px] text-white/15 mt-1 ml-1">iMessage required</p>
          </div>
          <button
            onClick={() => { if (name.trim() && phone.trim()) onSubmit(name.trim(), phone.trim()); }}
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-white text-black font-semibold text-[14px] hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-50"
          >
            {submitting ? <div className="w-4 h-4 mx-auto border-2 border-black/20 border-t-black rounded-full animate-spin" /> : "I'm in"}
          </button>
        </div>

        <button onClick={onClose} className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition text-[20px]">&times;</button>
      </motion.div>
    </motion.div>
  );
}

export function PartyPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [party, setParty] = useState<PartyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joinModal, setJoinModal] = useState<"guy" | "girl" | null>(null);
  const [joinError, setJoinError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch party data
  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError("no party code");
      return;
    }
    fetch(`${API}/api/party/${code}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) setParty(data.party);
        else setError(data.error || "party not found");
      })
      .catch(() => setError("couldn't connect"))
      .finally(() => setLoading(false));
  }, [code]);

  // Poll for updates every 5s
  useEffect(() => {
    if (!code || !party) return;
    const interval = setInterval(() => {
      fetch(`${API}/api/party/${code}`)
        .then(r => r.json())
        .then(data => { if (data.ok) setParty(data.party); })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [code, party]);

  const shareUrl = party ? `${window.location.origin}/party/${party.code}` : "";

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = async (name: string, phone: string) => {
    if (!joinModal || !code) return;
    setSubmitting(true);
    setJoinError("");
    try {
      const res = await fetch(`${API}/api/party/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, role: joinModal }),
      });
      const data = await res.json();
      if (data.ok) {
        setParty(data.party);
        setJoinModal(null);
      } else {
        setJoinError(data.error || "couldn't join");
      }
    } catch {
      setJoinError("couldn't connect");
    } finally {
      setSubmitting(false);
    }
  };

  const slots = party?.slots || [];
  const allFilled = slots.length === 4 && slots.every(s => s.filled);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // No code provided — show landing
  if (!code) {
    return (
      <div className="min-h-screen relative">
        <div className="fixed inset-0 z-0">
          <img src="/bg.jpg" alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 backdrop-blur-[12px] bg-black/50" />
        </div>
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <h1 className="text-[48px] sm:text-[64px] font-bold tracking-[-0.04em] text-white leading-[0.95] mb-4">double date</h1>
          <p className="text-white/40 text-[18px] mb-8">you need an invite link to join a party</p>
          <button onClick={() => navigate("/")} className="px-8 py-3 rounded-full bg-white text-black font-semibold text-[14px]">
            back to bubl
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen relative">
        <div className="fixed inset-0 z-0">
          <img src="/bg.jpg" alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 backdrop-blur-[12px] bg-black/50" />
        </div>
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <h1 className="text-[32px] font-bold text-white mb-2">party not found</h1>
          <p className="text-white/40 text-[16px] mb-8">{error}</p>
          <button onClick={() => navigate("/")} className="px-8 py-3 rounded-full bg-white text-black font-semibold text-[14px]">
            back to bubl
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <div className="fixed inset-0 z-0">
        <img src="/bg.jpg" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 backdrop-blur-[12px] bg-black/50" />
      </div>

      <nav className="fixed top-0 w-full z-50 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="text-white font-bold text-[18px] tracking-[-0.03em]">bubl.</button>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[12px] text-white/30 tracking-wider">{party?.code}</span>
            <div className={`w-2 h-2 rounded-full ${allFilled ? "bg-green-500" : "bg-yellow-500"} animate-pulse`} />
          </div>
        </div>
      </nav>

      <div className="relative z-10 pt-24 pb-20 px-5 sm:px-6">
        <motion.div variants={sectionVariants} initial="hidden" animate="visible" className="max-w-2xl mx-auto">

          <motion.div variants={itemVariants} className="text-center mb-12">
            <h1 className="text-[40px] sm:text-[56px] font-bold tracking-[-0.04em] text-white leading-[0.95]">
              double date
            </h1>
            <p className="mt-3 text-white/40 text-[16px] sm:text-[18px]">
              2v2 &middot; every match brings a friend
            </p>
          </motion.div>

          <div className="grid grid-cols-2 gap-4 mb-10">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-400/50 text-center mb-2">his side</p>
              {slots.filter(s => s.role === "guy").map((s, i) => (
                <SlotCard key={s.position} slot={s} index={i} onJoin={() => setJoinModal("guy")} />
              ))}
            </div>
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-pink-400/50 text-center mb-2">her side</p>
              {slots.filter(s => s.role === "girl").map((s, i) => (
                <SlotCard key={s.position} slot={s} index={i + 2} onJoin={() => setJoinModal("girl")} />
              ))}
            </div>
          </div>

          <motion.div variants={itemVariants} className="flex items-center justify-center gap-4 mb-10">
            <div className="h-px flex-1 bg-white/5" />
            <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center">
              <span className="text-white/20 font-bold text-[14px]">VS</span>
            </div>
            <div className="h-px flex-1 bg-white/5" />
          </motion.div>

          <motion.div variants={itemVariants} className="text-center mb-8">
            {allFilled ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-6 py-4">
                <p className="text-green-400 font-semibold text-[16px]">party's full — let's go</p>
                <p className="text-green-400/50 text-[13px] mt-1">match details drop thursday 9–11am</p>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-xl px-6 py-4">
                <p className="text-white/60 text-[15px]">
                  {slots.filter(s => !s.filled).length} slot{slots.filter(s => !s.filled).length > 1 ? "s" : ""} left — share the link
                </p>
              </div>
            )}
          </motion.div>

          {joinError && (
            <p className="text-red-400 text-[13px] text-center mb-4">{joinError}</p>
          )}

          <motion.div variants={itemVariants} className="flex flex-col items-center gap-3">
            <button
              onClick={copyLink}
              className="px-8 py-3 rounded-full bg-white text-black font-semibold text-[14px] hover:bg-white/90 active:scale-[0.97] transition"
            >
              {copied ? "copied!" : "copy invite link"}
            </button>
            <p className="text-white/20 text-[12px] font-mono">{shareUrl}</p>
          </motion.div>

          <motion.div variants={itemVariants} className="mt-16 border-t border-white/5 pt-10">
            <p className="text-white/30 text-[13px] uppercase tracking-widest font-semibold mb-6 text-center">how it works</p>
            <div className="grid sm:grid-cols-3 gap-6 text-center">
              {[
                { step: "01", text: "you get matched with someone" },
                { step: "02", text: "both of you invite a friend to fill the party" },
                { step: "03", text: "thursday hits — double date time" },
              ].map((s) => (
                <div key={s.step}>
                  <span className="font-mono text-[11px] text-white/15">{s.step}</span>
                  <p className="text-white/40 text-[14px] mt-2 leading-relaxed">{s.text}</p>
                </div>
              ))}
            </div>
          </motion.div>

        </motion.div>
      </div>

      {joinModal && (
        <JoinModal role={joinModal} onClose={() => setJoinModal(null)} onSubmit={handleJoin} submitting={submitting} />
      )}
    </div>
  );
}
