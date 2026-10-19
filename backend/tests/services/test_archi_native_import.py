"""`backend/tests/fixtures/archimate/archi_native_sample.archimate` is a small model
exported from Archi (archimatetool.com's own desktop tool): 4 Business elements, one
Grouping, 6 relationships and a view that places some elements twice. It pins the
converter against a real Archi export, not just a hand-built fixture."""

from __future__ import annotations

from pathlib import Path

from app.services.archimate.archi_native_import import convert_archi_native_to_exchange
from app.services.archimate.validate import validate_exchange

FIXTURE = (
    Path(__file__).resolve().parents[1] / "fixtures" / "archimate" / "archi_native_sample.archimate"
)

NATIVE_MINI = """<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:archimate="http://www.archimatetool.com/archimate" name="Mini" id="id-model"
    version="5.0.0">
  <folder name="Business" id="id-f1" type="business">
    <element xsi:type="archimate:BusinessActor" name="Actor" id="id-actor"/>
    <element xsi:type="archimate:BusinessProcess" name="Process" id="id-process"/>
    <element xsi:type="archimate:BusinessObject" name="Object" id="id-object"/>
  </folder>
  <folder name="Relations" id="id-f2" type="relations">
    <element xsi:type="archimate:AssignmentRelationship" id="id-rel" source="id-actor"
        target="id-process"/>
    <element xsi:type="archimate:AccessRelationship" id="id-rel-access" source="id-process"
        target="id-object" accessType="3"/>
  </folder>
  <folder name="Views" id="id-f3" type="diagrams">
    <element xsi:type="archimate:ArchimateDiagramModel" name="Main" id="id-view">
      <child xsi:type="archimate:DiagramObject" id="id-n1" archimateElement="id-actor">
        <bounds x="10" y="20" width="120" height="55"/>
        <sourceConnection xsi:type="archimate:Connection" id="id-c1" source="id-n1" target="id-n2"
            archimateRelationship="id-rel"/>
      </child>
      <child xsi:type="archimate:DiagramObject" id="id-n2" archimateElement="id-process">
        <bounds x="200" y="20" width="120" height="55"/>
      </child>
      <child xsi:type="archimate:Note" id="id-note">
        <bounds x="0" y="0" width="50" height="20"/>
      </child>
    </element>
  </folder>
</archimate:model>
"""


def test_mini_model_converts_to_valid_exchange_xml():
    exchange_xml = convert_archi_native_to_exchange(NATIVE_MINI)

    assert validate_exchange(exchange_xml) == []
    assert 'xsi:type="BusinessActor"' in exchange_xml
    assert 'xsi:type="BusinessProcess"' in exchange_xml
    # AssignmentRelationship -> Assignment (the "Relationship" suffix is Archi's own).
    assert 'xsi:type="Assignment"' in exchange_xml
    # accessType 3 -> ReadWrite (Archi's numeric code -> the Exchange format's enum).
    assert 'accessType="ReadWrite"' in exchange_xml
    # The Note has no archimateElement -- no node for it, but its siblings still appear.
    assert exchange_xml.count("<node") == 2
    assert 'relationshipRef="id-rel"' in exchange_xml


def test_rejects_a_non_archi_root():
    try:
        convert_archi_native_to_exchange("<model/>")
    except ValueError as exc:
        assert "archimate:model" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_real_archi_export_converts_to_a_valid_exchange_model():
    native_xml = FIXTURE.read_text(encoding="utf-8")
    exchange_xml = convert_archi_native_to_exchange(native_xml)

    issues = validate_exchange(exchange_xml)
    assert issues == [], issues
    # 4 Business elements + 1 Grouping; 6 relationships; the one view.
    assert exchange_xml.count("<element ") == 5
    assert exchange_xml.count("<relationship ") == 6
    assert "<view " in exchange_xml
