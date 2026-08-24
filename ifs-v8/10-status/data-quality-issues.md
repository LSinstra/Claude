# Tracker data quality — problems found in `IFS Food v8.xlsx`

The master tracker is `IFS Food v8.xlsx`, Drive `1qOwcsLqeJXorHuQ7f6mfImkClb-kBL-r`
(IFS ▸ 2026 folder). Everything below was found by parsing the file, and all of it is fixable in
an afternoon. Fixing it matters because **the auditor may ask to see how you track your own
compliance** — 2.1.1 document control is itself auditable.

## 1. Two requirements have lost their clause number

Someone typed a note into the **N°** column, overwriting the identifier. Both rows are now
invisible to any sort or filter by clause:

| Row now reads | Should be | Requirement |
|---|---|---|
| `Čiščenje tal je že na planu, plan se trenutno updejta, lastnik je @aleksandra.kadiric@…` | **`4.9.3.1`** | Floor covering — design, construction, impervious and wear-resistant surfaces |
| `DN13 SKLADIŠČENJE .docx Plus potrdilo o izobraževanju` | **`4.14.1`** | All incoming goods checked against specifications and a risk-based monitoring plan |

Move the text to Resources/Notes and restore the clause numbers.

## 2. The "missing requirement" is a false alarm

The 11 Aug readiness assessment noted *"the tracker contains 233 requirements; IFS Food v8 has 234.
One requirement is missing and should be identified."*

**Verified against the standard PDF: IFS Food v8 has 232 requirements, and the tracker covers all
232.** The 233rd row is a stray note ("Selection of applicable European legislation • Regulation
852/2004 Annex 2 Chapter XII…") sitting in a requirement row with an empty N°. Nothing is missing.
Per chapter, standard and tracker agree exactly: 11 / 27 / 25 / 132 / 37.

*No one needs to spend time hunting for a 234th requirement.*

## 3. Three divergent copies of the same tracker exist

| Copy | Where | State |
|---|---|---|
| **`IFS Food v8.xlsx`, sheet `Requirements`** | IFS ▸ 2026 | **The live master.** 102 Done |
| Same file, sheet `rok ` | same file | Stale snapshot — only 29 Done; **129 rows disagree on status**, 96 on evidence, 39 on owner |
| `IFS Food v8` (native Google Sheet, `1OhouwpPwjc3E15AYym5D_9sSEdxAuomNMbQaET0P2jI`) | IFS ▸ 2026 | Last touched 6.7.2026 — a separate fork |
| `ARHIV IFS Requirements` (`12z0r-UHhKXNmyG_IPvzBlLTYXgLdoeqYxoEnaBw83pU`) | IFS ▸ 2026 | Archive, but modified 31.7.2026 |

Three live-looking versions of the compliance tracker is exactly the finding 2.1.1 exists to
catch. **Pick one master, mark the rest "ARHIV\_", and say which is which in the opening meeting.**

## 4. The project `Plan` sheet is not maintained

14 of 19 milestones read "Not started", including ones whose dates have passed:

| Milestone | Due | Sheet says | Reality |
|---|---|---|---|
| Conduct internal audit with Manja | 17.8.2026 | Not started | **Done** — executed 13–14.8.2026, report 15.8.2026 |
| Identify gaps | 19.8.2026 | Not started | Partly — 11 findings exist, not yet entered in OBR22 |
| Review last audit | 11.3.2026 | "In progess" (sic) | — |
| Close gaps | 1.9.2026 | Not started | — |

An auditor reading this sheet concludes the programme stalled in March. It did not — but the
record says it did, and the record is what gets audited.

## 5. Due dates are bulk-assigned, not planned

All 232 requirements carry one of **three** dates: 1.4.2026 (177), 1.6.2026 (53), 1.7.2026 (2).
**130 requirements (56%) are past due and not Done**, including 8 of the 10 KOs. Dates that all
expired months ago give the team no prioritisation signal.

## 6. Status vocabulary is ambiguous

Five values are in use — `Done`, `In progress`, `Needs a review`, `Re-check before audit`,
`Not started`. "Done" has already been shown to mean "procedure written", not "records exist and
were checked". Recommend splitting into two columns:

- **Procedure**: drafted / approved / signed
- **Evidence**: none / partial / running with records

That single change would have surfaced the 115 C-grades months ago.

## 7. Wrong requirement text at `4.16.1`

The tracker's requirement text at `4.16.1` reproduces the text of `4.12.10`. Re-copy from the
standard.

## 8. Certification body named incorrectly

Internal documents name **SIQ**. The actual CB is **Quality Austria (COID 85239)**, as evidenced by
the 23.1.2026 recall notification. Correct it wherever it appears — but check context first, SIQ
appears legitimately elsewhere as a training provider.
