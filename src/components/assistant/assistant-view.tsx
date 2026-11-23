"use client";
import { Mic, MicOff, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import type { AssistantAnswer } from "@/lib/ai/assistant";
import { cn } from "@/lib/utils";

type Msg = { role: "user"; text: string } | { role: "assistant"; text: string; answer?: AssistantAnswer; error?: boolean };
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

const noop = () => () => {};

function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Ask about your own numbers by text or voice; answers are read-only summaries with links to the details. */
export function AssistantView({ ready, ask, base = "", sample, compact, onNavigate }: { ready: boolean; ask?: (i: unknown) => Promise<ActionResult<AssistantAnswer>>; base?: string; sample?: Msg[]; compact?: boolean; onNavigate?: () => void }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const [msgs, setMsgs] = React.useState<Msg[]>(sample ?? []);
  const [q, setQ] = React.useState("");
  const [pending, start] = React.useTransition();
  const [listening, setListening] = React.useState(false);
  const canSpeak = React.useSyncExternalStore(noop, () => !!speechRecognition(), () => false);
  const rec = React.useRef<Recognition | null>(null);
  const end = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs.length]);

  const send = (text: string) => {
    const question = text.trim();
    if (question.length < 2 || !ask) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.role === "assistant" && m.answer ? m.answer.answer : m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    start(async () => {
      const r = await ask({ question, history });
      if (r.ok && r.data) setMsgs((m) => [...m, { role: "assistant", text: r.data!.answer, answer: r.data }]);
      else setMsgs((m) => [...m, { role: "assistant", error: true, text: t.has(`e_${r.ok ? "aiFailed" : r.error}`) ? t(`e_${r.ok ? "aiFailed" : r.error}`) : t("e_aiFailed") }]);
    });
  };

  const toggleMic = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const R = speechRecognition();
    if (!R) return;
    const r = new R();
    r.lang = locale === "en" ? "en-US" : "ar-SA";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      finalText = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ");
      setQ(finalText);
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim().length > 1) send(finalText);
    };
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const suggestions = [t("s1"), t("s2"), t("s3"), t("s4")];

  return (
    <div className={cn("grid gap-4", compact ? "h-full min-h-0 grid-rows-[1fr_auto]" : "mx-auto max-w-3xl")}>
      {!ready && <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm">{t("notReady")}</p>}

      <div className={cn("grid content-start gap-3", compact ? "min-h-0 overflow-y-auto" : "min-h-[40vh] rounded-3xl border border-border bg-surface p-4 sm:p-6")} aria-live="polite">
        {msgs.length === 0 && (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Sparkles className="size-6" />
            </span>
            <p className="max-w-md text-sm text-muted-foreground">{t("intro")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" disabled={!ready || pending} onClick={() => send(s)} className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] hover:border-border-strong disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="max-w-[85%] justify-self-end rounded-3xl rounded-ee-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
              {m.text}
            </p>
          ) : (
            <div key={i} className={cn("grid max-w-[95%] gap-3 justify-self-start rounded-3xl rounded-es-md px-4 py-3", m.error ? "bg-danger-soft text-danger" : "bg-surface-2")}>
              <p className="whitespace-pre-line text-[15px] leading-7">{m.text}</p>
              {m.answer && m.answer.figures.length > 0 && (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {m.answer.figures.map((f) => (
                    <div key={f.label} className="rounded-2xl bg-surface px-3 py-2">
                      <dt className="text-[12px] text-muted-foreground">{f.label}</dt>
                      <dd className="font-bold" dir="auto">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {m.answer && m.answer.links.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {m.answer.links.map((l) => (
                    <Link key={l.href} href={`${base}${l.href}`} onClick={onNavigate} className="rounded-full border border-border bg-surface px-3 py-1 text-[13px] font-semibold text-primary hover:border-border-strong">
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {pending && <p className="justify-self-start rounded-3xl bg-surface-2 px-4 py-3 text-sm text-muted-foreground">{t("thinking")}</p>}
        <div ref={end} />
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <Textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(q);
            }
          }}
          rows={2}
          maxLength={500}
          placeholder={listening ? t("listening") : t("placeholder")}
          aria-label={t("placeholder")}
          disabled={!ready}
          className="min-h-14 flex-1"
        />
        {canSpeak && (
          <Button type="button" variant={listening ? "danger" : "secondary"} size="icon" className="size-14 shrink-0" onClick={toggleMic} disabled={!ready || pending} aria-label={listening ? t("stop") : t("speak")}>
            {listening ? <MicOff /> : <Mic />}
          </Button>
        )}
        <Button type="submit" size="icon" className="size-14 shrink-0" disabled={!ready || pending || q.trim().length < 2} aria-label={t("send")}>
          <Send className="rtl:-scale-x-100" />
        </Button>
      </form>
      {!compact && <p className="text-center text-[12px] text-muted-foreground">{t("disclaimer")}</p>}
    </div>
  );
}
