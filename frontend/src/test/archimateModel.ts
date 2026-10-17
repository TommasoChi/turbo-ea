/**
 * Shared ArchiMate model fixture (writer, reader and editor tests).
 *
 * Built to pass the server validator (backend/app/services/archimate/validate.py): every identifier in
 * the document is distinct, relationships are allowed by the ArchiMate table, and the view connection
 * joins the nodes that show the relationship's endpoints.
 */
import { CARD_ID_DEFINITION, type ArchimateModel } from "@/features/archimate/exchange/exchangeModel";

export const MODEL: ArchimateModel = {
  id: "id-model",
  name: "A & B",
  documentation: "Fixture model",
  propertyDefinitions: [{ id: CARD_ID_DEFINITION, name: "turboea:cardId", type: "string" }],
  properties: [],
  elements: [
    {
      id: "id-app", type: "ApplicationComponent", name: "CRM <core>", documentation: "The CRM",
      properties: [{ ref: CARD_ID_DEFINITION, value: "c1" }],
    },
    { id: "id-node", type: "Node", name: "N", properties: [] },
    { id: "id-data", type: "DataObject", name: "Customer", properties: [] },
    { id: "id-group", type: "Grouping", name: "Zone", properties: [] },
  ],
  relationships: [
    { id: "id-rel-serving", type: "Serving", source: "id-node", target: "id-app", properties: [] },
    {
      id: "id-rel-access", type: "Access", source: "id-app", target: "id-data", accessType: "ReadWrite",
      name: "uses", properties: [],
    },
    {
      id: "id-rel-assoc", type: "Association", source: "id-app", target: "id-node", isDirected: true,
      properties: [],
    },
  ],
  views: [
    {
      id: "id-view",
      name: "Main",
      nodes: [
        { id: "id-n1", elementRef: "id-app", x: 10, y: 20, width: 120, height: 55, parent: null },
        { id: "id-g1", elementRef: "id-group", x: 100, y: 100, width: 200, height: 120, parent: null },
        { id: "id-n2", elementRef: "id-data", x: 130, y: 140, width: 120, height: 55, parent: "id-g1" },
      ],
      connections: [
        {
          id: "id-c1", relationshipRef: "id-rel-access", source: "id-n1", target: "id-n2",
          bendpoints: [{ x: 70, y: 150 }, { x: 120, y: 160 }],
        },
      ],
      notes: [],
    },
  ],
};
