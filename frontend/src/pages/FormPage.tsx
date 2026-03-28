import { useState, useRef } from "react";
import { Check, X } from "lucide-react";
import { motion } from "motion/react";

const ETHNICITY_OPTIONS = [
  "American Indian", "Black/African Descent", "White", "East Asian",
  "South Asian", "Middle Eastern", "Pacific Islander", "South East Asian",
  "Hispanic/Latino",
];

const LOOKING_FOR_OPTIONS = [
  "Life partner", "Serious relationship", "Casual dates", "New friends", "Not sure yet",
];

const DATE_WHO_OPTIONS = ["Men", "Women", "Everyone"];

const ETHNICITY_PREF_OPTIONS = [...ETHNICITY_OPTIONS.filter(e => e !== "Prefer not to say"), "No preference"];

const MATCHING_SPEED = [
  { icon: "⚡", label: "Fast", desc: "speed over perfection" },
  { icon: "⚖️", label: "Balanced", desc: "decent fit" },
  { icon: "🎯", label: "Intentional", desc: "most preferences match" },
  { icon: "💎", label: "Wait for the one", desc: "all boxes checked" },
];

const YEAR_OPTIONS = ["Freshman", "Sophomore", "Junior", "Senior", "Master", "PhD", "Other"];
const HEARD_FROM_OPTIONS = ["Poster", "Instagram", "TikTok", "X (Twitter)", "Friend"];

