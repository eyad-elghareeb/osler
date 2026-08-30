"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Calculator, X } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { MOTION_SPRING } from "@/lib/osler/motion";

function useDrag(initialPos?: { x: number; y: number }) {
  const [pos, setPos] = React.useState(initialPos ?? null);
  const dragRef = React.useRef({ startX: 0, startY: 0, posX: 0, posY: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: rect.left,
      posY: rect.top,
    };

    const handleMove = (ev: MouseEvent) => {
      setPos({
        x: dragRef.current.posX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.posY + (ev.clientY - dragRef.current.startY),
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  return { pos, onMouseDown };
}

export function CalculatorModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [display, setDisplay] = React.useState("0");
  const [equation, setEquation] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);
  const { pos, onMouseDown } = useDrag();

  React.useEffect(() => {
    const cb = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (/^[0-9.+\-*/]$/.test(e.key)) {
        const btn = ref.current?.querySelector(
          `[data-key="${e.key}"]`
        ) as HTMLButtonElement;
        btn?.click();
      }
      if (e.key === "Enter") {
        (ref.current?.querySelector('[data-key="="]') as HTMLButtonElement)?.click();
      }
      if (e.key === "Backspace") {
        (ref.current?.querySelector('[data-key="←"]') as HTMLButtonElement)?.click();
      }
      if (e.key === "c" || e.key === "C") {
        (ref.current?.querySelector('[data-key="C"]') as HTMLButtonElement)?.click();
      }
    };
    window.addEventListener("keydown", cb);
    return () => window.removeEventListener("keydown", cb);
  }, [onClose]);

  const compute = (expr: string): string => {
    if (!expr) return "0";
    const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
    if (!tokens) return "Error";
    const pass1: (number | string)[] = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === "*" || t === "/") {
        const left = pass1.pop() as number;
        const right = parseFloat(tokens[++i]);
        if (t === "*") pass1.push(left * right);
        else {
          if (right === 0) return "Error";
          pass1.push(left / right);
        }
      } else if (t === "+" || t === "-") {
        pass1.push(t);
      } else {
        pass1.push(parseFloat(t));
      }
      i++;
    }
    let result = pass1[0] as number;
    for (let j = 1; j < pass1.length; j += 2) {
      const op = pass1[j] as string;
      const right = pass1[j + 1] as number;
      if (op === "+") result += right;
      else if (op === "-") result -= right;
    }
    if (!isFinite(result)) return "Error";
    return String(Math.round(result * 1e10) / 1e10);
  };

  const press = (key: string) => {
    if (key === "C") {
      setDisplay("0");
      setEquation("");
      return;
    }
    if (key === "=") {
      const result = compute(equation || display);
      setDisplay(result);
      setEquation(result === "Error" ? "" : result);
      return;
    }
    if (key === "←") {
      const next = equation.slice(0, -1);
      setEquation(next);
      setDisplay(next || "0");
      return;
    }
    const next = equation + key;
    setEquation(next);
    setDisplay(next);
  };

  const buttons = [
    ["C", "←", "/", "*"],
    ["7", "8", "9", "-"],
    ["4", "5", "6", "+"],
    ["1", "2", "3", "="],
    ["0", "."],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={MOTION_SPRING.soft}
      ref={ref}
      className="fixed z-50 bg-card border border-border rounded-xl shadow-e4 w-64 overflow-hidden"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 80 }}
    >
      <div
        className="px-3 py-2 border-b border-border flex items-center justify-between bg-primary text-primary-foreground cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <Calculator className="size-3.5" />
          <span className="text-xs font-semibold">{t("calculator.title")}</span>
        </div>
        <button
          onClick={onClose}
          className="size-6 rounded-md hover:bg-primary-foreground/15 flex items-center justify-center"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="p-2.5">
        <div className="bg-muted rounded-lg p-2 mb-2 text-right">
          <div className="text-[11px] text-muted-foreground h-3 tabular-nums truncate">
            {equation || "\u00A0"}
          </div>
          <div className="text-xl font-semibold tabular-nums truncate">
            {display}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {buttons.flat().map((b) => {
            const isOp = ["/", "*", "-", "+", "="].includes(b);
            const isAction = ["C", "←"].includes(b);
            const isZero = b === "0";
            return (
              <button
                key={b}
                data-key={b}
                onClick={() => press(b)}
                className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
                  isOp
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : isAction
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "bg-muted hover:bg-muted/70"
                } ${isZero ? "col-span-2" : ""}`}
              >
                {b}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
