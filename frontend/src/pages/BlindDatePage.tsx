import { useState, useRef } from "react";
import { Check } from "lucide-react";
import { motion, type Variants } from "motion/react";

/* ─── Scrapbook paper styles ─── */
type PaperStyle = "lined" | "grid" | "plain" | "yellow" | "pink";

const paperConfigs: Record<PaperStyle, { bg: string; lineColor: string; lines: boolean; grid: boolean }> = {
  lined:  { bg: "#1e1c1a", lineColor: "#2e2b28", lines: true,  grid: false },
  grid:   { bg: "#1a1a1e", lineColor: "#28282e", lines: false, grid: true  },
  plain:  { bg: "#1c1a18", lineColor: "",         lines: false, grid: false },
  yellow: { bg: "#1e1c16", lineColor: "#2c2a1e", lines: true,  grid: false },
  pink:   { bg: "#1e1a1c", lineColor: "#2e2628", lines: true,  grid: false },
};

const tapeColors = [
  "bg-[#3a4a3a]/60",   // green washi
  "bg-[#4a3a3a]/60",   // pink washi
  "bg-[#3a3c4a]/60",   // blue washi
  "bg-[#4a483a]/60",   // yellow washi
  "bg-[#423a4a]/60",   // purple washi
];

/* Tape strip component */
function Tape({ position, colorClass, rotation }: { position: string; colorClass: string; rotation: string }) {
  return (
    <div
      className={`absolute ${colorClass} h-[22px] w-[70px] sm:w-[90px] z-10 shadow-sm`}
      style={{
        ...posToStyle(position),
        transform: `rotate(${rotation})`,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='none'/%3E%3Cpath d='M0 0L4 4M4 0L0 4' stroke='%23ffffff' stroke-width='0.5' opacity='0.15'/%3E%3C/svg%3E")`,
      }}
    />
  );
}

function posToStyle(pos: string): React.CSSProperties {
  switch (pos) {
    case "tl": return { top: -8, left: 12 };
    case "tr": return { top: -8, right: 12 };
    case "bl": return { bottom: -8, left: 16 };
    case "br": return { bottom: -8, right: 16 };
    default:   return {};
  }
}

/* Notebook holes for left margin */
function NotebookHoles() {
  return (
    <div className="absolute left-3 top-0 bottom-0 flex flex-col justify-evenly pointer-events-none">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-3 h-3 rounded-full bg-black/40 shadow-inner ring-1 ring-white/5" />
      ))}
    </div>
  );
}

