# Workforce funding implementation plan

Add a **Workforce Funding** tab to the intake portal’s existing **Funding** workspace. Give portfolio owners a monthly view of team funding, spend, forecast, and runway across the portfolio and by line of business (LOB). Use it alongside the existing Resource allocation view when reviewing staffing and hiring decisions.

## What we’ll build

- **Funding register.** Use the workbook’s LOB, PR code, project name, and amount allocated to the team as the four entry fields. The amount represents the team’s share of the sponsor’s funding. Use the selected fiscal year and the workspace currency as context for the four fields.
- **Monthly actuals.** Open a PR and enter one closed-month total from the monthly charge report. Enter the reported dollar amount where available. When the report supplies hours only, require an approved hourly rate before converting them. Where rates vary, calculate the dollar total using the approved rates before entering the PR total. Allow explicit zero spend and track months with missing reports separately.
- **Portfolio and LOB views.** Default to all LOBs for the selected year and currency. Show allocated funding, actual spend, remaining funds, monthly burn rate, forecast spend at fiscal year-end, and estimated runway. Let users filter to one LOB and drill down to its PRs and monthly actuals.
- **Burndown.** Plot remaining dollars by month, with recorded actuals as a solid line and the projection as a dashed line. Mark zero, make overruns visible, and show the same numbers in a monthly table. Display the reporting cutoff and flag missing data.

## Implementation sequence

| Step | Owner | Deliverable and exit check |
| --- | --- | --- |
| 1. Build the review skeleton | Portal developer | Add the Workforce Funding tab inside `#/funding`. Use synthetic data for the four-field form, portfolio and LOB switching, PR detail, monthly entry, summary cards, and burndown. Show the skeleton to the funding workbook owner in a 5–10 minute walkthrough. |
| 2. Confirm the workbook and reporting rules | Funding workbook owner and monthly reporting owner | Review a sanitized workbook and a sample monthly charge report. Confirm the LOB list, fiscal dates, approved rate source, charge cutoff, zero-spend convention, and how amendments and recurring PR codes are handled. Record the decisions before wiring the prototype to stored financial data. |
| 3. Wire up manual entry | Portal developer | Extend the existing funding records and monthly charge API to support the workbook entry path. Save and edit budgets and actuals, validate amounts and months on the server, and log changes. Verify that records survive a portal restart and that updating a monthly total keeps one record for that PR and month. |
| 4. Add dollar reporting and finish the UI | Portal developer and UI owner | Add a server-side reporting view for approved funding and closed-month actuals. Wire the tab to it, reuse the portal’s table and chart components, and add empty, incomplete, and over-budget states. The UI owner takes over the skeleton for layout, accessibility, and final interaction polish. |
| 5. Reconcile and pilot | Funding workbook owner, monthly reporting owner, and portal developer | Load an agreed fiscal period in the authorized portal environment. Reconcile one portfolio total, one LOB, and at least two PRs against the workbook and monthly report. Run the first monthly update with the operator, then hand over a short entry and reconciliation guide. |

## Implement against the existing portal

The intake package already has a Funding view (`static/js/views/funding.js`), a funding API (`app/api/funding.py`), and SQLite tables for funding and monthly charges (`prn_budget` and `prn_charges`). The existing PR burndown (`app/engines/burndown.py`) is based on hours and can include planned allocations from linked initiatives. Keep that workflow available and add a dollar-based summary for Workforce Funding that works with manual entries alone.

- Map the four workbook fields to `lob`, `prn_code`, `name`, and `budget_amount`. Store the funding period and currency with each budget. Use the current normalized PR code and the monthly uniqueness constraint if the workbook confirms one allocation per code. If a code can recur across years or be split across LOBs, give each allocation a stable ID and migrate dependent records before importing real data.
- Reuse the budget and charge records, validation, transactions, and activity log. Update the amount-only entry path to represent unavailable hours and rates explicitly. Review the current required columns and default-rate behavior, then test any schema and API changes against existing hour-based records. Store the confirmed charge amount at entry so later rate edits preserve historical spend.
- For monthly actuals, validate the PR, reporting month, and finite nonnegative values. Add or edit the month’s total through the existing charge workflow. Record explicit zero as submitted, and handle corrections through the audit history. Keep source references short and leave employee-level charge records in the reporting system.
- Extend the funding summary to return totals and monthly series by fiscal period, LOB, and currency. Count confirmed team allocations as approved funding. Show any draft allocations separately. Keep currencies in separate totals and use decimal arithmetic for monetary calculations.

## Reporting rules for the baseline

| Measure | Definition |
| --- | --- |
| Allocated funding | Sum of confirmed team allocations in the selected fiscal period, LOB scope, and currency. |
| Actual spend | Sum of recorded charges through the selected closed month. If a selected PR lacks a required month, label the displayed actuals as incomplete. |
| Remaining | Allocated funding minus actual spend. Show a negative amount when spending exceeds funding. |
| Monthly burn rate | Proposed default for workbook review. Average the latest three consecutive complete months, or use two when only two are available. Include reported zero months. A portfolio or LOB month is complete once each active PR has submitted a total. |
| Year-end forecast | Actual spend plus monthly burn rate multiplied by the number of fiscal months after the cutoff. Show projected remaining separately from actual remaining. If actuals are incomplete or the burn rate is unavailable, show “Insufficient data.” |
| Runway | Divide remaining funds by a positive monthly burn rate. Show the projected exhaustion month when the burndown crosses zero within the displayed period. Use “Already exhausted” when the balance is zero or below, “No recent burn” for a zero rate, and “Insufficient data” when there is inadequate complete history or a reporting gap. |

**Synthetic reconciliation example.** An allocation of $24,000 has two closed months of $4,800 and $6,000 in charges. The first month can be entered as 40 hours at an approved $120/hour. The dashboard should show $10,800 spent, $13,200 remaining, a $5,400 monthly burn rate, and approximately 2.4 months of runway. If four fiscal months remain, forecast spend is $32,400 and forecast remaining is −$8,400.

## Acceptance checks

- A user can record an allocation and monthly actuals without linking an intake. Edits refresh the PR, LOB, and portfolio totals, and the same figures persist after restart.
- Two PRs in different LOBs reconcile to their portfolio total in the same currency. Switching LOB or fiscal period updates the cards, chart, and table together. Mixed currencies display distinct totals.
- Direct dollar entry and an approved hours-to-dollars conversion produce the same result for the same charge. Hours without a confirmed rate prompt for the missing input. A duplicate month is rejected and the operator can edit the existing entry.
- Missing data, explicit zero, insufficient history, and overspend have distinct display states. Funding forecasts never convert missing months into zero spend. Existing initiative links, allocation-based forecasts, and funding imports pass their regression checks.
- The funding workbook owner signs off on the reconciliation, the UI owner signs off on the tab, and the monthly operator can complete an update from the guide. Use synthetic data for public demonstrations and keep operational financial data in the authorized portal environment.

## Follow-on work

After the pilot, the funding reporting and intake owners will agree how PR allocations map to intake records, including shared funding and split charges. Evaluate automated monthly-charge ingestion and a funding-system connection separately once the team’s allocated share and its reconciliation rules can be verified. Add those integrations to the existing manual workflow after the owners approve the mappings and data access.
