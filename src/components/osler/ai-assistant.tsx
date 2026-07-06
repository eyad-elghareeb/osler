"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Sparkles,
  User as UserIcon,
  Trash2,
  Loader2,
  X,
  BookOpen,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ARTICLES } from "@/lib/osler/articles";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const STORAGE_KEY = "osler-ai-chat-v1";

const SUGGESTIONS = [
  "Explain the difference between systolic and diastolic heart failure.",
  "What are the indications for IV thrombolysis in ischemic stroke?",
  "Walk me through the GOLD classification for COPD.",
  "How do I interpret an arterial blood gas?",
  "What's the workup for suspected pulmonary embolism?",
  "Compare asthma vs COPD pathophysiology.",
  "What are the complications of cirrhosis?",
  "How do I manage acute STEMI?",
];

interface AiAssistantProps {
  /** Optional slide-in panel mode (used from QBank Studio) */
  open?: boolean;
  onClose?: () => void;
  /** Current question context (for QBank integration) */
  questionContext?: {
    stem: string;
    engine: string;
    submitted: boolean;
  };
}

export function AiAssistant({
  open,
  onClose,
  questionContext,
}: AiAssistantProps = {}) {
  const [messages, setMessages] = React.useState<Message[]>(() => loadChat());
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Persist
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // Auto-scroll
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    // Simulated assistant response
    setTimeout(() => {
      const reply: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: generateReply(trimmed, questionContext),
        timestamp: Date.now(),
      };
      setMessages((m) => [...m, reply]);
      setLoading(false);
    }, 700 + Math.random() * 800);
  };

  const clear = () => {
    setMessages([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border bg-card/40">
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Bot className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">AI Assistant</h3>
          <p className="text-[11px] text-muted-foreground">
            {questionContext
              ? `Context: ${questionContext.engine} question`
              : "Ask about any medical topic"}
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        )}
        {messages.length > 0 && !onClose ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        ) : null}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto osler-scroll px-4 md:px-6 py-4 space-y-3"
      >
        {/* Question context banner */}
        {questionContext && !questionContext.submitted && (
          <div className="bg-primary/8 border border-primary/25 rounded-lg p-3 mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary mb-1">
              <Lightbulb className="size-3.5" />
              Current Question Context
            </div>
            <p className="text-xs text-muted-foreground line-clamp-3">
              {questionContext.stem}
            </p>
          </div>
        )}

        {messages.length === 0 ? (
          <EmptyState onSuggestion={(s) => send(s)} />
        ) : (
          messages.map((m) => <ChatBubble key={m.id} msg={m} />)
        )}
        {loading ? (
          <div className="flex gap-2 items-center text-muted-foreground text-sm">
            <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Bot className="size-4" />
            </div>
            <div className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Thinking…</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-border bg-card/40 p-3 md:p-4"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask a medical question…"
            rows={1}
            className="flex-1 resize-none max-h-32 bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
            style={{ minHeight: "40px" }}
          />
          <Button
            type="submit"
            disabled={!input.trim() || loading}
            size="icon"
            className="size-10 shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 hidden sm:block">
          Press Enter to send · Shift+Enter for newline
        </p>
      </form>
    </div>
  );

  // Slide-in panel mode (from QBank Studio)
  if (open !== undefined && onClose) {
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed right-0 top-12 bottom-0 z-40 w-full sm:w-96 border-l border-border bg-card shadow-xl flex flex-col"
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Full page mode (from nav)
  return content;
}

function EmptyState({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center py-12"
    >
      <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-3">
        <Sparkles className="size-7" />
      </div>
      <h3 className="text-base font-semibold mb-1">Medical AI Tutor</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-5">
        Ask about pathophysiology, pharmacology, diagnostic workup, or any
        board topic. Get detailed, structured explanations.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestion(s)}
            className="text-left text-xs px-3 py-2.5 rounded-md border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-primary/15 text-primary"
        )}
      >
        {isUser ? <UserIcon className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div
        className={cn(
          "osler-chat-bubble ai-chat-msg",
          isUser ? "user" : "assistant"
        )}
      >
        {formatContent(msg.content)}
      </div>
    </motion.div>
  );
}

function formatContent(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <br key={i} />;
    if (/^[•\-*]\s/.test(line)) {
      return (
        <p key={i} style={{ paddingLeft: "0.6rem" }}>
          {line.replace(/^[•\-*]\s/, "• ")}
        </p>
      );
    }
    return <p key={i}>{line}</p>;
  });
}