/* Torn/ripped edge clip paths — jagged irregular outlines */
const tornShapes = [
  // ragged all edges, big tears
  "polygon(1% 3%, 4% 0%, 8% 2%, 11% 0%, 16% 3%, 19% 1%, 24% 4%, 28% 0%, 32% 3%, 35% 1%, 39% 4%, 43% 0%, 47% 3%, 51% 1%, 55% 0%, 58% 3%, 62% 1%, 66% 4%, 70% 0%, 74% 3%, 78% 1%, 82% 4%, 86% 0%, 89% 2%, 93% 0%, 96% 3%, 100% 1%, 99% 6%, 100% 11%, 98% 16%, 100% 22%, 99% 28%, 100% 34%, 98% 40%, 100% 46%, 99% 52%, 100% 58%, 98% 64%, 100% 70%, 99% 76%, 100% 82%, 98% 88%, 100% 94%, 99% 98%, 96% 100%, 93% 97%, 89% 100%, 86% 98%, 82% 100%, 78% 97%, 74% 100%, 70% 98%, 66% 100%, 62% 97%, 58% 100%, 55% 98%, 51% 100%, 47% 97%, 43% 100%, 39% 98%, 35% 100%, 32% 97%, 28% 100%, 24% 98%, 19% 100%, 16% 97%, 11% 100%, 8% 98%, 4% 100%, 1% 97%, 0% 94%, 2% 88%, 0% 82%, 2% 76%, 0% 70%, 2% 64%, 0% 58%, 2% 52%, 0% 46%, 2% 40%, 0% 34%, 2% 28%, 0% 22%, 2% 16%, 0% 11%, 2% 6%)",
  // torn bottom + right, clean top-left
  "polygon(0% 0%, 5% 1%, 10% 0%, 15% 2%, 20% 0%, 25% 1%, 30% 0%, 35% 2%, 40% 0%, 45% 1%, 50% 0%, 55% 2%, 60% 0%, 65% 1%, 70% 0%, 75% 2%, 80% 0%, 85% 1%, 90% 0%, 95% 2%, 100% 0%, 100% 5%, 98% 10%, 100% 16%, 97% 22%, 100% 28%, 98% 34%, 100% 40%, 97% 46%, 100% 52%, 98% 58%, 100% 64%, 97% 70%, 100% 76%, 98% 82%, 100% 88%, 97% 94%, 100% 100%, 95% 98%, 90% 100%, 85% 97%, 80% 100%, 75% 98%, 70% 100%, 65% 97%, 60% 100%, 55% 98%, 50% 100%, 45% 97%, 40% 100%, 35% 98%, 30% 100%, 25% 97%, 20% 100%, 15% 98%, 10% 100%, 5% 97%, 0% 100%, 2% 94%, 0% 88%, 2% 82%, 0% 76%, 2% 70%, 0% 64%, 2% 58%, 0% 52%, 2% 46%, 0% 40%, 2% 34%, 0% 28%, 2% 22%, 0% 16%, 2% 10%, 0% 5%)",
  // heavy tear on right side, wavy bottom
  "polygon(0% 1%, 6% 0%, 12% 2%, 18% 0%, 24% 3%, 30% 0%, 36% 2%, 42% 0%, 48% 3%, 54% 0%, 60% 2%, 66% 0%, 72% 3%, 78% 0%, 84% 2%, 90% 0%, 96% 3%, 100% 1%, 99% 8%, 100% 14%, 97% 20%, 100% 26%, 96% 32%, 100% 38%, 97% 44%, 100% 50%, 96% 56%, 100% 62%, 97% 68%, 100% 74%, 96% 80%, 100% 86%, 97% 92%, 100% 98%, 96% 100%, 90% 97%, 84% 100%, 78% 96%, 72% 100%, 66% 97%, 60% 100%, 54% 96%, 48% 100%, 42% 97%, 36% 100%, 30% 96%, 24% 100%, 18% 97%, 12% 100%, 6% 96%, 0% 100%, 1% 92%, 0% 86%, 2% 80%, 0% 74%, 1% 68%, 0% 62%, 2% 56%, 0% 50%, 1% 44%, 0% 38%, 2% 32%, 0% 26%, 1% 20%, 0% 14%, 2% 8%)",
  // notebook rip — straight left edge (from spiral), torn everywhere else
  "polygon(0% 0%, 5% 2%, 10% 0%, 15% 3%, 20% 0%, 25% 2%, 30% 0%, 35% 3%, 40% 0%, 45% 2%, 50% 0%, 55% 3%, 60% 0%, 65% 2%, 70% 0%, 75% 3%, 80% 0%, 85% 2%, 90% 0%, 95% 3%, 100% 0%, 98% 7%, 100% 13%, 97% 19%, 100% 25%, 98% 31%, 100% 37%, 97% 43%, 100% 49%, 98% 55%, 100% 61%, 97% 67%, 100% 73%, 98% 79%, 100% 85%, 97% 91%, 100% 97%, 95% 100%, 89% 97%, 83% 100%, 77% 97%, 71% 100%, 65% 97%, 59% 100%, 53% 97%, 47% 100%, 41% 97%, 35% 100%, 29% 97%, 23% 100%, 17% 97%, 11% 100%, 5% 97%, 0% 100%)",
  // rough all around with bigger tears
  "polygon(2% 0%, 7% 3%, 12% 0%, 17% 4%, 22% 1%, 27% 3%, 32% 0%, 37% 4%, 42% 1%, 47% 3%, 52% 0%, 57% 4%, 62% 1%, 67% 3%, 72% 0%, 77% 4%, 82% 1%, 87% 3%, 92% 0%, 97% 4%, 100% 2%, 98% 8%, 100% 15%, 97% 22%, 100% 29%, 97% 36%, 100% 43%, 97% 50%, 100% 57%, 97% 64%, 100% 71%, 97% 78%, 100% 85%, 97% 92%, 100% 99%, 97% 100%, 92% 97%, 87% 100%, 82% 96%, 77% 100%, 72% 97%, 67% 100%, 62% 96%, 57% 100%, 52% 97%, 47% 100%, 42% 96%, 37% 100%, 32% 97%, 27% 100%, 22% 96%, 17% 100%, 12% 97%, 7% 100%, 2% 96%, 0% 99%, 3% 92%, 0% 85%, 3% 78%, 0% 71%, 3% 64%, 0% 57%, 3% 50%, 0% 43%, 3% 36%, 0% 29%, 3% 22%, 0% 15%, 3% 8%)",
];

