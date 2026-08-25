"use client";

import * as React from "react";
import { Check, ListChecks, CheckCircle2, Circle, Activity, User, AlertTriangle, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionQuestion } from "./shared";




































































export function OsceEngineView({
  question,
  rubricState,
  submitted,
  onRubricToggle,
}: {
  question: SessionQuestion;
  rubricState: boolean[];
  submitted: boolean;
  onRubricToggle: (idx: number) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      {/* Patient scenario */}
      <div className="osler-osce-patient">
        <div className="osler-osce-patient-avatar">
          <User className="size-7" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Patient Scenario
            </h3>
          </div>
        </div>
      </div>

      {/* Red Flags */}
      {question.redFlags && question.redFlags.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/25 rounded-xl p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold mb-2 text-destructive">
            <AlertTriangle className="size-4" />
            Red Flags
          </h4>
          <ul className="space-y-1">
            {question.redFlags.map((flag, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-destructive mt-1">•</span>
                <span className="leading-relaxed">{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Differential Diagnosis */}
      {question.differential && question.differential.length > 0 && (
        <div className="osler-card--default">
          <h4 className="flex items-center gap-2 text-sm font-semibold mb-2">
            <Stethoscope className="size-4 text-primary" />
            Differential Diagnosis
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {question.differential.map((d, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-md text-xs bg-muted text-foreground border border-border"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Performance Rubric */}
      {question.rubric && question.rubric.length > 0 && (
        <div className="osler-card--default">
          <div className="flex items-center justify-between mb-1">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <ListChecks className="size-4 text-primary" />
              Performance Rubric
            </h4>
            <span className="text-xs text-muted-foreground">
              Score:{" "}
              <span className="font-semibold text-foreground">
                {rubricState.filter(Boolean).length}
              </span>{" "}
              / {question.rubric.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {submitted
              ? "Review the items you addressed."
              : "Check each item you addressed during this station."}
          </p>
          <div className="space-y-1.5">
            {question.rubric.map((item, i) => {
              const checked = rubricState[i] ?? false;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={submitted}
                  onClick={() => onRubricToggle(i)}
                  className={cn(
                    "w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors",
                    checked
                      ? "bg-success/10 text-success"
                      : "hover:bg-muted",
                    submitted && "cursor-default opacity-70"
                  )}
                >
                  {checked ? (
                    <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <span>{item}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}