import { Card } from "@/components/ui/card";
import type { SubjectNode } from "@/lib/subjects/tree";
import { AddSubjectForm, type CatalogEntry } from "./add-subject-form";
import { SubjectCard } from "./subject-card";

export function SubjectTree({
  tree,
  editable,
  catalog,
}: {
  tree: SubjectNode[];
  editable: boolean;
  catalog: CatalogEntry[];
}) {
  if (tree.length === 0) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">No subjects yet</p>
        <p className="mt-1 text-sm text-muted">
          {editable
            ? "Add a subject to start tracking chapters and progress."
            : "Your student hasn't added any subjects yet."}
        </p>
        {editable ? (
          <div className="mt-4">
            <AddSubjectForm catalog={catalog} />
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {tree.map((subject) => (
        <SubjectCard key={subject.id} subject={subject} editable={editable} />
      ))}
      {editable ? <AddSubjectForm catalog={catalog} /> : null}
    </div>
  );
}
