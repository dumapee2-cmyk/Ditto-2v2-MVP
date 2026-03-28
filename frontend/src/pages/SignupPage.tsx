import { useState, useRef } from "react";
import { Camera, Check, ChevronDown } from "lucide-react";
import { motion } from "motion/react";

type Step = "info" | "photos" | "interests" | "done";

const INTEREST_OPTIONS = [
  "hiking", "gym", "music", "cooking", "travel", "gaming",
  "reading", "art", "photography", "movies", "dancing", "yoga",
  "surfing", "skateboarding", "coffee", "boba", "anime", "fashion",
  "sports", "festivals", "dogs", "cats", "food", "nightlife",
];

export function SignupPage() {
  const [step, setStep] = useState<Step>("info");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [lookingFor, setLookingFor] = useState("");
  const [location, setLocation] = useState("");
  const [school, setSchool] = useState("");
  const [bio, setBio] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fmtPhone = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  };

  const addPhoto = (f: File) => {
    if (photos.length >= 6) return;
    setPhotos(prev => [...prev, f]);
    const r = new FileReader();
    r.onload = (e) => setPhotoPreviews(prev => [...prev, e.target?.result as string]);
    r.readAsDataURL(f);
  };

  const removePhoto = (i: number) => {
    setPhotos(prev => prev.filter((_, idx) => idx !== i));
    setPhotoPreviews(prev => prev.filter((_, idx) => idx !== i));
  };

  const toggleInterest = (interest: string) => {
    setInterests(prev =>
      prev.includes(interest)
        ? prev.filter(i => i !== interest)
        : prev.length < 8 ? [...prev, interest] : prev
    );
  };

  const submit = async () => {
    setError("");
    setSubmitting(true);
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("phone", phone.replace(/\D/g, ""));
    fd.append("age", age);
    fd.append("gender", gender);
    fd.append("looking_for", lookingFor);
    fd.append("location", location.trim());
    fd.append("school", school.trim());
    fd.append("bio", bio.trim());
    fd.append("interests", JSON.stringify(interests));
    photos.forEach(p => fd.append("photos", p));

    try {
      const res = await fetch("/api/bubl/profile", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "something went wrong"); setSubmitting(false); return; }
      setStep("done");
    } catch {
      setError("couldn't connect — try again");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-pink-950/30 via-black to-black" />
      </div>

      <nav className="fixed top-0 w-full z-50 border-b border-white/5 backdrop-blur-md">
        <div className="max-w-lg mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-white font-bold text-[18px] tracking-[-0.03em]">bubl.</span>
          <span className="text-white/40 text-[13px]">
            {step === "info" ? "1/3" : step === "photos" ? "2/3" : step === "interests" ? "3/3" : "✓"}
          </span>
        </div>
      </nav>

      <div className="relative z-10 max-w-lg mx-auto px-6 pt-24 pb-16">
        {/* Step 1: Basic Info */}
        {step === "info" && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-[32px] font-bold tracking-tight">let's set you up</h1>
            <p className="text-white/50 mt-1 mb-8">takes 30 seconds</p>

            <div className="space-y-4">
              <div>
                <label className="text-[13px] text-white/50 mb-1 block">name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50"
                  placeholder="first name" />
              </div>
              <div>
                <label className="text-[13px] text-white/50 mb-1 block">phone</label>
                <input value={phone} onChange={e => setPhone(fmtPhone(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50"
                  placeholder="(949) 000-0000" inputMode="tel" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[13px] text-white/50 mb-1 block">age</label>
                  <input value={age} onChange={e => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50"
                    placeholder="18" inputMode="numeric" />
                </div>
                <div className="flex-1">
                  <label className="text-[13px] text-white/50 mb-1 block">gender</label>
                  <div className="relative">
                    <select value={gender} onChange={e => setGender(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-pink-500/50">
                      <option value="" className="bg-black">select</option>
                      <option value="male" className="bg-black">male</option>
                      <option value="female" className="bg-black">female</option>
                      <option value="nonbinary" className="bg-black">nonbinary</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-white/30 pointer-events-none" />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[13px] text-white/50 mb-1 block">interested in</label>
                <div className="relative">
                  <select value={lookingFor} onChange={e => setLookingFor(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-pink-500/50">
                    <option value="" className="bg-black">select</option>
                    <option value="male" className="bg-black">men</option>
                    <option value="female" className="bg-black">women</option>
                    <option value="everyone" className="bg-black">everyone</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-white/30 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-[13px] text-white/50 mb-1 block">location</label>
                <input value={location} onChange={e => setLocation(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50"
                  placeholder="Irvine, CA" />
              </div>
              <div>
                <label className="text-[13px] text-white/50 mb-1 block">school (optional)</label>
                <input value={school} onChange={e => setSchool(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50"
                  placeholder="UCI, IVC..." />
              </div>
              <div>
                <label className="text-[13px] text-white/50 mb-1 block">bio</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={200}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-pink-500/50 resize-none"
                  placeholder="a lil about you..." />
                <p className="text-[11px] text-white/20 text-right mt-1">{bio.length}/200</p>
              </div>
            </div>

            <button onClick={() => {
              if (!name.trim() || !phone.trim() || !age || !gender || !lookingFor) {
                setError("fill in the required fields"); return;
              }
              setError(""); setStep("photos");
            }} className="w-full mt-6 py-3.5 bg-pink-500 hover:bg-pink-600 rounded-xl font-semibold text-[15px] transition">
              next →
            </button>
            {error && <p className="text-red-400 text-[13px] text-center mt-3">{error}</p>}
          </motion.div>
        )}

        {/* Step 2: Photos */}
        {step === "photos" && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-[32px] font-bold tracking-tight">add photos</h1>
            <p className="text-white/50 mt-1 mb-8">at least 1, up to 6</p>

            <div className="grid grid-cols-3 gap-3">
              {photoPreviews.map((src, i) => (
                <div key={i} className="aspect-[3/4] rounded-2xl overflow-hidden relative group">
                  <img src={src} className="w-full h-full object-cover" />
                  <button onClick={() => removePhoto(i)}
                    className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white text-[12px] opacity-0 group-hover:opacity-100 transition">
                    ×
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <button onClick={() => fileRef.current?.click()}
                  className="aspect-[3/4] rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 hover:border-pink-500/30 transition">
                  <Camera className="w-6 h-6 text-white/30" />
                  <span className="text-[11px] text-white/30">add</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { if (e.target.files?.[0]) addPhoto(e.target.files[0]); e.target.value = ""; }} />

            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep("info")}
                className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-xl font-semibold text-[15px]">
                ← back
              </button>
              <button onClick={() => {
                if (photos.length === 0) { setError("add at least 1 photo"); return; }
                setError(""); setStep("interests");
              }} className="flex-1 py-3.5 bg-pink-500 hover:bg-pink-600 rounded-xl font-semibold text-[15px] transition">
                next →
              </button>
            </div>
            {error && <p className="text-red-400 text-[13px] text-center mt-3">{error}</p>}
          </motion.div>
        )}

        {/* Step 3: Interests */}
        {step === "interests" && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-[32px] font-bold tracking-tight">pick your vibes</h1>
            <p className="text-white/50 mt-1 mb-8">select up to 8</p>

            <div className="flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map(interest => (
                <button key={interest} onClick={() => toggleInterest(interest)}
                  className={`px-4 py-2 rounded-full text-[14px] transition ${
                    interests.includes(interest)
                      ? "bg-pink-500 text-white"
                      : "bg-white/5 text-white/60 border border-white/10 hover:border-pink-500/30"
                  }`}>
                  {interest}
                </button>
              ))}
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setStep("photos")}
                className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-xl font-semibold text-[15px]">
                ← back
              </button>
              <button onClick={submit} disabled={submitting}
                className="flex-1 py-3.5 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-500/50 rounded-xl font-semibold text-[15px] transition">
                {submitting ? "submitting..." : "finish →"}
              </button>
            </div>
            {error && <p className="text-red-400 text-[13px] text-center mt-3">{error}</p>}
          </motion.div>
        )}

        {/* Done */}
        {step === "done" && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="text-center pt-20">
            <div className="w-20 h-20 bg-pink-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-pink-500" />
            </div>
            <h1 className="text-[32px] font-bold tracking-tight">you're in</h1>
            <p className="text-white/50 mt-2 text-[16px]">
              bubl will text you on Wednesday with your match
            </p>
            <p className="text-white/30 mt-6 text-[13px]">
              you can close this page now
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
