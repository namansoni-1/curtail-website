"""CFO-ready PDF summary of a replay run."""

from __future__ import annotations

import io
from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

INK = colors.HexColor("#14161a")
MUTED = colors.HexColor("#5b6270")
RULE = colors.HexColor("#d9dce2")
ACCENT = "#c8763a"
NEUTRAL = "#57524a"

FLAG_TEXT = {
    "deadline_missing_assumed_zero_slack": "jobs with no deadline treated as having zero slack",
    "tenant_config_missing": "tenant-events with no tenant configuration (protected)",
    "opt_in_unknown": "tenant-events with unknown opt-in (protected)",
    "tenant_limit_missing": "tenant-events with no reduction limit (protected)",
    "tenant_min_missing": "tenant-events with no guaranteed minimum (protected)",
    "compensation_assumed_default": "tenant-events using the default compensation rate",
    "job_type_unknown": "job-events with unknown job type (protected)",
    "no_power_data": "job-events with no power data (not counted)",
    "job_tenant_missing": "job-events with no tenant (protected)",
    "it_kw_missing_derived_from_pue": "IT load derived from total power and assumed PUE",
    "no_grid_signals": "no grid signals loaded",
    "deadline_from_timelimit": "job-events using requested walltime as the deadline",
    "tenant_min_assumed_zero": "tenant-events assuming a zero guaranteed minimum",
}


def _energy(mwh: float) -> str:
    return f"{mwh * 1000:,.1f} kWh" if abs(mwh) < 1 else f"{mwh:,.2f} MWh"


def _power(mw: float) -> str:
    return f"{mw * 1000:,.1f} kW" if abs(mw) < 1 else f"{mw:,.2f} MW"


def _money(x: float) -> str:
    return f"-${abs(x):,.0f}" if x < 0 else f"${x:,.0f}"


def _chart(result: dict) -> io.BytesIO:
    tl = result["timeline"]
    ts = pd.to_datetime(tl["ts"])
    fig, ax = plt.subplots(figsize=(7.2, 2.6), dpi=200)
    peak = max((v for v in tl["actual_kw"] if v is not None), default=0)
    scale, unit = (1000, "MW") if peak >= 1000 else (1, "kW")
    actual = [None if v is None else v / scale for v in tl["actual_kw"]]
    reduced = [None if v is None else v / scale for v in tl["reduced_kw"]]
    for w in tl["windows"]:
        ax.axvspan(pd.Timestamp(w["start"]), pd.Timestamp(w["end"]), color="#f2b134", alpha=0.25, lw=0)
    ax.plot(ts, actual, color=NEUTRAL, lw=0.8, label="Actual facility load")
    ax.plot(ts, reduced, color=ACCENT, lw=0.8, label="With Curtail (firm)")
    ax.set_ylabel(unit, fontsize=7)
    ax.tick_params(labelsize=6)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.legend(fontsize=6, frameon=False, loc="upper left", ncols=2)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return buf


def _table(rows, widths, header=True):
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
                  ("TEXTCOLOR", (0, 0), (-1, 0), MUTED)]
    t.setStyle(TableStyle(style))
    return t


