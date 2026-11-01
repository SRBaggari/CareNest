"use client";

import { FileSearch, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApiSubmit } from "@/lib/api-client";

type Answer = { kind: "answer" | "not_in_records" | "medical_advice" | "declined"; answer: string | null; citations: { id: string; label: string; path: string }[] };

const textarea = "min-h-28 w-full rounded-xl border-2 border-border bg-surface p-3 text-lg focus:border-primary aria-[invalid=true]:border-danger";

/** One question at a time; the answer shows the records it came from. Nothing is saved. */
export function AskForm(props: {
  url: string;
  labels: Record<"question" | "questionHint" | "ask" | "from" | "medical" | "declined" | "disclaimer" | "network" | "generic" | "fixErrors", string>;
}) {
  const { labels: l } = props;
  // The answer is the confirmation here, so no separate "Done." toast.
  const { pending, error, fieldErrors, submit } = useApiSubmit(l, { confirm: false });
  const [answer, setAnswer] = useState<Answer | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnswer(null);
    const result = await submit<Answer>("POST", props.url, { question: String(new FormData(event.currentTarget).get("question") ?? "") });
    if (result) setAnswer(result);
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{l.question}</span>
          <span className="text-base text-muted">{l.questionHint}</span>
          <textarea name="question" maxLength={500} required aria-invalid={Boolean(fieldErrors.question?.length)} className={textarea} />
          {fieldErrors.question && <span className="font-medium text-danger">{fieldErrors.question.join(" ")}</span>}
        </label>
        <Button type="submit" busy={pending} className="self-start">
          <Sparkles aria-hidden="true" className="size-5" />
          {l.ask}
        </Button>
      </form>

      <div aria-live="polite">
        {answer && (
          <section className="animate-rise card flex max-w-3xl flex-col gap-4 border-2 border-primary">
            {answer.kind === "medical_advice" ? (
              <p className="text-lg font-semibold">{l.medical}</p>
            ) : answer.kind === "declined" ? (
              <p className="text-lg font-semibold">{l.declined}</p>
            ) : (
              <p className="whitespace-pre-line text-lg">{answer.answer}</p>
            )}
            {answer.citations.length > 0 && (
              <div>
                <p className="font-semibold">{l.from}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {answer.citations.map((c) => (
                    <li key={c.id}>
                      <Link href={c.path} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary-soft px-4 font-semibold text-primary hover:underline">
                        <FileSearch aria-hidden="true" className="size-4" />
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-base text-muted">{l.disclaimer}</p>
          </section>
        )}
      </div>
    </div>
  );
}
