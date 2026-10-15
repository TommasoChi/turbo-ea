from __future__ import annotations

from pathlib import Path

from app.services.archimate.validate import MAX_XML_BYTES, validate_exchange

FX = Path(__file__).resolve().parents[1] / "fixtures" / "archimate"
NS = 'xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'


def _model(elements="", relationships="", views=""):
    return (
        f'<model {NS} identifier="m"><name xml:lang="en">m</name>'
        f"<elements>{elements}</elements><relationships>{relationships}</relationships>"
        f"<views><diagrams>{views}</diagrams></views></model>"
    )


def _el(i, t):
    return f'<element identifier="{i}" xsi:type="{t}"><name xml:lang="en">{i}</name></element>'


def _rel(i, t, s, g, extra=""):
    return f'<relationship identifier="{i}" xsi:type="{t}" source="{s}" target="{g}" {extra}/>'


def codes(xml):
    return [(i.code, i.ref) for i in validate_exchange(xml)]


def test_the_valid_fixture_has_no_issues():
    assert validate_exchange((FX / "valid_model.xml").read_text(encoding="utf-8")) == []


def test_xxe_and_dtd_are_rejected_without_reading_files():
    assert codes((FX / "hostile_xxe.xml").read_text(encoding="utf-8")) == [("dtd_forbidden", None)]


def test_billion_laughs_is_rejected():
    laughs = (
        '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa">'
        '<!ENTITY b "&a;&a;&a;&a;">]><model xmlns="x">&b;</model>'
    )
    assert codes(laughs) == [("dtd_forbidden", None)]


def test_oversize_input_is_rejected_before_parsing():
    assert codes("<a>" + "x" * MAX_XML_BYTES + "</a>") == [("too_large", None)]


def test_malformed_xml_is_one_issue_not_an_exception():
    assert codes("<model") == [("xml_invalid", None)]


def test_wrong_root():
    assert codes('<foo xmlns="http://www.opengroup.org/xsd/archimate/3.0/"/>') == [
        ("wrong_root", None)
    ]
    assert codes("<model/>") == [("wrong_root", None)]


def test_unknown_element_and_relationship_types():
    xml = _model(_el("a", "Banana"), _rel("r", "Wibble", "a", "a"))
    assert ("unknown_element_type", "a") in codes(xml)
    assert ("unknown_relationship_type", "r") in codes(xml)


def test_duplicate_identifiers():
    xml = _model(_el("a", "BusinessActor") + _el("a", "BusinessProcess"))
    assert ("duplicate_identifier", "a") in codes(xml)


def test_dangling_relationship_endpoints():
    xml = _model(
        _el("a", "BusinessActor"),
        _rel("r", "Association", "a", "ghost") + _rel("q", "Association", "ghost", "a"),
    )
    assert ("dangling_target", "r") in codes(xml) and ("dangling_source", "q") in codes(xml)


def test_a_relationship_the_matrix_forbids():
    xml = _model(
        _el("d", "DataObject") + _el("p", "BusinessActor"), _rel("r", "Assignment", "d", "p")
    )
    assert codes(xml) == [("relationship_not_allowed", "r")]


def test_a_relationship_the_matrix_allows():
    xml = _model(
        _el("p", "BusinessActor") + _el("q", "BusinessProcess"), _rel("r", "Assignment", "p", "q")
    )
    assert codes(xml) == []


def test_relationship_to_relationship_is_limited_to_three_types():
    base = _el("a", "BusinessActor") + _el("b", "BusinessProcess")
    rels = _rel("r1", "Association", "a", "b")
    ok = _model(base, rels + _rel("r2", "Association", "a", "r1"))
    bad = _model(base, rels + _rel("r3", "Serving", "a", "r1"))
    assert codes(ok) == []
    assert codes(bad) == [("relationship_not_allowed", "r3")]


def test_access_type_must_be_known():
    els = _el("p", "BusinessProcess") + _el("o", "BusinessObject")
    xml = _model(els, _rel("r", "Access", "p", "o", 'accessType="Maybe"'))
    assert ("unknown_access_type", "r") in codes(xml)
    ok = _model(els, _rel("r", "Access", "p", "o", 'accessType="ReadWrite"'))
    assert codes(ok) == []


def test_view_references_must_resolve_and_match():
    base = _el("a", "BusinessActor") + _el("p", "BusinessProcess") + _el("x", "BusinessRole")
    rel = _rel("r", "Assignment", "a", "p")
    nodes = (
        '<node identifier="n1" xsi:type="Element" elementRef="a" x="0" y="0" w="10" h="10"/>'
        '<node identifier="n2" xsi:type="Element" elementRef="p" x="0" y="0" w="10" h="10"/>'
        '<node identifier="n3" xsi:type="Element" elementRef="x" x="0" y="0" w="10" h="10"/>'
    )

    def view(conn):
        head = '<view identifier="v" xsi:type="Diagram"><name xml:lang="en">v</name>'
        return f"{head}{nodes}{conn}</view>"

    def conn(ref, src, tgt):
        return (
            f'<connection identifier="c" xsi:type="Relationship" relationshipRef="{ref}" '
            f'source="{src}" target="{tgt}"/>'
        )

    good = view(conn("r", "n1", "n2"))
    assert codes(_model(base, rel, good)) == []
    wrong = view(conn("r", "n3", "n2"))
    assert codes(_model(base, rel, wrong)) == [("connection_endpoint_mismatch", "c")]
    ghost = view(
        '<node identifier="n9" xsi:type="Element" elementRef="nope" x="0" y="0" w="1" h="1"/>'
    )
    assert ("dangling_element_ref", "n9") in codes(_model(base, rel, ghost))
    ghostrel = view(conn("nope", "n1", "n2"))
    assert ("dangling_relationship_ref", "c") in codes(_model(base, rel, ghostrel))


def test_element_of_unknown_type_is_reported_once_not_as_dangling():
    xml = _model(_el("a", "Banana") + _el("b", "BusinessActor"), _rel("r", "Association", "a", "b"))
    assert codes(xml) == [("unknown_element_type", "a")]


def test_missing_xsi_type_and_identifier_do_not_crash():
    xml = _model('<element><name xml:lang="en">x</name></element>', '<relationship source="a"/>')
    assert [c for c, _ in codes(xml)] == [
        "unknown_element_type",
        "unknown_relationship_type",
        "dangling_source",
        "dangling_target",
    ]


def test_deeply_nested_xml_never_raises():
    deep = _model(views="<x>" * 50000 + "</x>" * 50000)
    assert all(isinstance(i.code, str) for i in validate_exchange(deep))


def test_external_dtd_reference_is_rejected():
    xml = '<!DOCTYPE m SYSTEM "http://127.0.0.1:9/evil.dtd"><model xmlns="x"/>'
    assert codes(xml) == [("dtd_forbidden", None)]