/* Wrinkle/crease patterns — each paper gets a unique set of fold lines */
const wrinklePatterns = [
  [{ angle: 135, pos: 35 }, { angle: 40, pos: 72 }, { angle: 160, pos: 18 }],
  [{ angle: 110, pos: 55 }, { angle: 25, pos: 30 }, { angle: 145, pos: 80 }],
  [{ angle: 150, pos: 42 }, { angle: 60, pos: 65 }, { angle: 10, pos: 22 }],
  [{ angle: 120, pos: 28 }, { angle: 50, pos: 78 }, { angle: 170, pos: 52 }],
  [{ angle: 140, pos: 60 }, { angle: 30, pos: 40 }, { angle: 100, pos: 85 }],
];

function ScrapPaper({ children, index = 0, className = "" }: { children: React.ReactNode; index?: number; className?: string }) {
  const rotation = ["-1.2deg", "0.8deg", "-0.6deg", "1.1deg", "-0.9deg"][index % 5];
  const styles: PaperStyle[] = ["lined", "grid", "pink", "yellow", "lined"];
  const style = styles[index % styles.length];
  const config = paperConfigs[style];
  const hasHoles = style === "lined" || style === "yellow";
  const tornShape = tornShapes[index % tornShapes.length];
  const tapePositions = [
    [{ pos: "tl", rot: "-18deg" }, { pos: "br", rot: "15deg" }],
    [{ pos: "tr", rot: "22deg" }, { pos: "bl", rot: "-20deg" }],
    [{ pos: "tl", rot: "-25deg" }, { pos: "tr", rot: "18deg" }],
    [{ pos: "bl", rot: "-15deg" }, { pos: "tr", rot: "20deg" }],
    [{ pos: "tl", rot: "-20deg" }, { pos: "br", rot: "22deg" }],
  ][index % 5];

  const linesBg = config.lines
    ? `repeating-linear-gradient(transparent, transparent 27px, ${config.lineColor} 27px, ${config.lineColor} 28px)`
    : config.grid
    ? `repeating-linear-gradient(${config.lineColor} 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, ${config.lineColor} 0 1px, transparent 1px 28px)`
    : "";

  // red margin line for lined paper
  const marginLine = config.lines
    ? `linear-gradient(90deg, transparent 38px, #5a2a2a 38px, #5a2a2a 39px, transparent 39px)`
    : "";

  const combinedBg = [linesBg, marginLine].filter(Boolean).join(", ");

  return (
    <div className={`relative ${className}`} style={{ transform: `rotate(${rotation})` }}>
      {/* Tape strips */}
      {tapePositions.map((t, i) => (
        <Tape key={i} position={t.pos} colorClass={tapeColors[(index + i) % tapeColors.length]} rotation={t.rot} />
      ))}

      <div
        className="relative shadow-[0_4px_20px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.2)]"
        style={{
          backgroundColor: config.bg,
          backgroundImage: combinedBg || undefined,
          clipPath: tornShape,
        }}
      >
        {/* Notebook holes */}
        {hasHoles && <NotebookHoles />}

        {/* Paper grain / fiber texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Wrinkle creases — multiple crossing folds */}
        {wrinklePatterns[index % wrinklePatterns.length].map((w, i) => (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              inset: 0,
              background: `linear-gradient(${w.angle}deg, transparent ${w.pos - 1.5}%, rgba(255,255,255,0.03) ${w.pos - 0.5}%, rgba(0,0,0,0.06) ${w.pos}%, rgba(255,255,255,0.02) ${w.pos + 0.5}%, transparent ${w.pos + 1.5}%)`,
            }}
          />
        ))}

        {/* Worn edges — uneven darkening around borders */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow: "inset 0 0 30px rgba(0,0,0,0.15), inset 0 0 60px rgba(0,0,0,0.05)",
          }}
        />

        {/* Coffee ring stain (only on some papers) */}
        {(index === 1 || index === 4) && (
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              width: index === 1 ? 80 : 60,
              height: index === 1 ? 80 : 60,
              right: index === 1 ? 30 : "auto",
              left: index === 4 ? 40 : "auto",
              bottom: index === 1 ? 20 : "auto",
              top: index === 4 ? 15 : "auto",
              border: "2px solid rgba(90, 60, 30, 0.08)",
              background: "radial-gradient(circle, transparent 60%, rgba(90, 60, 30, 0.04) 70%, transparent 80%)",
            }}
          />
        )}

        {/* Dog-ear fold on corner (alternating corners) */}
        {(index === 0 || index === 3) && (
          <div
            className="absolute pointer-events-none"
            style={{
              ...(index === 0
                ? { bottom: 0, right: 0 }
                : { top: 0, right: 0 }),
              width: 28,
              height: 28,
              background: `linear-gradient(${index === 0 ? 225 : 315}deg, rgba(255,255,255,0.04) 50%, rgba(0,0,0,0.1) 50%)`,
            }}
          />
        )}

        {/* Subtle water damage / aging spots */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='turbulence' baseFrequency='0.015' numOctaves='3' seed='${index * 7}' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23w)'/%3E%3C/svg%3E")`,
          }}
        />

        <div className={`relative ${hasHoles ? "pl-12 sm:pl-14" : "pl-8 sm:pl-12"} pr-8 sm:pr-12 py-8 sm:py-12 text-white`}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─── Scroll-triggered section wrapper ─── */
const sectionVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" },
  },
};

/* ─── Scrapbook memory hero photo ─── */
function ScrapbookMemory() {
  return (
    <div className="relative" style={{ transform: "rotate(2deg)" }}>
      {/* Tape top-left */}
      <div
        className="absolute -top-2 left-4 sm:left-6 z-20 h-[18px] sm:h-[22px] w-[60px] sm:w-[80px] bg-[#d4e7d4]/50 shadow-sm"
        style={{
          transform: "rotate(-22deg)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='none'/%3E%3Cpath d='M0 0L4 4M4 0L0 4' stroke='%23ffffff' stroke-width='0.5' opacity='0.2'/%3E%3C/svg%3E")`,
        }}
      />
      {/* Tape top-right */}
      <div
        className="absolute -top-2 right-3 sm:right-5 z-20 h-[18px] sm:h-[22px] w-[55px] sm:w-[70px] bg-[#e8d4d4]/50 shadow-sm"
        style={{
          transform: "rotate(18deg)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='none'/%3E%3Cpath d='M0 0L4 4M4 0L0 4' stroke='%23ffffff' stroke-width='0.5' opacity='0.2'/%3E%3C/svg%3E")`,
        }}
      />
      {/* Tape bottom-right */}
      <div
        className="absolute -bottom-1 right-6 sm:right-8 z-20 h-[18px] sm:h-[22px] w-[50px] sm:w-[65px] bg-[#d4d8e7]/50 shadow-sm"
        style={{
          transform: "rotate(-12deg)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='none'/%3E%3Cpath d='M0 0L4 4M4 0L0 4' stroke='%23ffffff' stroke-width='0.5' opacity='0.2'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Polaroid frame */}
      <div className="bg-[#f5f0e8] p-1.5 pb-10 sm:p-2 sm:pb-14 rounded-sm shadow-2xl">
        <img src="/peson.jpg" alt="" className="w-[200px] sm:w-[260px] lg:w-[340px] xl:w-[380px] aspect-[3/4] object-cover rounded-[1px]" />

        {/* Handwritten caption under photo */}
        <p
          className="absolute bottom-2 sm:bottom-3 left-0 right-0 text-center text-[14px] sm:text-[16px] text-[#2a2520]/60"
          style={{ fontFamily: "Caveat, cursive", transform: "rotate(-1deg)" }}
        >
          best night ever ♡
        </p>
      </div>

      {/* Sticker — heart */}
      <div
        className="absolute -bottom-3 -left-3 sm:-left-4 z-20 text-[28px] sm:text-[34px]"
        style={{ transform: "rotate(-15deg)" }}
      >
        💌
      </div>

      {/* Drawn star doodle top-right */}
      <div
        className="absolute -top-4 -right-4 sm:-right-5 z-20 text-[22px] sm:text-[28px]"
        style={{ transform: "rotate(12deg)" }}
      >
        ✦
      </div>
    </div>
  );
}

/* ─── Phone mockup ─── */
function PhoneMockup() {
  const msgs = [
    { dir: "in" as const, text: "hey sarah... your bubl match is ready 👀" },
    { dir: "in" as const, text: "are you ready to find out who you got?" },
    { dir: "out" as const, text: "omg YES" },
    { dir: "in" as const, text: "you're locked in 🔒 waiting on your match..." },
    { dir: "in" as const, text: "your match is... Jake! 🎉\n\ntheir number: (949) 555-0123\n\nsay hi 👋" },
  ];
  return (
    <div className="w-[250px] sm:w-[280px] lg:w-[320px] shrink-0">
      <div className="bg-black rounded-[44px] p-[10px] ring-1 ring-white/10">
        <div className="bg-black rounded-[34px] overflow-hidden relative">
          <div className="relative px-6 pt-3 pb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white w-12">9:41</span>
            <div className="absolute left-1/2 -translate-x-1/2 w-[90px] h-[22px] bg-black rounded-full" />
            <div className="flex items-center gap-1 w-12 justify-end">
              <svg width="13" height="10" viewBox="0 0 13 10" fill="white"><rect x="0" y="6" width="2.5" height="4" rx="0.5" opacity="0.4"/><rect x="3.5" y="4" width="2.5" height="6" rx="0.5" opacity="0.6"/><rect x="7" y="2" width="2.5" height="8" rx="0.5" opacity="0.8"/><rect x="10.5" y="0" width="2.5" height="10" rx="0.5"/></svg>
              <svg width="15" height="10" viewBox="0 0 15 10" fill="white"><path d="M7.5 2.5C9.5 2.5 11.2 3.3 12.4 4.6L13.5 3.5C12 1.9 10 1 7.5 1S3 1.9 1.5 3.5L2.6 4.6C3.8 3.3 5.5 2.5 7.5 2.5Z" opacity="0.4"/><path d="M7.5 5C8.8 5 10 5.5 10.9 6.3L12 5.2C10.8 4.1 9.2 3.5 7.5 3.5S4.2 4.1 3 5.2L4.1 6.3C5 5.5 6.2 5 7.5 5Z" opacity="0.7"/><path d="M7.5 7.5C8.2 7.5 8.8 7.8 9.3 8.2L7.5 10L5.7 8.2C6.2 7.8 6.8 7.5 7.5 7.5Z"/></svg>
              <svg width="22" height="10" viewBox="0 0 22 10" fill="none"><rect x="0.5" y="0.5" width="18" height="9" rx="2" stroke="white" strokeWidth="1" opacity="0.35"/><rect x="19.5" y="3" width="2" height="4" rx="1" fill="white" opacity="0.4"/><rect x="1.5" y="1.5" width="14" height="7" rx="1" fill="white"/></svg>
            </div>
          </div>
          <div className="px-3 pt-1 pb-2">
            <div className="flex items-center gap-1 mb-2">
              <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8.5 1L1.5 8L8.5 15" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="text-[14px] text-[#007AFF]">12</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center mb-1">
                <span className="text-[12px] font-bold text-white">b</span>
              </div>
              <p className="text-[13px] font-semibold text-white">bubl</p>
              <p className="text-[10px] text-[#8E8E93]">iMessage</p>
            </div>
          </div>
          <div className="px-3 pb-3 pt-2 space-y-[6px] min-h-[260px]">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] px-3 py-[7px] text-[13px] leading-[1.35] ${
                  m.dir === "out"
                    ? "bg-[#007AFF] text-white rounded-[18px] rounded-br-[4px]"
                    : "bg-[#1C1C1E] text-[#E5E5EA] rounded-[18px] rounded-bl-[4px]"
                }`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 pb-4 pt-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#1C1C1E] flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#8E8E93" strokeWidth="1.5"/><path d="M7 4V10M4 7H10" stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div className="flex-1 h-[30px] rounded-full border border-[#3A3A3C] flex items-center px-3">
                <span className="text-[13px] text-[#8E8E93]">iMessage</span>
              </div>
            </div>
          </div>
          <div className="flex justify-center pb-2">
            <div className="w-[100px] h-[4px] rounded-full bg-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Page ═══ */
type FormState = "idle" | "submitting" | "success";

export function BlindDatePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const signupRef = useRef<HTMLDivElement>(null);
  const fmt = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  };
  const submit = async () => {
    setError("");
    if (!name.trim() || !phone.trim() || !email.trim()) { setError("all fields are required"); return; }
    setFormState("submitting");
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("phone", phone.replace(/\D/g, ""));
    fd.append("email", email.trim());
    try {
      const res = await fetch("/api/blind-date/signup", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "something went wrong"); setFormState("idle"); return; }
      setPosition(data.position);
      setFormState("success");
    } catch { setError("couldn't connect — try again"); setFormState("idle"); }
  };
  const scrollToSignup = () => signupRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen relative">

      {/* Background */}
      <div className="fixed inset-0 z-0">
        <img src="/bg.jpg" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 backdrop-blur-[12px] bg-black/40" />
      </div>

      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5">
        <div className="max-w-6xl xl:max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-white font-bold text-[18px] tracking-[-0.03em]">bubl.</span>
          <button onClick={scrollToSignup} className="text-white/60 text-[13px] hover:text-white transition">
            join waitlist &rarr;
          </button>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <motion.section
        variants={sectionVariants} initial="hidden" animate="visible"
        className="relative z-10 min-h-[100svh] flex flex-col justify-end px-5 sm:px-6 pb-16 sm:pb-24 pt-16">
        <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 lg:gap-16">
          <div className="flex-1 order-2 lg:order-1">
            <motion.h1 variants={itemVariants} className="text-[56px] sm:text-[100px] lg:text-[160px] xl:text-[200px] font-bold leading-[0.85] tracking-[-0.05em] text-white select-none">
              bubl.
            </motion.h1>
            <motion.p variants={itemVariants} className="mt-4 sm:mt-6 text-white/60 text-[16px] sm:text-[22px] lg:text-[24px] leading-snug max-w-md lg:max-w-lg">
              Get a curated match every Thursday. No app download, no follows, no dms.
            </motion.p>
            <motion.button variants={itemVariants} onClick={scrollToSignup}
              className="mt-6 px-7 py-3 rounded-full bg-white text-black text-[14px] font-semibold hover:bg-white/90 active:scale-[0.97] transition">
              Join the Waitlist
            </motion.button>
          </div>
          <motion.div variants={itemVariants} className="shrink-0 order-1 lg:order-2 self-center lg:self-auto lg:mb-4">
            <ScrapbookMemory />
          </motion.div>
        </div>
      </motion.section>

      <div className="relative z-10">

      {/* ─── Marquee divider ─── */}
      <div className="border-y border-white/5 py-3 overflow-hidden">
        <div className="flex whitespace-nowrap animate-[marquee_20s_linear_infinite]">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="text-white/10 text-[13px] font-mono uppercase tracking-[0.2em] mx-8">
              iMessage only &middot; high school only &middot; every thursday &middot; no app required
            </span>
          ))}
        </div>
      </div>

      {/* ─── How it works — editorial layout ─── */}
      <motion.section variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.15 }} className="py-20 sm:py-32 px-5 sm:px-6">
        <ScrapPaper index={0} className="max-w-5xl lg:max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr_1px_1fr] gap-8 lg:gap-0">
            <div className="lg:pr-16">
              <motion.p variants={itemVariants} className="text-[20px] sm:text-[22px] text-white/40 mb-4 sm:mb-6" style={{ fontFamily: "Caveat, cursive", transform: "rotate(-2deg)" }}>How it works</motion.p>
              <motion.h2 variants={itemVariants} className="text-[28px] sm:text-[36px] lg:text-[48px] xl:text-[56px] font-bold tracking-[-0.03em] text-white leading-[1.05]">
                Sign up.<br />
                Get texted.<br />
                Meet someone<br />
                <span className="text-white/30">real.</span>
              </motion.h2>
            </div>
            <div className="hidden lg:block bg-white/10" />
            <div className="lg:pl-16 flex flex-col justify-center space-y-8">
              {[
                "Drop your name, number, and school ID.",
                "Every Thursday between 9–11am we send you a match over iMessage.",
                "Both say yes — we reveal names and numbers.",
                "We break the ice. You take it from there.",
              ].map((text, i) => (
                <motion.div key={i} variants={itemVariants} className="flex gap-4 items-baseline">
                  <span className="font-mono text-[12px] text-white/20 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-white/50 text-[15px] leading-relaxed">{text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </ScrapPaper>
      </motion.section>

      {/* ─── Pull quote ─── */}
      <motion.section variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} className="py-16 sm:py-20 px-5 sm:px-6">
        <ScrapPaper index={1} className="max-w-4xl lg:max-w-5xl mx-auto text-center">
          <motion.p variants={itemVariants} className="text-[22px] sm:text-[36px] lg:text-[44px] xl:text-[52px] font-bold tracking-[-0.02em] leading-[1.15] text-white/80">
            &ldquo;Tinder gave me carpal tunnel.<br />
            bubl gave me a date.&rdquo;
          </motion.p>
          <motion.p variants={itemVariants} className="mt-4 font-mono text-[12px] text-white/20 uppercase tracking-[0.15em]">— actual high schooler, probably</motion.p>
        </ScrapPaper>
      </motion.section>

      {/* ─── iMessage demo — offset layout ─── */}
      <motion.section variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="py-20 sm:py-32 px-5 sm:px-6">
        <ScrapPaper index={2} className="max-w-5xl lg:max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center lg:items-start gap-10 lg:gap-16">
            <motion.div variants={itemVariants} className="w-full lg:w-1/2 flex justify-center lg:justify-start">
              <PhoneMockup />
            </motion.div>
            <div className="w-full lg:w-1/2 lg:pt-12">
              <motion.p variants={itemVariants} className="text-[20px] sm:text-[22px] text-white/40 mb-4 sm:mb-6" style={{ fontFamily: "Caveat, cursive", transform: "rotate(1.5deg)" }}>No app needed</motion.p>
              <motion.h2 variants={itemVariants} className="text-[28px] sm:text-[36px] lg:text-[44px] xl:text-[52px] font-bold tracking-[-0.03em] text-white leading-[1.05] mb-4 sm:mb-6">
                It lives in<br />your texts.
              </motion.h2>
              <motion.p variants={itemVariants} className="text-white/40 text-[15px] leading-[1.7] max-w-sm">
                We text you. You reply yes. We reveal your match. The whole thing takes 30 seconds and you never leave iMessage.
              </motion.p>
              <motion.div variants={itemVariants} className="mt-6 flex">
                <div className="bg-[#007AFF] text-white text-[13px] px-4 py-2 rounded-[18px] rounded-bl-[4px]">
                  blue bubbles only
                </div>
              </motion.div>
            </div>
          </div>
        </ScrapPaper>
      </motion.section>

      {/* ─── Photo collage (3-panel) ─── */}
      <motion.section variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="py-20 sm:py-32 px-5 sm:px-6 overflow-hidden">
        <div className="max-w-5xl lg:max-w-6xl mx-auto">
          <motion.p variants={itemVariants} className="text-[20px] sm:text-[24px] text-white/40 mb-10 sm:mb-16 text-center" style={{ fontFamily: "Caveat, cursive", transform: "rotate(-1.5deg)" }}>Real people. Real nights.</motion.p>
          {/* Mobile: stacked polaroids */}
          <div className="flex flex-col items-center gap-6 sm:hidden">
            {[
              { src: "/elsam4.jpg", rot: "-2deg" },
              { src: "/grace.jpg", rot: "1.5deg" },
              { src: "/vibes.jpg", rot: "-1deg" },
            ].map((img, i) => (
              <motion.div key={i} variants={itemVariants} style={{ transform: `rotate(${img.rot})` }}>
                <div className="bg-[#1a1a1a] p-1.5 pb-6 rounded">
                  <img src={img.src} alt="" className="w-[280px] aspect-[4/3] object-cover rounded-sm" />
                </div>
              </motion.div>
            ))}
          </div>
          {/* Desktop: overlapping collage */}
          <div className="hidden sm:block relative" style={{ minHeight: "500px" }}>
            <div className="absolute left-0 top-0 w-[45%]" style={{ transform: "rotate(-3deg)" }}>
              <div className="bg-[#1a1a1a] p-2 pb-8 rounded">
                <img src="/elsam4.jpg" alt="" className="w-full aspect-[4/3] object-cover rounded-sm" />
              </div>
            </div>
            <div className="absolute right-0 top-4 w-[42%]" style={{ transform: "rotate(2deg)" }}>
              <div className="bg-[#1a1a1a] p-2 pb-8 rounded">
                <img src="/grace.jpg" alt="" className="w-full aspect-[4/3] object-cover rounded-sm" />
              </div>
            </div>
            <div className="absolute left-[15%] bottom-0 w-[45%]" style={{ transform: "rotate(1.5deg)" }}>
              <div className="bg-[#1a1a1a] p-2 pb-8 rounded">
                <img src="/vibes.jpg" alt="" className="w-full aspect-[16/9] object-cover rounded-sm" />
              </div>
            </div>
            <div className="absolute top-[-8px] left-[32%] z-10" style={{ transform: "rotate(-5deg)" }}>
              <div className="bg-pink-400 px-4 py-2">
                <p className="text-black font-black text-[34px] leading-none">100+</p>
                <p className="text-black/60 font-bold text-[11px] uppercase">Matches</p>
              </div>
            </div>
            <div className="absolute top-[45%] right-[5%] z-10" style={{ transform: "rotate(4deg)" }}>
              <div className="bg-yellow-400 px-4 py-2">
                <p className="text-black font-black text-[34px] leading-none">0</p>
                <p className="text-black/60 font-bold text-[11px] uppercase">Swipes</p>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ─── Signup form ─── */}
      <motion.section ref={signupRef} variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.15 }} className="py-20 sm:py-32 px-5 sm:px-6">
        <ScrapPaper index={3} className="max-w-sm mx-auto">
          {formState === "success" ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-white flex items-center justify-center">
                <Check className="w-8 h-8 text-black" strokeWidth={3} />
              </div>
              <h2 className="text-[28px] font-bold text-white mb-2">you're in</h2>
              <p className="text-white/50 text-[15px] mb-1">#{position} on the waitlist</p>
              <p className="text-white/30 text-[14px]">we'll text you when your match is ready</p>
            </div>
          ) : (
            <>
              <motion.p variants={itemVariants} className="text-[24px] text-white/40 mb-4 text-center" style={{ fontFamily: "Caveat, cursive", transform: "rotate(-1deg)" }}>Waitlist</motion.p>
              <motion.h2 variants={itemVariants} className="text-[32px] sm:text-[44px] font-bold text-center mb-8 sm:mb-10 tracking-[-0.03em] text-white leading-[1.05]">
                Get in.
              </motion.h2>

              <div className="space-y-3">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="name"
                  className="w-full px-4 py-3 rounded-lg border border-white/10 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/25 transition bg-white/5" />
                <div>
                  <input type="tel" value={phone} onChange={(e) => setPhone(fmt(e.target.value))} placeholder="phone"
                    className="w-full px-4 py-3 rounded-lg border border-white/10 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/25 transition bg-white/5" />
                  <p className="text-[11px] text-white/15 mt-1 ml-1">iMessage required</p>
                </div>
                <div>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student email"
                    className="w-full px-4 py-3 rounded-lg border border-white/10 text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/25 transition bg-white/5" />
                  <p className="text-[11px] text-white/15 mt-1 ml-1">.edu email preferred</p>
                </div>

                {error && <p className="text-[13px] text-red-400 text-center">{error}</p>}

                <button onClick={submit} disabled={formState === "submitting"}
                  className="w-full py-3 rounded-lg bg-white text-black font-semibold text-[14px] hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed">
                  {formState === "submitting"
                    ? <div className="w-4 h-4 mx-auto border-2 border-black/20 border-t-black rounded-full animate-spin" />
                    : "Join Waitlist"}
                </button>
              </div>
            </>
          )}
        </ScrapPaper>
      </motion.section>

      {/* ─── FAQ ─── */}
      <motion.section variants={sectionVariants} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.15 }} className="py-20 sm:py-32 px-5 sm:px-6">
        <ScrapPaper index={4} className="max-w-xl mx-auto">
          <motion.p variants={itemVariants} className="text-[24px] text-white/40 mb-12" style={{ fontFamily: "Caveat, cursive", transform: "rotate(2deg)" }}>FAQ</motion.p>
          {[
            { q: "How does matching work?", a: "Every Thursday between 9–11am we pair everyone and send both people an iMessage. Both say yes, we reveal names and numbers." },
            { q: "Do I need an app?", a: "No. iMessage only." },
            { q: "Why school ID?", a: "We verify every user is a real high school student. Your ID is never shared." },
            { q: "What if I'm not into my match?", a: "Reply 'no'. Back in the pool next week." },
            { q: "Is it free?", a: "Yes." },
          ].map((f, i) => (
            <motion.div key={i} variants={itemVariants} className="border-b border-white/5 py-5">
              <h3 className="text-white/70 text-[15px] mb-1">{f.q}</h3>
              <p className="text-white/30 text-[14px] leading-relaxed">{f.a}</p>
            </motion.div>
          ))}
        </ScrapPaper>
      </motion.section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-white/5">
        <div className="max-w-6xl xl:max-w-7xl mx-auto flex items-center justify-between">
          <span className="text-white/20 font-bold text-[15px] tracking-[-0.03em]">bubl</span>
          <p className="text-white/15 text-[12px] font-mono">every thursday</p>
        </div>
      </footer>

      </div>
    </div>
  );
}
