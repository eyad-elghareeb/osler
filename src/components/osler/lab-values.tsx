"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FlaskConical, X } from "lucide-react";
import { usePlatform } from "@/hooks/use-platform";

type LabCategory = "chem" | "hem" | "abg" | "coag" | "other";

const LAB_TABS: { id: LabCategory; label: string }[] = [
  { id: "chem", label: "Chemistry" },
  { id: "hem", label: "Hematology" },
  { id: "abg", label: "ABG" },
  { id: "coag", label: "Coagulation" },
  { id: "other", label: "Other" },
];

interface LabItem {
  name: string;
  range: string;
  note: string;
}

const LABS_BY_CAT: Record<LabCategory, LabItem[]> = {
  chem: [
    { name: "Sodium (Na)", range: "135–145 mEq/L", note: "Major extracellular cation. Hyponatremia → SIADH, vomiting. Hypernatremia → DI, dehydration." },
    { name: "Potassium (K)", range: "3.5–5.0 mEq/L", note: "Major intracellular cation. Hypokalemia → diuretics, diarrhea. Hyperkalemia → renal failure, ACEi." },
    { name: "Chloride (Cl)", range: "98–107 mEq/L", note: "Follows Na. Elevated in hyperchloremic metabolic acidosis (e.g. diarrhea, RTA)." },
    { name: "Bicarbonate (HCO₃)", range: "22–28 mEq/L", note: "Primary buffer. Low in metabolic acidosis. High in metabolic alkalosis." },
    { name: "BUN", range: "7–20 mg/dL", note: "Renal function + volume status. High → prerenal AKI, GI bleed, high protein." },
    { name: "Creatinine (Cr)", range: "0.6–1.2 mg/dL", note: "Glomerular filtration marker. Rises in AKI, CKD. Used for eGFR calculation." },
    { name: "Glucose (fasting)", range: "70–100 mg/dL", note: "Hyperglycemia → DM, stress. Hypoglycemia → insulinoma, liver failure, sepsis." },
    { name: "Calcium (Ca)", range: "8.5–10.5 mg/dL", note: "Hypercalcemia → hyperPTH, malignancy. Hypocalcemia → hypoparathyroidism, Vit D def." },
    { name: "Phosphate (PO₄)", range: "3.0–4.5 mg/dL", note: "Inversely related to Ca. High in renal failure. Low in hyperPTH, refeeding." },
    { name: "Magnesium (Mg)", range: "1.7–2.2 mg/dL", note: "Hypomagnesemia → arrhythmia, hypokalemia (refractory). Hypermagnesemia → renal failure." },
    { name: "Albumin", range: "3.5–5.0 g/dL", note: "Carrier protein. Low in cirrhosis, nephrotic syndrome, malnutrition. Correct Ca for low alb." },
    { name: "Total Protein", range: "6.0–8.3 g/dL", note: "High in multiple myeloma (M spike), dehydration. Low in malnutrition, liver disease." },
    { name: "AST", range: "10–40 U/L", note: "Hepatocellular injury marker (also in muscle/heart). AST:ALT > 2 in alcoholic hepatitis." },
    { name: "ALT", range: "7–56 U/L", note: "More specific for liver than AST. High in viral hepatitis, NASH, drug-induced injury." },
    { name: "ALP", range: "44–147 U/L", note: "Bile duct (cholestasis) + bone. High in obstruction, PBC, Paget disease, growing children." },
    { name: "Total Bilirubin", range: "0.1–1.2 mg/dL", note: "Unconjugated → hemolysis, Gilbert. Conjugated → obstruction, hepatitis." },
    { name: "LDH", range: "140–280 U/L", note: "Nonspecific. Elevated in hemolysis, MI, tumor lysis, pneumonia, tissue injury." },
    { name: "Lipase", range: "0–160 U/L", note: "Pancreas-specific. Elevated in acute pancreatitis (3× ULN). More specific than amylase." },
    { name: "Troponin I", range: "<0.04 ng/mL", note: "Gold standard for MI. Highly cardiac-specific. Rises 2-4h, peaks 12-24h." },
  ],
  hem: [
    { name: "Hb (Male)", range: "13.5–17.5 g/dL", note: "Low → anemia. High → polycythemia, COPD, high altitude." },
    { name: "Hb (Female)", range: "12.0–15.5 g/dL", note: "Lower due to menstruation." },
    { name: "Hct (Male)", range: "41–53%", note: "Packed cell volume. ~3× Hb." },
    { name: "Hct (Female)", range: "36–46%", note: "Parallels Hb." },
    { name: "MCV", range: "80–100 fL", note: "Micro → IDA, thalassemia. Macro → B₁₂/folate def, alcohol, MDS." },
    { name: "WBC", range: "4.5–11.0 K/µL", note: "Leukocytosis → infection, inflammation, leukemia." },
    { name: "Neutrophils", range: "40–70%", note: "Bacterial infection, stress, steroids (↑)." },
    { name: "Lymphocytes", range: "20–40%", note: "Viral infection, CLL (↑). Immunodeficiency (↓)." },
    { name: "Platelets", range: "150–400 K/µL", note: "Thrombocytopenia → ITP, DIC, HIT. Thrombocytosis → iron def, reactive." },
    { name: "Reticulocytes", range: "0.5–2.5%", note: "↑ in hemolysis, blood loss. ↓ in BM failure." },
    { name: "Ferritin", range: "30–300 ng/mL", note: "Iron stores. Low = iron deficiency. High = inflammation, hemochromatosis." },
    { name: "Iron", range: "60–170 µg/dL", note: "Low in IDA. High in hemochromatosis." },
    { name: "TIBC", range: "240–450 µg/dL", note: "High in IDA. Low in anemia of chronic disease." },
    { name: "Vitamin B₁₂", range: "200–900 pg/mL", note: "Low → macrocytic anemia, neuropathy." },
    { name: "Folate", range: "3–17 ng/mL", note: "Low → macrocytic anemia, neural tube defects." },
  ],
  abg: [
    { name: "pH (arterial)", range: "7.35–7.45", note: "Acidosis (<7.35) vs alkalosis (>7.45)." },
    { name: "PaCO₂", range: "35–45 mmHg", note: "Respiratory component. High → hypoventilation." },
    { name: "PaO₂", range: "80–100 mmHg", note: "Hypoxemia on room air. <60 → severe." },
    { name: "HCO₃ (arterial)", range: "22–26 mEq/L", note: "Metabolic component." },
    { name: "Base Excess", range: "–2 to +2 mEq/L", note: "Metabolic acid-base status." },
    { name: "Lactate", range: "0.5–2.0 mmol/L", note: "Tissue hypoperfusion, sepsis, ischemia." },
    { name: "O₂ Saturation", range: "95–100%", note: "Hb-bound O₂. <90% → hypoxemia." },
    { name: "A-a Gradient", range: "10–20 mmHg", note: "↑ in V/Q mismatch, shunt, diffusion defect." },
  ],
  coag: [
    { name: "PT / INR", range: "11–14 sec / 0.9–1.2", note: "Extrinsic pathway. ↑ in warfarin, liver disease, Vit K def, DIC." },
    { name: "aPTT", range: "25–35 sec", note: "Intrinsic pathway. ↑ in heparin, hemophilia." },
    { name: "Fibrinogen", range: "200–400 mg/dL", note: "Acute phase reactant. ↓ in DIC, liver failure." },
    { name: "D-Dimer", range: "<0.5 µg/mL", note: "Sensitive but not specific for DVT/PE." },
    { name: "Bleeding Time", range: "2–7 min", note: "Platelet function. ↑ in vWD, ASA use." },
    { name: "Factor VIII", range: "55–145%", note: "Hemophilia A (↓)." },
  ],
  other: [
    { name: "TSH", range: "0.4–4.0 mIU/L", note: "High → primary hypothyroidism. Low → hyperthyroidism." },
    { name: "Free T4", range: "0.8–1.8 ng/dL", note: "Active thyroid hormone." },
    { name: "HbA1c", range: "<5.7%", note: "Glycemic control over ~3 months. ≥6.5% → diabetes." },
    { name: "CRP", range: "<1.0 mg/L", note: "Nonspecific acute phase reactant." },
    { name: "ESR", range: "0–20 mm/hr", note: "Nonspecific inflammation." },
    { name: "Uric Acid", range: "3.5–7.2 mg/dL", note: "High → gout, tumor lysis." },
    { name: "Ammonia", range: "15–45 µg/dL", note: "High in hepatic encephalopathy." },
    { name: "BNP", range: "<100 pg/mL", note: "HF marker. ↑ in systolic/diastolic HF." },
  ],
};