export function FormPage() {
  // basics
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState("");
  const [ethnicity, setEthnicity] = useState<string[]>([]);
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");

  // hobbies
  const [hobbies, setHobbies] = useState("");

  // school
  const [year, setYear] = useState("");
  const [heardFrom, setHeardFrom] = useState("");
  const [heardOther, setHeardOther] = useState("");

  // type
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [dateWho, setDateWho] = useState<string[]>([]);
  const [ageRange, setAgeRange] = useState([18, 50]);
  const [ethnicityPref, setEthnicityPref] = useState<string[]>([]);

  // attraction
  const [heightPref, setHeightPref] = useState("");
  const [heightPrefSkip, setHeightPrefSkip] = useState(false);
  const [facePref, setFacePref] = useState("");
  const [facePrefSkip, setFacePrefSkip] = useState(false);
  const [vibePref, setVibePref] = useState("");
  const [vibePrefSkip, setVibePrefSkip] = useState(false);

  // matching
  const [matchSpeed, setMatchSpeed] = useState("");

  // photos
  const [photos, setPhotos] = useState<(File | null)[]>([null, null, null, null, null, null]);
  const [previews, setPreviews] = useState<(string | null)[]>([null, null, null, null, null, null]);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const toggleMulti = (arr: string[], val: string, set: (v: string[]) => void) =>
    set(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);

  const addPhoto = (i: number, f: File) => {
    const newPhotos = [...photos]; newPhotos[i] = f; setPhotos(newPhotos);
    const r = new FileReader();
    r.onload = (e) => { const p = [...previews]; p[i] = e.target?.result as string; setPreviews(p); };
    r.readAsDataURL(f);
  };

  const removePhoto = (i: number) => {
    const p = [...photos]; p[i] = null; setPhotos(p);
    const pr = [...previews]; pr[i] = null; setPreviews(pr);
  };

  const submit = async () => {
    if (!name.trim()) { setError("name is required"); return; }
    const realPhotos = photos.filter(Boolean);
    if (realPhotos.length === 0) { setError("add at least 1 photo"); return; }
    setError(""); setSubmitting(true);

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("birthday", birthday);
    fd.append("gender", gender);
    fd.append("ethnicity", JSON.stringify(ethnicity));
    fd.append("height", heightFt && heightIn ? `${heightFt}'${heightIn}"` : "");
    fd.append("hobbies", hobbies.trim());
    fd.append("year", year);
    fd.append("heard_from", heardFrom === "Other" ? heardOther : heardFrom);
    fd.append("looking_for", JSON.stringify(lookingFor));
    fd.append("date_who", JSON.stringify(dateWho));
    fd.append("age_range", JSON.stringify(ageRange));
    fd.append("ethnicity_pref", JSON.stringify(ethnicityPref));
    fd.append("height_pref", heightPrefSkip ? "" : heightPref);
    fd.append("face_pref", facePrefSkip ? "" : facePref);
    fd.append("vibe_pref", vibePrefSkip ? "" : vibePref);
    fd.append("match_speed", matchSpeed);
    realPhotos.forEach(p => fd.append("photos", p!));

    try {
      const res = await fetch("/api/bubl/profile", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "something went wrong"); setSubmitting(false); return; }
      setDone(true);
    } catch { setError("couldn't connect — try again"); setSubmitting(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen relative">
        <div className="fixed inset-0 z-0"><img src="/bg.jpg" alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 backdrop-blur-[12px] bg-black/40" /></div>
        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-6"><Check className="w-10 h-10 text-white" /></div>
            <h1 className="text-[36px] font-bold text-white tracking-tight">you're in</h1>
            <p className="text-white/50 mt-2 text-[16px]">bubl will text you on wednesday with your match</p>
            <p className="text-white/20 mt-8 text-[13px]">you can close this page</p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <img src="/bg.jpg" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 backdrop-blur-[12px] bg-black/40" />
      </div>

      <div className="relative z-10">
        {/* ─── Section 1: Basics ─── */}
        <section className="min-h-screen flex flex-col justify-center px-6 py-20">
          <div className="max-w-lg mx-auto w-full">
            <h1 className="text-[36px] sm:text-[48px] font-bold text-white tracking-tight mb-2 text-center">
              bubl. your <span className="text-pink-400">basics</span>
            </h1>
            <div className="mt-10 bg-white/[0.06] backdrop-blur-md rounded-2xl border border-white/[0.08] p-6 space-y-6">
              <Field label="What's your name?">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Type your answer here..."
                  className="inp" />
              </Field>
              <Field label="When is your birthday?" sub="Only your age will be shown to others">
                <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)}
                  className="inp" />
              </Field>
              <Field label="What's your gender?">
                <Pills options={["Female", "Male"]} selected={gender ? [gender] : []}
                  onToggle={v => setGender(v === gender ? "" : v)} />
              </Field>
              <Field label="What's your ethnicity?" sub="Select all that apply">
                <Pills options={ETHNICITY_OPTIONS} selected={ethnicity}
                  onToggle={v => toggleMulti(ethnicity, v, setEthnicity)} />
              </Field>
              <Field label="How tall are you?">
                <div className="flex gap-3 items-center">
                  <div className="flex items-center gap-1">
                    <input value={heightFt} onChange={e => setHeightFt(e.target.value.replace(/\D/g, "").slice(0, 1))}
                      className="inp w-16 text-center" placeholder="5" inputMode="numeric" />
                    <span className="text-white/40 text-[14px]">ft</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input value={heightIn} onChange={e => setHeightIn(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      className="inp w-16 text-center" placeholder="11" inputMode="numeric" />
                    <span className="text-white/40 text-[14px]">in</span>
                  </div>
                </div>
              </Field>
            </div>
          </div>
        </section>

        {/* ─── Section 2: Hobbies ─── */}
        <section className="px-6 py-20">
          <div className="max-w-lg mx-auto w-full">
            <div className="bg-white/[0.06] backdrop-blur-md rounded-2xl border border-white/[0.08] p-6 space-y-6">
              <Field label="Share your hobbies and interests">
                <textarea value={hobbies} onChange={e => setHobbies(e.target.value)} rows={4}
                  className="inp resize-none" placeholder={"example:\n hiking with dog\n reading feminism literature\n music (kdot, keshi, laufey)"} />
              </Field>
              <Field label="What year are you in">
                <RadioList options={YEAR_OPTIONS} selected={year} onSelect={setYear} />
              </Field>
              <Field label="Where did you hear from us?">
                <RadioList options={[...HEARD_FROM_OPTIONS, "Other"]} selected={heardFrom} onSelect={setHeardFrom} />
                {heardFrom === "Other" && (
                  <input value={heardOther} onChange={e => setHeardOther(e.target.value)}
                    placeholder="Please specify..." className="inp mt-2" />
                )}
              </Field>
            </div>
          </div>
        </section>

        {/* ─── Section 3: Type ─── */}
        <section className="px-6 py-20">
          <div className="max-w-lg mx-auto w-full">
            <h2 className="text-[36px] sm:text-[48px] font-bold text-white tracking-tight mb-2 text-center">
              bubl. your <span className="text-pink-400">type</span>
            </h2>
            <div className="mt-10 bg-white/[0.06] backdrop-blur-md rounded-2xl border border-white/[0.08] p-6 space-y-6">
              <Field label="What are you looking for right now?" sub="Select all that apply">
                <Pills options={LOOKING_FOR_OPTIONS} selected={lookingFor}
                  onToggle={v => toggleMulti(lookingFor, v, setLookingFor)} />
              </Field>
              <Field label="Who do you wanna date?" sub="Select all who you're open to meeting">
                <Pills options={DATE_WHO_OPTIONS} selected={dateWho}
                  onToggle={v => toggleMulti(dateWho, v, setDateWho)} />
              </Field>
              <Field label="What age range would you like to date in?" sub="Drag the slider to set your preferred age range.">
                <div className="space-y-3">
                  <input type="range" min={18} max={50} value={ageRange[1]}
                    onChange={e => setAgeRange([ageRange[0], parseInt(e.target.value)])}
                    className="w-full accent-pink-500" />
                  <span className="text-white/40 text-[13px] bg-white/5 px-3 py-1 rounded-full">
                    Age range: {ageRange[0]}-{ageRange[1]}+
                  </span>
                </div>
              </Field>
              <Field label="What ethnicities are you attracted to?" sub="Select all that apply">
                <Pills options={ETHNICITY_PREF_OPTIONS} selected={ethnicityPref}
                  onToggle={v => toggleMulti(ethnicityPref, v, setEthnicityPref)} />
              </Field>
            </div>
          </div>
        </section>

        {/* ─── Section 4: Attraction ─── */}
        <section className="px-6 py-20">
          <div className="max-w-lg mx-auto w-full">
            <div className="bg-white/[0.06] backdrop-blur-md rounded-2xl border border-white/[0.08] p-6 space-y-6">
              <h3 className="text-[20px] font-bold text-white">What do you find physically attractive?</h3>
              <AttractionField label="Height & Build" value={heightPref} onChange={setHeightPref}
                skip={heightPrefSkip} onSkip={setHeightPrefSkip} placeholder="5'in, athletic, broad shoulders..." />
              <AttractionField label="Facial Features" value={facePref} onChange={setFacePref}
                skip={facePrefSkip} onSkip={setFacePrefSkip} placeholder="expressive eyes, warm smiles, clean-shaven..." />
              <AttractionField label="Energy & Vibes" value={vibePref} onChange={setVibePref}
                skip={vibePrefSkip} onSkip={setVibePrefSkip} placeholder="Artsy/Indie, Nerd/Smart, Calm & Grounding..." />
            </div>
          </div>
        </section>

        {/* ─── Section 5: Matching Speed ─── */}
        <section className="px-6 py-20">
          <div className="max-w-lg mx-auto w-full">
            <div className="bg-white/[0.06] backdrop-blur-md rounded-2xl border border-white/[0.08] p-6 space-y-4">
              <Field label="How do you want bubl to match you rn" sub="Select all that apply">
                {MATCHING_SPEED.map(s => (
                  <button key={s.label} onClick={() => setMatchSpeed(s.label)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition ${
                      matchSpeed === s.label ? "bg-white/10 border border-white/20" : "hover:bg-white/5"
                    }`}>
                    <span className="text-[20px]">{s.icon}</span>
                    <div>
                      <span className="text-white text-[14px] font-semibold">{s.label}</span>
                      <span className="text-white/40 text-[13px] ml-2">- {s.desc}</span>
                    </div>
                  </button>
                ))}
              </Field>
            </div>
          </div>
        </section>

        {/* ─── Section 6: Photos ─── */}
        <section className="px-6 py-20">
          <div className="max-w-lg mx-auto w-full text-center">
            <h2 className="text-[36px] sm:text-[48px] font-bold text-white tracking-tight mb-2">
              <span className="text-pink-400">5 pics</span> of your vibe
            </h2>
            <div className="mt-10 bg-white/[0.06] backdrop-blur-md rounded-2xl border border-white/[0.08] p-6">
              <p className="text-white text-[15px] font-semibold text-left mb-1">Add 5 pics that show your face and vibe</p>
              <p className="text-white/40 text-[13px] text-left mb-4">Clear face photos from different moments help bubl find better matches for you. You can swap them anytime.</p>
              <div className="grid grid-cols-3 gap-3">
                {previews.map((src, i) => (
                  <div key={i} className="aspect-[3/4] rounded-xl overflow-hidden relative">
                    {src ? (
                      <div className="relative group w-full h-full">
                        <img src={src} className="w-full h-full object-cover" />
                        <button onClick={() => removePhoto(i)}
                          className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => fileRefs.current[i]?.click()}
                        className={`w-full h-full flex items-center justify-center transition ${
                          i === 0 ? "bg-white/10" : "border-2 border-dashed border-white/10 hover:border-white/20"
                        }`}>
                        <span className="text-white/30 text-[24px]">+</span>
                      </button>
                    )}
                    <input ref={el => { fileRefs.current[i] = el; }} type="file" accept="image/*" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) addPhoto(i, e.target.files[0]); e.target.value = ""; }} />
                  </div>
                ))}
              </div>
            </div>

            <p className="text-white/30 text-[12px] mt-6">By continuing, you agree to our <span className="underline">Terms</span> & <span className="underline">Privacy</span>.</p>

            {error && <p className="text-red-400 text-[13px] mt-3">{error}</p>}

            <button onClick={submit} disabled={submitting}
              className="w-full mt-4 py-4 rounded-full bg-white/90 text-pink-500 font-bold text-[16px] hover:bg-white active:scale-[0.98] transition disabled:opacity-50">
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─── Reusable components ─── */

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-white text-[15px] font-semibold mb-1">{label}</p>
      {sub && <p className="text-white/40 text-[13px] mb-3">{sub}</p>}
      {children}
    </div>
  );
}

function Pills({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o} onClick={() => onToggle(o)}
          className={`px-4 py-2 rounded-full text-[13px] transition ${
            selected.includes(o)
              ? "bg-white/20 text-white border border-white/30"
              : "bg-white/5 text-white/50 border border-white/[0.08] hover:border-white/20"
          }`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function RadioList({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (v: string) => void }) {
  return (
    <div className="space-y-2">
      {options.map(o => (
        <button key={o} onClick={() => onSelect(o)}
          className="w-full flex items-center gap-3 text-left py-2">
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
            selected === o ? "border-white bg-white" : "border-white/20"
          }`}>
            {selected === o && <div className="w-2.5 h-2.5 rounded-full bg-black" />}
          </div>
          <span className="text-white text-[14px]">{o}</span>
        </button>
      ))}
    </div>
  );
}

function AttractionField({ label, value, onChange, skip, onSkip, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  skip: boolean; onSkip: (v: boolean) => void; placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white text-[14px] font-semibold">{label}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={skip} onChange={e => onSkip(e.target.checked)}
            className="w-4 h-4 rounded bg-white/10 border-white/20 accent-pink-500" />
          <span className="text-white/40 text-[12px]">i don't care</span>
        </label>
      </div>
      <textarea value={skip ? "" : value} onChange={e => onChange(e.target.value)} rows={2}
        disabled={skip} placeholder={placeholder}
        className={`inp resize-none ${skip ? "opacity-30" : ""}`} />
    </div>
  );
}
