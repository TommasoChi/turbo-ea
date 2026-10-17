/**
 * ArchimateEditorPage — full-page ArchiMate editor route.
 * Route: /admin/archimate/:id
 *
 * Keyed by the diagram id so the editor (a diagram-js instance with its own undo stack and dirty
 * state) is rebuilt, never reused, when the URL moves from one diagram to another.
 */
import { useNavigate, useParams } from "react-router";
import ArchimateModeler from "./ArchimateModeler";

export default function ArchimateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) return null;

  return <ArchimateModeler key={id} diagramId={id} onBack={() => navigate("/admin/archimate")} />;
}