def build_pdf(result: dict, site_name: str, run_id: str) -> bytes:
    s = result["summary"]
    p = result["params"]
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=18, alignment=0, textColor=INK,
                        spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11, textColor=INK, spaceBefore=10,
                        spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9, leading=12.5, textColor=INK)
    small = ParagraphStyle("s", parent=body, fontSize=7.5, leading=10, textColor=MUTED)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            title=f"Curtail Replay: {site_name}")
    start = (s["period_start"] or "")[:10]
    end = (s["period_end"] or "")[:10]
    story = [
        Paragraph(f"Curtail Replay: {site_name}", h1),
        Paragraph(f"Historical period {start} to {end} &nbsp;·&nbsp; run {run_id[:8]} "
                  f"&nbsp;·&nbsp; generated {datetime.now():%Y-%m-%d}", small),
        Spacer(1, 10),
        Paragraph(
            f"Over <b>{s['period_months']:.1f} months</b>, this facility could have safely reduced "
            f"<b>{_energy(s['firm_mwh'])}</b> across <b>{s['events_with_reduction']} of "
            f"{s['events']} events</b>, affecting <b>{s['jobs_affected']} jobs</b> and earning the "
            f"operator <b>{_money(s['operator_net'])}</b> net of tenant compensation and energy "
            f"rebound, with <b>zero SLA or tenant-rule violations</b>.", body),
        Spacer(1, 8),
    ]
    acts = s.get("actions", {})
    story.append(_table([
        ["Metric", "Value"],
        [("Events analyzed (grid events + price above "
         f"${p['price_threshold_per_mwh']:,.0f}/MWh)"), f"{s['events']} ({s['event_hours']:.1f} h)"],
        ["Firm energy reduced during events", _energy(s["firm_mwh"])],
        ["Average firm reduction while events active", _power(s["avg_firm_mw_during_events"])],
        ["Largest single-event average reduction", _power(s["peak_firm_mw"])],
        ["Jobs affected", f"{s['jobs_affected']}"],
        ["Actions taken across events (caps / pauses / deferrals)",
         f"{acts.get('cap', 0)} / {acts.get('pause', 0)} / {acts.get('defer', 0)}"],
        ["Gross value of reduced energy", _money(s["gross_value"])],
        ["Less: cost of rebound energy after events", _money(-s["rebound_cost"])],
        ["Less: tenant compensation", _money(-s["tenant_compensation"])],
        ["Operator net revenue", _money(s["operator_net"])],
        ["SLA / tenant-rule violations in reported result", "0"],
    ], [4.6 * inch, 2.2 * inch]))
    story += [Spacer(1, 10), Image(_chart(result), width=6.9 * inch, height=2.5 * inch),
              Paragraph("Shaded bands are event windows. Hourly averages.", small)]

    story.append(Paragraph("By tenant", h2))
    rows = [["Tenant", "Events", "Job actions", "Energy (modeled)", "Compensation",
             "Most common exclusion"]]
    for t in result["tenants"]:
        excl = max(t["exclusions"].items(), key=lambda kv: kv[1])[0] if t["exclusions"] else ""
        rows.append([t["tenant_id"], t["events_participated"], t["jobs_affected"],
                     _energy(t["modeled_mwh"]), _money(t["compensation"]), excl.replace("_", " ")])
    story.append(_table(rows, [1.4 * inch, 0.6 * inch, 0.6 * inch, 1.0 * inch, 1.0 * inch, 2.2 * inch]))

    story.append(Paragraph("Largest events", h2))
    top = sorted(result["events"], key=lambda e: -e["firm_mwh"])[:12]
    rows = [["Start (UTC)", "Type", "Avg price", "Firm avg", "Energy", "Net"]]
    for e in top:
        rows.append([e["start"][:16].replace("T", " "), e["kind"], f"${e['avg_price']:,.0f}",
                     _power(e["firm_avg_mw"]), _energy(e["firm_mwh"]), _money(e["operator_net"])])
    story.append(_table(rows, [1.5 * inch, 0.8 * inch, 0.9 * inch, 0.9 * inch, 0.9 * inch, 1.0 * inch]))

    story += [PageBreak(), Paragraph("How this was computed", h2), Paragraph(
        "For every event window Curtail reconstructs the jobs that were running and their measured "
        "power, then solves an optimization (Google OR-Tools CP-SAT) that chooses at most one "
        "action per job: a GPU power cap, a pause after checkpointing, or a deferred start. Every "
        "tenant's opt-in, blackout windows, maximum reduction and guaranteed minimum power must "
        "hold in every 5-minute interval, and no job may finish later than its deadline. An "
        "independent verifier re-checks every decision against the raw tenant rules; anything "
        "that fails is removed before reporting. Where data is missing, the strict case is "
        "assumed (the job or tenant is protected) and the gap is listed below.", body),
        Paragraph(
            f"<b>Conservatism.</b> A safety margin of {p['safety_margin']:.0%} tightens every "
            "constraint and derates the reported reduction. Tenant compensation is charged on the "
            "un-derated reduction. Shifted energy is assumed to be bought back after the event at "
            "the following period's average price. "
            + ("Decisions were made with perfect knowledge of job power (hindsight)."
               if s["mode"] == "hindsight" else
               "Decisions were made with forecast job power and scored against actual power."),
            body)]

    story.append(Paragraph("Key assumptions", h2))
    rows = [["Parameter", "Value"]]
    for k in ("safety_margin", "price_threshold_per_mwh", "gpu_power_share", "inference_floor_frac",
              "checkpoint_minutes", "restart_minutes", "paused_power_frac", "facility_kw_per_it_kw",
              "energy_value_basis", "dr_payment_per_mwh", "default_compensation_per_mwh",
              "missing_deadline_policy", "missing_min_guaranteed_policy", "opt_in_rate", "objective"):
        rows.append([k.replace("_", " "), str(p[k])])
    curve = ", ".join(f"{c['power_frac']:.0%}→{c['throughput_frac']:.0%}" for c in p["cap_curve"])
    rows.append(["cap curve (power → throughput)", curve])
    story.append(_table(rows, [3.0 * inch, 3.8 * inch]))

    if result.get("flags"):
        story.append(Paragraph("Data gaps (handled strictly)", h2))
        rows = [["Count", "Item"]]
        for k, v in sorted(result["flags"].items(), key=lambda kv: -kv[1]):
            rows.append([str(v), FLAG_TEXT.get(k, k.replace("_", " "))])
        story.append(_table(rows, [0.8 * inch, 6.0 * inch]))

    story += [Spacer(1, 12), Paragraph(
        "Counterfactual estimate from historical data. It is not a guarantee of future results; "
        "see ASSUMPTIONS.md in the Curtail repository for every modeling assumption.", small)]
    doc.build(story)
    return buf.getvalue()