export function LabValuesSidebar({ open, onClose }: { open?: boolean; onClose: () => void }) {
  const platform = usePlatform();
  const [tab, setTab] = React.useState<LabCategory>("chem");
  const labs = LABS_BY_CAT[tab];

  const content = (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Lab Values</h3>
        </div>
        <button
          onClick={onClose}
          className="size-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex border-b border-border bg-muted/30 shrink-0 overflow-x-auto">
        {LAB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${
              tab === t.id
                ? "border-primary text-primary bg-card"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto medos-scroll p-3">
        <div className="space-y-1.5">
          {labs.map((lab) => (
            <div
              key={lab.name}
              className="rounded-lg border border-border/60 bg-card px-3 py-2 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {lab.name}
                </span>
                <span className="text-[10px] font-semibold text-primary tabular-nums shrink-0">
                  {lab.range}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                {lab.note}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (open !== undefined) {
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            initial={platform.isPhone ? { y: "100%", opacity: 0 } : { x: 360, opacity: 0 }}
            animate={platform.isPhone ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
            exit={platform.isPhone ? { y: "100%", opacity: 0 } : { x: 360, opacity: 0 }}
            transition={platform.isPhone
              ? { type: "spring", damping: 32, stiffness: 320 }
              : { type: "spring", damping: 28, stiffness: 300 }}
            className={platform.isPhone
              ? "fixed inset-0 z-50 bg-card flex flex-col"
              : "fixed right-0 top-12 bottom-0 z-50 w-full sm:w-96 border-l border-border bg-card shadow-xl flex flex-col"
            }
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return content;
}
