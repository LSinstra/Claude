# IFS Food v8 — working memory

Everything needed to walk into the Juicy Marbles / BEVO d.o.o. IFS Food v8 audit knowing where
each piece of evidence is, what state it is in, and what will be scored against it.

> ## Status as at 24 August 2026: 🔴 **not ready — 24%**
> Foundation level needs **75%**. On top of the score there are **seven majors** (more than one =
> no certificate) and **five KOs at D** (any one = no certificate). Three independent grounds for
> failure. → **[SCORECARD.md](SCORECARD.md)**

## Read in this order

| # | File | What it gives you |
|---|---|---|
| 1 | **[SCORECARD.md](SCORECARD.md)** | The running score, three ways of measuring it, and why they disagree |
| 2 | **[10-status/ko-dashboard.md](10-status/ko-dashboard.md)** | The ten requirements that decide the audit, with distance-to-pass for each |
| 3 | **[10-status/open-findings.md](10-status/open-findings.md)** | Every open major, minor and credibility risk, deduplicated across both assessments — and what is genuinely strong |
| 4 | **[40-plan/action-plan.md](40-plan/action-plan.md)** | What to do, in order, and the rule for when it is safe to book the audit |
| 5 | **[30-audit-day/opening-meeting-pack.md](30-audit-day/opening-meeting-pack.md)** | Site facts, first-30-minutes checklist, what to say and what not to |

## The rest

```
00-standard/     the standard itself, verified against the PDF — not from memory
  ifs-food-v8-structure.md    232 requirements, 5 chapters, 10 KOs, scoring, thresholds
  official-guides-index.md    every official IFS document, its Drive ID, and the doctrine's
                              four Part-2 clarifications (two of which apply here)

10-status/       where the preparation actually stands
  ko-dashboard.md             the ten KOs
  chapter-1..5.md             all 232 requirements, tracker status + verified grade + audit finding
  open-findings.md            consolidated findings
  data-quality-issues.md      problems in the tracker itself, all fixable in an afternoon

20-evidence-map/ where the evidence lives
  drive-map.md                folder IDs for both Drives, plus what lives in Odoo and not the Drive
  document-index.md           DN/OBR/QP/HS codes → clauses → current condition of each record
  evidence-gaps.md            the 99 requirements naming no evidence, starred ones first

30-audit-day/    for the day itself
  opening-meeting-pack.md
  clause-cheatsheet.md        question → clause → document → record

40-plan/action-plan.md

data/            machine-readable
  requirement-register.csv/.json   all 232, one row each, every source merged
  std_reqs_final.json              the standard's own requirement text, extracted from the PDF
  sheets.json / real_reqs.json     raw tracker extraction
```

## Sources this was built from

| Source | Date | Role |
|---|---|---|
| `IFS_Food_v8_standard_EN.pdf` | Oct 2023 | Authoritative. All structural facts here were re-derived from it |
| `IFS_Food_v8_doctrine_v4_EN.pdf` | Jul 2025 | Binding clarifications |
| `IFS_Food_v8_audit_checklist_guideline_v1_EN.pdf` | — | Merged into the tracker's columns C–G |
| **`IFS Food v8.xlsx`** (Requirements sheet) | live, modified 24.8.2026 | The team's self-reported tracker — 232 requirements |
| **IFS_Food_v8_-_Readiness_Assessment** | 11 Aug 2026 | Evidence-verified gap analysis — records opened and read, Odoo queried |
| **Poročilo o notranji presoji IFS8** | 15 Aug 2026 | Internal audit, 13–14 Aug, 18 h, Manja Lampe — 11 NCs, 3 major |
| SC Folder Guide | v2.0, 16.2.2024 | Master document index (itself out of date) |

## Three corrections to things currently believed internally

1. **IFS Food v8 has 232 requirements, not 233 or 234, and the tracker covers all of them.**
   The readiness assessment's note about "one missing requirement" is a false alarm — the 233rd
   tracker row is a stray legislation note. Nobody needs to hunt for it.
   *(Verified per chapter against the standard: 11 / 27 / 25 / 132 / 37.)*
2. **There is no chapter 6.** Food defence is `4.21`, food fraud is `4.20`. Any material describing
   "chapter 6 — food defence" is v7. **The `ifs-auditee-helper` skill's reference file is v7-shaped
   and its KO list is wrong** — see below.
3. **A KO cannot be scored C.** The scale is A / KO-B (0 points) / D. A KO that cannot be
   positively demonstrated resolves to **D**, not to a soft middle grade. Also: starred (★)
   requirements carry **no extra scoring weight** — they only require compulsory explanation in the
   report.

### ⚠️ The audit-helper skill needs fixing before audit day

`references/ifs_food_v8_structure.md` in the `ifs-auditee-helper` skill lists the **v7** KO
clauses. Eight of its ten KO numbers are wrong:

| Skill says (v7) | Actually v8 |
|---|---|
| 2.2.3.8.1 | `2.3.9.1` |
| 3.2.1.2 | `3.2.2` |
| 4.2.1.2 | `4.2.1.3` |
| 4.2.2.1 | *(not a KO in v8)* — KO 4 is `4.1.3` |
| 5.6.1 | `5.1.1` |
| 5.9.2 | `5.9.1` |
| 5.11.2 | `5.11.3` |
| "Chapter 6 — Food Defence" | `4.21` |

Only `1.2.1`, `4.12.1` and `4.18.1` are right. Citing a wrong clause number to an auditor costs
credibility in the first minute. **Replace that file's content with
[00-standard/ifs-food-v8-structure.md](00-standard/ifs-food-v8-structure.md).**

## Keeping this current

The scorecard is only as good as its last **evidence pass** — opening records, not reading status
columns. The tracker's self-report has already been shown to overstate readiness by ~20 points.
When re-scoring, add a row to the history table in `SCORECARD.md` and say which pass it came from.
