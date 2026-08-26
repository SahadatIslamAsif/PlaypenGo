"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { addSubject, type ActionState } from "@/lib/subjects/actions";

const initialState: ActionState = { error: null };

export type CatalogEntry = {
  id: string;
  name: string;
  common_aliases: string[];
};

export function AddSubjectForm({ catalog }: { catalog: CatalogEntry[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [state, formAction, pending] = useActionState(addSubject, initialState);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current && !pending && state.error === null) {
      submittedRef.current = false;
      close();
    }
  }, [pending, state]);

  const suggestions = useMemo(() => {
    const query = name.trim().toLowerCase();
    if (query.length < 2) return [];
    return catalog
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(query) ||
          entry.common_aliases.some((alias) => alias.toLowerCase().includes(query)),
      )
      .slice(0, 6);
  }, [catalog, name]);

  function close() {
    setOpen(false);
    setName("");
    setCatalogId("");
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="w-full">
        Add subject
      </Button>

      <Sheet open={open} onClose={close} title="Add a subject">
        <form
          action={(formData) => {
            submittedRef.current = true;
            formAction(formData);
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="catalog_id" value={catalogId} />

          <Field label="Subject name" htmlFor="subject_name">
            <Input
              id="subject_name"
              name="display_name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setCatalogId("");
              }}
              autoComplete="off"
              placeholder="Environmental Management"
              required
            />
            {suggestions.length > 0 ? (
              <div className="mt-1.5 flex flex-col gap-1 rounded-button border border-hairline bg-surface p-1">
                {suggestions.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setName(entry.name);
                      setCatalogId(entry.id);
                    }}
                    className="rounded-button px-2 py-1.5 text-left text-sm text-body hover:bg-surface-sunk"
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>

          <Field label="Teacher (optional)" htmlFor="teacher_name">
            <Input id="teacher_name" name="teacher_name" placeholder="Rakin" />
          </Field>

          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Adding…" : "Add subject"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