function generateReply(
  question: string,
  context?: { stem: string; engine: string; submitted: boolean }
): string {
  const q = question.toLowerCase();

  // Context-aware response
  if (context && !context.submitted) {
    return [
      "Based on the current question, here are some key concepts to consider:",
      "",
      "1. **Identify the chief complaint** — What is the primary clinical presentation?",
      "2. **Consider the differential** — What conditions could cause this presentation?",
      "3. **Pick the gold-standard test** — What imaging or lab would confirm the diagnosis?",
      "4. **Know the first-line treatment** — What's the standard of care?",
      "",
      "Try to reason through the question stem step by step. Look for key clues like vital signs, lab values, and imaging findings that narrow the differential.",
      "",
      "(This is a simulated hint. In production, the AI would analyze the specific question and provide targeted guidance without revealing the answer.)",
    ].join("\n");
  }

  if (q.includes("stroke") || q.includes("thrombolysis") || q.includes("tpa")) {
    return [
      "Acute ischemic stroke thrombolysis — IV alteplase (tPA) indications:",
      "• Symptom onset within 3 hours (extended to 4.5 hours in eligible patients)",
      "• Ischemic stroke confirmed on non-contrast CT (no hemorrhage)",
      "• Measurable neurological deficit on NIHSS",
      "",
      "Key contraindications:",
      "• Intracranial hemorrhage on imaging",
      "• Recent surgery or major trauma (<14 days)",
      "• Active bleeding or coagulopathy (INR >1.7, platelets <100k)",
      "• Sustained BP >185/110 despite treatment",
      "• Glucose <50 mg/dL (correct first)",
      "",
      "Before tPA: lower BP to <185/110. After tPA: keep BP <180/105 for 24 hours, no anticoagulants/antiplatelets for 24h.",
    ].join("\n");
  }
  if (q.includes("copd") || q.includes("gold")) {
    return [
      "COPD GOLD classification — based on post-bronchodilator FEV1 % predicted:",
      "• GOLD 1 (Mild): FEV1 ≥ 80%",
      "• GOLD 2 (Moderate): FEV1 50–79%",
      "• GOLD 3 (Severe): FEV1 30–49%",
      "• GOLD 4 (Very Severe): FEV1 < 30%",
      "",
      "Management by severity:",
      "• Group A: SABA or SAMA PRN",
      "• Group B: LABA + LAMA",
      "• Group C/D: LABA + LAMA + ICS (if eos ≥ 300 or exacerbations)",
      "",
      "Two interventions reduce mortality: smoking cessation and long-term oxygen therapy (LTOT) for severe resting hypoxemia (PaO2 < 55 mm Hg).",
    ].join("\n");
  }
  if (q.includes("heart failure") || q.includes("systolic") || q.includes("diastolic")) {
    return [
      "Heart failure — systolic (HFrEF) vs diastolic (HFpEF):",
      "",
      "HFrEF (EF ≤ 40%):",
      "• Reduced contractility → low forward output",
      "• RAAS and SNS activation cause maladaptive remodeling",
      "• First-line: beta-blocker + ACEi/ARB/ARNI + SGLT2i + MRA",
      "",
      "HFpEF (EF ≥ 50%):",
      "• Stiff ventricle → impaired filling, preserved EF",
      "• Diuretics for congestion; treat comorbidities (HTN, AF, diabetes)",
      "• SGLT2i shown to reduce HF hospitalizations",
      "",
      "Common to both: diuretics for volume overload, salt restriction, daily weights.",
    ].join("\n");
  }
  if (q.includes("pe") || q.includes("pulmonary embolism") || q.includes("embolism")) {
    return [
      "Pulmonary embolism workup:",
      "• Wells criteria → low/medium/high pre-test probability",
      "• If low probability + D-dimer negative → PE excluded",
      "• If D-dimer positive or higher probability → CT pulmonary angiography (CTPA)",
      "• V/Q scan if CT contraindicated (renal failure, contrast allergy)",
      "",
      "ECG findings: sinus tachycardia, S1Q3T3, right axis deviation, T-wave inversions V1-V4.",
      "CXR: usually normal; may show Westermark sign or Hampton's hump.",
      "",
      "Treatment: anticoagulation (LMWH, DOAC, or warfarin). Thrombolysis for massive PE with hemodynamic instability.",
    ].join("\n");
  }
  if (q.includes("abg") || q.includes("arterial blood gas")) {
    return [
      "Arterial blood gas interpretation — 5-step approach:",
      "",
      "1. pH: <7.35 acidosis, >7.45 alkalosis",
      "2. PaCO2: respiratory component (↑ = acidosis, ↓ = alkalosis)",
      "3. HCO3: metabolic component (↑ = alkalosis, ↓ = acidosis)",
      "4. Compensation: opposite direction of primary disturbance",
      "5. ΔΔ formula: determine if mixed disorder",
      "",
      "Quick compensations:",
      "• Metabolic acidosis: PaCO2 ≈ 1.5 × HCO3 + 8 (±2)",
      "• Metabolic alkalosis: PaCO2 ↑ by 0.7 × ΔHCO3",
      "• Respiratory acidosis (acute): HCO3 ↑ 1 mEq/L per 10 mmHg PaCO2 ↑",
      "• Respiratory acidosis (chronic): HCO3 ↑ 3-4 mEq/L per 10 mmHg",
    ].join("\n");
  }
  if (q.includes("asthma")) {
    return [
      "Asthma vs COPD comparison:",
      "",
      "Asthma:",
      "• Type 2 (Th2) inflammation — eosinophils, IL-4, IL-5, IL-13",
      "• Reversible airflow obstruction (≥12% + 200mL FEV1 improvement post-SABA)",
      "• Onset usually in childhood, triggers (allergens, exercise, cold air)",
      "• Treatment: ICS-formoterol PRN (GINA Track 1) + maintenance ICS",
      "",
      "COPD:",
      "• Neutrophilic inflammation, protease-antiprotease imbalance",
      "• Largely fixed obstruction (FEV1/FVC <0.7 post-bronchodilator)",
      "• Onset usually >40, smoking history",
      "• Treatment: LABA + LAMA ± ICS; smoking cessation + LTOT reduce mortality",
    ].join("\n");
  }
  if (q.includes("cirrhosis") || q.includes("portal")) {
    return [
      "Cirrhosis complications and management:",
      "",
      "Portal hypertension complications:",
      "• Varices: non-selective beta-blocker (propranolol) for primary prophylaxis",
      "• Ascites: sodium restriction + spironolactone + furosemide (100:40 ratio)",
      "• SBP: cefotaxime if ascitic PMN ≥250; norfloxacin prophylaxis",
      "• Hepatic encephalopathy: lactulose + rifaximin; treat precipitant",
      "• HRS: octreotide + midodrine + albumin; terlipressin; transplant",
      "",
      "Screening:",
      "• Varices: EGD every 1-3 years",
      "• HCC: ultrasound ± AFP every 6 months",
      "",
      "Child-Pugh and MELD-Na scores estimate prognosis and transplant priority.",
    ].join("\n");
  }
  if (q.includes("stemi") || q.includes("mi") || q.includes("infarction")) {
    return [
      "Acute STEMI management:",
      "",
      "Initial (MONA-B):",
      "• Morphine for refractory pain",
      "• Oxygen only if SpO2 <90%",
      "• Nitroglycerin for ongoing pain (avoid in RV infarct, hypotension)",
      "• Aspirin 162-325 mg chewed",
      "• Beta-blocker (avoid in acute HF, hypotension, severe asthma)",
      "",
      "Reperfusion:",
      "• Primary PCI within 90 min (door-to-balloon) — preferred",
      "• If PCI >120 min: fibrinolytics (alteplase/tenecteplase) within 30 min",
      "",
      "Post-PCI: DAPT (aspirin + ticagrelor/clopidogrel) 12 months + high-intensity statin + ACEi (especially anterior STEMI)",
    ].join("\n");
  }
  return [
    `Question: "${question}"`,
    "",
    "Here's a structured approach to any medical question:",
    "• Identify the chief complaint and key vitals",
    "• Form a differential based on symptom pattern",
    "• Pick the gold-standard imaging or lab test",
    "• State the first-line treatment and any contraindications",
    "• Consider complications and prognosis",
    "",
    "(This is a simulated response for demo purposes — in production this would call the Osler AI engine with full medical knowledge base.)",
  ].join("\n");
}

function loadChat(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}
