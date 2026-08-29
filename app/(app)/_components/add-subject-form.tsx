"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
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

  const items: ComboboxItem[] = useMemo(
    () =>
      catalog.map((entry) => ({
        id: entry.id,
        label: entry.name,
        keywords: entry.common_aliases,
      })),
    [catalog],
  );

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
            <Combobox
              id="subject_name"
              name="display_name"
              value={name}
              items={items}
              // Typing past a suggestion drops the catalogue link: §4.1 keeps
              // display_name as the school's own name, and a stale catalog_id
              // would claim a match the text no longer makes.
              onChange={(text) => {
                setName(text);
                setCatalogId("");
              }}
              onSelect={(item) => {
                setName(item.label);
                setCatalogId(item.id);
              }}
              placeholder="Environmental Management"
            />
          </Field>

          <Field label="Teacher (optional)" htmlFor="teacher_name">
            <Input id="teacher_name" name="teacher_name" placeholder="Rakin" />
          </Field>

          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Adding…" : "Add subject"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
